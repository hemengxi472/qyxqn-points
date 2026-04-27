const { callCloud } = require('../../../utils/cloud');

Page({
  data: {
    stats: null,
    loading: true
  },

  onShow() {
    this.loadStats();
  },

  async loadStats() {
    this.setData({ loading: true });
    try {
      const data = await callCloud('admin', { action: 'statistics' });
      this.setData({ stats: data, loading: false });
    } catch (err) {
      this.setData({ loading: false });
    }
  }
});
