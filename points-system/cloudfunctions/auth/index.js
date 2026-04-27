const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { action } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    switch (action) {
      case 'login':
        return await handleLogin(openid);
      case 'register':
        return await handleRegister(openid, event);
      default:
        return { code: 400, message: '未知操作' };
    }
  } catch (e) {
    console.error('auth error:', e);
    return { code: 500, message: e.message || '服务器错误' };
  }
};

async function handleLogin(openid) {
  const res = await db.collection('employees').where({ _openid: openid }).get();
  if (res.data.length === 0) {
    return { code: 0, data: { needRegister: true } };
  }
  const user = res.data[0];
  if (user.status === 'disabled') {
    return { code: 403, message: '账号已被禁用，请联系管理员' };
  }
  return { code: 0, data: { needRegister: false, user: formatUser(user) } };
}

async function handleRegister(openid, data) {
  const { name, employeeId, department } = data;
  if (!name || !employeeId || !department) {
    return { code: 400, message: '请填写完整信息' };
  }

  const existing = await db.collection('employees').where({ _openid: openid }).get();
  if (existing.data.length > 0) {
    return { code: 400, message: '该微信账号已注册' };
  }

  const dupEmployeeId = await db.collection('employees').where({ employeeId }).get();
  if (dupEmployeeId.data.length > 0) {
    return { code: 400, message: '该工号已被注册' };
  }

  const now = new Date();
  const employee = {
    _openid: openid,
    employeeId,
    name,
    department,
    avatarUrl: '',
    role: 'employee',
    status: 'active',
    createdAt: now,
    updatedAt: now
  };

  const res = await db.collection('employees').add({ data: employee });
  return { code: 0, data: { user: formatUser({ ...employee, _id: res._id }) } };
}

function formatUser(user) {
  return {
    _id: user._id,
    employeeId: user.employeeId,
    name: user.name,
    department: user.department,
    avatarUrl: user.avatarUrl,
    role: user.role,
    status: user.status
  };
}
