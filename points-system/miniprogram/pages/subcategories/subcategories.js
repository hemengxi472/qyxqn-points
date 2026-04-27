const { callCloud } = require('../../utils/cloud');

Page({
  data: {
    moduleId: '',
    moduleName: '',
    subcategories: [],
    loading: true
  },

  onLoad(options) {
    this.setData({
      moduleId: options.moduleId,
      moduleName: options.moduleName
    });
    wx.setNavigationBarTitle({ title: options.moduleName || '积分子项' });
    this.loadSubcategories();
  },

  async loadSubcategories() {
    const data = await callCloud('modules', { action: 'list' });
    const mod = data.modules.find(m => m._id === this.data.moduleId);
    if (mod) {
      this.setData({ subcategories: mod.subcategories, loading: false });
    } else {
      this.setData({ loading: false });
    }
  },

  onSelectSub(e) {
    const { name, points } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/submit/submit?moduleId=${this.data.moduleId}&moduleName=${this.data.moduleName}&subcategoryName=${name}&defaultPoints=${points}`
    });
  }
});
