// pages/module-detail/module-detail.js —— 通用模块详情（按 type 渲染，1:1 对齐源文件卡片视觉）
// 所有用户数据写入 records 集合，靠 module 字段区分来源。
const { getModule } = require('../../modules/index');
const { today } = require('../../utils/date');
const { getWuxing } = require('../../utils/wuxing');

const REC = 'records';
const CATS = ['工作', '个人', '购物', '健身', '学习', '生活'];
const EX_KINDS = ['有氧', '无氧', '混氧HIIT'];
const MEDIA_PLATS = ['小红书', '抖音', '微博', '公众号', 'B站', '朋友圈', '其他'];
const MEDIA_STATUS = ['灵感', '规划中', '已发布'];
const GOAL_CATS = ['事业', '健康', '学习', '生活', '财务', '其他'];
const MOODS = ['🥰', '😊', '🙂', '😐', '😔', '😢', '🥹'];
const DIET_MEALS = ['早餐', '午餐', '晚餐', '加餐'];

Page({
  data: {
    module: null, type: '', date: '',
    // todo
    todos: [], newTodo: '', todoCat: '工作',
    // number(weight)
    wMorning: '', wEvening: '', wRec: null,
    // account
    accType: 'expense', amount: '', accCat: '餐饮', accNote: '', accList: [],
    monthIncome: 0, monthExpense: 0, monthBalance: 0,
    // text(diet/feeling)
    value: '', dietMeal: '早餐', dietCal: '', dietList: [], feelingList: [],
    // content
    wuxing: null, english: null,
    // mood
    moodEmoji: '🥰', moodText: '', moodList: [],
    // exercise
    exList: [],
    // body
    bodyDone: false,
    // media
    mediaPlat: '小红书', mediaTitle: '', mediaContent: '', mediaStatus: '灵感', mediaList: [],
    // goals
    goalText: '', goalCat: '健康', goalList: [],
    // travel
    travelTitle: '', travelDesc: '', travelList: [],
    // options
    cats: CATS, exKinds: EX_KINDS, mediaPlats: MEDIA_PLATS, mediaStatuses: MEDIA_STATUS,
    goalCats: GOAL_CATS, moods: MOODS, dietMeals: DIET_MEALS,
    // ui
    showEx: false, exKind: '', exMin: ''
  },

  onLoad(options) {
    const m = getModule(options.id);
    if (!m) { wx.showToast({ title: '模块不存在', icon: 'none' }); return; }
    wx.setNavigationBarTitle({ title: m.name });
    this.setData({ module: m, type: m.type, date: today() });
    this.load();
  },

  async load() {
    const m = this.data.module;
    if (!m) return;
    const t = today();
    const db = wx.cloud.database();

    if (m.type === 'content') {
      if (m.id === 'wuxing') this.setData({ wuxing: getWuxing(t) });
      else if (m.id === 'english') this.setData({ english: {
        sentence: 'Small steps every day lead to big changes.', word: 'serene', meaning: '平静的，安详的'
      }});
      return;
    }

    if (m.type === 'todo') {
      const r = await db.collection(REC).where({ module: 'daily_todo', date: t }).orderBy('createdAt', 'desc').limit(100).get().catch(() => ({ data: [] }));
      this.setData({ todos: r.data });
    } else if (m.type === 'number') {
      const r = await db.collection(REC).where({ module: 'weight', date: t }).get().catch(() => ({ data: [] }));
      const rec = r.data[0] || null;
      this.setData({ wRec: rec, wMorning: rec ? (rec.morning || '') : '', wEvening: rec ? (rec.evening || '') : '' });
    } else if (m.type === 'account') {
      await this.loadAccount();
    } else if (m.type === 'text') {
      if (m.id === 'diet') {
        const r = await db.collection(REC).where({ module: 'diet', date: t }).orderBy('createdAt', 'desc').get().catch(() => ({ data: [] }));
        this.setData({ dietList: r.data });
      } else {
        const r = await db.collection(REC).where({ module: 'feeling', date: t }).orderBy('createdAt', 'desc').get().catch(() => ({ data: [] }));
        this.setData({ feelingList: r.data });
      }
    } else if (m.type === 'mood') {
      const r = await db.collection(REC).where({ module: 'mood', date: t }).orderBy('createdAt', 'desc').get().catch(() => ({ data: [] }));
      const rec = r.data[0];
      this.setData({ moodList: r.data, moodEmoji: rec ? rec.emoji : '🥰', moodText: rec ? rec.text : '' });
    } else if (m.type === 'exercise') {
      const r = await db.collection(REC).where({ module: 'exercise', date: t }).get().catch(() => ({ data: [] }));
      this.setData({ exList: r.data });
    } else if (m.type === 'body') {
      const r = await db.collection(REC).where({ module: 'body', date: t }).get().catch(() => ({ data: [] }));
      this.setData({ bodyDone: r.data.length > 0 });
    } else if (m.type === 'media') {
      const r = await db.collection(REC).where({ module: 'media' }).orderBy('createdAt', 'desc').limit(100).get().catch(() => ({ data: [] }));
      this.setData({ mediaList: r.data });
    } else if (m.type === 'goals') {
      const r = await db.collection(REC).where({ module: 'goals' }).orderBy('createdAt', 'desc').limit(100).get().catch(() => ({ data: [] }));
      this.setData({ goalList: r.data });
    } else if (m.type === 'travel') {
      const r = await db.collection(REC).where({ module: 'travel' }).orderBy('createdAt', 'desc').limit(100).get().catch(() => ({ data: [] }));
      this.setData({ travelList: r.data });
    }
  },

  async loadAccount() {
    const db = wx.cloud.database();
    const t = today();
    const r = await db.collection(REC).where({ module: 'accounting' }).limit(100).get().catch(() => ({ data: [] }));
    const list = r.data;
    const ym = t.slice(0, 7);
    const cur = list.filter(x => (x.date || '').slice(0, 7) === ym);
    const income = cur.filter(x => x.type === 'income').reduce((s, x) => s + (x.amount || 0), 0);
    const expense = cur.filter(x => x.type === 'expense').reduce((s, x) => s + (x.amount || 0), 0);
    this.setData({ accList: list.slice(0, 50), monthIncome: income, monthExpense: expense, monthBalance: income - expense });
  },

  // ---------- todo ----------
  onNewTodo(e) { this.setData({ newTodo: e.detail.value }); },
  onTodoCat(e) { this.setData({ todoCat: e.currentTarget.dataset.c }); },
  async addTodo() {
    const v = this.data.newTodo.trim();
    if (!v) return;
    await wx.cloud.database().collection(REC).add({ data: { module: 'daily_todo', content: v, cat: this.data.todoCat, done: false, date: today() } });
    this.setData({ newTodo: '' }); this.load();
  },
  async toggleTodo(e) {
    const { id, done } = e.currentTarget.dataset;
    await wx.cloud.database().collection(REC).doc(id).update({ data: { done: !done } }); this.load();
  },
  async delTodo(e) {
    await wx.cloud.database().collection(REC).doc(e.currentTarget.dataset.id).remove(); this.load();
  },

  // ---------- weight ----------
  onWM(e) { this.setData({ wMorning: e.detail.value }); },
  onWE(e) { this.setData({ wEvening: e.detail.value }); },
  async saveWeight() {
    const m = this.data.module; const t = today();
    const db = wx.cloud.database();
    const r = await db.collection(REC).where({ module: 'weight', date: t }).get().catch(() => ({ data: [] }));
    const data = { morning: this.data.wMorning, evening: this.data.wEvening, date: t };
    if (r.data.length === 0) await db.collection(REC).add({ data: Object.assign({ module: 'weight' }, data) });
    else await db.collection(REC).doc(r.data[0]._id).update({ data });
    wx.showToast({ title: '已记录' }); this.load();
  },

  // ---------- account ----------
  setAccType(e) { this.setData({ accType: e.currentTarget.dataset.type }); },
  onAmount(e) { this.setData({ amount: e.detail.value }); },
  onAccCat(e) { this.setData({ accCat: e.detail.value }); },
  onAccNote(e) { this.setData({ accNote: e.detail.value }); },
  async addAccount() {
    const n = parseFloat(this.data.amount);
    if (isNaN(n)) { wx.showToast({ title: '请输入金额', icon: 'none' }); return; }
    await wx.cloud.database().collection(REC).add({ data: { module: 'accounting', amount: n, type: this.data.accType, category: this.data.accCat, note: this.data.accNote, date: today() } });
    this.setData({ amount: '', accNote: '' }); this.loadAccount();
  },
  async delAcc(e) { await wx.cloud.database().collection(REC).doc(e.currentTarget.dataset.id).remove(); this.loadAccount(); },

  // ---------- text (diet/feeling) ----------
  onValue(e) { this.setData({ value: e.detail.value }); },
  onDietMeal(e) { this.setData({ dietMeal: e.detail.value }); },
  onDietCal(e) { this.setData({ dietCal: e.detail.value }); },
  async addDiet() {
    const v = this.data.value.trim();
    if (!v) { wx.showToast({ title: '请输入内容', icon: 'none' }); return; }
    await wx.cloud.database().collection(REC).add({ data: { module: 'diet', content: v, meal: this.data.dietMeal, calories: this.data.dietCal, date: today() } });
    this.setData({ value: '', dietCal: '' }); this.load();
  },
  async addFeeling() {
    const v = this.data.value.trim();
    if (!v) { wx.showToast({ title: '请输入内容', icon: 'none' }); return; }
    await wx.cloud.database().collection(REC).add({ data: { module: 'feeling', content: v, date: today() } });
    this.setData({ value: '' }); this.load();
  },
  async delText(e) {
    const { id, mod } = e.currentTarget.dataset;
    await wx.cloud.database().collection(REC).doc(id).remove(); this.load();
  },

  // ---------- mood ----------
  setMood(e) { this.setData({ moodEmoji: e.currentTarget.dataset.e }); },
  onMoodText(e) { this.setData({ moodText: e.detail.value }); },
  async saveMood() {
    const t = today(); const db = wx.cloud.database();
    const r = await db.collection(REC).where({ module: 'mood', date: t }).get().catch(() => ({ data: [] }));
    const data = { emoji: this.data.moodEmoji, text: this.data.moodText, date: t };
    if (r.data.length === 0) await db.collection(REC).add({ data: Object.assign({ module: 'mood' }, data) });
    else await db.collection(REC).doc(r.data[0]._id).update({ data });
    wx.showToast({ title: '已保存' }); this.load();
  },

  // ---------- exercise ----------
  openEx(e) { this.setData({ showEx: true, exKind: e.currentTarget.dataset.k, exMin: '' }); },
  onExMin(e) { this.setData({ exMin: e.detail.value }); },
  closeEx() { this.setData({ showEx: false }); },
  async saveEx() {
    const n = parseInt(this.data.exMin);
    if (isNaN(n) || n <= 0) { wx.showToast({ title: '请输入分钟数', icon: 'none' }); return; }
    await wx.cloud.database().collection(REC).add({ data: { module: 'exercise', kind: this.data.exKind, minutes: n, date: today() } });
    this.setData({ showEx: false, exMin: '' }); this.load();
  },
  async delEx(e) { await wx.cloud.database().collection(REC).doc(e.currentTarget.dataset.id).remove(); this.load(); },

  // ---------- body ----------
  async doBody() {
    const t = today(); const db = wx.cloud.database();
    const r = await db.collection(REC).where({ module: 'body', date: t }).get().catch(() => ({ data: [] }));
    if (r.data.length === 0) await db.collection(REC).add({ data: { module: 'body', done: true, date: t } });
    wx.showToast({ title: '已完成 ✓' }); this.load();
  },

  // ---------- media ----------
  onMediaPlat(e) { this.setData({ mediaPlat: e.detail.value }); },
  onMediaTitle(e) { this.setData({ mediaTitle: e.detail.value }); },
  onMediaContent(e) { this.setData({ mediaContent: e.detail.value }); },
  setMediaStatus(e) { this.setData({ mediaStatus: e.currentTarget.dataset.s }); },
  async addMedia() {
    if (!this.data.mediaTitle.trim() && !this.data.mediaContent.trim()) { wx.showToast({ title: '请输入内容', icon: 'none' }); return; }
    await wx.cloud.database().collection(REC).add({ data: { module: 'media', platform: this.data.mediaPlat, title: this.data.mediaTitle, content: this.data.mediaContent, status: this.data.mediaStatus, date: today() } });
    this.setData({ mediaTitle: '', mediaContent: '' }); this.load();
  },
  async delMedia(e) { await wx.cloud.database().collection(REC).doc(e.currentTarget.dataset.id).remove(); this.load(); },

  // ---------- goals ----------
  onGoalText(e) { this.setData({ goalText: e.detail.value }); },
  onGoalCat(e) { this.setData({ goalCat: e.detail.value }); },
  async addGoal() {
    const v = this.data.goalText.trim();
    if (!v) { wx.showToast({ title: '请输入目标', icon: 'none' }); return; }
    await wx.cloud.database().collection(REC).add({ data: { module: 'goals', text: v, category: this.data.goalCat, done: false, date: today() } });
    this.setData({ goalText: '' }); this.load();
  },
  async toggleGoal(e) {
    const { id, done } = e.currentTarget.dataset;
    await wx.cloud.database().collection(REC).doc(id).update({ data: { done: !done } }); this.load();
  },
  async delGoal(e) { await wx.cloud.database().collection(REC).doc(e.currentTarget.dataset.id).remove(); this.load(); },

  // ---------- travel ----------
  onTravelTitle(e) { this.setData({ travelTitle: e.detail.value }); },
  onTravelDesc(e) { this.setData({ travelDesc: e.detail.value }); },
  async addTravel() {
    const v = this.data.travelTitle.trim();
    if (!v) { wx.showToast({ title: '请输入目的地', icon: 'none' }); return; }
    await wx.cloud.database().collection(REC).add({ data: { module: 'travel', title: v, desc: this.data.travelDesc, date: today() } });
    this.setData({ travelTitle: '', travelDesc: '' }); this.load();
  },
  async delTravel(e) { await wx.cloud.database().collection(REC).doc(e.currentTarget.dataset.id).remove(); this.load(); },

  noop() {},

  onShareAppMessage() {
    const m = this.data.module;
    return { title: `鸭鸭·${m ? m.name : '个人工作台'}`, path: '/pages/workbench/workbench' };
  }
});
