const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { action } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    const admin = await checkAdmin(openid);
    if (!admin) return { code: 403, message: '无管理员权限' };

    switch (action) {
      case 'reviewList':
        return await reviewList(event, admin);
      case 'reviewDetail':
        return await reviewDetail(event);
      case 'reviewAction':
        return await reviewAction(openid, event, admin);
      case 'employeeList':
        return await employeeList(event);
      case 'statistics':
        return await statistics();
      case 'promoteAdmin':
        return await promoteAdmin(event, admin);
      case 'disableEmployee':
        return await disableEmployee(event, admin);
      default:
        return { code: 400, message: '未知操作' };
    }
  } catch (e) {
    console.error('admin error:', e);
    return { code: 500, message: e.message || '服务器错误' };
  }
};

async function checkAdmin(openid) {
  const res = await db.collection('employees')
    .where({ _openid: openid, role: db.command.in(['admin', 'superadmin']), status: 'active' })
    .get();
  return res.data.length > 0 ? res.data[0] : null;
}

async function reviewList(event) {
  const pageSize = event.pageSize || 20;
  const page = event.page || 1;
  const status = event.status || 'pending';
  const department = event.department;

  let conditions = { status };
  if (department) conditions.department = department;

  const total = await db.collection('submissions').where(conditions).count();
  const list = await db.collection('submissions')
    .where(conditions)
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  return {
    code: 0,
    data: {
      items: list.data.map(formatReviewItem),
      total: total.total,
      page,
      pageSize
    }
  };
}

async function reviewDetail(event) {
  const { submissionId } = event;
  if (!submissionId) return { code: 400, message: '缺少申请ID' };

  const res = await db.collection('submissions').doc(submissionId).get();
  if (!res.data) return { code: 404, message: '申请记录不存在' };

  return { code: 0, data: { submission: formatReviewItem(res.data) } };
}

async function reviewAction(openid, event, admin) {
  const { submissionId, action, points, comment } = event;

  if (!submissionId || !action) return { code: 400, message: '缺少必要参数' };
  if (action !== 'approve' && action !== 'reject') return { code: 400, message: '无效操作' };
  if (action === 'approve' && (!points || points < 0)) return { code: 400, message: '请填写有效积分' };

  const sub = await db.collection('submissions').doc(submissionId).get();
  if (!sub.data) return { code: 404, message: '申请记录不存在' };
  if (sub.data.status !== 'pending') return { code: 400, message: '该申请已审核，不可重复操作' };

  const transaction = await db.startTransaction();
  try {
    const t = transaction.collection;
    const now = new Date();

    if (action === 'approve') {
      await t('submissions').doc(submissionId).update({
        data: {
          status: 'approved',
          pointsAwarded: points,
          reviewerId: admin._id,
          reviewerName: admin.name,
          reviewComment: comment || '',
          reviewedAt: now
        }
      });

      await t('points_log').add({
        data: {
          _openid: sub.data._openid,
          employeeId: sub.data.employeeId,
          submissionId: submissionId,
          moduleId: sub.data.moduleId,
          moduleName: sub.data.moduleName,
          subcategoryName: sub.data.subcategoryName,
          points: points,
          type: 'award',
          description: `${sub.data.subcategoryName} - ${sub.data.description || '审核通过'}`,
          createdAt: now
        }
      });

      const summaryRes = await t('points_summary')
        .where({ _openid: sub.data._openid }).get();

      const moduleKey = `modulePoints.${sub.data.moduleId}`;
      const _ = db.command;

      if (summaryRes.data.length === 0) {
        await t('points_summary').add({
          data: {
            _openid: sub.data._openid,
            employeeId: sub.data.employeeId,
            totalPoints: points,
            modulePoints: { [sub.data.moduleId]: points },
            updatedAt: now
          }
        });
      } else {
        await t('points_summary').where({ _openid: sub.data._openid }).update({
          data: {
            totalPoints: _.inc(points),
            [moduleKey]: _.inc(points),
            updatedAt: now
          }
        });
      }
    } else {
      await t('submissions').doc(submissionId).update({
        data: {
          status: 'rejected',
          reviewerId: admin._id,
          reviewerName: admin.name,
          reviewComment: comment || '',
          reviewedAt: now
        }
      });
    }

    await transaction.commit();
    return { code: 0, data: { success: true, action } };
  } catch (e) {
    await transaction.rollback();
    throw e;
  }
}

async function employeeList(event) {
  const pageSize = event.pageSize || 50;
  const page = event.page || 1;
  const department = event.department;

  let conditions = {};
  if (department) conditions.department = department;

  const total = await db.collection('employees').where(conditions).count();
  const list = await db.collection('employees')
    .where(conditions)
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  const employeeIds = list.data.map(e => e.employeeId);
  let summaries = {};
  if (employeeIds.length > 0) {
    const summaryRes = await db.collection('points_summary')
      .where({ employeeId: db.command.in(employeeIds) })
      .get();
    summaryRes.data.forEach(s => {
      summaries[s.employeeId] = s.totalPoints || 0;
    });
  }

  return {
    code: 0,
    data: {
      items: list.data.map(e => ({
        _id: e._id,
        employeeId: e.employeeId,
        name: e.name,
        department: e.department,
        role: e.role,
        status: e.status,
        totalPoints: summaries[e.employeeId] || 0,
        createdAt: e.createdAt
      })),
      total: total.total,
      page,
      pageSize
    }
  };
}

async function statistics() {
  const [empCount, subTotal, pendingCount] = await Promise.all([
    db.collection('employees').where({ status: 'active' }).count(),
    db.collection('submissions').count(),
    db.collection('submissions').where({ status: 'pending' }).count()
  ]);

  const mods = await db.collection('modules').where({ isActive: true }).field({ name: true }).get();
  const allSummaries = await db.collection('points_summary').get();

  const pointsByModule = {};
  mods.data.forEach(m => { pointsByModule[m.name] = 0; });
  allSummaries.data.forEach(s => {
    const mp = s.modulePoints || {};
    mods.data.forEach(m => {
      pointsByModule[m.name] = (pointsByModule[m.name] || 0) + (mp[m._id] || 0);
    });
  });

  const topEmployees = allSummaries.data
    .sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0))
    .slice(0, 10)
    .map(async (s) => {
      const emp = await db.collection('employees')
        .where({ employeeId: s.employeeId }).field({ name: true, department: true }).get();
      return {
        employeeId: s.employeeId,
        name: emp.data[0] ? emp.data[0].name : '未知',
        department: emp.data[0] ? emp.data[0].department : '未知',
        totalPoints: s.totalPoints
      };
    });

  const resolvedTopEmployees = await Promise.all(topEmployees);

  return {
    code: 0,
    data: {
      totalEmployees: empCount.total,
      totalSubmissions: subTotal.total,
      pendingReview: pendingCount.total,
      pointsByModule: Object.entries(pointsByModule).map(([name, total]) => ({ moduleName: name, total })),
      topEmployees: resolvedTopEmployees
    }
  };
}

async function promoteAdmin(event, admin) {
  if (admin.role !== 'superadmin') return { code: 403, message: '仅超级管理员可提拔管理员' };

  const { employeeId } = event;
  if (!employeeId) return { code: 400, message: '缺少员工ID' };

  await db.collection('employees').doc(employeeId).update({
    data: { role: 'admin', updatedAt: new Date() }
  });

  return { code: 0, data: { success: true } };
}

async function disableEmployee(event, admin) {
  if (admin.role !== 'superadmin') return { code: 403, message: '仅超级管理员可禁用员工' };

  const { employeeId, status } = event;
  await db.collection('employees').doc(employeeId).update({
    data: { status: status || 'disabled', updatedAt: new Date() }
  });

  return { code: 0, data: { success: true } };
}

function formatReviewItem(s) {
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
