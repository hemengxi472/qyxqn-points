App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      return;
    }
    wx.cloud.init({
      env: 'points-system-env',
      traceUser: true
    });
    this.loadUserInfo();
  },

  globalData: {
    userInfo: null,
    isAdmin: false,
    isRegistered: false
  },

  async loadUserInfo() {
    try {
      const res = await wx.cloud.callFunction({ name: 'auth', data: { action: 'login' } });
      if (res.result && res.result.user) {
        this.globalData.userInfo = res.result.user;
        this.globalData.isRegistered = true;
        this.globalData.isAdmin = res.result.user.role === 'admin' || res.result.user.role === 'superadmin';
      } else if (res.result && res.result.needRegister) {
        this.globalData.isRegistered = false;
      }
    } catch (err) {
      console.error('登录检查失败:', err);
    }
  },

  getUserInfo() {
    return this.globalData.userInfo;
  },

  isAdmin() {
    return this.globalData.isAdmin;
  },

  setUserInfo(user, role) {
    this.globalData.userInfo = user;
    this.globalData.isRegistered = true;
    this.globalData.isAdmin = role === 'admin' || role === 'superadmin';
  }
});
