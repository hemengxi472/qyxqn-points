const { callCloud } = require('../../../utils/cloud');

Page({
  data: {
    submission: null,
    loading: true,
    reviewing: false
  },

  onLoad(options) {
    this.loadDetail(options.id);
  },

  async loadDetail(id) {
    try {
      const data = await callCloud('admin', { action: 'reviewDetail', submissionId: id });
      this.setData({ submission: data.submission, loading: false });
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  onPreview(e) {
    const { index } = e.currentTarget.dataset;
    wx.previewImage({
      urls: this.data.submission.photoUrls,
      current: this.data.submission.photoUrls[index]
    });
  },

  async onApprove(e) {
    const { comment } = e.detail;
    this.setData({ reviewing: true });
    try {
      await callCloud('admin', {
        action: 'reviewAction',
        submissionId: this.data.submission._id,
        action: 'approve',
        points: this.data.submission.pointsAwarded || e.detail.points,
        comment
      });
      wx.showToast({ title: '审核通过', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 1000);
    } catch (err) {
      this.setData({ reviewing: false });
    }
  },

  async onReject(e) {
    const { comment } = e.detail;
    this.setData({ reviewing: true });
    try {
      await callCloud('admin', {
        action: 'reviewAction',
        submissionId: this.data.submission._id,
        action: 'reject',
        points: 0,
        comment
      });
      wx.showToast({ title: '已拒绝', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1000);
    } catch (err) {
      this.setData({ reviewing: false });
    }
  }
});
