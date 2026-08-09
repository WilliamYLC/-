const cloud = require('wx-server-sdk');
const { blockWords } = require('./config');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 内容安全云函数
// - text：本地敏感词兜底审核（fail-open，异常不阻断）
// - image：预留（个人主体暂不支持外部图片审核），返回 skip 不拦截
exports.main = async (event, context) => {
  const action = (event && event.action) || 'text';

  if (action === 'text') {
    const content = event.content || '';
    const arr = Array.isArray(content) ? content : [content];
    const hits = [];
    for (const raw of arr) {
      const s = String(raw == null ? '' : raw);
      for (const w of blockWords) {
        if (s.indexOf(w) >= 0 && hits.indexOf(w) < 0) hits.push(w);
      }
    }
    return {
      pass: hits.length === 0,
      hits,
      msg: hits.length ? '内容包含敏感词：' + hits.join('、') : ''
    };
  }

  if (action === 'image') {
    // 图片审核需外部服务（个人主体暂不支持），暂不拦截
    return { pass: true, skip: true, msg: '图片审核跳过（需配置外部审核）' };
  }

  return { pass: true, skip: true };
};
