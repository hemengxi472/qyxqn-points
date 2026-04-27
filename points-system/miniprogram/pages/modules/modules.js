const { callCloud } = require('../../utils/cloud');

Page({
  data: {
    modules: [],
    loading: true
  },

  onShow() {
    this.loadModules();
  },

  async loadModules() {
    this.setData({ loading: true });
    try {
      const data = await callCloud('modules', { action: 'list' });
      this.setData({ modules: data.modules, loading: false });
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  onSelectModule(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/subcategories/subcategories?moduleId=${id}&moduleName=${name}`
    });
  }
});
