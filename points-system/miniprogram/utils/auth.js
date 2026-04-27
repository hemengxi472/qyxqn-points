const { callCloud } = require('./cloud');
const app = getApp();

async function checkLogin() {
  try {
    const result = await callCloud('auth', { action: 'login' });
    if (result.needRegister) {
      app.globalData.isRegistered = false;
      return { needRegister: true };
    }
    const user = result.user;
    app.globalData.userInfo = user;
    app.globalData.isRegistered = true;
    app.globalData.isAdmin = user.role === 'admin' || user.role === 'superadmin';
    return { needRegister: false, user };
  } catch (err) {
    return { error: err.message };
  }
}

async function register(info) {
  const result = await callCloud('auth', { action: 'register', ...info });
  app.globalData.userInfo = result.user;
  app.globalData.isRegistered = true;
  app.globalData.isAdmin = false;
  return result;
}

function isAdmin() {
  return app.globalData.isAdmin;
}

function isSuperAdmin() {
  return app.globalData.userInfo && app.globalData.userInfo.role === 'superadmin';
}

function getUserInfo() {
  return app.globalData.userInfo;
}

module.exports = { checkLogin, register, isAdmin, isSuperAdmin, getUserInfo };
