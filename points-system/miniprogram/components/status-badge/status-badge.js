Component({
  properties: {
    status: { type: String, value: 'pending' }
  },
  data: {
    label: '',
    color: '',
    bg: ''
  },
  lifetimes: {
    attached() {
      const STATUS_MAP = {
        pending:   { label: '待审核', color: '#f9ab00', bg: '#fef7e0' },
        approved:  { label: '已通过', color: '#0f9d58', bg: '#e6f4ea' },
        rejected:  { label: '已拒绝', color: '#ea4335', bg: '#fce8e6' },
        cancelled: { label: '已取消', color: '#9aa0a6', bg: '#f1f3f4' }
      };
      const cfg = STATUS_MAP[this.properties.status] || STATUS_MAP.pending;
      this.setData(cfg);
    }
  }
});
