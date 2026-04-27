const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { action } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    switch (action) {
      case 'dashboard':
        return await getDashboard(openid);
      case 'history':
        return await getHistory(openid, event);
      default:
        return { code: 400, message: '未知操作' };
    }
  } catch (e) {
    console.error('points error:', e);
    return { code: 500, message: e.message || '服务器错误' };
  }
};

async function getDashboard(openid) {
  const summary = await db.collection('points_summary').where({ _openid: openid }).get();

  if (summary.data.length === 0) {
    return {
      code: 0,
      data: {
        totalPoints: 0,
        moduleBreakdown: [],
        recentLogs: []
      }
    };
  }

  const s = summary.data[0];

  const modules = await db.collection('modules')
    .where({ isActive: true })
    .field({ name: true, icon: true })
    .get();

  const modulePoints = s.modulePoints || {};
  const moduleBreakdown = modules.data.map(m => ({
    moduleId: m._id,
    moduleName: m.name,
    icon: m.icon,
    points: modulePoints[m._id] || 0
  }));

  const recentLogs = await db.collection('points_log')
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(5)
    .get();

  return {
    code: 0,
    data: {
      totalPoints: s.totalPoints || 0,
      moduleBreakdown,
      recentLogs: recentLogs.data.map(l => ({
        _id: l._id,
        moduleName: l.moduleName,
        subcategoryName: l.subcategoryName,
        points: l.points,
        type: l.type,
        description: l.description,
        createdAt: l.createdAt
      }))
    }
  };
}

async function getHistory(openid, event) {
  const pageSize = event.pageSize || 20;
  const page = event.page || 1;

  let query = db.collection('points_log').where({ _openid: openid });

  const total = await query.count();
  const list = await query
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  return {
    code: 0,
    data: {
      items: list.data.map(l => ({
        _id: l._id,
        moduleName: l.moduleName,
        subcategoryName: l.subcategoryName,
        points: l.points,
        type: l.type,
        description: l.description,
        createdAt: l.createdAt
      })),
      total: total.total,
      page,
      pageSize
    }
  };
}
