// app.js —— 全局初始化云开发 + 静默登录
//
// 部署前请修改两处：
// 1. project.config.json 里的 "appid" 换成你自己的小程序 AppID
// 2. 下面 globalData.env 换成你在「云开发控制台」看到的环境 ID
//    （也可以在微信开发者工具里右键 cloudfunctions/login 选择环境，
//      此处 env 留空字符串时会使用「默认环境」）
App({
  globalData: {
    env: 'cloud1-d6g3kvfyuf44f11a6',  // 云开发环境 ID
    openid: '',
    enabled: []         // 当前用户启用的模块 id 列表
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('当前基础库不支持云开发，请使用 2.2.3 以上基础库');
      return;
    }
    // env 为空时（未配置环境 ID）使用默认环境，避免初始化报错
    const env = this.globalData.env;
    wx.cloud.init(env ? { env, traceUser: true } : { traceUser: true });
    this.silentLogin();
    this._wirePrivacy();
  },

  // 全局隐私授权回调：当 __usePrivacyCheck__=true 时，敏感 API (录音/相册/相机) 调用前若未声明或未同意，会触发此事件。
  // 走标准流程：把 resolve/reject 暂存起来，由页面的隐私弹窗同意按钮统一回调。
  _wirePrivacy() {
    if (!wx.onNeedPrivacyAuthorization) return;
    const that = this;
    wx.onNeedPrivacyAuthorization(res => {
      const api = (res && res.apiName) || (res && res.scope) || '';
      console.log('[privacy] need authorize for', api);
      // 通知当前页：需要弹隐私弹窗。用户点同意/拒绝后，我们用 _privacyResolve / _privacyReject 解锁。
      that.globalData.pendingPrivacyApi = api;
      that.globalData._privacyResolve = res.resolve || null;
      that.globalData._privacyReject = res.reject || null;
      // 通知页面（workbench 订阅了 onShow 轮询）
      if (that._privacyPageHandler && that._privacyPageHandler(api)) return;
      // 没有任何页面响应，就直接 reject（保持微信不卡住）
      if (res.reject) res.reject({ errMsg: 'no privacy page handler' });
    });
  },

  // 静默登录：拿 OPENID，并确保 user_modules 有默认启用项
  silentLogin() {
    wx.cloud.callFunction({ name: 'login' })
      .then(res => {
        const result = res.result || {};
        this.globalData.openid = result.openid || '';
        this.globalData.enabled = result.enabled || [];
        this.globalData.loginError = '';
        console.log('[login] openid=', this.globalData.openid);
      })
      .catch(err => {
        // 不吞错，把真实原因带给上层做诊断 UI
        this.globalData.openid = '';
        this.globalData.loginError = (err && (err.errMsg || err.message)) || 'login 云函数调用失败';
        console.error('[login] failed', err);
      });
  }
});
