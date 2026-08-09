// pages/addons/addons.js —— 添加项（用户自选模块）
const { MODULES } = require('../../modules/index');

Page({
  data: { groups: [], enabled: [] },

  onShow() { this.load(); },

  async load() {
    const app = getApp();
    let enabled = app.globalData.enabled;
    if (!enabled || enabled.length === 0) {
      const db = wx.cloud.database();
      const res = await db.collection('user_modules').get().catch(() => ({ data: [] }));
      enabled = (res.data[0] && res.data[0].enabled) || MODULES.map(m => m.id);
    }

    // 按分类分组展示
    const catMap = {};
    MODULES.forEach(m => {
      const item = Object.assign({}, m, { on: enabled.indexOf(m.id) > -1 });
      (catMap[m.category] = catMap[m.category] || []).push(item);
    });
    const groups = Object.keys(catMap).map(c => ({ category: c, items: catMap[c] }));

    this.setData({ groups, enabled });
  },

  // 开关切换 -> 写回 user_modules（数据隔离由安全规则保证只改自己的）
  async toggle(e) {
    const id = e.currentTarget.dataset.id;
    const on = e.detail.value;
    let enabled = this.data.enabled.slice();
    if (on) {
      if (enabled.indexOf(id) === -1) enabled.push(id);
    } else {
      enabled = enabled.filter(x => x !== id);
    }
    this.setData({ enabled });

    const app = getApp();
    app.globalData.enabled = enabled;

    const db = wx.cloud.database();
    const res = await db.collection('user_modules').get().catch(() => ({ data: [] }));
    if (res.data.length === 0) {
      await db.collection('user_modules').add({ data: { enabled } });
    } else {
      await db.collection('user_modules').doc(res.data[0]._id).update({ data: { enabled } });
    }
    wx.showToast({ title: on ? '已添加' : '已移除', icon: 'none' });
  }
});
