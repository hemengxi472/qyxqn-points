function chooseImages(count = 9, sourceType = ['album', 'camera']) {
  return new Promise((resolve, reject) => {
    wx.chooseImage({
      count,
      sizeType: ['compressed'],
      sourceType,
      success(res) {
        resolve(res.tempFilePaths);
      },
      fail(err) {
        if (err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '选择图片失败', icon: 'none' });
        }
        reject(err);
      }
    });
  });
}

function compressImage(src) {
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src,
      quality: 80,
      success(res) {
        resolve(res.tempFilePath);
      },
      fail(err) {
        console.warn('图片压缩失败，使用原图:', err);
        resolve(src);
      }
    });
  });
}

async function uploadImages(paths) {
  const uploadedIds = [];
  for (const path of paths) {
    const compressed = await compressImage(path);
    const res = await wx.cloud.uploadFile({
      cloudPath: `submissions/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`,
      filePath: compressed
    });
    uploadedIds.push(res.fileID);
  }
  return uploadedIds;
}

function previewImages(urls, currentIndex = 0) {
  wx.previewImage({
    urls,
    current: urls[currentIndex]
  });
}

module.exports = { chooseImages, compressImage, uploadImages, previewImages };
