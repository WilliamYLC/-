// workbench.js —— SPA 外壳 + 13 模块读写（全部走 CloudBase records，按 module 字段区分）
const db = wx.cloud.database();
const _ = db.command;
const { today, weekday, dateCN } = require('../../utils/date.js');
const { getWuxing } = require('../../utils/wuxing.js');
const { MODULES, getModule } = require('../../modules/index.js');

// 语料库（各 370+ / 520 条，按日期种子轮转，保证 365 天不重复）
const WARM_PHRASES = require('../../data/warm.js');      // 370 条暖心话
const TRAVEL_DB = require('../../data/travel.js');        // 370 条旅行灵感（{name,bestMonth,note,tags}）
const ENGLISH_PHRASES = require('../../data/english-phrase.js'); // 520 条每日口语（{en,cn,ex}）
const ENGLISH_VOCAB = require('../../data/english-vocab.js');    // 370 条每日词汇（{en,ph,cn}）

// 语音/识别统一走云端函数（个人主体小程序无法使用插件，故改为云函数调用外部 API）
function cloudVoice(action, payload) {
  return wx.cloud.callFunction({ name: 'tts', data: Object.assign({ action }, payload) });
}

const PHRASES = [
  '把每一件小事做完，就是稳定的进步。',
  '今天也温柔地对待自己。',
  '轻盈，从一次深呼吸开始。',
  '完成比完美更重要。',
  '你的节奏，就是最好的节奏。',
  '慢慢来，比较快。'
];

// 仪表盘 8 卡片顺序（对齐源 LifePlan-可继续编辑.html 行 10638-10646）
const DASH_ORDER = ['daily_todo','weight','wuxing','accounting','diet','english','exercise','feeling'];
// map module id -> 卡片显示文案/描述（与 dashboard 同步更新）
const DASH_META = {
  daily_todo: { emoji:'📋', name:'日常待办', descDone:n=>`${n.done}/${n.total} 项完成`, descEmpty:'还没有添加待办' },
  weight:     { emoji:'⚖️', name:'体重记录', descDone:'今日体重已记录', descEmpty:'今日体重未记录' },
  wuxing:     { emoji:'🔮', name:'五行穿搭', descDone:'查看今日穿衣', descEmpty:'点击查看今日穿衣指南' },
  accounting: { emoji:'💵', name:'今日记账', descDone:n=>`本月支出 ¥${n.expense}`, descEmpty:'添加第一笔账单' },
  diet:       { emoji:'🍱', name:'饮食记录', descDone:n=>`今日摄入 ${Math.round(n.kcal)} kcal`, descEmpty:'等待记录今日饮食' },
  english:    { emoji:'💬', name:'英语练习', descDone:'英语练习完成', descEmpty:'每日口语+词汇练习' },
  exercise:   { emoji:'🏊', name:'健身运动', descDone:'今日运动已完成', descEmpty:'等待完成运动打卡' },
  feeling:    { emoji:'📜', name:'感受体验', descDone:'已记录今日感受', descEmpty:'写下今日感受' }
};

// 饮食份量单位 → 折算克数（估算基准，可按需调整）
const DIET_UNIT_G = { '克': 1, '碗': 150, '个': 50, '份': 100 };

// 待办分类 + 图标（对齐源）
const TODO_CAT_ICONS = [
  { name:'工作', icon:'💼' },{ name:'个人', icon:'👤' },{ name:'购物', icon:'🛒' },
  { name:'健身', icon:'💪' },{ name:'学习', icon:'📚' },{ name:'生活', icon:'🌱' }
];
// 待办三段
const TODO_BUCKETS = [
  { key:'today', label:'今日待办', needDate:false },
  { key:'soon',  label:'近期待办（7天内）', needDate:true, daysFromNow:1, maxDays:7 },
  { key:'later', label:'以后 / 不限时间', needDate:true }
];

// 记账类别（对齐源：支出 12 / 收入 6）
const EXPENSE_CATS = ['餐饮','交通','购物','娱乐','住房','医疗','教育','工资','理财','日用','通讯','其他'];
const INCOME_CATS = ['工资','理财','兼职','红包','奖金','其他'];

// 自媒体平台 + 状态
const MEDIA_PLATFORMS = ['小红书','抖音','微博','公众号','B站','朋友圈','其他'];
const MEDIA_STATUSES = ['💡灵感','📝规划中','✅已发布'];

// 年度目标分类
const GOAL_CATS = ['事业','健康','学习','生活','财务','其他'];

// 心情 emoji（7 个，对应 score 5/4/3/2/1/0/6 与源一致）
const MOOD_EMOJIS = ['🥰','😊','🙂','😐','😔','😢','🥹'];
const MOOD_SCORE_MAP = {'🥰':5,'😊':4,'🙂':3,'😐':2,'😔':1,'😢':0,'🥹':6};

// 每日英语口语语料（520 条）见 data/english-phrase.js

// 每日词汇库（370 条）见 data/english-vocab.js

// 暖心话语料（370 条）见 data/warm.js

// ===== 工具：日期种子 + 选条 =====
// 返回自 2026-01-01 起的连续天数序号（每天 +1）。
// 配合 (seed*K) % len（K 与 len 互质）即可在 len 天内无重复轮转，满足 365 天不重复。
function dailySeed(offset=0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  const epoch = new Date(2026, 0, 1);
  return Math.floor((d - epoch) / 86400000);
}
// 从语料库按日期种子取连续 n 条（轮转，保证当天固定、隔天不同、全年不重复）
function pickRot(arr, seed, n, factor) {
  const len = arr.length;
  const base = ((seed % len) * (factor % len)) % len;
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[(base + i) % len]);
  return out;
}

const NAV_MAIN = [
  { key: 'dashboard', icon: '🏡', label: '首页' },
  { key: 'daily_todo', icon: '📋', label: '待办' },
  { key: 'weight', icon: '⚖️', label: '体重' },
  { key: 'wuxing', icon: '🔮', label: '五行' },
  { key: 'diet', icon: '🍱', label: '饮食' },
  { key: 'accounting', icon: '💵', label: '记账' },
  { key: 'exercise', icon: '🏊', label: '运动' },
  { key: 'body', icon: '🩰', label: '体态' },
  { key: 'english', icon: '💬', label: '英语' },
  { key: 'mood', icon: '🥰', label: '心情' },
  { key: 'feeling', icon: '📜', label: '感受' },
  { key: 'travel', icon: '✈️', label: '旅游' },
  { key: 'media', icon: '💡', label: '灵感' },
  { key: 'goals', icon: '🧸', label: '目标' }
];
const NAV_BOTTOM = [
  { key: 'weekly', icon: '🗳️', label: '周报', special: true },
  { key: 'settings', icon: '⚙️', label: '设置' }
];

const TITLES = {
  dashboard: '鸭鸭', daily_todo: '待办清单', weight: '体重记录', wuxing: '五行穿衣',
  diet: '饮食记录', accounting: '今日记账', exercise: '运动打卡', body: '体态管理',
  english: '每日英语', mood: '心情日记', feeling: '感受体验', travel: '旅游规划',
  media: '自媒体灵感', goals: '年度目标', weekly: '周度分析', settings: '设置'
};

const EX_TYPES = [
  { type: '有氧', emoji: '🏃', title: '有氧', desc: '跑步、椭圆机、跳绳、游泳' },
  { type: '无氧', emoji: '🏋️', title: '无氧', desc: '力量训练、器械训练' },
  { type: '混氧HIIT', emoji: '🔥', title: '混氧HIIT', desc: '高强度间歇、波比跳、战绳' }
];
const WX_DAYS = ['今天', '明天', '后天', '第4天', '第5天', '第6天', '第7天'];
const BG_PRESETS = [
  { name: '🌸浅紫', c1: '#EDD5E8', c2: '#F5DCEE', a: 160 },
  { name: '🍑蜜桃', c1: '#FFE0D0', c2: '#FFF1E6', a: 160 },
  { name: '🌿抹茶', c1: '#D8F0D8', c2: '#EAF8EA', a: 160 },
  { name: '💜薰衣草', c1: '#E8B4E8', c2: '#F5D4F5', a: 160 },
  { name: '☀️暖阳', c1: '#FFF3D0', c2: '#FFF8E6', a: 160 },
  { name: '❄️冰雪', c1: '#D6ECF5', c2: '#EAF6FB', a: 160 }
];

// 默认（第一版）品牌主题：色码严格对齐 web 源 :root 变量。
// ⚠️ 上一轮我把 c1/c2/a 误填成 --gradient 的起止色（#E8B4E8/#F5DEE0/135°），
// 导致"恢复默认"会跳到偏紫的发闷版本 —— 与 web 端 --bg（粉嫩原版）不一致。
// 真正的"第一版背景"是 --bg：linear-gradient(160deg, #EDD5E8 0%, #F5DCEE 100%)。
const BG_ANGLES = ['↘ 135°', '↘ 160°', '↓ 180°', '→ 90°', '↘ 45°', '↑ 0°']; // 对齐 web select 顺序
const BG_ANGLE_VALS = [135, 160, 180, 90, 45, 0];
// 背景方案版本号：每次 DEFAULT_THEME 色码/角度变了，+1。
// 旧用户 storage 里的 bg 若 version 落后，自动重置到当前默认值，避免"恢复默认"颜色还对不上。
const BG_VERSION = 8;
const DEFAULT_THEME = {
  c1: '#E8B4E8',       // 背景起始（对齐主页 hero 卡片渐变 0% 色）
  c2: '#F5DEE0',       // 背景结束（对齐主页 hero 卡片渐变 100% 色）
  a: 135,              // 背景角度（对齐主页 hero 卡片渐变 135deg）
  primary: '#B57EDC',  // 对齐 web --primary（按钮/章节色）
  primaryDark: '#7B4FA0', // 对齐 web --primary-dark（标题色）
  tint: '#F5EEF5',     // 对齐 web --tint（输入框底色）
  // 主页 hero 卡片使用的紫粉渐变（4 站）—— 初始页背景也用这一组，保证两边完全一致
  gradient: 'linear-gradient(135deg, #E8B4E8 0%, #F0C4E8 30%, #F5D4D4 70%, #F5DEE0 100%)'
};

// 城市 → 省份推断（源 WORLD_CITIES 精简，用于足迹添加时自动识别省份）
const WORLD_CITIES = [
  { name: '北京', province: '北京' }, { name: '上海', province: '上海' }, { name: '广州', province: '广东' },
  { name: '深圳', province: '广东' }, { name: '成都', province: '四川' }, { name: '杭州', province: '浙江' },
  { name: '西安', province: '陕西' }, { name: '重庆', province: '重庆' }, { name: '昆明', province: '云南' },
  { name: '拉萨', province: '西藏' }, { name: '乌鲁木齐', province: '新疆' }, { name: '哈尔滨', province: '黑龙江' },
  { name: '天津', province: '天津' }, { name: '武汉', province: '湖北' }, { name: '南京', province: '江苏' },
  { name: '青岛', province: '山东' }, { name: '大连', province: '辽宁' }, { name: '厦门', province: '福建' },
  { name: '长沙', province: '湖南' }, { name: '郑州', province: '河南' }, { name: '太原', province: '山西' },
  { name: '石家庄', province: '河北' }, { name: '呼和浩特', province: '内蒙古' }, { name: '银川', province: '宁夏' },
  { name: '西宁', province: '青海' }, { name: '兰州', province: '甘肃' }, { name: '海口', province: '海南' },
  { name: '三亚', province: '海南' }, { name: '台北', province: '台湾' }, { name: '香港', province: '香港' },
  { name: '澳门', province: '澳门' }, { name: '贵阳', province: '贵州' }, { name: '南宁', province: '广西' },
  { name: '长春', province: '吉林' }, { name: '沈阳', province: '辽宁' }, { name: '济南', province: '山东' },
  { name: '合肥', province: '安徽' }, { name: '南昌', province: '江西' }, { name: '福州', province: '福建' },
  { name: '苏州', province: '江苏' }, { name: '丽江', province: '云南' }, { name: '桂林', province: '广西' },
  { name: '敦煌', province: '甘肃' }, { name: '张家界', province: '湖南' }, { name: '九寨沟', province: '四川' },
  { name: '珠海', province: '广东' }, { name: '大理', province: '云南' },
  { name: '东京', province: '日本' }, { name: '京都', province: '日本' }, { name: '大阪', province: '日本' },
  { name: '首尔', province: '韩国' }, { name: '曼谷', province: '泰国' }, { name: '清迈', province: '泰国' },
  { name: '新加坡', province: '新加坡' }, { name: '巴黎', province: '法国' }, { name: '伦敦', province: '英国' },
  { name: '纽约', province: '美国' }, { name: '洛杉矶', province: '美国' }, { name: '悉尼', province: '澳大利亚' },
  { name: '迪拜', province: '阿联酋' }
];

// 旅行灵感语料（370 条）见 data/travel.js

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

Page({
  data: {
    section: 'dashboard', pageTitle: '鸭鸭', railOpen: true,
    navMain: NAV_MAIN, navBottom: NAV_BOTTOM,
    dateText: '', phrase: '', cards: [], done: 0, total: 0, pct: 0,
    enabled: [], openid: '',
    // 欢迎页
    welcomeOpen: true, welcomeQuote: '', welcomeTip: '', welcomeGreeting: '你好',
    // 用户信息
    userName: '鸭鸭', userAvatar: '/assets/brand-avatar.png',
    profileOpen: false, profileEditName: '',
    // 待办（三段）
    todoCats: TODO_CAT_ICONS, todoCat: '工作', todoCatIcon: '💼',
    newTodo: '', todoList: [],
    todoToday: [], todoSoon: [], todoLater: [], todoTodayCount: 0, todoSoonCount: 0, todoLaterCount: 0,
    todoInlineToday: '', todoInlineSoon: '', todoInlineLater: '',
    todoLaterRange: ['今天', '明天', '3 天后', '一周后', '一个月后', '未来（不限）'],
    todoLaterRangeIdx: 5, // 默认"未来"
    todoSoonDate: '', todoLaterDate: '',
    // 体重
    wMorning: '', wEvening: '', wDate: '', wTodayM: '--', wTodayE: '--', wDiff: '--', wTodayMax: '--', wTodayDateCN: '', wDoneToday: false, wHistory: [], wHistoryCount: 0,
    // 体重编辑弹窗
    wEditOpen: false, wEditId: '', wEditDate: '', wEditMorning: '', wEditEvening: '',
    // 五行（lunar-driven，7 天 chips）
    wxDays: WX_DAYS, wxDayIdx: 0, wxData: null, wxDataArr: [],
    // 饮食
    dietCal: '', dietContent: '', dietPortion: '', dietPortionUnits: ['克', '碗', '个', '份'], dietPortionIdx: 0, dietList: [], dietMeals: ['早餐', '午餐', '晚餐', '加餐'], dietMeal: '午餐', dietMealIndex: 1,
    // 饮食计划（独立 sub-section）
    dietPlanDate: '', dietPlanMeal: '早餐', dietPlanMealIdx: 0,
    dietPlanContent: '', dietPlanCal: '', dietPlanList: [],
    // 记账（支出/收入双类别 + 日期）
    accType: 'expense', accAmount: '', accCat: '餐饮', accNote: '', accList: [], accDate: '',
    expenseCats: EXPENSE_CATS, incomeCats: INCOME_CATS, accCatIdx: 0,
    monthIncome: '0', monthExpense: '0', monthBalance: '0',
    // 运动
    exTypes: EX_TYPES, exList: [], exOpen: false, exLabel: '', exType: '', exMinutes: '',
    // 体态（含日历）
    bodyList: [], bodyCalendar: [], bodyDoneToday: false, bodyYear: 0, bodyMonth: 0,
    // 心情
    moodEmojis: MOOD_EMOJIS, mood: '🥰', moodText: '', moodList: [],
    // 感受
    feelingText: '', feelingList: [], feelingCount: '0 条', feelingEditing: '',
    // 自媒体
    mediaPlatforms: MEDIA_PLATFORMS, mediaPlatformIdx: 0,
    mediaStatusList: MEDIA_STATUSES, mediaStatusIdx: 0,
    mediaTitle: '', mediaContent: '', mediaList: [], mediaCount: '0 条',
    // 目标（6 类下拉）
    goalCats: GOAL_CATS, goalCatIdx: 0,
    goalText: '', goalsList: [], goalsCount: '0/0',
    // 英语（5 口语 + 5 词汇；offset 0 为今天；7 天 chips）
    englishOffset: 0, englishPhrases: [], englishVocab: [],
    // 旅游
    travelTitle: '', travelDesc: '', travelList: [], travelPaste: '',
    // 我的足迹
    fpProvinces: 0, fpCities: 0, fpCoords: 0, footprintList: [],
    fpModalOpen: false, fpCity: '', fpDate: '', fpNote: '',
    // 旅行灵感
    inspirationList: [],
    // 设置
    bg1: DEFAULT_THEME.c1, bg2: DEFAULT_THEME.c2,
    bgMid: '#EFC9E9', // fallback（仅自定义配色时才用；默认走 hero 4 站渐变，不依赖它）
    bgGradient: DEFAULT_THEME.gradient, // 初始页/主页背景渐变字符串（默认 = 主页 hero 卡片渐变）
    bgAngle: String(DEFAULT_THEME.a),
    bgAngleIdx: 0, // 默认 135°（对齐主页 hero 卡片渐变；BG_ANGLE_VALS[0] = 135）
    bgAngles: BG_ANGLES,
    bgPresets: BG_PRESETS, showPalette: '',
    colorBoard: [
      { hex: '#F8E1E7' }, { hex: '#FCE7F3' }, { hex: '#F3E8FB' },
      { hex: '#E8D5F5' }, { hex: '#D5F5F3' }, { hex: '#D5E8F5' },
      { hex: '#F5E8D5' }, { hex: '#FFF3D0' }, { hex: '#D8F0D8' },
      { hex: '#FFE0D0' }, { hex: '#FFD5E5' }, { hex: '#E8B4E8' }
    ],
    // 周报
    weekTotal: 0, weekTodo: 0, weekMood: 0, weekInsight: '',
    // AI
    aiOpen: false, aiText: '', aiPreview: '', aiAction: null, voiceStatus: '',
    // 隐私授权弹窗
    privacyShow: false
  },

  onLoad() {
    const d = new Date();
    const seed = dailySeed(0);
    const phrase = WARM_PHRASES[seed % WARM_PHRASES.length];
    this.setData({ dateText: dateCN(), phrase });
    // 欢迎页：每次进入都展示（对齐源：每次打开链接都先见欢迎页）
    const qIdx = seed % WARM_PHRASES.length;
    const h = d.getHours();
    const greet = h < 6 ? '凌晨好' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : h < 22 ? '晚上好' : '夜深了';
    this.setData({
      welcomeOpen: true,
      welcomeGreeting: greet,
      welcomeQuote: WARM_PHRASES[qIdx],
      welcomeTip: WARM_PHRASES[(qIdx + 3) % WARM_PHRASES.length]
    });
    this.loadUserProfile();
    this.loadProfile();
    this.loadDashboard();
    // 隐私授权：基础库支持时查询是否需要弹授权（配合 __usePrivacyCheck__）
    if (wx.getPrivacySetting) {
      wx.getPrivacySetting({
        success: (res) => { if (res && res.needAuthorization) this.setData({ privacyShow: true }); },
        fail: () => {}
      });
    }
    // 云开发未就绪诊断：onLaunch 调 login 失败时主动提醒用户去部署云函数，避免盲点按钮
    setTimeout(() => {
      const app = getApp();
      if (!app.globalData.openid && app.globalData.loginError && !this._warnedCloud) {
        this._warnedCloud = true;
        wx.showModal({
          title: '云开发未就绪',
          content: '登录云函数调用失败：' + app.globalData.loginError +
            '\n\n这通常意味着云函数未部署。请按以下步骤修复：\n\n1. 微信开发者工具左侧树右键 cloudfunctions/login（以及 tts / ocr / security）→「上传并部署：云端安装依赖」\n2. 云开发控制台建 3 个集合：records / user_profile / user_modules，权限全选「仅创建者可读写」\n3. 重新编译小程序即可正常登录、备份、清空。',
          showCancel: false,
          confirmText: '好的，我去部署'
        });
      }
    }, 800);
  },

  // ----- 隐私授权 -----
  openPrivacyContract() {
    if (wx.openPrivacyContract) wx.openPrivacyContract({ fail: () => {} });
  },
  onAgreePrivacy() {
    this.setData({ privacyShow: false });
    const app = getApp();
    if (app && app.globalData._privacyResolve) {
      try { app.globalData._privacyResolve(); } catch (e) {}
      app.globalData._privacyResolve = null;
      app.globalData._privacyReject = null;
    }
  },
  onDenyPrivacy() {
    this.setData({ privacyShow: false });
    const app = getApp();
    if (app && app.globalData._privacyReject) {
      try { app.globalData._privacyReject({ errMsg: 'user denied' }); } catch (e) {}
      app.globalData._privacyReject = null;
      app.globalData._privacyResolve = null;
    }
  },

  // 统一入口：调用 wx.requirePrivacyAuthorize，未声明时给 modal 指引
  _ensurePrivacy(apiName) {
    if (!wx.requirePrivacyAuthorize) return Promise.resolve(true);
    return new Promise(resolve => {
      wx.requirePrivacyAuthorize({
        apiName,
        success: () => resolve(true),
        fail: (err) => {
          const msg = (err && err.errMsg) || '';
          if (msg.indexOf('api scope is not declared') !== -1 || msg.indexOf('not declared') !== -1) {
            wx.showModal({
              title: '需要在后台声明权限',
              content: '调用 "' + apiName + '" 前，需要在微信小程序后台\n【设置 → 服务内容声明 → 用户隐私保护指引】\n中添加：\n\n• 麦克风（scope.record）\n• 相册照片（chooseMedia / scope.album）\n• 摄像头（scope.camera）\n\n保存并审核通过后，重新进入页面即可使用。',
              confirmText: '我知道了', showCancel: false
            });
          } else {
            wx.showToast({ title: '已取消授权', icon: 'none' });
          }
          resolve(false);
        }
      });
    });
  },

  // ----- 内容安全（fail-open：云函数异常不阻断用户写库） -----
  safeText(content) {
    if (!content || !String(content).trim()) return Promise.resolve(true);
    return wx.cloud.callFunction({ name: 'security', data: { action: 'text', content: String(content) } })
      .then(res => {
        const r = (res && res.result) || {};
        if (r.pass === false) {
          wx.showToast({ title: r.msg || '内容包含敏感词，请修改', icon: 'none' });
          return false;
        }
        return true;
      })
      .catch(() => true);
  },

  // 用户信息（本地优先：缓存里有就用缓存，云端只有比缓存新才覆盖）
  loadUserProfile() {
    const local = wx.getStorageSync('user_profile');
    if (local) this.setData({ userName: local.name || '鸭鸭', userAvatar: local.avatar || '/assets/brand-avatar.png', pageTitle: (local.name || '鸭鸭') });
    if (this.data.openid) {
      db.collection('user_profile').where({ _openid: this.data.openid }).limit(1).get().then(res => {
        if (!res.data.length) return;
        const u = res.data[0];
        // 比较时间戳：云端 >= 本地 才覆盖（避免把刚改完的新名字被旧云端覆盖回老值）
        const localTs = local && local.updatedAt ? new Date(local.updatedAt).getTime() : 0;
        const cloudTs = u.updatedAt ? new Date(u.updatedAt).getTime() : 0;
        if (cloudTs >= localTs) {
          this.setData({
            userName: u.name || '鸭鸭',
            userAvatar: u.avatar || '/assets/brand-avatar.png',
            pageTitle: u.name || '鸭鸭',
            profileEditName: u.name || ''
          });
        }
      }).catch(() => {});
    }
  },

  // 每次页面回到前台都重新同步用户信息（修复改了名字其它页面/重启后不刷新的 bug）
  onShow() {
    this.loadUserProfile();
  },

  enterApp() {
    wx.setStorageSync('welcome_seen_' + today(), true);
    this.setData({ welcomeOpen: false });
  },

  openProfile() {
    this.setData({ profileOpen: true, profileEditName: this.data.userName });
  },
  closeProfile() {
    this.setData({ profileOpen: false });
  },
  onProfileName(e) { this.setData({ profileEditName: e.detail.value }); },
  chooseAvatar() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'],
      success: res => {
        const file = res.tempFiles[0].tempFilePath;
        this.setData({ userAvatar: file });
      }
    });
  },
  saveProfile() {
    const name = (this.data.profileEditName || '').trim() || '鸭鸭';
    const avatar = this.data.userAvatar;
    const now = new Date().toISOString();
    this.setData({ userName: name });
    // 本地先存（带时间戳，给云端比对用），保证两边同步立刻生效
    wx.setStorageSync('user_profile', { name, avatar, updatedAt: now });
    if (this.data.openid) {
      const isLocal = !avatar || (typeof avatar === 'string' && avatar.indexOf('http') !== 0 && avatar.indexOf('cloud://') !== 0);
      const writeToCloud = (avatarUrl) => {
        db.collection('user_profile').where({ _openid: this.data.openid }).limit(1).get().then(res => {
          if (res.data.length) {
            // 已存在 → update（不能带 _openid）
            return db.collection('user_profile').doc(res.data[0]._id).update({ data: { name, avatar: avatarUrl, updatedAt: db.serverDate() } });
          }
          // 新增 → 必须显式带 _openid（客户端 add 不会自动注入）
          return db.collection('user_profile').add({ data: { _openid: this.data.openid, name, avatar: avatarUrl, updatedAt: db.serverDate() } });
        }).catch(err => {
          console.warn('[saveProfile] cloud save failed', err);
          wx.showToast({ title: '云端保存失败（本地已存）', icon: 'none' });
        });
      };
      if (isLocal) {
        // 临时本地路径 → 先上传云存储，拿到 fileID 再落库（避免下次读回来失效）
        const extMatch = (avatar || '').match(/\.(\w+)(?:\?|$)/);
        const ext = extMatch ? extMatch[1] : 'png';
        const cloudPath = `user_avatar/${this.data.openid}_${Date.now()}.${ext}`;
        wx.cloud.uploadFile({ cloudPath, filePath: avatar })
          .then(r => writeToCloud(r.fileID))
          .catch(err => {
            console.warn('[saveProfile] avatar upload failed', err);
            wx.showToast({ title: '头像上传失败', icon: 'none' });
            // 头像上传失败时仍尝试把名字写进云端（avatar 就用原本地路径）
            writeToCloud(avatar);
          });
      } else {
        // 已经是 http(s)/cloud 路径 → 直接写
        writeToCloud(avatar);
      }
    }
    wx.showToast({ title: '已保存 ✓', icon: 'success' });
    this.setData({ profileOpen: false });
    // 把 userName 立即同步到 topbar 中央的 pageTitle，避免「头像下变了但顶部还叫鸭鸭」的错位感
    this.setData({ pageTitle: this.data.userName });
  },

  // ---------- 云环境 / 用户 ----------
  loadProfile() {
    const app = getApp();
    if (!app.globalData.openid) {
      // 通过 login 云函数拿 openid
      wx.cloud.callFunction({ name: 'login' }).then(res => {
        const openid = res.result.openid;
        const enabled = res.result.enabled || [];
        app.globalData.openid = openid;
        this.setData({ openid, enabled });
        this.loadDashboard();
        this.loadSection(this.data.section);
        // 拿到 openid 后强制再同步一次用户信息（首次 onLoad 时 openid 为空跳过了云端读取）
        this.loadUserProfile();
      }).catch(() => { this.setData({ enabled: MODULES.map(m => m.id) }); });
    } else {
      this.setData({ openid: app.globalData.openid, enabled: app.globalData.enabled || MODULES.map(m => m.id) });
      this.loadDashboard();
    }
  },

  // ---------- 导航 ----------
  switchSection(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ section: key, pageTitle: TITLES[key] || '鸭鸭' });
    if (key !== 'dashboard') this.loadSection(key);
    if (key === 'dashboard') this.loadDashboard();
  },
  toggleRail() { this.setData({ railOpen: !this.data.railOpen }); },
  onCheckin() { wx.showToast({ title: '今日打卡成功！继续加油鸭 🦆', icon: 'none', duration: 1800 }); },

  // ---------- 仪表盘 ----------
  loadDashboard() {
    const t = today();
    const enabled = this.data.enabled.length ? this.data.enabled : MODULES.map(m => m.id);
    // 按 DASH_ORDER 排序输出 8 张卡片（即使该模块未启用也展示）
    const all = DASH_ORDER.filter(id => enabled.indexOf(id) !== -1 || true);
    const allCards = [];
    // 取所有今日 records（一次拉全部模块）
    db.collection('records').where({ date: t }).limit(200).get().then(res => {
      const todays = res.data;
      const cTodo = todays.filter(x => x.module === 'daily_todo');
      const cW = todays.filter(x => x.module === 'weight');
      const cA = todays.filter(x => x.module === 'accounting');
      const cD = todays.filter(x => x.module === 'diet');
      const cE = todays.filter(x => x.module === 'exercise');
      const cF = todays.filter(x => x.module === 'feeling');
      const cT = todays.filter(x => x.module === 'mood');
      const monthExp = cA.filter(x => x.type === 'expense').reduce((s, x) => s + Number(x.amount || 0), 0);
      const dietKcal = cD.reduce((s, x) => s + Number(x.calories || 0), 0);
      let doneTodo = cTodo.length ? cTodo.filter(x => x.done).length : 0, totalTodo = cTodo.length;
      DASH_ORDER.forEach(id => {
        const meta = DASH_META[id];
        let status = meta.descEmpty;
        if (id === 'daily_todo' && totalTodo) status = meta.descDone({ done: doneTodo, total: totalTodo });
        else if (id === 'diet' && dietKcal) status = meta.descDone({ kcal: dietKcal });
        else if (id === 'accounting') status = meta.descDone({ expense: monthExp });
        else if (id === 'weight' && cW.length) status = meta.descDone;
        else if (id === 'exercise' && cE.length) status = meta.descDone;
        else if (id === 'feeling' && cF.length) status = meta.descDone;
        allCards.push({ id, key: id, icon: meta.emoji, name: meta.name, status });
      });
      const pct = totalTodo ? Math.round(doneTodo / totalTodo * 100) : 0;
      this.setData({ cards: allCards, done: doneTodo, total: totalTodo, pct });
      this.drawRing(pct);
    }).catch(() => {
      // 离线/失败：仍生成 cards（无 status）
      DASH_ORDER.forEach(id => {
        const meta = DASH_META[id];
        allCards.push({ id, key: id, icon: meta.emoji, name: meta.name, status: meta.descEmpty });
      });
      this.setData({ cards: allCards });
    });
  },

  drawRing(pct) {
    const q = wx.createSelectorQuery().in(this);
    q.select('#ringCanvas').fields({ node: true, size: true }).exec(res => {
      if (!res[0] || !res[0].node) return;
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const w = res[0].width, h = res[0].height;
      const dpr = wx.getSystemInfoSync().pixelRatio;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2, r = w / 2 - 7;
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (pct / 100) * Math.PI * 2);
      ctx.stroke();
    });
  },

  // ---------- 通用：按 section 加载 ----------
  loadSection(key) {
    const map = {
      daily_todo: () => this.loadTodo(),
      weight: () => this.loadWeight(),
      wuxing: () => this.loadWuxing(),
      diet: () => this.loadDiet(),
      accounting: () => this.loadAcc(),
      exercise: () => this.loadEx(),
      body: () => this.loadBody(),
      mood: () => this.loadMood(),
      feeling: () => this.loadFeeling(),
      media: () => this.loadMedia(),
      goals: () => this.loadGoals(),
      english: () => this.loadEnglish(),
      travel: () => this.loadTravel(),
      weekly: () => this.loadWeekly(),
      settings: () => this.loadSettings()
    };
    if (map[key]) map[key]();
  },

  // ---------- 待办 ----------
  loadTodo() {
    const t = today();
    // 7 天内
    const soonStart = t;
    const soonEnd = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })();
    db.collection('records').where({ module: 'daily_todo' }).orderBy('createTime', 'desc').limit(200).get()
      .then(res => {
        const list = res.data;
        // 三段分类：today=今天；soon=未来 7 天内（含明天）；later=7 天外或无 dueDate
        const today = [], soon = [], later = [];
        list.forEach(it => {
          const due = it.dueDate || (it.date ? it.date.slice(0,10) : '');
          if (!due || due < soonStart) later.push(it);
          else if (due === soonStart) today.push(it);
          else if (due > soonStart && due <= soonEnd) soon.push(it);
          else later.push(it);
        });
        const cnt = a => a.length;
        // 把 todoCats 转字符串名称列表供 wxml
        this.setData({
          todoList: list,
          todoToday: today.reverse(), todoSoon: soon.reverse(), todoLater: later.reverse(),
          todoTodayCount: cnt(today), todoSoonCount: cnt(soon), todoLaterCount: cnt(later),
          todoCount: list.length + ' 条'
        });
      }).catch(() => {});
  },
  setTodoCat(e) {
    const cat = e.currentTarget.dataset.cat;
    const icon = e.currentTarget.dataset.icon;
    this.setData({ todoCat: cat, todoCatIcon: icon });
  },
  onTodoInput(e) { this.setData({ newTodo: e.detail.value }); },
  // 三段 inline 输入
  onTodoInline(e) {
    const key = e.currentTarget.dataset.bucket;
    this.setData({ ['todoInline' + (key === 'today' ? 'Today' : key === 'soon' ? 'Soon' : 'Later')]: e.detail.value });
  },
  onTodoSoonDate(e) { this.setData({ todoSoonDate: e.detail.value }); },
  onTodoLaterDate(e) { this.setData({ todoLaterDate: e.detail.value }); },
  onTodoLaterRange(e) {
    const idx = Number(e.detail.value);
    const ranges = this.data.todoLaterRange;
    let dueDate = '';
    const today0 = new Date();
    const fmt = (d) => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    if (idx === 0) dueDate = fmt(today0);
    else if (idx === 1) { const d = new Date(today0); d.setDate(d.getDate() + 1); dueDate = fmt(d); }
    else if (idx === 2) { const d = new Date(today0); d.setDate(d.getDate() + 3); dueDate = fmt(d); }
    else if (idx === 3) { const d = new Date(today0); d.setDate(d.getDate() + 7); dueDate = fmt(d); }
    else if (idx === 4) { const d = new Date(today0); d.setMonth(d.getMonth() + 1); dueDate = fmt(d); }
    else if (idx === 5) dueDate = ''; // 未来（不限）
    this.setData({ todoLaterRangeIdx: idx, todoLaterDate: dueDate });
  },
  async addTodo(e) {
    // 兼容两种调用：1) addTodoInline 传入 string bucket  2) WXML bindtap 传入 event
    let bucket = 'today';
    if (typeof e === 'string') bucket = e;
    else if (e && e.currentTarget && e.currentTarget.dataset) bucket = e.currentTarget.dataset.bucket || 'today';
    let content, dueDate = '';
    if (bucket === 'today') {
      content = (this.data.newTodo || '').trim();
      dueDate = today();
    } else if (bucket === 'soon') {
      content = (this.data.todoInlineSoon || '').trim();
      dueDate = this.data.todoSoonDate || (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })();
    } else if (bucket === 'later') {
      content = (this.data.todoInlineLater || '').trim();
      // 兼容 selector 模式：todoLaterRangeIdx 选中"未来"则 dueDate=''
      if (this.data.todoLaterRangeIdx == null || this.data.todoLaterRangeIdx === 0) dueDate = today();
      else if (this.data.todoLaterRangeIdx === 5) dueDate = '';
      else if (this.data.todoLaterDate) dueDate = this.data.todoLaterDate;
      else dueDate = '';
    } else {
      content = (this.data.newTodo || '').trim();
    }
    if (!content) { wx.showToast({ title: '请输入内容', icon: 'none' }); return; }
    const ok = await this.safeText(content); if (!ok) return;
    const d = dueDate || today();
    db.collection('records').add({ data: { module: 'daily_todo', content, cat: this.data.todoCat, done: false, date: d, dueDate: d, createTime: db.serverDate() } })
      .then(() => {
        const upd = {};
        if (bucket === 'today') upd.newTodo = '';
        if (bucket === 'soon') { upd.todoInlineSoon = ''; upd.todoSoonDate = ''; }
        if (bucket === 'later') { upd.todoInlineLater = ''; upd.todoLaterDate = ''; }
        this.setData(upd);
        this.loadTodo(); this.loadDashboard();
      });
  },
  addTodoInline(e) {
    const bucket = e.currentTarget.dataset.bucket;
    this.addTodo(bucket);
  },
  toggleTodo(e) {
    const id = e.currentTarget.dataset.id;
    const it = [...this.data.todoToday, ...this.data.todoSoon, ...this.data.todoLater].find(x => x._id === id);
    db.collection('records').doc(id).update({ data: { done: !it.done } }).then(() => { this.loadTodo(); this.loadDashboard(); });
  },
  delTodo(e) {
    db.collection('records').doc(e.currentTarget.dataset.id).remove().then(() => { this.loadTodo(); this.loadDashboard(); });
  },

  // ---------- 体重 ----------
  loadWeight() {
    const t = this.data.wDate || today();
    db.collection('records').where({ module: 'weight' }).orderBy('date', 'desc').limit(100).get()
      .then(res => {
        const list = res.data || [];
        const rec = list.find(x => x.date === t) || {};
        const wm = rec.morning, we = rec.evening;
        let diff = '--', maxW = '--';
        if (wm && we) {
          diff = (parseFloat(we) - parseFloat(wm)).toFixed(1);
          maxW = Math.max(parseFloat(wm), parseFloat(we)).toFixed(1);
        } else if (wm) maxW = parseFloat(wm).toFixed(1);
        else if (we) maxW = parseFloat(we).toFixed(1);
        // 今日是否打卡
        const todayStr = today();
        const todayHas = list.some(x => x.date === todayStr && (x.morning || x.evening));
        // 中文日期显示（8月9日·周日）
        const dd = new Date();
        const weekdayCN = ['周日','周一','周二','周三','周四','周五','周六'][dd.getDay()];
        const tDate = new Date(t);
        const tWeekdayCN = ['周日','周一','周二','周三','周四','周五','周六'][tDate.getDay()];
        this.setData({
          wDate: t,
          wTodayM: wm || '--', wTodayE: we || '--', wDiff: diff,
          wTodayMax: maxW, wTodayDateCN: `${tDate.getMonth()+1}月${tDate.getDate()}日 · ${tWeekdayCN}`,
          wDoneToday: todayHas,
          wHistory: list.slice(0, 30), wHistoryCount: list.length
        });
        this.drawWeightChart(list);
      }).catch(() => {});
  },
  onWDate(e) { this.setData({ wDate: e.detail.value }, () => this.loadWeight()); },
  onWM(e) { this.setData({ wMorning: e.detail.value }); },
  onWE(e) { this.setData({ wEvening: e.detail.value }); },
  saveMorning() {
    const t = this.data.wDate || today();
    const v = (this.data.wMorning || '').trim(); if (!v) { wx.showToast({ title: '请输入体重', icon: 'none' }); return; }
    db.collection('records').where({ module: 'weight', date: t }).get().then(r => {
      if (r.data.length) db.collection('records').doc(r.data[0]._id).update({ data: { morning: v } });
      else db.collection('records').add({ data: { module: 'weight', date: t, morning: v, evening: '', createTime: db.serverDate() } });
    }).then(() => { this.setData({ wMorning: '' }); this.loadWeight(); this.loadDashboard(); });
  },
  saveEvening() {
    const t = this.data.wDate || today();
    const v = (this.data.wEvening || '').trim(); if (!v) { wx.showToast({ title: '请输入体重', icon: 'none' }); return; }
    db.collection('records').where({ module: 'weight', date: t }).get().then(r => {
      if (r.data.length) db.collection('records').doc(r.data[0]._id).update({ data: { evening: v } });
      else db.collection('records').add({ data: { module: 'weight', date: t, morning: '', evening: v, createTime: db.serverDate() } });
    }).then(() => { this.setData({ wEvening: '' }); this.loadWeight(); this.loadDashboard(); });
  },

  // ----- 体重历史记录编辑 -----
  onEditWeight(e) {
    const { id, date, morning, evening } = e.currentTarget.dataset;
    this.setData({
      wEditOpen: true,
      wEditId: id,
      wEditDate: date,
      wEditMorning: morning || '',
      wEditEvening: evening || ''
    });
  },
  onEditWM(e) { this.setData({ wEditMorning: e.detail.value }); },
  onEditWE(e) { this.setData({ wEditEvening: e.detail.value }); },
  onDelWeight(e) {
    const { id, date } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除体重记录',
      content: '确定删除 ' + date + ' 的体重记录？删除后不可恢复。',
      confirmText: '删除',
      confirmColor: '#ef4444',
      success: r => {
        if (!r.confirm) return;
        db.collection('records').doc(id).remove().then(() => {
          wx.showToast({ title: '已删除', icon: 'success' });
          this.loadWeight(); this.loadDashboard();
        }).catch(err => wx.showToast({ title: '删除失败：' + (err.errMsg || '未知'), icon: 'none' }));
      }
    });
  },
  closeEditWeight() {
    this.setData({ wEditOpen: false, wEditId: '', wEditMorning: '', wEditEvening: '' });
  },
  confirmEditWeight() {
    const { wEditId, wEditMorning, wEditEvening } = this.data;
    const m = (wEditMorning || '').trim();
    const ev = (wEditEvening || '').trim();
    if (!m && !ev) { wx.showToast({ title: '至少填一个', icon: 'none' }); return; }
    if (!wEditId) { wx.showToast({ title: '记录无效', icon: 'none' }); return; }
    wx.showLoading({ title: '保存中…' });
    db.collection('records').doc(wEditId).update({
      data: { morning: m, evening: ev, updatedAt: db.serverDate() }
    }).then(() => {
      wx.hideLoading();
      wx.showToast({ title: '已保存 ✓', icon: 'success' });
      this.setData({ wEditOpen: false, wEditId: '', wEditMorning: '', wEditEvening: '' });
      this.loadWeight();
      this.loadDashboard();
    }).catch(err => {
      wx.hideLoading();
      wx.showToast({ title: '保存失败：' + (err.errMsg || ''), icon: 'none' });
    });
  },
  drawWeightChart(list) {
    // 画双线：橙=晨起、蓝=睡前
    const q = wx.createSelectorQuery().in(this);
    q.select('#weightChart').fields({ node: true, size: true }).exec(res => {
      if (!res[0] || !res[0].node) return;
      const canvas = res[0].node, ctx = canvas.getContext('2d');
      const w = res[0].width, h = res[0].height;
      const dpr = wx.getSystemInfoSync().pixelRatio;
      canvas.width = w * dpr; canvas.height = h * dpr; ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
      // 倒序：早→近；过滤掉两条都空的脏数据
      const data = list.filter(x => x.morning || x.evening).slice().reverse();
      const morn = data.map(x => parseFloat(x.morning || 0)).filter(v => v > 0);
      const eve = data.map(x => parseFloat(x.evening || 0)).filter(v => v > 0);
      const hasM = morn.length > 0;
      const hasE = eve.length > 0;
      if (!hasM && !hasE) {
        // 空状态：画"暂无数据"提示
        ctx.font = '13px sans-serif'; ctx.fillStyle = '#aaa';
        ctx.textAlign = 'center';
        ctx.fillText('⚖️ 记录体重后查看变化曲线', w / 2, h / 2 - 8);
        ctx.font = '11px sans-serif'; ctx.fillStyle = '#bbb';
        ctx.fillText('上方输入并点击「记录」', w / 2, h / 2 + 12);
        ctx.textAlign = 'left';
        return;
      }
      const pad = 30;
      const all = [...(hasM ? morn : []), ...(hasE ? eve : [])];
      let mn = Math.min(...all), mx = Math.max(...all);
      // 智能 padding：差距 > 1 给 0.5，差距 < 1 给 ±0.5
      const range = (mx - mn) || 1;
      const padding = range > 1 ? 0.5 : 0.3;
      mn = Math.max(0, mn - padding);
      mx = mx + padding;
      const adjRange = mx - mn;
      // y 轴刻度（5 等分）
      ctx.font = '10px sans-serif'; ctx.fillStyle = '#aaa';
      for (let i = 0; i < 5; i++) {
        const y = pad + i * ((h - pad * 2) / 4);
        const v = (mx - (i / 4) * adjRange).toFixed(1);
        ctx.fillText(v, 4, y + 3);
        ctx.strokeStyle = '#eee'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - 4, y); ctx.stroke();
      }
      const stepX = (w - pad - 8) / Math.max(1, data.length - 1);
      const drawSeries = (key, color) => {
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
        let started = false;
        data.forEach((x, i) => {
          const v = parseFloat(x[key] || 0);
          if (!v) return;
          const px = pad + i * stepX, py = h - pad - ((v - mn) / adjRange) * (h - pad * 2);
          if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
        });
        ctx.stroke();
        // 节点圆点
        ctx.fillStyle = color;
        data.forEach((x, i) => {
          const v = parseFloat(x[key] || 0);
          if (!v) return;
          const px = pad + i * stepX, py = h - pad - ((v - mn) / adjRange) * (h - pad * 2);
          ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
        });
      };
      if (hasM) drawSeries('morning', '#FF8C42');
      if (hasE) drawSeries('evening', '#5B8DEF');
      // 图例（顶部居中）
      let lx = w / 2 - 60;
      ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
      if (hasM) {
        ctx.fillStyle = '#FF8C42'; ctx.fillRect(lx, 6, 14, 8); ctx.fillStyle = '#666';
        ctx.fillText('🌅 晨起', lx + 18, 14); lx += 60;
      }
      if (hasE) {
        ctx.fillStyle = '#5B8DEF'; ctx.fillRect(lx, 6, 14, 8); ctx.fillStyle = '#666';
        ctx.fillText('🌙 睡前', lx + 18, 14);
      }
      ctx.textAlign = 'left';
    });
  },

  // ---------- 五行 ----------
  loadWuxing() {
    // 一次性算 7 天（基于 lunar-javascript 日柱干支）
    const arr = [];
    for (let i = 0; i < 7; i++) arr.push(getWuxing(new Date(), i));
    const idx = this.data.wxDayIdx || 0;
    this.setData({ wxDataArr: arr, wxData: arr[idx] || arr[0] });
  },
  setWxDay(e) {
    const idx = e.currentTarget.dataset.idx;
    const arr = this.data.wxDataArr;
    this.setData({ wxDayIdx: idx, wxData: arr[idx] || arr[0] });
  },

  // ---------- 饮食 ----------
  loadDiet() {
    const t = today();
    db.collection('records').where({ module: 'diet', date: t }).orderBy('createTime', 'desc').limit(100).get()
      .then(res => this.setData({ dietList: res.data })).catch(() => {});
    // 加载饮食计划（不限日期）
    db.collection('records').where({ module: 'diet', subtype: 'plan' }).orderBy('createTime', 'desc').limit(50).get()
      .then(res => this.setData({ dietPlanList: res.data })).catch(() => {});
  },
  onDietCal(e) { this.setData({ dietCal: e.detail.value }); },
  onDietMeal(e) { const i = parseInt(e.detail.value); this.setData({ dietMealIndex: i, dietMeal: this.data.dietMeals[i] }); },
  onDietContent(e) { this.setData({ dietContent: e.detail.value }); },
  // 份量：数量 + 单位（克/碗/个/份），克数 = 数量 × 单位对应克数，再按每100g热量算整份
  getDietGrams() {
    const unit = this.data.dietPortionUnits[this.data.dietPortionIdx] || '克';
    const n = parseFloat(this.data.dietPortion);
    if (isNaN(n) || n <= 0) return 0;
    return Math.round(n * (DIET_UNIT_G[unit] || 1));
  },
  applyDietCal() {
    const per100 = this._dietCaloriePer100 || 0;
    const g = this.getDietGrams();
    if (per100 && g > 0) this.setData({ dietCal: String(Math.round(per100 / 100 * g)) });
  },
  onDietPortion(e) { this.setData({ dietPortion: e.detail.value }); this.applyDietCal(); },
  onDietPortionUnit(e) {
    const i = parseInt(e.detail.value, 10);
    this.setData({ dietPortionIdx: i });
    this.applyDietCal();
  },
  onDietPreset(e) {
    const g = parseInt(e.currentTarget.dataset.g, 10);
    this.setData({ dietPortion: String(g), dietPortionIdx: 0 });
    this.applyDietCal();
  },
  async addDiet() {
    if (!this.data.dietContent.trim()) return;
    const ok = await this.safeText(this.data.dietContent); if (!ok) return;
    db.collection('records').add({ data: { module: 'diet', content: this.data.dietContent, meal: this.data.dietMeal, calories: this.data.dietCal || 0, date: today(), createTime: db.serverDate() } })
      .then(() => { this._dietCaloriePer100 = 0; this.setData({ dietContent: '', dietCal: '', dietPortion: '' }); this.loadDiet(); this.loadDashboard(); });
  },
  delDiet(e) { db.collection('records').doc(e.currentTarget.dataset.id).remove().then(() => this.loadDiet()); },
  // 饮食计划
  onDietPlanDate(e) { this.setData({ dietPlanDate: e.detail.value }); },
  onDietPlanMeal(e) { const i = parseInt(e.detail.value); this.setData({ dietPlanMealIdx: i, dietPlanMeal: this.data.dietMeals[i] }); },
  onDietPlanContent(e) { this.setData({ dietPlanContent: e.detail.value }); },
  onDietPlanCal(e) { this.setData({ dietPlanCal: e.detail.value }); },
  addDietPlan() {
    const c = (this.data.dietPlanContent || '').trim();
    if (!c) return;
    const d = this.data.dietPlanDate || today();
    db.collection('records').add({ data: { module: 'diet', subtype: 'plan', content: c, meal: this.data.dietPlanMeal, calories: this.data.dietPlanCal || 0, date: d, planDate: d, createTime: db.serverDate() } })
      .then(() => { this.setData({ dietPlanContent: '', dietPlanCal: '', dietPlanDate: '' }); this.loadDiet(); });
  },
  delDietPlan(e) { db.collection('records').doc(e.currentTarget.dataset.id).remove().then(() => this.loadDiet()); },

  // ---------- 记账 ----------
  loadAcc() {
    const t = today();
    const month = t.slice(0, 7);
    db.collection('records').where({ module: 'accounting' }).orderBy('date', 'desc').limit(100).get()
      .then(res => {
        const list = res.data;
        const monthList = list.filter(x => x.date.slice(0, 7) === month);
        let inc = 0, exp = 0;
        monthList.forEach(x => { if (x.type === 'income') inc += parseFloat(x.amount || 0); else exp += parseFloat(x.amount || 0); });
        this.setData({
          accList: monthList, accDate: t,
          monthIncome: inc.toFixed(0), monthExpense: exp.toFixed(0), monthBalance: (inc - exp).toFixed(0)
        });
        this.drawDoughnut('accChart', monthList.filter(x => x.type === 'expense'));
      }).catch(() => {});
  },
  setAccType(e) {
    const t = e.currentTarget.dataset.t;
    const cats = t === 'income' ? INCOME_CATS : EXPENSE_CATS;
    this.setData({ accType: t, accCat: cats[0], accCatIdx: 0 });
  },
  onAccAmount(e) { this.setData({ accAmount: e.detail.value }); },
  onAccCat(e) {
    const i = parseInt(e.detail.value);
    const cats = this.data.accType === 'income' ? INCOME_CATS : EXPENSE_CATS;
    this.setData({ accCatIdx: i, accCat: cats[i] });
  },
  onAccNote(e) { this.setData({ accNote: e.detail.value }); },
  onAccDate(e) { this.setData({ accDate: e.detail.value }); },
  async addAcc() {
    if (!this.data.accAmount) return;
    const ok = await this.safeText(this.data.accNote); if (!ok) return;
    db.collection('records').add({ data: { module: 'accounting', type: this.data.accType, amount: parseFloat(this.data.accAmount), category: this.data.accCat, note: this.data.accNote, date: this.data.accDate || today(), createTime: db.serverDate() } })
      .then(() => { this.setData({ accAmount: '', accNote: '' }); this.loadAcc(); this.loadDashboard(); });
  },
  delAcc(e) { db.collection('records').doc(e.currentTarget.dataset.id).remove().then(() => this.loadAcc()); },

  // ---------- 运动 ----------
  loadEx() {
    const t = today();
    db.collection('records').where({ module: 'exercise', date: t }).orderBy('createTime', 'desc').limit(100).get()
      .then(res => this.setData({ exList: res.data })).catch(() => {});
  },
  openEx(e) { const ty = e.currentTarget.dataset.type; const info = EX_TYPES.find(x => x.type === ty); this.setData({ exOpen: true, exType: ty, exLabel: info.title, exMinutes: '' }); },
  closeEx() { this.setData({ exOpen: false }); },
  onExMinutes(e) { this.setData({ exMinutes: e.detail.value }); },
  confirmEx() {
    if (!this.data.exMinutes) return;
    db.collection('records').add({ data: { module: 'exercise', kind: this.data.exType, minutes: parseInt(this.data.exMinutes), date: today(), createTime: db.serverDate() } })
      .then(() => { this.setData({ exOpen: false }); this.loadEx(); this.loadDashboard(); });
  },
  delEx(e) { db.collection('records').doc(e.currentTarget.dataset.id).remove().then(() => this.loadEx()); },

  // ---------- 体态（含日历） ----------
  loadBody() {
    const t = today();
    const now = new Date();
    const year = now.getFullYear(), month = now.getMonth(); // 当前月
    // 当月所有 body 记录
    db.collection('records').where({ module: 'body' }).orderBy('date', 'desc').limit(200).get()
      .then(res => {
        const all = res.data;
        const tDay = new Date(t + 'T00:00:00');
        const doneToday = all.some(x => x.date === t);
        // 日历（当月天数，每天打勾状态）
        const lastDay = new Date(year, month + 1, 0).getDate();
        const cal = [];
        for (let d = 1; d <= lastDay; d++) {
          const ds = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          cal.push({ day: d, date: ds, done: all.some(x => x.date === ds), isToday: ds === t });
        }
        this.setData({
          bodyList: all.slice(0, 20),
          bodyCalendar: cal, bodyDoneToday: doneToday,
          bodyYear: year, bodyMonth: month + 1
        });
      }).catch(() => {});
  },
  doneBody() {
    if (this.data.bodyDoneToday) { wx.showToast({ title: '今日已打卡 ✓', icon: 'none' }); return; }
    db.collection('records').add({ data: { module: 'body', done: true, minutes: 15, date: today(), createTime: db.serverDate() } })
      .then(() => { this.loadBody(); this.loadDashboard(); });
  },

  // ---------- 心情 ----------
  loadMood() {
    db.collection('records').where({ module: 'mood' }).orderBy('date', 'desc').limit(100).get()
      .then(res => {
        const list = res.data;
        this.setData({ moodList: list.slice(0, 30) });
        // 折线图：X = 近 14 天日期倒序（早→右），Y = 0..6 心情指数
        const points = [];
        const today = new Date();
        for (let off = 13; off >= 0; off--) {
          const d = new Date(); d.setDate(today.getDate() - off);
          const ds = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
          const m = list.find(x => x.date === ds);
          const score = m ? (MOOD_SCORE_MAP[m.emoji] ?? 3) : null;
          points.push({ date: ds.slice(5), score });
        }
        this.drawMoodLine(points);
      }).catch(() => {});
  },
  drawMoodLine(points) {
    const q = wx.createSelectorQuery().in(this);
    q.select('#moodChart').fields({ node: true, size: true }).exec(res => {
      if (!res[0] || !res[0].node) return;
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const w = res[0].width, h = res[0].height;
      const dpr = wx.getSystemInfoSync().pixelRatio;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      // 网格（Y=0..6 七行）
      const padL = 24, padR = 8, padT = 14, padB = 22;
      const gw = w - padL - padR, gh = h - padT - padB;
      ctx.strokeStyle = 'rgba(180,150,180,0.15)'; ctx.lineWidth = 1;
      for (let i = 0; i <= 6; i++) {
        const y = padT + gh * (i / 6);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + gw, y); ctx.stroke();
      }
      ctx.fillStyle = '#9C7BCE'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
      for (let i = 0; i <= 6; i++) ctx.fillText(String(i), padL - 4, padT + gh * (i / 6) + 4);
      // X 标签（每隔 2 天）
      ctx.textAlign = 'center'; ctx.fillStyle = '#9C7BCE';
      const stepX = gw / Math.max(1, points.length - 1);
      points.forEach((p, i) => { if (i % 2 === 0) ctx.fillText(p.date, padL + stepX * i, h - 6); });
      // Y 轴标签（左侧标"心情指数"）
      ctx.save(); ctx.translate(10, padT + gh / 2); ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = '#B59ACB'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('0-6 心情指数', 0, 0); ctx.restore();
      // 数据点 + 折线
      const dataPoints = points.map((p, i) => p.score == null ? null : { x: padL + stepX * i, y: padT + gh * (p.score / 6), score: p.score });
      ctx.strokeStyle = '#F59E0B'; ctx.lineWidth = 2.5;
      let last = null;
      dataPoints.forEach(p => {
        if (!p) { last = null; return; }
        if (last) { ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); }
        last = p;
      });
      dataPoints.forEach(p => {
        if (!p) return;
        const emoji = MOOD_EMOJIS.find(k => MOOD_SCORE_MAP[k] === p.score) || '😐';
        ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(emoji, p.x, p.y - 8);
      });
    });
  },
  setMood(e) { this.setData({ mood: e.currentTarget.dataset.m }); },
  onMoodText(e) { this.setData({ moodText: e.detail.value }); },
  async   saveMood() {
    const ok = await this.safeText(this.data.moodText); if (!ok) return;
    db.collection('records').add({ data: { module: 'mood', emoji: this.data.mood, text: this.data.moodText, score: MOOD_SCORE_MAP[this.data.mood], date: today(), createTime: db.serverDate() } })
      .then(() => { this.setData({ moodText: '' }); this.loadMood(); this.loadDashboard(); });
  },
  delMood(e) { db.collection('records').doc(e.currentTarget.dataset.id).remove().then(() => this.loadMood()); },

  // ---------- 感受（含编辑） ----------
  loadFeeling() {
    db.collection('records').where({ module: 'feeling' }).orderBy('createTime', 'desc').limit(100).get()
      .then(res => { const l = res.data; this.setData({ feelingList: l, feelingCount: l.length + ' 条' }); }).catch(() => {});
  },
  onFeeling(e) { this.setData({ feelingText: e.detail.value }); },
  async saveFeeling() {
    const txt = (this.data.feelingText || '').trim();
    if (!txt) return;
    const ok = await this.safeText(txt); if (!ok) return;
    if (this.data.feelingEditing) {
      db.collection('records').doc(this.data.feelingEditing).update({ data: { content: txt } })
        .then(() => { this.setData({ feelingText: '', feelingEditing: '' }); this.loadFeeling(); });
    } else {
      db.collection('records').add({ data: { module: 'feeling', content: txt, date: today(), createTime: db.serverDate() } })
        .then(() => { this.setData({ feelingText: '' }); this.loadFeeling(); this.loadDashboard(); });
    }
  },
  editFeeling(e) {
    const id = e.currentTarget.dataset.id;
    const it = this.data.feelingList.find(x => x._id === id);
    this.setData({ feelingText: it.content || '', feelingEditing: id });
  },
  cancelEditFeeling() { this.setData({ feelingText: '', feelingEditing: '' }); },
  delFeeling(e) { db.collection('records').doc(e.currentTarget.dataset.id).remove().then(() => this.loadFeeling()); },

  // ---------- 自媒体（7 平台 + 3 状态） ----------
  loadMedia() {
    db.collection('records').where({ module: 'media' }).orderBy('createTime', 'desc').limit(100).get()
      .then(res => { const l = res.data; this.setData({ mediaList: l, mediaCount: l.length + ' 条' }); }).catch(() => {});
  },
  onMediaPlat(e) { this.setData({ mediaPlatformIdx: parseInt(e.detail.value) }); },
  onMediaTitle(e) { this.setData({ mediaTitle: e.detail.value }); },
  onMediaContent(e) { this.setData({ mediaContent: e.detail.value }); },
  setMediaStatus(e) { this.setData({ mediaStatusIdx: parseInt(e.currentTarget.dataset.idx) }); },
  saveMedia() {
    if (!this.data.mediaTitle.trim()) return;
    db.collection('records').add({ data: { module: 'media', platform: this.data.mediaPlatforms[this.data.mediaPlatformIdx], title: this.data.mediaTitle, content: this.data.mediaContent, status: this.data.mediaStatusList[this.data.mediaStatusIdx], date: today(), createTime: db.serverDate() } })
      .then(() => { this.setData({ mediaTitle: '', mediaContent: '' }); this.loadMedia(); this.loadDashboard(); });
  },
  delMedia(e) { db.collection('records').doc(e.currentTarget.dataset.id).remove().then(() => this.loadMedia()); },

  // ---------- 目标（6 类下拉） ----------
  loadGoals() {
    db.collection('records').where({ module: 'goals' }).limit(100).get()
      .then(res => {
        const l = (res.data || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
        const done = l.filter(x => x.done).length;
        this.setData({ goalsList: l, goalsCount: done + '/' + l.length });
      }).catch(() => {});
  },
  onGoalText(e) { this.setData({ goalText: e.detail.value }); },
  onGoalCat(e) { this.setData({ goalCatIdx: parseInt(e.detail.value) }); },
  addGoal() {
    if (!this.data.goalText.trim()) return;
    db.collection('records').add({ data: { module: 'goals', text: this.data.goalText, category: this.data.goalCats[this.data.goalCatIdx], done: false, order: Date.now(), date: today(), createTime: db.serverDate() } })
      .then(() => { this.setData({ goalText: '' }); this.loadGoals(); this.loadDashboard(); });
  },
  moveGoal(e) {
    const dir = e.currentTarget.dataset.dir;
    const id = e.currentTarget.dataset.id;
    const list = this.data.goalsList.slice();
    const i = list.findIndex(x => x._id === id);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= list.length) return;
    const a = list[i], b = list[j];
    const oa = a.order || 0, ob = b.order || 0;
    Promise.all([
      db.collection('records').doc(a._id).update({ data: { order: ob } }),
      db.collection('records').doc(b._id).update({ data: { order: oa } })
    ]).then(() => this.loadGoals()).catch(() => this.loadGoals());
  },
  toggleGoal(e) {
    const id = e.currentTarget.dataset.id; const it = this.data.goalsList.find(x => x._id === id);
    db.collection('records').doc(id).update({ data: { done: !it.done } }).then(() => this.loadGoals());
  },
  delGoal(e) { db.collection('records').doc(e.currentTarget.dataset.id).remove().then(() => this.loadGoals()); },

  // ---------- 英语（21 句口语 + 词汇；offset 0=今天，可向前/向后 1 天） ----------
  loadEnglish() {
    const offset = this.data.englishOffset || 0;
    const seed = dailySeed(offset);
    // 口语库 520 条（*7 互质）、词汇库 370 条（*13 互质），轮转保证全年不重复
    const phrases = pickRot(ENGLISH_PHRASES, seed, 5, 7);
    const vocab = pickRot(ENGLISH_VOCAB, seed, 5, 13);
    this.setData({ englishPhrases: phrases, englishVocab: vocab });
  },
  englishPrev() { this.setData({ englishOffset: (this.data.englishOffset || 0) - 1 }, () => this.loadEnglish()); },
  englishNext() { this.setData({ englishOffset: (this.data.englishOffset || 0) + 1 }, () => this.loadEnglish()); },
  englishToday() { this.setData({ englishOffset: 0 }, () => this.loadEnglish()); },
  speakEn(e) {
    const text = e.currentTarget.dataset.text;
    if (!text) return;
    wx.showLoading({ title: '生成语音...' });
    cloudVoice('tts', { text: text, lang: 'en' })
      .then(res => {
        wx.hideLoading();
        const r = res.result;
        if (!r || !r.ok) { wx.showToast({ title: (r && r.msg) || '语音生成失败', icon: 'none', duration: 2500 }); return; }
        const ctx = wx.createInnerAudioContext();
        ctx.src = r.url; ctx.play();
        ctx.onError(() => wx.showToast({ title: '播放失败', icon: 'none' }));
      })
      .catch(err => { wx.hideLoading(); wx.showToast({ title: 'tts 云函数未部署或失败：' + (err.errMsg || err.message || '未知'), icon: 'none', duration: 3000 }); });
  },

  // ---------- 旅游 ----------
  loadTravel() {
    db.collection('records').where({ module: 'travel' }).orderBy('createTime', 'desc').limit(100).get()
      .then(res => this.setData({ travelList: res.data })).catch(() => {});
    this.loadFootprint();
    if (!this.data.inspirationList || this.data.inspirationList.length === 0) {
      // 按日期种子轮转 3 条（370 条 *17 互质），保证当天固定、隔天不同、全年不重复
      this.setData({ inspirationList: pickRot(TRAVEL_DB, dailySeed(0), 3, 17) });
    }
  },
  onTravelTitle(e) { this.setData({ travelTitle: e.detail.value }); },
  onTravelDesc(e) { this.setData({ travelDesc: e.detail.value }); },
  async addTravel() {
    if (!this.data.travelTitle.trim()) return;
    const ok = await this.safeText(this.data.travelTitle + ' ' + (this.data.travelDesc || '')); if (!ok) return;
    db.collection('records').add({ data: { module: 'travel', title: this.data.travelTitle, desc: this.data.travelDesc, date: today(), createTime: db.serverDate() } })
      .then(() => { this.setData({ travelTitle: '', travelDesc: '' }); this.loadTravel(); this.loadDashboard(); });
  },
  delTravel(e) { db.collection('records').doc(e.currentTarget.dataset.id).remove().then(() => this.loadTravel()); },
  onTravelPaste(e) { this.setData({ travelPaste: e.detail.value }); },
  importTravel() {
    const txt = (this.data.travelPaste || '').trim();
    if (!txt) return;
    db.collection('records').add({ data: { module: 'travel', title: txt.slice(0, 20), desc: txt, date: today(), createTime: db.serverDate() } })
      .then(() => { this.setData({ travelPaste: '' }); this.loadTravel(); });
  },
  onTravelPhoto() { this._ocrPhoto('travelPaste', 'text'); },
  onDietPhoto() { this._ocrPhoto('dietContent', 'food'); },
  _ocrPhoto(field, action = 'text') {
    const that = this;
    // 隐私授权：chooseMedia 涉及相册/摄像头，要求后台声明后再走
    this._ensurePrivacy('chooseMedia').then(ok => {
      if (!ok) return;
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album', 'camera'],
      success: async (res) => {
        const fp0 = res.tempFiles[0].tempFilePath;
        wx.showLoading({ title: '识别中...' });
        try {
          // 前端压缩：避免原图过大（>4MB）被百度接口拒绝；压缩失败降级用原图
          const fp = await new Promise((resolve) => {
            wx.compressImage({ src: fp0, quality: 70, success: (c) => resolve(c.tempFilePath), fail: () => resolve(fp0) });
          });
          const up = await wx.cloud.uploadFile({ cloudPath: 'ocr/' + Date.now() + '.jpg', filePath: fp });
          const callRet = await wx.cloud.callFunction({ name: 'ocr', data: { fileID: up.fileID, action } });
          wx.hideLoading();
          const r = callRet && callRet.result;
          if (!r || !r.ok) { wx.showToast({ title: (r && r.msg) || '识别失败', icon: 'none', duration: 2500 }); return; }
          if (action === 'food') {
            const top = (r.foods && r.foods[0]) || null;
            if (!top) { wx.showToast({ title: '未识别到食物，请手动输入', icon: 'none', duration: 2500 }); return; }
            const per100 = parseInt(top.calorie, 10);
            that._dietCaloriePer100 = isNaN(per100) ? 0 : per100;
            const g = that.getDietGrams();
            let total = that._dietCaloriePer100;
            if (g > 0 && that._dietCaloriePer100) total = Math.round(that._dietCaloriePer100 / 100 * g);
            that.setData({ dietContent: top.name, dietCal: String(total) });
            const note = (that._dietCaloriePer100 ? ' 约' + that._dietCaloriePer100 + ' kcal/100g' : '') + (total !== that._dietCaloriePer100 ? ' 整份约' + total : '');
            wx.showToast({ title: '识别：' + top.name + note, icon: 'none', duration: 2800 });
          } else {
            that.setData({ [field]: r.text });
            wx.showToast({ title: '识别成功', icon: 'success' });
          }
        } catch (err) { wx.hideLoading(); wx.showToast({ title: 'ocr 云函数未部署或失败：' + (err.errMsg || err.message || '未知'), icon: 'none', duration: 3000 }); }
      },
      fail: (err) => {
        // 用户取消不再静默；其他真实原因（特别是"未声明 scope"）做诊断
        const msg = (err && err.errMsg) || '';
        if (msg && msg.indexOf('cancel') === -1) {
          wx.showToast({ title: '打开相册/相机失败：' + msg.slice(0, 30), icon: 'none', duration: 2500 });
          console.warn('[ocr] chooseMedia fail', err);
        }
      }
    });
    }); // end then
  },

  // ====== 我的足迹 ======
  loadFootprint() {
    db.collection('records').where({ module: 'footprint' }).orderBy('date', 'asc').limit(100).get()
      .then(res => {
        const list = res.data || [];
        const provinces = new Set();
        const cities = new Set();
        list.forEach(fp => { if (fp.province) provinces.add(fp.province); cities.add(fp.city); });
        this.setData({
          footprintList: list,
          fpProvinces: provinces.size,
          fpCities: cities.size,
          fpCoords: list.length
        });
        setTimeout(() => this.drawFootprint(), 120);
      }).catch(() => {});
  },
  // 用 canvas 2d 复刻源 footprint-svg：装饰（树/山/水）+ 虚线渐变路径 + 按时间排序的标记点
  drawFootprint() {
    if (this.data.section !== 'travel') return;
    const q = wx.createSelectorQuery().in(this);
    q.select('#footprintCanvas').fields({ node: true, size: true }).exec(res => {
      if (!res || !res[0] || !res[0].node) return;
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const w = res[0].width, h = res[0].height;
      const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio) || 2;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      const sx = w / 600, sy = h / 220;
      // 装饰：树
      const trees = [{ x: 60, y: 130, s: 1 }, { x: 540, y: 120, s: 1 }, { x: 270, y: 110, s: 0.85 }, { x: 470, y: 130, s: 0.95 }];
      trees.forEach(t => {
        ctx.save(); ctx.translate(t.x * sx, t.y * sy); ctx.scale(t.s * sx, t.s * sy);
        ctx.fillStyle = 'rgba(134,239,172,0.7)'; ctx.beginPath(); ctx.ellipse(0, -15, 14, 20, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(34,197,94,0.5)'; ctx.beginPath(); ctx.ellipse(-5, -12, 8, 14, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(146,64,14,0.7)'; ctx.fillRect(-2, 0, 4, 10);
        ctx.restore();
      });
      // 装饰：山
      const mountains = [{ x: 200, y: 130, w: 50 }, { x: 410, y: 130, w: 60 }];
      mountains.forEach(m => {
        ctx.save(); ctx.translate(m.x * sx, m.y * sy);
        ctx.fillStyle = 'rgba(167,139,250,0.65)';
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(m.w / 2 * sx, -m.w * 0.6 * sy); ctx.lineTo(m.w * sx, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(221,214,254,0.85)';
        ctx.beginPath(); ctx.moveTo(m.w * 0.3 * sx, -m.w * 0.3 * sy); ctx.lineTo(m.w * 0.5 * sx, -m.w * 0.6 * sy); ctx.lineTo(m.w * 0.7 * sx, -m.w * 0.3 * sy); ctx.closePath(); ctx.fill();
        ctx.restore();
      });
      // 装饰：水
      ctx.fillStyle = 'rgba(125,211,252,0.6)'; ctx.beginPath(); ctx.ellipse(320 * sx, 160 * sy, 35 * sx, 6 * sy, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(56,189,248,0.5)'; ctx.beginPath(); ctx.ellipse(320 * sx, 160 * sy, 20 * sx, 3 * sy, 0, 0, Math.PI * 2); ctx.fill();
      // 主路径（虚线渐变）
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, '#9C7BCE'); grad.addColorStop(0.5, '#F0ABDC'); grad.addColorStop(1, '#7B4FA0');
      ctx.strokeStyle = grad; ctx.lineWidth = 2.5; ctx.setLineDash([6, 5]); ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(40 * sx, 140 * sy);
      ctx.quadraticCurveTo(110 * sx, 70 * sy, 180 * sx, 120 * sy);
      ctx.quadraticCurveTo(250 * sx, 170 * sy, 320 * sx, 100 * sy);
      ctx.quadraticCurveTo(390 * sx, 30 * sy, 460 * sx, 130 * sy);
      ctx.quadraticCurveTo(530 * sx, 230 * sy, 560 * sx, 110 * sy);
      ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      // 标记点（按时间排序，取最近 5 个）
      const list = this.data.footprintList.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const maxN = Math.min(list.length, 5);
      const colors = ['#10B981', '#F59E0B', '#3B82F6', '#8B5CF6', '#EC4899'];
      const r = (sx + sy) / 2;
      list.slice(-maxN).forEach((fp, i) => {
        const t = (i + 1) / (maxN + 1);
        const x = (40 + t * 520) * sx;
        const y = (100 + Math.sin(t * Math.PI) * -30) * sy;
        ctx.fillStyle = colors[i % colors.length];
        ctx.beginPath(); ctx.arc(x, y, 10 * r, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3 * r, 0, Math.PI * 2); ctx.fill();
      });
    });
  },
  openFootprintAdd() { this.setData({ fpModalOpen: true, fpCity: '', fpDate: '', fpNote: '' }); },
  closeFootprintModal() { this.setData({ fpModalOpen: false }); },
  onFpCity(e) { this.setData({ fpCity: e.detail.value }); },
  onFpDate(e) { this.setData({ fpDate: e.detail.value }); },
  onFpNote(e) { this.setData({ fpNote: e.detail.value }); },
  confirmFootprint() {
    const city = (this.data.fpCity || '').trim();
    if (!city) { wx.showToast({ title: '请填写城市', icon: 'none' }); return; }
    const date = (this.data.fpDate || '').trim() || today();
    const note = (this.data.fpNote || '').trim();
    const cityObj = WORLD_CITIES.find(c => c.name === city);
    const province = cityObj ? cityObj.province : '';
    db.collection('records').add({ data: { module: 'footprint', city, province, date, note, createTime: db.serverDate() } })
      .then(() => { this.setData({ fpModalOpen: false }); this.loadFootprint(); this.loadDashboard(); })
      .catch(() => { this.setData({ fpModalOpen: false }); });
  },
  deleteFootprint(e) {
    const id = e.currentTarget.dataset.id;
    db.collection('records').doc(id).remove().then(() => this.loadFootprint()).catch(() => {});
  },
  refreshInspiration() {
    // 每次点击换一批：以当天种子 + 点击次数为偏移轮转，避免立刻重复
    this._inspTap = (this._inspTap || 0) + 1;
    this.setData({ inspirationList: pickRot(TRAVEL_DB, dailySeed(0) + this._inspTap, 3, 17) });
  },
  addInspirationToTravel(e) {
    const item = this.data.inspirationList.find(x => x.name === e.currentTarget.dataset.name);
    if (!item) return;
    db.collection('records').add({ data: { module: 'travel', title: item.name, desc: item.note + ' · ' + item.bestMonth, date: today(), createTime: db.serverDate() } })
      .then(() => { wx.showToast({ title: '已加入旅行计划', icon: 'success' }); this.loadTravel(); })
      .catch(() => {});
  },

  // ---------- 周报 ----------
  loadWeekly() {
    // 本周一 ~ 今天
    const now = new Date();
    const dow = (now.getDay() + 6) % 7; // 周一=0
    const mon = new Date(now); mon.setDate(now.getDate() - dow);
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const start = fmt(mon);
    db.collection('records').where({ module: _.in(['daily_todo', 'mood', 'exercise', 'diet', 'accounting', 'body', 'weight', 'feeling', 'media', 'goals', 'travel']) }).limit(100).get()
      .then(res => {
        const list = res.data.filter(x => x.date >= start);
        const todo = list.filter(x => x.module === 'daily_todo').length;
        const mood = list.filter(x => x.module === 'mood').length;
        this.setData({
          weekTotal: list.length, weekTodo: todo, weekMood: mood,
          weekInsight: list.length ? `本周已记录 ${list.length} 条，继续保持轻盈的节奏 🌸` : '本周还没有记录，从今天的一件小事开始吧。'
        });
      }).catch(() => {});
  },

  // ---------- 设置 / 背景 ----------
  HEX_RE: /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/,
  normalizeHex(v, fallback) {
    if (!v) return fallback;
    v = String(v).trim();
    if (!v.startsWith('#')) v = '#' + v;
    return this.HEX_RE.test(v) ? v.toUpperCase() : fallback;
  },
  loadSettings() {
    const stored = wx.getStorageSync('bg');
    // 版本号落后 → 旧默认值（深紫发闷版）已被替代，直接用当前 DEFAULT_THEME
    const isStale = !stored || stored.version !== BG_VERSION;
    const bg = isStale
      ? { c1: DEFAULT_THEME.c1, c2: DEFAULT_THEME.c2, a: DEFAULT_THEME.a }
      : stored;
    const c1 = (bg && bg.c1) || DEFAULT_THEME.c1;
    const c2 = (bg && bg.c2) || DEFAULT_THEME.c2;
    const ang = String((bg && bg.a) || DEFAULT_THEME.a);
    // 若当前就是初始配色，则沿用主页 hero 卡片渐变（primary/gradient 都用原版）
    const isDefault = c1.toUpperCase() === DEFAULT_THEME.c1.toUpperCase()
      && c2.toUpperCase() === DEFAULT_THEME.c2.toUpperCase()
      && String(ang) === String(DEFAULT_THEME.a);
    const aIdx = BG_ANGLE_VALS.indexOf(parseInt(ang, 10));
    const bgMid = this._blendHex(c1, c2);
    // 初始页/主页背景：默认直接用 hero 卡片 4 站渐变；自定义才用 c1/mid/c2 三站
    const bgGradient = isDefault
      ? DEFAULT_THEME.gradient
      : 'linear-gradient(' + ang + 'deg, ' + c1 + ' 0%, ' + bgMid + ' 50%, ' + c2 + ' 100%)';
    this.setData({
      bg1: c1, bg2: c2, bgMid,
      bgGradient,
      bgAngle: ang,
      bgAngleIdx: aIdx >= 0 ? aIdx : 0,
      themeStyle: this._buildThemeStyle(c1, c2, isDefault ? DEFAULT_THEME : null)
    });
    if (isStale) {
      // 把当前默认值写回 storage，标记新版本号，避免下次再被当作 stale
      wx.setStorageSync('bg', { c1, c2, a: parseInt(ang, 10) || DEFAULT_THEME.a, version: BG_VERSION });
    }
  },
  // 颜色工具：根据 bg1/bg2 派生与背景同色系的 CSS 变量，
  // 让 .btn / .chip / .hero / .checkin-btn / .voice-btn / .item-check 等所有用 var(--gradient) 的地方自动跟随。
  _blendHex(c1, c2) {
    // HSL 中点插值 + 饱和度提升（解决 #EDD5E8→#F5DCEE 这种色差很小的双色渐变看不出方向的问题）：
    // - 色相取中点；亮度取中点偏 c1 一侧（让中段更"深"一点点）
    // - 饱和度强制 ≥ max(s1, s2) + 0.08（让 mid 比 c1/c2 都更鲜艳，方向感才出得来）
    const [r1, g1, b1] = this._hexToRgb(c1);
    const [r2, g2, b2] = this._hexToRgb(c2);
    const [h1, s1, l1] = this._rgbToHsl(r1, g1, b1);
    const [h2, s2, l2] = this._rgbToHsl(r2, g2, b2);
    let dh = h2 - h1;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    const mh = (((h1 + dh / 2) % 360) + 360) % 360;
    const ms = Math.min(1, Math.max(s1, s2) + 0.08);
    const ml = (l1 + l2) / 2 - 0.04; // 略偏 c1 一侧（更"深"一点），渐变方向更清晰
    const [mr, mg, mb] = this._hslToRgb(mh, ms, Math.max(0, Math.min(1, ml)));
    return this._rgbToHex(mr, mg, mb);
  },
  _syncBgMid() {
    this.setData({ bgMid: this._blendHex(this.data.bg1, this.data.bg2) });
  },
  _hexToRgb(hex) {
    let h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6) return [181, 126, 220];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  },
  _rgbToHex(r, g, b) {
    const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
  },
  _rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h, s, l = (mx + mn) / 2;
    if (mx === mn) { h = s = 0; }
    else {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      switch (mx) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
        case g: h = ((b - r) / d + 2); break;
        default: h = ((r - g) / d + 4);
      }
      h *= 60;
    }
    return [h, s, l];
  },
  _hueToRgb(p, q, t) {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  },
  _hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = this._hueToRgb(p, q, (h / 360 + 1 / 3));
      g = this._hueToRgb(p, q, h / 360);
      b = this._hueToRgb(p, q, (h / 360 - 1 / 3));
    }
    return [r * 255, g * 255, b * 255];
  },
  // 给定 hex + 目标明度（0~1），保色相饱和度返回新 hex
  _hexWithLightness(hex, targetL) {
    const [r, g, b] = this._hexToRgb(hex);
    const [h, s] = this._rgbToHsl(r, g, b);
    const [nr, ng, nb] = this._hslToRgb(h, Math.max(s, 0.35), Math.max(0, Math.min(1, targetL)));
    return this._rgbToHex(nr, ng, nb);
  },
  // bg1 偏浅时，把 primary 降到更暗（按钮白字清晰）；bg1 偏深时，反提亮。
  // 调柔：目标明度抬到 0.40~0.66，避免上一版过暗发闷。
  _pickPrimary(bg1) {
    const [, , l] = this._rgbToHsl(...this._hexToRgb(bg1));
    const targetL = Math.max(0.40, Math.min(0.66, 0.82 - l * 0.48));
    return this._hexWithLightness(bg1, targetL);
  },
  // theme：显式主题（如 DEFAULT_THEME，含原始 primary/gradient）则直接用它；
  // 否则根据 bg1/bg2 派生同色系变量。
  _buildThemeStyle(bg1, bg2, theme) {
    if (theme) {
      const p = theme.primary, pd = theme.primaryDark;
      return [
        '--primary:' + p,
        '--primary-rgb:' + this._hexToRgb(p).join(', '),
        '--primary-dark:' + pd,
        '--primary-dark-rgb:' + this._hexToRgb(pd).join(', '),
        '--tint:' + theme.tint,
        '--gradient:' + theme.gradient
      ].join('; ');
    }
    const primary = this._pickPrimary(bg1);
    const primaryRgb = this._hexToRgb(primary).join(', ');
    const primaryDark = this._hexWithLightness(primary, Math.max(0.22, this._rgbToHsl(...this._hexToRgb(primary))[2] - 0.18));
    const primaryDarkRgb = this._hexToRgb(primaryDark).join(', ');
    const tint = this._hexWithLightness(bg1, Math.min(0.95, this._rgbToHsl(...this._hexToRgb(bg1))[2] + 0.18));
    const gradient = 'linear-gradient(135deg, ' + primary + ' 0%, ' + bg2 + ' 100%)';
    return [
      '--primary:' + primary,
      '--primary-rgb:' + primaryRgb,
      '--primary-dark:' + primaryDark,
      '--primary-dark-rgb:' + primaryDarkRgb,
      '--tint:' + tint,
      '--gradient:' + gradient
    ].join('; ');
  },
  // 计算初始页/主页背景渐变字符串：默认（c1/c2/角度都=DEFAULT_THEME）直接用 hero 卡片 4 站渐变；
  // 用户自定义时才降级成 c1/mid/c2 三站。
  _syncBg() {
    const c1 = this.data.bg1, c2 = this.data.bg2;
    const ang = parseInt(this.data.bgAngle, 10) || DEFAULT_THEME.a;
    const isDefault = c1.toUpperCase() === DEFAULT_THEME.c1.toUpperCase()
      && c2.toUpperCase() === DEFAULT_THEME.c2.toUpperCase()
      && String(ang) === String(DEFAULT_THEME.a);
    const bgGradient = isDefault
      ? DEFAULT_THEME.gradient
      : 'linear-gradient(' + ang + 'deg, ' + c1 + ' 0%, ' + this.data.bgMid + ' 50%, ' + c2 + ' 100%)';
    this.setData({ bgGradient });
  },
  _syncTheme() {
    this.setData({
      themeStyle: this._buildThemeStyle(this.data.bg1, this.data.bg2),
      bgMid: this._blendHex(this.data.bg1, this.data.bg2)
    }, () => this._syncBg());
  },
  onBg1(e) { this.setData({ bg1: this.normalizeHex(e.detail.value, this.data.bg1) }, () => this._syncTheme()); },
  onBg2(e) { this.setData({ bg2: this.normalizeHex(e.detail.value, this.data.bg2) }, () => this._syncTheme()); },
  onBgAngleIdx(e) {
    const idx = Number(e.detail.value);
    if (idx >= 0 && idx < BG_ANGLE_VALS.length) {
      this.setData({ bgAngleIdx: idx, bgAngle: String(BG_ANGLE_VALS[idx]) }, () => this._syncBg());
    }
  },
  pickBg1() { this.setData({ showPalette: 'bg1' }); },
  pickBg2() { this.setData({ showPalette: 'bg2' }); },
  hidePalette() { this.setData({ showPalette: '' }); },
  onPickColor(e) {
    const hex = e.currentTarget.dataset.hex;
    if (this.data.showPalette === 'bg1') this.setData({ bg1: hex, showPalette: '' }, () => this._syncTheme());
    else if (this.data.showPalette === 'bg2') this.setData({ bg2: hex, showPalette: '' }, () => this._syncTheme());
  },
  applyPreset(e) {
    const p = e.currentTarget.dataset.p;
    const aIdx = BG_ANGLE_VALS.indexOf(p.a);
    this.setData({
      bg1: p.c1, bg2: p.c2,
      bgMid: this._blendHex(p.c1, p.c2),
      bgAngle: String(p.a),
      bgAngleIdx: aIdx >= 0 ? aIdx : 0,
      themeStyle: this._buildThemeStyle(p.c1, p.c2)
    }, () => { this._syncBg(); this.applyBg({ silent: true }); });
  },
  applyBg(opts = {}) {
    const a = parseInt(this.data.bgAngle) || DEFAULT_THEME.a;
    const bg = { c1: this.data.bg1, c2: this.data.bg2, a, version: BG_VERSION };
    wx.setStorageSync('bg', bg);
    // 同步派生 CSS 变量，让按钮/标签/卡片整体随之变色
    if (!this.data.themeStyle) this.setData({ themeStyle: this._buildThemeStyle(bg.c1, bg.c2) });
    // 1) 改 .app 容器：已通过 wxml style 绑定，setData 即刷新
    // 2) 改原生顶栏颜色（用户下拉时可见）
    wx.setBackgroundColor({
      backgroundColor: bg.c1, backgroundColorTop: bg.c1, backgroundColorBottom: bg.c2, success: () => {},
      fail: () => {}
    });
    // 3) 改导航栏胶囊文字色
    wx.setNavigationBarColor({ frontColor: '#000000', backgroundColor: bg.c1, success: () => {}, fail: () => {} });
    if (!opts.silent) {
      wx.showToast({ title: '已应用背景', icon: 'success' });
      wx.vibrateShort && wx.vibrateShort({ type: 'light' });
    }
  },
  resetBg() {
    const aIdx = BG_ANGLE_VALS.indexOf(DEFAULT_THEME.a);
    this.setData({
      bg1: DEFAULT_THEME.c1, bg2: DEFAULT_THEME.c2,
      bgMid: this._blendHex(DEFAULT_THEME.c1, DEFAULT_THEME.c2),
      bgAngle: String(DEFAULT_THEME.a),
      bgAngleIdx: aIdx >= 0 ? aIdx : 0,
      themeStyle: this._buildThemeStyle(DEFAULT_THEME.c1, DEFAULT_THEME.c2, DEFAULT_THEME),
      bgGradient: DEFAULT_THEME.gradient
    }, () => {
      this.applyBg({ silent: true });
      wx.showToast({ title: '已恢复默认背景', icon: 'success' });
    });
  },

  // ---------- 备份 ----------
  async _ensureOpenid() {
    const app = getApp();
    let oid = this.data.openid || app.globalData.openid;
    if (oid) return oid;
    try {
      const r = await wx.cloud.callFunction({ name: 'login' });
      oid = (r && r.result && r.result.openid) || '';
      if (oid) { app.globalData.openid = oid; this.setData({ openid: oid }); }
      return oid;
    } catch (e) {
      const msg = (e && (e.errMsg || e.message)) || 'login 云函数调用失败';
      throw new Error('无法获取 openid：' + msg + '（请右键 cloudfunctions/login → 上传并部署：云端安装依赖，并确认云开发控制台已建 records / user_profile / user_modules 三个集合）');
    }
  },
  async exportBackup() {
    wx.showLoading({ title: '打包中…', mask: true });
    try {
      const oid = await this._ensureOpenid();
      const res = await db.collection('records').where({ _openid: oid }).limit(500).get();
      const payload = JSON.stringify({
        app: 'yaya-workbench',
        version: 1,
        exportedAt: new Date().toISOString(),
        records: res.data || []
      }, null, 2);
      const fs = wx.getFileSystemManager();
      const path = `${wx.env.USER_DATA_PATH}/yaya_backup_${today()}.json`;
      fs.writeFile({
        filePath: path, data: payload, encoding: 'utf8',
        success: () => {
          wx.hideLoading();
          wx.saveFileToDisk({
            filePath: path, showOptions: true,
            success: () => wx.showToast({ title: '已导出', icon: 'success' }),
            fail: err => {
              wx.showModal({
                title: '已生成备份文件',
                content: '保存到磁盘未授权。文件路径：\n' + path + '\n\n请在开发者工具的文件管理器中查看，或长按真机调试区域"通过命令行获取本地文件"导出。',
                showCancel: false, confirmText: '知道了'
              });
              console.warn('[backup] saveFileToDisk fail', err);
            }
          });
        },
        fail: err => {
          wx.hideLoading();
          this._showBackupError('生成备份文件失败', err);
        }
      });
    } catch (err) {
      wx.hideLoading();
      this._showBackupError('导出失败', err);
    }
  },
  importBackup() {
    wx.chooseMessageFile({
      count: 1, type: 'file', extension: ['json'],
      success: r => {
        const path = r.tempFiles && r.tempFiles[0] && r.tempFiles[0].path;
        if (!path) { wx.showToast({ title: '未选择文件', icon: 'none' }); return; }
        wx.showLoading({ title: '导入中…', mask: true });
        const fs = wx.getFileSystemManager();
        fs.readFile({
          filePath: path, encoding: 'utf8',
          success: async ff => {
            try {
              const obj = JSON.parse(ff.data || '{}');
              const list = Array.isArray(obj.records) ? obj.records : [];
              if (!list.length) { wx.hideLoading(); wx.showToast({ title: '备份文件无记录', icon: 'none' }); return; }
              let ok = 0;
              for (const r0 of list) {
                const { _id, _openid, ...rest } = r0;
                try { await db.collection('records').add({ data: rest }); ok++; } catch (_) {}
              }
              wx.hideLoading();
              wx.showModal({
                title: '导入完成',
                content: `成功导入 ${ok}/${list.length} 条记录。建议到对应页面下拉刷新查看。`,
                showCancel: false, confirmText: '好的'
              });
            } catch (e) {
              wx.hideLoading();
              wx.showToast({ title: '文件格式不对', icon: 'none' });
              console.error('[backup] parse fail', e);
            }
          },
          fail: e => {
            wx.hideLoading();
            wx.showToast({ title: '读取文件失败', icon: 'none' });
            console.error('[backup] readFile fail', e);
          }
        });
      },
      fail: () => wx.showToast({ title: '已取消', icon: 'none' })
    });
  },

  clearAll() {
    wx.showModal({
      title: '清空所有数据',
      content: '将删除云端全部记录、个人信息、模块设置，并清空本地缓存。此操作不可恢复，是否继续？',
      confirmText: '清空',
      confirmColor: '#EF4444',
      success: async m => {
        if (!m.confirm) return;
        wx.showLoading({ title: '清空中...' });
        try {
          const oid = await this._ensureOpenid();
          // 三个集合逐个拉取 _id 后批量删
          const colls = ['records', 'user_profile', 'user_modules'];
          let total = 0;
          for (const c of colls) {
            const res = await db.collection(c).where({ _openid: oid }).limit(1000).get();
            const ids = (res.data || []).map(x => x._id);
            // 串行删（避免云函数并发 5 上限）
            for (const id of ids) {
              await db.collection(c).doc(id).remove().catch(() => {});
              total++;
            }
          }
          // 清本地缓存
          try { wx.clearStorageSync(); } catch (e) {}
          wx.hideLoading();
          wx.showToast({ title: '已清空 ' + total + ' 条', icon: 'success', duration: 1500 });
          setTimeout(() => {
            // 重新进入欢迎页
            this.setData({ showWelcome: true });
            this.loadAll();
          }, 1200);
        } catch (err) {
          wx.hideLoading();
          this._showBackupError('清空失败', err);
        }
      }
    });
  },
  // 备份相关错误的统一展示：用 modal（不一闪而过），并附排查清单
  _showBackupError(title, err) {
    const msg = (err && (err.message || err.errMsg)) || '未知错误';
    const isCloudIssue = /openid|cloud|Environment|env|集合|collection|wx-server-sdk|login/i.test(msg);
    const tip = isCloudIssue
      ? '\n\n排查清单：\n1. 微信开发者工具右键 cloudfunctions/login、tts、ocr、security 四个云函数 → 上传并部署（云端安装依赖）\n2. 云开发控制台建 3 个集合：records / user_profile / user_modules，权限全选「仅创建者可读写」\n3. 重新编译小程序'
      : '';
    wx.showModal({
      title: title,
      content: msg + tip,
      showCancel: false,
      confirmText: '我知道了'
    });
    console.error('[backup]', title, err);
  },
  goAddons() { wx.navigateTo({ url: '/pages/addons/addons' }); },

  // ---------- 图表（canvas 自绘，等价 Chart.js） ----------
  drawLine(id, labels, data, color, min, max) {
    const q = wx.createSelectorQuery().in(this);
    q.select('#' + id).fields({ node: true, size: true }).exec(res => {
      if (!res[0] || !res[0].node) return;
      const canvas = res[0].node, ctx = canvas.getContext('2d');
      const w = res[0].width, h = res[0].height; const dpr = wx.getSystemInfoSync().pixelRatio;
      canvas.width = w * dpr; canvas.height = h * dpr; ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
      if (!data.length) return;
      const pad = 18, minV = min !== undefined ? min : Math.min(...data), maxV = max !== undefined ? max : Math.max(...data);
      const range = (maxV - minV) || 1; const stepX = (w - pad * 2) / Math.max(1, data.length - 1);
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.beginPath();
      data.forEach((v, i) => { const x = pad + i * stepX; const y = h - pad - ((v - minV) / range) * (h - pad * 2); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
      ctx.stroke();
    });
  },
  drawDoughnut(id, list) {
    const q = wx.createSelectorQuery().in(this);
    q.select('#' + id).fields({ node: true, size: true }).exec(res => {
      if (!res[0] || !res[0].node) return;
      const canvas = res[0].node, ctx = canvas.getContext('2d');
      const w = res[0].width, h = res[0].height; const dpr = wx.getSystemInfoSync().pixelRatio;
      canvas.width = w * dpr; canvas.height = h * dpr; ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
      const cats = {}; list.forEach(x => { cats[x.category || '其他'] = (cats[x.category || '其他'] || 0) + parseFloat(x.amount || 0); });
      const keys = Object.keys(cats); const total = keys.reduce((s, k) => s + cats[k], 0) || 1;
      const colors = ['#B57EDC', '#F9A8D4', '#7B4FA0', '#A78BFA', '#F59E0B', '#60A5FA', '#34D399'];
      const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 8;
      let start = -Math.PI / 2;
      if (!keys.length) { ctx.fillStyle = '#E5E7EB'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); return; }
      keys.forEach((k, i) => {
        const ang = (cats[k] / total) * Math.PI * 2;
        ctx.fillStyle = colors[i % colors.length]; ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, start, start + ang); ctx.closePath(); ctx.fill(); start += ang;
      });
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2); ctx.fill();
    });
  },

  // ---------- AI 智能输入 + 语音（同声传译插件） ----------
  openAI() { this.setData({ aiOpen: true, aiText: '', aiPreview: '', aiAction: null, voiceStatus: '' }); },
  closeAI() {
    const sec = this.data.section;
    this.setData({ aiOpen: false }, () => {
      // canvas hidden→显示后会丢帧，强制重画
      this.redrawSectionChart(sec);
    });
  },
  redrawSectionChart(sec) {
    try {
      if (sec === 'dashboard') { this.drawRing && this.drawRing(this.data.pct || 0); }
      else if (sec === 'weight') { this.drawWeightChart && this.drawWeightChart(this.data.wHistory || []); }
      else if (sec === 'mood') { this.drawMoodLine && this.drawMoodLine(this.data.moodPoints || []); }
      else if (sec === 'travel') { this.drawFootprint && this.drawFootprint(); }
      else if (sec === 'accounting') { this.drawAccChart && this.drawAccChart(this.data.accStats || { inc: 0, exp: 0 }); }
    } catch(_) { /* 静默，失败不阻塞 */ }
  },
  noop() {},
  onAiText(e) { this.setData({ aiText: e.detail.value }); },
  aiRecognize() {
    const text = (this.data.aiText || '').trim();
    if (!text) return;
    const action = this.smartParse(text);
    this.setData({ aiPreview: this.describeAction(action), aiAction: action });
  },
  confirmAI() {
    const a = this.data.aiAction; if (!a) return;
    this.executeAction(a);
    this.setData({ aiOpen: false, aiText: '', aiPreview: '', aiAction: null });
  },
  smartParse(text) {
    const num = text.match(/(\d+(?:\.\d+)?)/);
    const amount = num ? parseFloat(num[1]) : null;
    // 心情：包含 心情/感受/开心/难过/压力/累/焦虑/满足/沮丧/emo/快乐/烦躁 等关键词
    if (/心情|感受|开心|难过|高兴|兴奋|不开心|压力|焦虑|抑郁|emo|快乐|烦躁|沮丧|疲惫|放松|满足|幸福|生气|难过|忧伤|欣喜|感动|委屈|想哭|想笑|丧|喜/.test(text)) {
      // 简单 emoji 推断
      const pos = /开心|高兴|兴奋|快乐|满足|幸福|放松|欣喜|感动/.test(text);
      const neg = /难过|压力|焦虑|抑郁|emo|烦躁|沮丧|疲惫|生气|忧伤|委屈|想哭|丧|不开心/.test(text);
      const emoji = pos ? '😊' : (neg ? '😔' : '😐');
      const score = pos ? 5 : (neg ? 2 : 3);
      return { type: 'mood', mood: emoji, score, text };
    }
    // 感受（日记）：包含 觉得/想/其实/今天.+(开心|累|烦|难)等长句，且非其他类型
    if (text.length >= 8 && /觉得|想|其实|但|今天.*?(开心|累|烦|难|好|不好)|日记/.test(text)) {
      return { type: 'feeling', text };
    }
    if (/卡|卡路里|kcal|大卡|千卡/.test(text) || (/早餐|午餐|晚餐|加餐|吃了|喝了/.test(text))) {
      let meal = '其他'; if (/早餐|早饭/.test(text)) meal = '早餐'; else if (/午餐|中饭/.test(text)) meal = '午餐'; else if (/晚餐|晚饭/.test(text)) meal = '晚餐'; else if (/加餐|零食/.test(text)) meal = '加餐';
      const cal = amount !== null ? amount : '';
      let content = text.replace(/\d+\.?\d*\s*[卡kcalKCAL大卡千卡]/g, '').replace(/早餐|午饭|午餐|中饭|晚餐|晚饭|加餐|吃了|喝了/g, '').trim();
      return { type: 'diet', meal, calories: cal, content: content || '饮食记录' };
    }
    if (/花|买|支出|消费|花了|付款|支付|吃|喝|打车|地铁|公交/.test(text) && amount !== null) {
      let cat = '其他'; if (/吃|饭|餐|饮|菜|外卖|咖啡|奶茶/.test(text)) cat = '餐饮'; else if (/车|地铁|公交|交通|油|打车|高铁|飞机/.test(text)) cat = '交通'; else if (/衣|鞋|包|购|淘宝|京东|超市|买|东西/.test(text)) cat = '购物'; else if (/房|租|水电|房贷|物业/.test(text)) cat = '住房'; else if (/药|医|医院|挂号/.test(text)) cat = '医疗'; else if (/学|课|书|教育|培训/.test(text)) cat = '教育'; else if (/电影|玩|游戏|娱乐|KTV|演唱会|旅游/.test(text)) cat = '娱乐';
      return { type: 'account', accType: 'expense', amount, category: cat, note: text };
    }
    if (/收入|工资|收到|到账|奖金|红包|兼职|副业|理财收益/.test(text) && amount !== null) {
      let cat = '工资'; if (/红包/.test(text)) cat = '红包'; else if (/奖金/.test(text)) cat = '奖金'; else if (/兼职|副业/.test(text)) cat = '兼职'; else if (/理财/.test(text)) cat = '理财';
      return { type: 'account', accType: 'income', amount, category: cat, note: text };
    }
    if (/跑|步|运动|健身|锻炼|游泳|骑车|瑜伽|普拉提|有氧|无氧|HIIT|分钟|小时/.test(text)) {
      let minutes = amount || 30; if (/小时/.test(text) && amount) minutes = amount * 60;
      let exType = '有氧'; if (/无氧/.test(text)) exType = '无氧'; else if (/HIIT|混氧/.test(text)) exType = '混氧HIIT';
      return { type: 'exercise', exType, minutes, note: text };
    }
    const word = text.match(/([a-zA-Z\-]{2,})/);
    if (/单词|英语|英文|vocabulary|learn/.test(text) && word) {
      return { type: 'word', word: word[1], meaning: text.replace(word[1], '').replace(/[\/?？，,]/g, ' ').trim() || '（请补充释义）' };
    }
    return { type: 'text', text };
  },
  describeAction(a) {
    if (a.type === 'diet') return `🍱 饮食：${a.meal} · ${a.calories ? a.calories + ' kcal' : ''} · ${a.content}`;
    if (a.type === 'account') return `💵 ${a.accType === 'income' ? '收入' : '支出'}：${a.amount} 元 · ${a.category}`;
    if (a.type === 'exercise') return `🏃 运动：${a.exType} ${a.minutes} 分钟`;
    if (a.type === 'word') return `💬 单词：${a.word} ${a.meaning}`;
    if (a.type === 'mood') return `${a.mood} 心情：${a.text}`;
    if (a.type === 'feeling') return `📔 感受：${a.text.slice(0, 30)}${a.text.length > 30 ? '…' : ''}`;
    return `📝 ${a.text}`;
  },
  executeAction(a) {
    if (a.type === 'diet') db.collection('records').add({ data: { module: 'diet', content: a.content, meal: a.meal, calories: a.calories || 0, date: today(), createTime: db.serverDate() } }).then(() => { this.loadDiet(); this.loadDashboard(); });
    else if (a.type === 'account') db.collection('records').add({ data: { module: 'accounting', type: a.accType, amount: a.amount, category: a.category, note: a.note, date: today(), createTime: db.serverDate() } }).then(() => { this.loadAcc(); this.loadDashboard(); });
    else if (a.type === 'exercise') db.collection('records').add({ data: { module: 'exercise', kind: a.exType, minutes: a.minutes, date: today(), createTime: db.serverDate() } }).then(() => { this.loadEx(); this.loadDashboard(); });
    else if (a.type === 'word') db.collection('records').add({ data: { module: 'english', word: a.word, meaning: a.meaning, date: today(), createTime: db.serverDate() } }).then(() => this.loadEnglish());
    else if (a.type === 'mood') {
      const ok = this.safeText(a.text);
      ok.then(pass => { if (!pass) return;
        db.collection('records').add({ data: { module: 'mood', emoji: a.mood, text: a.text, score: a.score, date: today(), createTime: db.serverDate() } }).then(() => { this.loadMood(); this.loadDashboard(); });
      });
    } else if (a.type === 'feeling') {
      const ok = this.safeText(a.text);
      ok.then(pass => { if (!pass) return;
        db.collection('records').add({ data: { module: 'feeling', content: a.text, date: today(), createTime: db.serverDate() } }).then(() => { this.loadFeeling(); this.loadDashboard(); });
      });
    } else {
      // 兜底：纯文本写入感受
      const ok = this.safeText(a.text);
      ok.then(pass => { if (!pass) return;
        db.collection('records').add({ data: { module: 'feeling', content: a.text, date: today(), createTime: db.serverDate() } }).then(() => { this.loadFeeling(); this.loadDashboard(); });
      });
    }
  },
  toggleVoice() {
    // 语音转文字：录音 -> 上传云存储 -> 云端 ASR（个人账号无插件，走云函数）
    if (this.data.voiceStatus === '🎤 正在聆听...') {
      if (this.recorder) this.recorder.stop();
      this.setData({ voiceStatus: '' });
      return;
    }
    const that = this;
    // 隐私授权检查：未在后台声明 scope.record 时，requirePrivacyAuthorize 会 fail，
    // 我们的 _ensurePrivacy 会给出明确 modal，告知去后台补加。
    this._ensurePrivacy('scope.record').then(ok => {
      if (!ok) { that.setData({ voiceStatus: '⚠️ 需先声明麦克风权限' }); return; }
    const rm = wx.getRecorderManager();
    that.recorder = rm;
    rm.onStart(() => that.setData({ voiceStatus: '🎤 正在聆听...' }));
    rm.onStop(async (res) => {
      that.setData({ voiceStatus: '识别中...' });
      try {
        const up = await wx.cloud.uploadFile({ cloudPath: 'asr/' + Date.now() + '.wav', filePath: res.tempFilePath });
        const callRet = await cloudVoice('asr', { fileID: up.fileID });
        const r = callRet && callRet.result;
        if (r && r.ok) { that.setData({ aiText: r.text, voiceStatus: '' }); that.aiRecognize(); }
        else that.setData({ voiceStatus: '识别失败：' + ((r && r.msg) || '未知') });
      } catch (err) { that.setData({ voiceStatus: '识别失败：' + (err.errMsg || err.message || '请先部署 tts 云函数') }); }
    });
    rm.onError((e) => that.setData({ voiceStatus: '录音失败：' + (e.errMsg || '') }));
    rm.start({ duration: 60000, format: 'wav', sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000 });
    }); // end then
  }
});
