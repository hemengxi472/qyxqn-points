const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const MODULES = [
  {
    name: '能力',
    description: '专业能力提升相关积分，包括技术认证、项目获奖、论文发表、专利发明、技能竞赛等',
    icon: '📚',
    sortOrder: 1,
    isActive: true,
    subcategories: [
      { name: '技术认证', description: '获得行业认可的技术资格证书', points: 5, maxTimes: 0, requiresPhoto: true, sortOrder: 1, isActive: true },
      { name: '项目获奖', description: '参与项目获得公司/行业奖项', points: 10, maxTimes: 0, requiresPhoto: true, sortOrder: 2, isActive: true },
      { name: '论文发表', description: '在期刊或会议上发表学术论文', points: 8, maxTimes: 0, requiresPhoto: true, sortOrder: 3, isActive: true },
      { name: '专利发明', description: '获得国家认可的专利发明', points: 15, maxTimes: 0, requiresPhoto: true, sortOrder: 4, isActive: true },
      { name: '技能竞赛', description: '参加公司或行业技能竞赛获奖', points: 5, maxTimes: 0, requiresPhoto: true, sortOrder: 5, isActive: true }
    ]
  },
  {
    name: '担当',
    description: '责任担当相关积分，包括攻坚克难、导师带徒、临时任务、跨部门协作等',
    icon: '🛡️',
    sortOrder: 2,
    isActive: true,
    subcategories: [
      { name: '攻坚克难', description: '完成公司急难险重任务', points: 10, maxTimes: 0, requiresPhoto: true, sortOrder: 1, isActive: true },
      { name: '导师带徒', description: '担任新员工导师并完成带教任务', points: 8, maxTimes: 0, requiresPhoto: true, sortOrder: 2, isActive: true },
      { name: '临时任务', description: '承担额外安排的临时重要任务', points: 5, maxTimes: 0, requiresPhoto: true, sortOrder: 3, isActive: true },
      { name: '跨部门协作', description: '积极参与跨部门协作项目并取得成果', points: 5, maxTimes: 0, requiresPhoto: true, sortOrder: 4, isActive: true }
    ]
  },
  {
    name: '道德',
    description: '道德品质相关积分，包括无偿献血、志愿服务、见义勇为、爱心捐助等',
    icon: '❤️',
    sortOrder: 3,
    isActive: true,
    subcategories: [
      { name: '献血', description: '参加无偿献血活动，上传献血证照片', points: 2, maxTimes: 4, requiresPhoto: true, sortOrder: 1, isActive: true },
      { name: '志愿者服务', description: '参与社区或公司组织的志愿服务活动', points: 3, maxTimes: 0, requiresPhoto: true, sortOrder: 2, isActive: true },
      { name: '见义勇为', description: '保护国家/集体/他人生命财产安全的行为', points: 10, maxTimes: 0, requiresPhoto: true, sortOrder: 3, isActive: true },
      { name: '爱心捐助', description: '参与扶贫/助学/救灾等爱心捐助活动', points: 3, maxTimes: 0, requiresPhoto: true, sortOrder: 4, isActive: true }
    ]
  }
];

exports.main = async (event, context) => {
  const { action } = event;

  try {
    switch (action) {
      case 'initModules':
        return await initModules();
      case 'initSuperAdmin':
        return await initSuperAdmin(event);
      case 'initAll':
        return await initAll(event);
      default:
        return { code: 400, message: '请指定操作: initModules / initSuperAdmin / initAll' };
    }
  } catch (e) {
    console.error('init error:', e);
    return { code: 500, message: e.message || '初始化失败' };
  }
};

async function initModules() {
  const existing = await db.collection('modules').count();
  if (existing.total > 0) {
    return { code: 400, message: `模块数据已存在（${existing.total}条），请先清空` };
  }

  for (const mod of MODULES) {
    await db.collection('modules').add({ data: mod });
  }

  return { code: 0, data: { message: `成功创建${MODULES.length}个模块` } };
}

async function initSuperAdmin(event) {
  const { name, employeeId, department } = event;
  if (!name || !employeeId) {
    return { code: 400, message: '请提供超级管理员的姓名和工号 (name, employeeId)' };
  }

  const existing = await db.collection('employees').where({ employeeId }).get();
  if (existing.data.length > 0) {
    const emp = existing.data[0];
    if (emp.role === 'superadmin') {
      return { code: 400, message: '该工号已是超级管理员' };
    }
    await db.collection('employees').doc(emp._id).update({
      data: { role: 'superadmin', updatedAt: new Date() }
    });
    return { code: 0, data: { message: `已将 ${emp.name}(${employeeId}) 提升为超级管理员` } };
  }

  const now = new Date();
  await db.collection('employees').add({
    data: {
      _openid: '__SUPER_ADMIN_PLACEHOLDER__',
      employeeId,
      name,
      department: department || '综合部',
      avatarUrl: '',
      role: 'superadmin',
      status: 'active',
      createdAt: now,
      updatedAt: now
    }
  });

  return { code: 0, data: { message: `超级管理员 ${name}(${employeeId}) 创建成功。请用该微信账号登录小程序完成注册以绑定openid。` } };
}

async function initAll(event) {
  const modResult = await initModules();
  if (modResult.code !== 0) {
    return modResult;
  }

  const adminResult = await initSuperAdmin(event);
  if (adminResult.code !== 0) {
    return { code: 500, message: `模块初始化成功，但管理员初始化失败: ${adminResult.message}` };
  }

  return {
    code: 0,
    data: {
      message: '数据库初始化完成',
      modules: `已创建${MODULES.length}个模块`,
      superAdmin: `${event.name}(${event.employeeId || 'admin001'})`
    }
  };
}
