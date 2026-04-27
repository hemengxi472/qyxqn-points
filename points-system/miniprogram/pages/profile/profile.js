const { getUserInfo, isAdmin } = require('../../utils/auth');

Page({
  data: {
    userInfo: null,
    isAdmin: false
  },

  onShow() {
    this.setData({
      userInfo: getUserInfo(),
      isAdmin: isAdmin()
    });
  },

  goAdmin() {
    wx.switchTab({ url: '/pages/admin/review/review' });
  },

  goMySubmissions() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出吗？',
      success(res) {
        if (res.confirm) {
          const app = getApp();
          app.globalData.userInfo = null;
          app.globalData.isRegistered = false;
          app.globalData.isAdmin = false;
          wx.reLaunch({ url: '/pages/login/login' });
        }
      }
    });
  }
});
