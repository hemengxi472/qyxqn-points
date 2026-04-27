Component({
  properties: {
    title: { type: String, value: '青年能力积分' },
    showBack: { type: Boolean, value: false },
    bgColor: { type: String, value: '#1a73e8' }
  },
  methods: {
    onBack() {
      wx.navigateBack();
    }
  }
});
