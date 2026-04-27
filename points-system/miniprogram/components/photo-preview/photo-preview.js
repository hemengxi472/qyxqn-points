Component({
  properties: {
    urls: { type: Array, value: [] },
    visible: { type: Boolean, value: false }
  },
  methods: {
    onClose() {
      this.triggerEvent('close');
    },
    onPreview(e) {
      const { index } = e.currentTarget.dataset;
      wx.previewImage({ urls: this.properties.urls, current: this.properties.urls[index] });
    }
  }
});
