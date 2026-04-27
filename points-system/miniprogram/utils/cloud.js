const app = getApp();

function callCloud(fnName, data = {}) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: fnName,
      data: data
    }).then(res => {
      if (res.result && res.result.code === 0) {
        resolve(res.result.data);
      } else {
        const msg = (res.result && res.result.message) || '服务器错误';
        wx.showToast({ title: msg, icon: 'none' });
        reject(new Error(msg));
      }
    }).catch(err => {
      console.error(`云函数 [${fnName}] 调用失败:`, err);
      wx.showToast({ title: '网络异常，请重试', icon: 'none' });
      reject(err);
    });
  });
}

function showLoading(title = '加载中...') {
  wx.showLoading({ title, mask: true });
}

function hideLoading() {
  wx.hideLoading();
}

module.exports = { callCloud, showLoading, hideLoading };
