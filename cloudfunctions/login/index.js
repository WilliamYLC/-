// cloudfunctions/login/index.js
// 作用：用微信云开发拿到当前用户的 OPENID（稳定且唯一），
//      并初始化 user_profile 与 user_modules（默认启用全部模块）。
//
// 部署：在微信开发者工具里右键 cloudfunctions/login -> 上传并部署（云端安装依赖）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// 默认启用模块（与 modules/index.js 的 DEFAULT_ENABLED 保持一致：13 个模块全部默认开启）
const DEFAULT_ENABLED = [
  'daily_todo', 'weight', 'wuxing', 'accounting',
  'diet', 'english', 'exercise', 'body',
  'mood', 'feeling', 'media', 'goals', 'travel'
];

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { openid: '', enabled: [] };
  }

  // 初始化 user_profile（首次进入时创建）
  const profileRes = await db.collection('user_profile')
    .where({ _openid: OPENID })
    .get()
    .catch(() => ({ data: [] }));
  if (!profileRes.data || profileRes.data.length === 0) {
    await db.collection('user_profile').add({ data: { createdAt: new Date() } });
  }

  // 初始化 user_modules（首次进入时写入默认启用项）
  const umRes = await db.collection('user_modules')
    .where({ _openid: OPENID })
    .get()
    .catch(() => ({ data: [] }));
  let enabled = DEFAULT_ENABLED;
  if (umRes.data && umRes.data.length > 0) {
    enabled = umRes.data[0].enabled || DEFAULT_ENABLED;
  } else {
    await db.collection('user_modules').add({ data: { enabled: DEFAULT_ENABLED } });
  }

  return { openid: OPENID, enabled };
};
