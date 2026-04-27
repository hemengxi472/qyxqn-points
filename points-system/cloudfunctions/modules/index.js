const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { action } = event;

  try {
    switch (action) {
      case 'list':
        return await listModules();
      default:
        return { code: 400, message: '未知操作' };
    }
  } catch (e) {
    console.error('modules error:', e);
    return { code: 500, message: e.message || '服务器错误' };
  }
};

async function listModules() {
  const res = await db.collection('modules')
    .where({ isActive: true })
    .orderBy('sortOrder', 'asc')
    .get();

  const modules = res.data.map(mod => ({
    _id: mod._id,
    name: mod.name,
    description: mod.description,
    icon: mod.icon,
    sortOrder: mod.sortOrder,
    subcategories: (mod.subcategories || [])
      .filter(s => s.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(s => ({
        name: s.name,
        description: s.description,
        points: s.points,
        maxTimes: s.maxTimes,
        requiresPhoto: s.requiresPhoto
      }))
  }));

  return { code: 0, data: { modules } };
}
