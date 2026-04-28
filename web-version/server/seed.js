const bcrypt = require('bcryptjs');
const { trx } = require('./db');

async function seed(db) {

const MODULES = [
  {
    name: '能力', description: '专业能力提升相关积分，包括各级公司奖励、技术成果等',
    icon: '📚', sort_order: 1, is_active: 1,
    subcategories: [
      { name: '获得区级公司奖励', description: '获得区级公司颁发的奖项或荣誉表彰', points: 5, max_times: 0, requires_photo: 1, sort_order: 1, is_active: 1 },
      { name: '获得市级公司奖励', description: '获得市级公司颁发的奖项或荣誉表彰', points: 10, max_times: 0, requires_photo: 1, sort_order: 2, is_active: 1 },
      { name: '获得省级公司奖励', description: '获得省级公司颁发的奖项或荣誉表彰', points: 15, max_times: 0, requires_photo: 1, sort_order: 3, is_active: 1 },
      { name: '获得公司级奖励', description: '获得公司级内部奖项或荣誉表彰', points: 8, max_times: 0, requires_photo: 1, sort_order: 4, is_active: 1 },
      { name: '其他', description: '其他能力相关积分事项', points: 2, max_times: 0, requires_photo: 1, sort_order: 5, is_active: 1 }
    ]
  },
  {
    name: '担当', description: '责任担当相关积分，包括科研任务、跨部门协作、问题反馈等',
    icon: '🛡️', sort_order: 2, is_active: 1,
    subcategories: [
      { name: '承担公司科研任务', description: '主动承担或参与公司科研项目、课题研究任务', points: 10, max_times: 0, requires_photo: 1, sort_order: 1, is_active: 1 },
      { name: '解决跨部门问题', description: '主动协调并解决跨部门的工作难题或协作障碍', points: 8, max_times: 0, requires_photo: 1, sort_order: 2, is_active: 1 },
      { name: '提出当值工作问题', description: '在当值期间主动发现并提出有价值的工作问题或改进建议', points: 5, max_times: 0, requires_photo: 1, sort_order: 3, is_active: 1 },
      { name: '其他', description: '其他责任担当相关积分事项', points: 3, max_times: 0, requires_photo: 1, sort_order: 4, is_active: 1 }
    ]
  },
  {
    name: '道德', description: '道德品质与社会责任相关积分，包括文体活动、志愿服务、公益献血等',
    icon: '❤️', sort_order: 3, is_active: 1,
    subcategories: [
      { name: '参加公司文体活动', description: '积极参加公司组织的文化体育类活动', points: 2, max_times: 0, requires_photo: 1, sort_order: 1, is_active: 1 },
      { name: '参加社区志愿活动', description: '参加社区或外部组织的志愿服务活动', points: 3, max_times: 0, requires_photo: 1, sort_order: 2, is_active: 1 },
      { name: '参加公益活动', description: '参加扶贫、助学、救灾等社会公益活动', points: 3, max_times: 0, requires_photo: 1, sort_order: 3, is_active: 1 },
      { name: '无偿献血', description: '参加无偿献血活动，上传献血证照片', points: 2, max_times: 4, requires_photo: 1, sort_order: 4, is_active: 1 },
      { name: '见义勇为', description: '保护国家、集体或他人生命财产安全的行为', points: 10, max_times: 0, requires_photo: 1, sort_order: 5, is_active: 1 }
    ]
  },
  {
    name: '纪律', description: '纪律相关积分，包括每月团队任务完成、诚实守信等，由系统自动管理',
    icon: '⚖️', sort_order: 4, is_active: 1,
    subcategories: []
  }
];

// Seed modules
const existingModules = (await db.prepare('SELECT COUNT(*) as cnt FROM modules').get()).cnt;
if (existingModules === 0) {
  await trx(async (tx) => {
    for (const mod of MODULES) {
      const r = await tx.prepare('INSERT INTO modules (name, description, icon, sort_order, is_active) VALUES (?, ?, ?, ?, ?)')
        .run(mod.name, mod.description, mod.icon, mod.sort_order, mod.is_active);
      const moduleId = r.lastInsertRowid;
      for (const sub of mod.subcategories) {
        await tx.prepare('INSERT INTO subcategories (module_id, name, description, points, max_times, requires_photo, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(moduleId, sub.name, sub.description, sub.points, sub.max_times, sub.requires_photo, sub.sort_order, sub.is_active);
      }
    }
  });
  console.log(`已创建 ${MODULES.length} 个模块及子项`);
} else {
  // Existing database — migrate subcategories + ensure module 4 exists
  const disciplineModule = await db.prepare("SELECT id FROM modules WHERE name = '纪律'").get();
  if (!disciplineModule) {
    await db.prepare('INSERT INTO modules (name, description, icon, sort_order, is_active) VALUES (?, ?, ?, ?, ?)')
      .run('纪律', '纪律相关积分，包括每月团队任务完成、诚实守信等，由系统自动管理', '⚖️', 4, 1);
    console.log('已添加纪律模块');
  } else {
    console.log('纪律模块已存在');
  }

  await trx(async (tx) => {
    for (const mod of MODULES) {
      const modRow = await tx.prepare("SELECT id FROM modules WHERE name = ?").get(mod.name);
      if (!modRow) continue;
      const moduleId = modRow.id;

      await tx.prepare('UPDATE modules SET icon = ?, description = ? WHERE id = ?')
        .run(mod.icon, mod.description, moduleId);

      for (const sub of mod.subcategories) {
        const existing = await tx.prepare('SELECT id, is_active FROM subcategories WHERE module_id = ? AND name = ?').get(moduleId, sub.name);
        if (existing) {
          await tx.prepare('UPDATE subcategories SET is_active = 1, points = ?, max_times = ?, requires_photo = ?, sort_order = ?, description = ? WHERE id = ?')
            .run(sub.points, sub.max_times, sub.requires_photo, sub.sort_order, sub.description, existing.id);
        } else {
          await tx.prepare('INSERT INTO subcategories (module_id, name, description, points, max_times, requires_photo, sort_order, is_active) VALUES (?,?,?,?,?,?,?,?)')
            .run(moduleId, sub.name, sub.description, sub.points, sub.max_times, sub.requires_photo, sub.sort_order, 1);
        }
      }

      const newNames = mod.subcategories.map(s => s.name);
      if (newNames.length > 0) {
        await tx.prepare(`UPDATE subcategories SET is_active = 0 WHERE module_id = ? AND name NOT IN (${newNames.map(() => '?').join(',')})`)
          .run(moduleId, ...newNames);
      }
    }
  });
  console.log('模块及子项已更新');
}

// Seed super admin (default: admin / admin123)
const existingAdmin = await db.prepare('SELECT COUNT(*) as cnt FROM users WHERE role = ?').get('superadmin');
if (existingAdmin.cnt === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  await db.prepare(`INSERT INTO users (username, password_hash, employee_id, name, department, role, status) VALUES (?, ?, ?, ?, ?, 'superadmin', 'active')`)
    .run('admin', hash, 'admin001', '超级管理员', '综合部');
  console.log('已创建超级管理员: admin / admin123');
} else {
  console.log('超级管理员已存在，跳过');
}

// Seed employee accounts (persistent across restarts)
const EMPLOYEES = [
  { username: 'ABC', password: '123456', name: '何孟溪', employeeId: '12345678', department: '青羊区' },
  { username: 'hmx', password: '123456', name: '张三', employeeId: '123', department: '技术部' },
  { username: 'testuser', password: '123456', name: '吴九', employeeId: 'TEST001', department: '技术部' },
  { username: 'user1', password: '123456', name: '李四', employeeId: 'EMP001', department: '技术部' },
  { username: 'user2', password: '123456', name: '王五', employeeId: 'EMP002', department: '市场部' },
  { username: 'user3', password: '123456', name: '赵六', employeeId: 'EMP003', department: '市场部' },
  { username: 'user4', password: '123456', name: '孙七', employeeId: 'EMP004', department: '综合部' },
  { username: 'user5', password: '123456', name: '周八', employeeId: 'EMP005', department: '综合部' },
];
const existingEmployees = (await db.prepare('SELECT COUNT(*) as cnt FROM users WHERE role = ?').get('employee')).cnt;
if (existingEmployees === 0) {
  await trx(async (tx) => {
    for (const emp of EMPLOYEES) {
      const hash = bcrypt.hashSync(emp.password, 10);
      await tx.prepare('INSERT INTO users (username, password_hash, employee_id, name, department, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(emp.username, hash, emp.employeeId, emp.name, emp.department, 'employee', 'active');
    }
  });
  console.log(`已创建 ${EMPLOYEES.length} 个员工账号，默认密码: 123456`);
} else {
  console.log(`已有 ${existingEmployees} 个员工账号，跳过`);
}

console.log('数据库初始化完成');
}

// Run directly if called as script
if (require.main === module) {
  const { db, initDB } = require('./db');
  (async () => {
    await initDB();
    await seed(db);
    process.exit(0);
  })();
}

module.exports = { seed };
