// modules/index.js —— 模块注册表（与源文件 LifePlan 的导航/模块一一对应）
//
// type 决定模块详情页如何渲染与存数据（全部写入 records 集合，靠 module 字段区分）：
//   todo    -> 待办清单
//   number  -> 数值记录（体重，含早晨/晚上）
//   account -> 记账
//   text    -> 文字记录（饮食/感受）
//   content -> 系统内容，不存用户数据，仅展示（五行穿搭/英语练习）
//   mood    -> 心情日记
//   exercise-> 运动打卡（有氧/无氧/HIIT）
//   body    -> 体态管理（每日 15 分钟）
//   media   -> 自媒体灵感
//   goals   -> 年度目标
//   travel  -> 旅游规划
// tag 是卡片上的图标（emoji，与源文件侧边栏一致）。

const MODULES = [
  { id: 'daily_todo', name: '日常待办', tag: '📋', desc: '今天的待办清单',       category: '工作', type: 'todo',    collection: 'records', defaultOn: true },
  { id: 'weight',     name: '体重记录', tag: '⚖️', desc: '记录每日体重变化',     category: '生活', type: 'number',  collection: 'records', unit: 'kg', defaultOn: true },
  { id: 'wuxing',     name: '五行穿搭', tag: '🔮', desc: '今日大吉色穿搭',       category: '生活', type: 'content', collection: null,      defaultOn: true },
  { id: 'accounting', name: '今日记账', tag: '💵', desc: '记一笔收支',           category: '购物', type: 'account', collection: 'records', defaultOn: true },
  { id: 'diet',       name: '饮食记录', tag: '🍱', desc: '记录今天吃了什么',     category: '健身', type: 'text',    collection: 'records', defaultOn: true },
  { id: 'english',    name: '英语练习', tag: '💬', desc: '每日口语 + 词汇',      category: '学习', type: 'content', collection: null,      defaultOn: true },
  { id: 'exercise',   name: '运动打卡', tag: '🏊‍♀️', desc: '有氧/无氧/HIIT',        category: '健身', type: 'exercise', collection: 'records', defaultOn: true },
  { id: 'body',       name: '体态管理', tag: '🩰', desc: '每天 15 分钟体态训练', category: '健身', type: 'body',    collection: 'records', defaultOn: true },
  { id: 'mood',       name: '心情日记', tag: '🥰', desc: '记录今日心情',         category: '个人', type: 'mood',    collection: 'records', defaultOn: true },
  { id: 'feeling',    name: '感受体验', tag: '📜', desc: '写下今日感受',         category: '个人', type: 'text',    collection: 'records', defaultOn: true },
  { id: 'media',      name: '自媒体灵感', tag: '💡', desc: '灵感/规划/已发布',   category: '工作', type: 'media',   collection: 'records', defaultOn: true },
  { id: 'goals',      name: '年度目标', tag: '🧸', desc: '年度目标清单',         category: '个人', type: 'goals',   collection: 'records', defaultOn: true },
  { id: 'travel',     name: '旅游规划', tag: '✈️', desc: '出行计划与足迹',       category: '生活', type: 'travel',  collection: 'records', defaultOn: true }
];

// 默认全部启用（与源文件仪表盘默认展示全部模块一致）
const DEFAULT_ENABLED = MODULES.filter(m => m.defaultOn).map(m => m.id);

function getModule(id) {
  return MODULES.find(m => m.id === id) || null;
}

module.exports = { MODULES, DEFAULT_ENABLED, getModule };
