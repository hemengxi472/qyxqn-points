const app = getApp();

const EMPLOYEE_TABS = [
  { pagePath: '/pages/dashboard/dashboard', text: '首页', icon: '🏠' },
  { pagePath: '/pages/modules/modules', text: '申请', icon: '➕' },
  { pagePath: '/pages/history/history', text: '记录', icon: '📋' },
  { pagePath: '/pages/profile/profile', text: '我的', icon: '👤' }
];

const ADMIN_TABS = [
  { pagePath: '/pages/admin/review/review', text: '审核', icon: '✅' },
  { pagePath: '/pages/admin/stats/stats', text: '统计', icon: '📊' },
  { pagePath: '/pages/admin/employees/employees', text: '管理', icon: '⚙️' },
  { pagePath: '/pages/profile/profile', text: '我的', icon: '👤' }
];

Component({
  data: {
    tabs: EMPLOYEE_TABS,
    activeIndex: 0
  },

  lifetimes: {
    attached() {
      this.updateTabs();
    }
  },

  pageLifetimes: {
    show() {
      this.updateTabs();
      this.updateActive();
    }
  },

  methods: {
    updateTabs() {
      const isAdmin = app.globalData.isAdmin;
      this.setData({ tabs: isAdmin ? ADMIN_TABS : EMPLOYEE_TABS });
    },

    updateActive() {
      const pages = getCurrentPages();
      if (pages.length === 0) return;
      const currentPath = '/' + pages[pages.length - 1].route;
      const tabs = this.data.tabs;
      const index = tabs.findIndex(t => t.pagePath === currentPath);
      if (index >= 0) this.setData({ activeIndex: index });
    },

    onTabTap(e) {
      const { index, path } = e.currentTarget.dataset;
      if (index === this.data.activeIndex) return;
      wx.switchTab({ url: path });
    }
  }
});
