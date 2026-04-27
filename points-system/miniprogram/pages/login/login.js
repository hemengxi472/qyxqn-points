const { checkLogin, register } = require('../../utils/auth');

Page({
  data: {
    statusBarHeight: 44,
    step: 'loading',
    form: {
      name: '',
      employeeId: '',
      department: ''
    },
    submitting: false
  },

  onLoad() {
    const sys = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: sys.statusBarHeight });
  },

  async onShow() {
    const result = await checkLogin();
    if (result.needRegister === false) {
      this.goHome();
    } else if (result.needRegister === true) {
      this.setData({ step: 'register' });
    } else {
      wx.showToast({ title: '连接失败，请重试', icon: 'none' });
    }
  },

  goHome() {
    wx.switchTab({ url: '/pages/dashboard/dashboard' });
  },

  onInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  async onRegister() {
    const { name, employeeId, department } = this.data.form;
    if (!name.trim()) return wx.showToast({ title: '请输入姓名', icon: 'none' });
    if (!employeeId.trim()) return wx.showToast({ title: '请输入工号', icon: 'none' });
    if (!department.trim()) return wx.showToast({ title: '请输入部门', icon: 'none' });

    this.setData({ submitting: true });
    try {
      await register({ name: name.trim(), employeeId: employeeId.trim(), department: department.trim() });
      wx.showToast({ title: '注册成功', icon: 'success' });
      setTimeout(() => this.goHome(), 1200);
    } catch (err) {
      this.setData({ submitting: false });
    }
  }
});
