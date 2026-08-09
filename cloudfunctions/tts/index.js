// cloudfunctions/tts/index.js
// 作用：云端语音合成(TTS) + 语音识别(ASR)，调用百度智能云，绕过「个人主体小程序无法使用插件」的限制。
// 部署：右键 cloudfunctions/tts -> 上传并部署（云端安装依赖）
// 依赖：在 config.js 填入你自己的百度 API Key / Secret Key
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const https = require('https');
const qs = require('querystring');
const cfg = require('./config.js');

let tokenCache = { token: '', exp: 0 };

function getToken() {
  if (tokenCache.token && tokenCache.exp > Date.now()) return Promise.resolve(tokenCache.token);
  const url = 'https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=' +
    encodeURIComponent(cfg.baidu.apiKey) + '&client_secret=' + encodeURIComponent(cfg.baidu.secretKey);
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.access_token) { tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in - 300) * 1000 }; resolve(j.access_token); }
          else reject(new Error(j.error_description || '获取百度 token 失败'));
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function postForm(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks), contentType: res.headers['content-type'] }));
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

exports.main = async (event) => {
  const { action, text, fileID, lang = 'en' } = event;
  if (!cfg.baidu.apiKey || cfg.baidu.apiKey === 'YOUR_API_KEY') {
    return { ok: false, code: 'NOT_CONFIGURED', msg: '请先在 cloudfunctions/tts/config.js 填写百度智能云 API Key / Secret Key' };
  }
  try {
    const token = await getToken();
    if (action === 'tts') {
      if (!text) return { ok: false, code: 'NO_TEXT' };
      // 百度语音合成：aue=3 => mp3；lan=en 英文；per 音色
      const per = lang === 'en' ? 0 : 0;
      const body = qs.stringify({ tex: text, tok: token, cuid: 'yaya-workbench', ctp: 1, lan: lang === 'en' ? 'en' : 'zh', spd: 5, pit: 5, vol: 5, aue: 3, per });
      const r = await postForm('https://tsn.baidubce.com/text2audio', body);
      if (!r.contentType || r.contentType.indexOf('audio') === -1) {
        let err = 'TTS 失败';
        try { err = JSON.parse(r.buf.toString()).error_msg || err; } catch (e) {}
        return { ok: false, code: 'TTS_FAIL', msg: err };
      }
      const cloudPath = 'tts/' + Date.now() + '.mp3';
      await cloud.uploadFile({ cloudPath, fileContent: r.buf });
      const { fileList } = await cloud.getTempFileURL({ fileList: [cloudPath] });
      return { ok: true, url: fileList[0].tempFileURL };
    }
    if (action === 'asr') {
      if (!fileID) return { ok: false, code: 'NO_FILE' };
      const { fileContent } = await cloud.downloadFile({ fileID });
      const base64 = fileContent.toString('base64');
      const body = qs.stringify({ speech: base64, format: 'wav', rate: 16000, channel: 1, cuid: 'yaya', token, len: fileContent.length });
      const r = await postForm('https://vop.baidu.com/server_api', body);
      let j;
      try { j = JSON.parse(r.buf.toString()); } catch (e) { return { ok: false, code: 'ASR_PARSE', msg: '识别结果解析失败' }; }
      if (j.err_no === 0 && j.result) return { ok: true, text: j.result[0] };
      return { ok: false, code: 'ASR_FAIL', msg: j.err_msg || '识别失败' };
    }
    return { ok: false, code: 'BAD_ACTION' };
  } catch (e) {
    return { ok: false, code: 'ERR', msg: e.message };
  }
};
