const { callCloud } = require('../../utils/cloud');

Page({
  data: {
    moduleId: '',
    moduleName: '',
    subcategoryName: '',
    defaultPoints: 0,
    description: '',
    photos: [],
    submitting: false
  },

  onLoad(options) {
    this.setData({
      moduleId: options.moduleId,
      moduleName: options.moduleName,
      subcategoryName: options.subcategoryName,
      defaultPoints: Number(options.defaultPoints) || 0
    });
    wx.setNavigationBarTitle({ title: '提交申请' });
  },

  onDescInput(e) {
    this.setData({ description: e.detail.value });
  },

  onPhotoChange(e) {
    this.setData({ photos: e.detail.photos });
  },

  async onSubmit() {
    const { moduleId, subcategoryName, description, photos } = this.data;

    if (!description.trim()) {
      return wx.showToast({ title: '请填写描述说明', icon: 'none' });
    }
    if (photos.length === 0) {
      return wx.showToast({ title: '请上传证明材料照片', icon: 'none' });
    }

    this.setData({ submitting: true });
    try {
      await callCloud('submissions', {
        action: 'create',
        moduleId,
        subcategoryName,
        description: description.trim(),
        photoUrls: photos
      });
      wx.showToast({ title: '提交成功，等待审核', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 1500);
    } catch (err) {
      this.setData({ submitting: false });
    }
  }
});
