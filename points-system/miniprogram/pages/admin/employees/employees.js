const { callCloud } = require('../../../utils/cloud');
const { isSuperAdmin } = require('../../../utils/auth');

Page({
  data: {
    employees: [],
    page: 1,
    total: 0,
    loading: false,
    hasMore: true,
    isSuperAdmin: false
  },

  onShow() {
    this.setData({ isSuperAdmin: isSuperAdmin(), employees: [], page: 1, hasMore: true });
    this.loadList(true);
  },

  async loadList(reset = false) {
    if (this.data.loading) return;
    const page = reset ? 1 : this.data.page;
    this.setData({ loading: true });

    try {
      const data = await callCloud('admin', { action: 'employeeList', page, pageSize: 50 });
      const employees = reset ? data.items : [...this.data.employees, ...data.items];
      this.setData({
        employees,
        page: page + 1,
        total: data.total,
        hasMore: employees.length < data.total,
        loading: false
      });
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  onReachBottom() {
    if (this.data.hasMore) this.loadList();
  },

  async onPromote(e) {
    const { id, name } = e.currentTarget.dataset;
    const res = await new Promise(r => wx.showModal({
      title: '提拔管理员',
      content: `确定将 ${name} 提升为管理员吗？`,
      success: r
    }));
    if (!res.confirm) return;

    try {
      await callCloud('admin', { action: 'promoteAdmin', employeeId: id });
      wx.showToast({ title: '已提升为管理员', icon: 'success' });
      this.loadList(true);
    } catch (err) { /* error handled by cloud.js */ }
  },

  async onDisable(e) {
    const { id, name, status } = e.currentTarget.dataset;
    const newStatus = status === 'active' ? 'disabled' : 'active';
    const action = newStatus === 'disabled' ? '禁用' : '启用';

    const res = await new Promise(r => wx.showModal({
      title: `${action}员工`,
      content: `确定${action} ${name} 的账号吗？`,
      success: r
    }));
    if (!res.confirm) return;

    try {
      await callCloud('admin', { action: 'disableEmployee', employeeId: id, status: newStatus });
      wx.showToast({ title: `已${action}`, icon: 'success' });
      this.loadList(true);
    } catch (err) { /* error handled by cloud.js */ }
  }
});
