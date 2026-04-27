const { callCloud } = require('../../utils/cloud');
const { getUserInfo } = require('../../utils/auth');

Page({
  data: {
    userInfo: null,
    totalPoints: 0,
    moduleBreakdown: [],
    recentLogs: [],
    loading: true
  },

  onShow() {
    const user = getUserInfo();
    if (!user) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    this.setData({ userInfo: user });
    this.loadDashboard();
  },

  async loadDashboard() {
    this.setData({ loading: true });
    try {
      const data = await callCloud('points', { action: 'dashboard' });
      this.setData({
        totalPoints: data.totalPoints,
        moduleBreakdown: data.moduleBreakdown,
        recentLogs: data.recentLogs,
        loading: false
      });
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  goModules() {
    wx.switchTab({ url: '/pages/modules/modules' });
  },

  goHistory() {
    wx.switchTab({ url: '/pages/history/history' });
  }
});
