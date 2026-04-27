const { callCloud } = require('../../utils/cloud');
const { getUserInfo } = require('../../utils/auth');

Page({
  data: {
    logs: [],
    page: 1,
    total: 0,
    loading: false,
    hasMore: true,
    userInfo: null
  },

  onShow() {
    this.setData({ userInfo: getUserInfo() });
    this.loadHistory(true);
  },

  async loadHistory(reset = false) {
    if (this.data.loading) return;
    const page = reset ? 1 : this.data.page;
    this.setData({ loading: true });

    try {
      const data = await callCloud('points', {
        action: 'history',
        page,
        pageSize: 20
      });
      const logs = reset ? data.items : [...this.data.logs, ...data.items];
      this.setData({
        logs,
        page: page + 1,
        total: data.total,
        hasMore: logs.length < data.total,
        loading: false
      });
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  onReachBottom() {
    if (this.data.hasMore) this.loadHistory();
  },

  onTapLog(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/submission-detail/detail?id=${id}` });
  }
});
