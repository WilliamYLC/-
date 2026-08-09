// pages/profile/profile.js —— 我的（账号展示 + 今日小结图分享）
const { MODULES, getModule } = require('../../modules/index');
const { today, weekday } = require('../../utils/date');
const db = wx.cloud.database();

function getPixelRatio() {
  try {
    if (wx.getWindowInfo) return wx.getWindowInfo().pixelRatio;
    return wx.getSystemInfoSync().pixelRatio;
  } catch (e) {
    return 2;
  }
}

Page({
  data: {
    openidMask: '',
    userName: '鸭鸭',
    userAvatar: '/assets/brand-avatar.png',
    lines: [],
    canvasVisible: false
  },

  onShow() {
    const app = getApp();
    const oid = app.globalData.openid || '';
    this.setData({
      openidMask: oid ? `${oid.slice(0, 4)}****${oid.slice(-4)}` : '未登录'
    });
    this.loadUserInfo();
    this.buildSummary();
  },

  // 与 workbench 的 user_profile 同步（本地优先：缓存里有就用缓存，云端只有比缓存新才覆盖）
  loadUserInfo() {
    const local = wx.getStorageSync('user_profile');
    if (local) this.setData({ userName: local.name || '鸭鸭', userAvatar: local.avatar || '/assets/brand-avatar.png' });
    const app = getApp();
    const oid = app.globalData.openid;
    const applyCloud = (u) => {
      // 云端 >= 本地才覆盖，避免被旧云端覆盖刚改完的新值
      const localTs = local && local.updatedAt ? new Date(local.updatedAt).getTime() : 0;
      const cloudTs = u && u.updatedAt ? new Date(u.updatedAt).getTime() : 0;
      if (cloudTs >= localTs) {
        this.setData({ userName: (u && u.name) || '鸭鸭', userAvatar: (u && u.avatar) || '/assets/brand-avatar.png' });
      }
    };
    if (oid) {
      db.collection('user_profile').where({ _openid: oid }).limit(1).get().then(res => {
        if (res.data.length) applyCloud(res.data[0]);
      }).catch(() => {});
    } else {
      // openid 还没回来时，主动拉一次；拉到后强制再同步
      wx.cloud.callFunction({ name: 'login' }).then(res => {
        if (res && res.result && res.result.openid) {
          app.globalData.openid = res.result.openid;
          this.loadUserInfo();
        }
      }).catch(() => {});
    }
  },

  // 汇总今日数据，生成小结文案
  async buildSummary() {
    const app = getApp();
    let enabled = app.globalData.enabled;
    if (!enabled || enabled.length === 0) {
      const db = wx.cloud.database();
      const res = await db.collection('user_modules').get().catch(() => ({ data: [] }));
      enabled = (res.data[0] && res.data[0].enabled) || MODULES.map(m => m.id);
    }

    const db = wx.cloud.database();
    const t = today();
    const lines = [];

    const todoRes = await db.collection('records').where({ module: 'daily_todo', date: t }).get().catch(() => ({ data: [] }));
    const total = todoRes.data.length;
    const done = todoRes.data.filter(x => x.done).length;
    lines.push(`待办：完成 ${done}/${total}`);

    const wRes = await db.collection('records').where({ module: 'weight', date: t }).get().catch(() => ({ data: [] }));
    lines.push(wRes.data[0] ? `体重：${wRes.data[0].value} kg` : '体重：未记录');

    const aRes = await db.collection('records').where({ module: 'accounting', date: t }).get().catch(() => ({ data: [] }));
    const exp = aRes.data.filter(r => r.type === 'expense').reduce((s, r) => s + (r.amount || 0), 0);
    lines.push(`今日支出：¥${exp}`);

    for (const id of ['diet', 'exercise', 'feeling']) {
      const m = getModule(id);
      const r = await db.collection('records').where({ module: id, date: t }).get().catch(() => ({ data: [] }));
      lines.push(`${m ? m.name : id}：${r.data[0] ? '已记录' : '未记录'}`);
    }

    this.setData({ lines });
  },

  // 用 canvas 把小结画成图片（可保存/转发，分享的是图不是原始数据）
  genImage() {
    const that = this;
    wx.createSelectorQuery()
      .select('#shareCanvas')
      .fields({ node: true, size: true })
      .exec(res => {
        if (!res || !res[0] || !res[0].node) {
          wx.showToast({ title: '画布未就绪', icon: 'none' });
          return;
        }
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = getPixelRatio();
        const W = 300, H = 440;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        ctx.scale(dpr, dpr);

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);
        // 顶部紫粉渐变带
        const grad = ctx.createLinearGradient(0, 0, W, 90);
        grad.addColorStop(0, '#E8B4E8');
        grad.addColorStop(0.3, '#F0C4E8');
        grad.addColorStop(0.7, '#F5D4D4');
        grad.addColorStop(1, '#F5DEE0');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, 90);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 22px sans-serif';
        ctx.fillText('🦆 鸭鸭·今日小结', 16, 44);
        ctx.font = '12px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText(`${today()} ${weekday()}`, 16, 68);

        ctx.fillStyle = '#7B4FA0';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText('— 今日记录 —', 16, 118);

        ctx.fillStyle = '#1F2937';
        ctx.font = '14px sans-serif';
        let y = 146;
        that.data.lines.forEach(l => {
          ctx.fillText(l, 16, y);
          y += 30;
        });

        ctx.fillStyle = '#B57EDC';
        ctx.font = 'italic 11px sans-serif';
        ctx.fillText('记录轻盈每一天 · 鸭鸭·个人工作台', 16, H - 20);

        that.setData({ canvasVisible: true });
      });
  },

  saveImage() {
    wx.createSelectorQuery()
      .select('#shareCanvas')
      .fields({ node: true })
      .exec(res => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        wx.canvasToTempFilePath({
          canvas,
          success: r => {
            wx.saveImageToPhotosAlbum({
              filePath: r.tempFilePath,
              success: () => wx.showToast({ title: '已保存到相册' }),
              fail: () => wx.showToast({ title: '保存失败，请授权相册', icon: 'none' })
            });
          }
        });
      });
  },

  onShareAppMessage() {
    return {
      title: '鸭鸭·个人工作台，记录轻盈每一天',
      path: '/pages/workbench/workbench'
    };
  }
});
