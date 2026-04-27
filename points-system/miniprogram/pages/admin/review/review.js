const { callCloud } = require('../../../utils/cloud');

Page({
  data: {
    tabs: [
      { key: 'pending', label: '待审核' },
      { key: 'approved', label: '已通过' },
      { key: 'rejected', label: '已拒绝' }
    ],
    currentTab: 'pending',
    items: [],
    page: 1,
    total: 0,
    loading: false,
    hasMore: true
  },

  onShow() {
    this.setData({ items: [], page: 1, hasMore: true });
    this.loadList(true);
  },

  onTabChange(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab, items: [], page: 1, hasMore: true });
    this.loadList(true);
  },

  async loadList(reset = false) {
    if (this.data.loading) return;
    const page = reset ? 1 : this.data.page;
    this.setData({ loading: true });

    try {
      const data = await callCloud('admin', {
        action: 'reviewList',
        status: this.data.currentTab,
        page,
        pageSize: 20
      });
      const items = reset ? data.items : [...this.data.items, ...data.items];
      this.setData({
        items,
        page: page + 1,
        total: data.total,
        hasMore: items.length < data.total,
        loading: false
      });
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  onReachBottom() {
    if (this.data.hasMore) this.loadList();
  },

  onTapItem(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/admin/review-detail/detail?id=${id}` });
  }
});
