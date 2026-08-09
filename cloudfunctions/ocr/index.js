// cloudfunctions/ocr/index.js
// 作用：云端 OCR 文字识别，调用百度智能云 general_basic，绕过「个人主体小程序无法使用插件」的限制。
// 部署：右键 cloudfunctions/ocr -> 上传并部署（云端安装依赖）
// 依赖：在 config.js 填入你自己的百度 API Key / Secret Key（文字识别）
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
  const { fileID } = event;
  if (!cfg.baidu.apiKey || cfg.baidu.apiKey === 'YOUR_API_KEY') {
    return { ok: false, code: 'NOT_CONFIGURED', msg: '请先在 cloudfunctions/ocr/config.js 填写百度智能云 API Key / Secret Key（文字识别）' };
  }
  if (!fileID) return { ok: false, code: 'NO_FILE' };
  try {
    const token = await getToken();
    const { fileContent } = await cloud.downloadFile({ fileID });
    const base64 = fileContent.toString('base64');
    const body = qs.stringify({ image: base64, language_type: 'CHN_ENG', detect_direction: true });
    const r = await postForm('https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token=' + token, body);
    let j;
    try { j = JSON.parse(r.buf.toString()); } catch (e) { return { ok: false, code: 'OCR_PARSE', msg: 'OCR 结果解析失败' }; }
    if (j.error_code) return { ok: false, code: 'OCR_FAIL', msg: j.error_msg || 'OCR 失败' };
    const text = (j.words_result || []).map(w => w.words).join('\n');
    return { ok: true, text };
  } catch (e) {
    return { ok: false, code: 'ERR', msg: e.message };
  }
};
