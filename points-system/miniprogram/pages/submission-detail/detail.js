const { callCloud } = require('../../utils/cloud');

Page({
  data: {
    submission: null,
    loading: true
  },

  onLoad(options) {
    this.loadDetail(options.id);
  },

  async loadDetail(id) {
    try {
      const data = await callCloud('submissions', { action: 'detail', submissionId: id });
      this.setData({ submission: data.submission, loading: false });
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  onPreview(e) {
    const { index } = e.currentTarget.dataset;
    const urls = this.data.submission.photoUrls;
    wx.previewImage({ urls, current: urls[index] });
  }
});
