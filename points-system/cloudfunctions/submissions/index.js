const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { action } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    switch (action) {
      case 'create':
        return await createSubmission(openid, event);
      case 'myList':
        return await mySubmissions(openid, event);
      case 'detail':
        return await getDetail(openid, event);
      default:
        return { code: 400, message: '未知操作' };
    }
  } catch (e) {
    console.error('submissions error:', e);
    return { code: 500, message: e.message || '服务器错误' };
  }
};

async function createSubmission(openid, data) {
  const { moduleId, subcategoryName, description, photoUrls } = data;

  if (!moduleId || !subcategoryName) {
    return { code: 400, message: '请选择积分模块和子项' };
  }

  const employee = await db.collection('employees').where({ _openid: openid }).get();
  if (employee.data.length === 0) {
    return { code: 401, message: '请先注册' };
  }
  const emp = employee.data[0];
  if (emp.status !== 'active') {
    return { code: 403, message: '账号已被禁用' };
  }

  const module = await db.collection('modules').doc(moduleId).get();
  if (!module.data || !module.data.isActive) {
    return { code: 404, message: '模块不存在或已禁用' };
  }

  const sub = (module.data.subcategories || []).find(s => s.name === subcategoryName);
  if (!sub || !sub.isActive) {
    return { code: 404, message: '积分子项不存在或已禁用' };
  }

  if (sub.requiresPhoto && (!photoUrls || photoUrls.length === 0)) {
    return { code: 400, message: '请上传证明材料照片' };
  }

  if (sub.maxTimes > 0) {
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const count = await db.collection('submissions')
      .where({
        _openid: openid,
        moduleId: moduleId,
        subcategoryName: subcategoryName,
        status: db.command.in(['pending', 'approved']),
        createdAt: db.command.gte(yearStart)
      }).count();
    if (count.total >= sub.maxTimes) {
      return { code: 400, message: `该子项本年度最多申请${sub.maxTimes}次` };
    }
  }

  const now = new Date();
  const submission = {
    _openid: openid,
    employeeId: emp.employeeId,
    employeeName: emp.name,
    department: emp.department,
    moduleId: moduleId,
    moduleName: module.data.name,
    subcategoryName: subcategoryName,
    description: description || '',
    photoUrls: photoUrls || [],
    status: 'pending',
    pointsAwarded: null,
    reviewerId: null,
    reviewerName: null,
    reviewComment: null,
    reviewedAt: null,
    createdAt: now
  };

  const res = await db.collection('submissions').add({ data: submission });
  return { code: 0, data: { submission: { _id: res._id, status: 'pending', createdAt: now } } };
}

async function mySubmissions(openid, event) {
  const pageSize = event.pageSize || 20;
  const page = event.page || 1;
  const status = event.status;

  let query = db.collection('submissions').where({ _openid: openid });
  if (status) {
    query = query.where({ _openid: openid, status });
  }

  const total = await query.count();
  const list = await query
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  return {
    code: 0,
    data: {
      items: list.data.map(formatSubmission),
      total: total.total,
      page,
      pageSize
    }
  };
}

async function getDetail(openid, event) {
  const { submissionId } = event;
  if (!submissionId) {
    return { code: 400, message: '缺少申请ID' };
  }

  const res = await db.collection('submissions').doc(submissionId).get();
  if (!res.data) {
    return { code: 404, message: '申请记录不存在' };
  }
  if (res.data._openid !== openid) {
    return { code: 403, message: '无权查看该申请' };
  }

  return { code: 0, data: { submission: formatSubmission(res.data) } };
}

function formatSubmission(s) {
  return {
    _id: s._id,
    employeeId: s.employeeId,
    employeeName: s.employeeName,
    department: s.department,
    moduleId: s.moduleId,
    moduleName: s.moduleName,
    subcategoryName: s.subcategoryName,
    description: s.description,
    photoUrls: s.photoUrls,
    status: s.status,
    pointsAwarded: s.pointsAwarded,
    reviewerId: s.reviewerId,
    reviewerName: s.reviewerName,
    reviewComment: s.reviewComment,
    reviewedAt: s.reviewedAt,
    createdAt: s.createdAt
  };
}
