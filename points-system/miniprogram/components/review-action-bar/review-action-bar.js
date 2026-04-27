Component({
  properties: {
    visible: { type: Boolean, value: false },
    defaultPoints: { type: Number, value: 2 },
    submitting: { type: Boolean, value: false }
  },
  data: {
    points: 2,
    comment: '',
    showReject: false
  },
  methods: {
    showRejectForm() {
      this.setData({ showReject: true });
    },
    cancelReject() {
      this.setData({ showReject: false });
    },
    onPointsChange(e) {
      this.setData({ points: Number(e.detail.value) || 0 });
    },
    onCommentChange(e) {
      this.setData({ comment: e.detail.value });
    },
    onApprove() {
      this.triggerEvent('approve', { points: this.properties.defaultPoints, comment: this.data.comment });
    },
    onReject() {
      if (!this.data.comment.trim()) {
        wx.showToast({ title: '请填写拒绝原因', icon: 'none' });
        return;
      }
      this.triggerEvent('reject', { points: 0, comment: this.data.comment });
      this.setData({ showReject: false });
    }
  }
});
