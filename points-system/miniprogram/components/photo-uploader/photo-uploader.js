const { chooseImages, uploadImages } = require('../../utils/image');

Component({
  properties: {
    maxCount: { type: Number, value: 9 },
    photos: { type: Array, value: [] }
  },
  data: {
    uploading: false
  },
  methods: {
    async onAddPhoto() {
      try {
        const paths = await chooseImages(this.properties.maxCount - this.properties.photos.length);
        this.setData({ uploading: true });
        const fileIDs = await uploadImages(paths);
        const newPhotos = [...this.properties.photos, ...fileIDs];
        this.setData({ photos: newPhotos, uploading: false });
        this.triggerEvent('change', { photos: newPhotos });
      } catch (err) {
        this.setData({ uploading: false });
        console.error('上传图片失败:', err);
      }
    },
    onPreview(e) {
      const { index } = e.currentTarget.dataset;
      const urls = this.properties.photos;
      wx.previewImage({ urls, current: urls[index] });
    },
    onDelete(e) {
      const { index } = e.currentTarget.dataset;
      const photos = [...this.properties.photos];
      photos.splice(index, 1);
      this.setData({ photos });
      this.triggerEvent('change', { photos });
    }
  }
});
