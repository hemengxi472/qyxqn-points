const { createClient } = require('@libsql/client');
const path = require('path');

const TURSO_URL = process.env.TURSO_URL || '';
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || '';

// Use Turso in production (env var set), local SQLite file for dev
const client = TURSO_URL
  ? createClient({ url: TURSO_URL, authToken: TURSO_AUTH_TOKEN })
  : createClient({ url: `file:${process.env.DB_PATH || path.join(__dirname, 'points.db')}` });

function wrapClient(c) {
  return {
    prepare(sql) {
      return {
        async get(...params) {
          const r = await c.execute({ sql, args: params.map(String) });
          return r.rows[0];
        },
        async all(...params) {
          const r = await c.execute({ sql, args: params.map(String) });
          return r.rows;
        },
        async run(...params) {
          const r = await c.execute({ sql, args: params.map(String) });
          return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid ? Number(r.lastInsertRowid) : 0 };
        }
      };
    }
  };
}

// db is the async-compatible wrapper used in all route files
const db = wrapClient(client);

// For transactions: await trx(async (trx) => { trx.prepare(...).run() })
async function trx(fn) {
  const tx = await client.transaction();
  const txDb = wrapClient(tx);
  try {
    await fn(txDb);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

async function addColumnIfMissing(table, column, type) {
  const r = await client.execute(`PRAGMA table_info(${table})`);
  if (!r.rows.some(row => row.name === column)) {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

async function initDB() {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      employee_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      department TEXT NOT NULL DEFAULT '',
      avatar_url TEXT DEFAULT '',
      role TEXT NOT NULL DEFAULT 'employee' CHECK(role IN ('employee','admin','superadmin')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('active','disabled','pending')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS modules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS subcategories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_id INTEGER NOT NULL REFERENCES modules(id),
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      points INTEGER NOT NULL DEFAULT 0,
      max_times INTEGER NOT NULL DEFAULT 0,
      requires_photo INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      employee_id TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      department TEXT NOT NULL,
      module_id INTEGER NOT NULL,
      module_name TEXT NOT NULL,
      subcategory_name TEXT NOT NULL,
      description TEXT DEFAULT '',
      photo_urls TEXT DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      points_awarded INTEGER,
      reviewer_id INTEGER REFERENCES users(id),
      reviewer_name TEXT,
      review_comment TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS points_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      employee_id TEXT NOT NULL,
      submission_id INTEGER NOT NULL REFERENCES submissions(id),
      module_id INTEGER NOT NULL,
      module_name TEXT NOT NULL,
      subcategory_name TEXT NOT NULL,
      points INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'award',
      description TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS points_summary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
      employee_id TEXT NOT NULL UNIQUE,
      total_points INTEGER NOT NULL DEFAULT 0,
      module_points TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions(user_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
    CREATE INDEX IF NOT EXISTS idx_submissions_module ON submissions(module_id);
    CREATE INDEX IF NOT EXISTS idx_points_log_user ON points_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_points_summary_employee ON points_summary(employee_id);

    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      month_year TEXT NOT NULL,
      task_description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','submitted','approved','rejected')),
      submission_id INTEGER REFERENCES submissions(id),
      reviewer_id INTEGER REFERENCES users(id),
      reviewer_name TEXT,
      review_comment TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES groups(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      employee_id TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      department TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS fraud_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      employee_id TEXT NOT NULL,
      month_year TEXT NOT NULL,
      reason TEXT NOT NULL,
      points_reset INTEGER NOT NULL DEFAULT 0,
      reviewer_id INTEGER NOT NULL REFERENCES users(id),
      reviewer_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS monthly_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      employee_id TEXT NOT NULL,
      month_year TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      is_fraud_reset INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, month_year)
    );

    -- 统一任务：quarter 是权威键（每季度一条）。month_year 降级为遗留列 ——
    -- 原来的 UNIQUE 已去掉（一个季度会有多个月份值写进来），唯一性改由下面
    -- ux_monthly_tasks_quarter 这个部分唯一索引保证。表名保留 "monthly_tasks"：
    -- 重命名要同步改所有读者，而它的唯一作用已经被 quarter 接管，不值得动。
    CREATE TABLE IF NOT EXISTS monthly_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quarter TEXT NOT NULL DEFAULT '',
      month_year TEXT NOT NULL DEFAULT '',
      task_description TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_groups_month ON groups(month_year);
    CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_fraud_records_user ON fraud_records(user_id);
    CREATE INDEX IF NOT EXISTS idx_fraud_records_month ON fraud_records(month_year);
    CREATE INDEX IF NOT EXISTS idx_monthly_points_user ON monthly_points(user_id);
    CREATE INDEX IF NOT EXISTS idx_monthly_points_month ON monthly_points(month_year);
    CREATE INDEX IF NOT EXISTS idx_monthly_tasks_month ON monthly_tasks(month_year);

    -- ------------------------------------------------------------------
    -- 季度评分层（与上面的月度层并存，互不干扰）
    -- ------------------------------------------------------------------

    -- 每(人, 季度, 模块)一行。只存输入（扣分），派生的模块得分不落库，
    -- 读时算 MAX(0, base_score - deduction)。存了就是第二个真相源，必然漂移。
    CREATE TABLE IF NOT EXISTS quarterly_module_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      employee_id TEXT NOT NULL,
      quarter TEXT NOT NULL,
      dimension_id INTEGER NOT NULL,
      module_id INTEGER NOT NULL,
      module_name TEXT NOT NULL,
      base_score INTEGER NOT NULL DEFAULT 0,
      deduction INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, quarter, module_id)
    );
    CREATE INDEX IF NOT EXISTS idx_qms_user_quarter ON quarterly_module_scores(user_id, quarter);
    CREATE INDEX IF NOT EXISTS idx_qms_quarter ON quarterly_module_scores(quarter);

    -- 加分的唯一真相源，加分上限校验就是对它 SUM。
    -- UNIQUE(submission_id) 从结构上杜绝同一申请重复计分。
    CREATE TABLE IF NOT EXISTS quarterly_bonus_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      employee_id TEXT NOT NULL,
      quarter TEXT NOT NULL,
      dimension_id INTEGER NOT NULL,
      module_id INTEGER NOT NULL,
      module_name TEXT NOT NULL,
      submission_id INTEGER NOT NULL,
      points INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(submission_id)
    );
    CREATE INDEX IF NOT EXISTS idx_qbl_cap ON quarterly_bonus_ledger(user_id, quarter, dimension_id);

    -- 刚性归零标记，维度级（不是模块级：放在 module 表上就得靠"同维度所有
    -- 行标记一致"这种约定，漏一次 UPDATE 就出半个归零维度）。
    -- reward_ineligible 不能省：奖励按排名，被归零的人总分仍可能进前 10，
    -- 规范说的是"取消季度奖励资格"，所以必须从排名中剔除。
    CREATE TABLE IF NOT EXISTS quarterly_dimension_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      employee_id TEXT NOT NULL,
      quarter TEXT NOT NULL,
      dimension_id INTEGER NOT NULL,
      hard_zero INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      reward_ineligible INTEGER NOT NULL DEFAULT 0,
      set_by INTEGER REFERENCES users(id),
      set_by_name TEXT,
      set_at TEXT,
      UNIQUE(user_id, quarter, dimension_id)
    );

    -- 季度评分的审计流水（公示 3 工作日 + 申诉流程需要能说清谁在何时改了什么）
    CREATE TABLE IF NOT EXISTS quarterly_score_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      employee_id TEXT NOT NULL,
      quarter TEXT NOT NULL,
      dimension_id INTEGER,
      module_id INTEGER,
      type TEXT NOT NULL CHECK(type IN
        ('deduction','deduction_revert','bonus','bonus_revert','hard_zero_set','hard_zero_clear','lock')),
      delta INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      submission_id INTEGER,
      actor_id INTEGER REFERENCES users(id),
      actor_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_qsl_user_quarter ON quarterly_score_log(user_id, quarter);

    -- 季度锁定时的排名冻结。规范有"锁定 → 导出 → 公示 → 申诉 → 备案"链路，
    -- 没有快照的话公示期间任何一次扣分录入都会悄悄改掉已公示的排名。
    CREATE TABLE IF NOT EXISTS quarterly_reward_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quarter TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id),
      employee_id TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      department TEXT NOT NULL DEFAULT '',
      rank INTEGER NOT NULL,
      total_score INTEGER NOT NULL,
      leave_days REAL NOT NULL DEFAULT 0,
      hard_zero_count INTEGER NOT NULL DEFAULT 0,
      locked_at TEXT NOT NULL DEFAULT (datetime('now')),
      locked_by TEXT NOT NULL DEFAULT '',
      UNIQUE(quarter, user_id)
    );
  `);

  // Migrations
  await addColumnIfMissing('submissions', 'month_year', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing('points_log', 'month_year', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing('groups', 'completion_description', "TEXT DEFAULT ''");

  // ------------------------------------------------------------------
  // 六有青年评价体系：结构化内容字段
  //
  // 映射关系：modules 行 = 评价维度（有健康…有纪律），
  //          subcategories 行 = 维度下的模块（身体健康、心理健康…）。
  // 判定依据：六个维度各自模块的基础分精确加总为 100
  //          （60+40、40+35+25、40+30+30、40+30+30、40+35+25、45+35+20）。
  // ------------------------------------------------------------------
  await addColumnIfMissing('modules', 'dimension_code', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing('modules', 'base_score', "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing('modules', 'bonus_cap', "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing('modules', 'cycle', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing('modules', 'core_modules', "TEXT NOT NULL DEFAULT '[]'");
  await addColumnIfMissing('modules', 'theme_activity', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing('modules', 'has_hard_zero', "INTEGER NOT NULL DEFAULT 0");

  // 注意：不改 subcategories.points 的含义。它仍是"参考加分/次"（员工端
  // 显示、提交页预填），基础分走新的 base_score 列。把 points 重解释成
  // 基础分会静默改坏现有展示和预填路径。
  await addColumnIfMissing('subcategories', 'base_score', "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing('subcategories', 'score_rule', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing('subcategories', 'bonus_rule', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing('subcategories', 'bonus_cap', "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing('subcategories', 'theme_activity', "TEXT NOT NULL DEFAULT '[]'");
  await addColumnIfMissing('subcategories', 'evidence_required', "TEXT NOT NULL DEFAULT ''");

  // 季度在提交时冻结（决策：按提交时间归属），所以是存储列。
  await addColumnIfMissing('submissions', 'quarter', "TEXT NOT NULL DEFAULT ''");

  // 上一版预留的钩子，已被下方的 fraud_records.quarter 取代 —— 勿用，勿读。
  // 保留列不删：DROP COLUMN 在有索引/触发器时会失败，而这一列在任何查询里
  // 都不出现，留着零成本；删它才是风险。
  await addColumnIfMissing('fraud_records', 'affects_quarter', "INTEGER NOT NULL DEFAULT 0");

  // Backfill month_year
  await client.execute(`UPDATE submissions SET month_year = strftime('%Y-%m', created_at) WHERE month_year = ''`);
  await client.execute(`UPDATE points_log SET month_year = strftime('%Y-%m', created_at) WHERE month_year = ''`);

  // Backfill quarter —— 从已存的 month_year 推，而不是从 created_at 推，
  // 这样历史季度的归属与历史 month_year 自洽（两者 UTC 口径一致）。
  await client.execute(`UPDATE submissions SET quarter =
    substr(month_year, 1, 4) || '-Q' || ((CAST(substr(month_year, 6, 2) AS INTEGER) + 2) / 3)
    WHERE quarter = '' AND month_year != ''`);

  // Migrate overwritten task_description to completion_description
  await client.execute(`UPDATE groups SET completion_description = task_description, task_description = ''
    WHERE status IN ('submitted', 'approved', 'rejected') AND task_description != '' AND completion_description = ''`);

  // ==================================================================
  // 全面季度化：团队任务 / 作假 / 历史归属
  //
  // quarter 是唯一权威的时间归属列，month_year 降级为遗留列 —— 新写入一律写
  // 真实的当前月份（monthKey()），只为让 NOT NULL 约束成立、让遗留读者看到合理值，
  // 所有周期逻辑（查询、筛选、排序、守卫）一律改读 quarter。
  //
  // 不要往 month_year 里写"季度起始月"：monthly_tasks.month_year 带 UNIQUE，
  // monthly_points 是 UNIQUE(user_id, month_year)，写假月份会互撞，并把遗留月度桶
  // 和季度桶混成一个。
  // ==================================================================

  // 月份 → 季度的 SQL 表达式，与上面 db.js 的回填同一算法。
  // 对空串会算出 '--Q0' 这种垃圾值 —— 所有调用点都必须带 month_year != '' 守卫。
  const Q_FROM_M = (col) =>
    `substr(${col}, 1, 4) || '-Q' || ((CAST(substr(${col}, 6, 2) AS INTEGER) + 2) / 3)`;

  await addColumnIfMissing('groups', 'quarter', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing('monthly_tasks', 'quarter', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing('fraud_records', 'quarter', "TEXT NOT NULL DEFAULT ''");
  // 作假的撤销要按**当时**的口径精确反算。只存总额不够 —— 撤销路径的注释有完整说明。
  await addColumnIfMissing('fraud_records', 'module_breakdown', "TEXT NOT NULL DEFAULT '{}'");
  await addColumnIfMissing('points_log', 'quarter', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing('points_log', 'source', "TEXT NOT NULL DEFAULT ''");
  // 审计流水的来源标记（'' = 人工，'fraud' = 弄虚作假归零）。用 ADD COLUMN 而不是
  // 重建表 —— type 的 CHECK 约束不需要动，不值得为它冒重建的不可逆风险。
  await addColumnIfMissing('quarterly_score_log', 'source', "TEXT NOT NULL DEFAULT ''");
  // 不参与季度排名：给「能登录、但不是参赛对象」的账号用（测试账号、借调、
  // 长期外派）。不能拿 status 代替 —— status 是登录闸门，置成 disabled/pending
  // 会连人一起挡在门外（auth.js:30-35），而这类账号恰恰需要能登进来看。
  await addColumnIfMissing('users', 'exclude_from_ranking', "INTEGER NOT NULL DEFAULT 0");

  // 索引沿用 CREATE INDEX IF NOT EXISTS 惯例（见上方月度层的写法），没有 helper。
  // groups.quarter 只建普通索引：一个季度本来就有多组。
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_groups_quarter ON groups(quarter)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_points_log_quarter ON points_log(user_id, quarter)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_fraud_records_quarter ON fraud_records(user_id, quarter)`);

  // ------------------------------------------------------------------
  // 子项加分上限校正（依据 表2 六大维度积分规则）
  //
  // 这些子项最初建表时把**维度的**加分上限抄到了每一行（有成长 3×60、有担当 3×30
  // …），员工端会把"每项都能拿满 60"读成制度。表2 里的分值是按子项给的，这里补齐。
  //
  // 为什么放在 db.js 而不是 seed.js：seed 只在 INSERT 时写这些值（seed.js 里
  // "只插入不覆盖文案"），线上这些行早就存在了，走 INSERT 那条路径根本改不到。
  //
  // 幂等靠守卫而不是靠标记表：只有当 bonus_cap 还等于**维度**bonus_cap 时才改，
  // 也就是"还停留在旧错误状态"。改完之后两者不再相等，重跑自然不命中；
  // 管理员事后手工调过的值也不会被覆盖（那时两个数已经不相等了）。
  //
  // 唯一的误伤面：管理员如果故意把某个子项调回"恰好等于维度上限"，会被重置一次。
  // 这个取舍是为了不引入一张只为跑一次的标记表。
  // ------------------------------------------------------------------
  const SUB_BONUS_CAP_FIX = [
    ['health', '身体健康', 10], ['health', '心理健康', 0],
    ['skill', '专业扎实', 10], ['skill', '高效执行', 10], ['skill', '跨界学习', 10],
    ['growth', '持续成长', 60], ['growth', '自信自强', 60], ['growth', '品质修养', 60],
    ['wisdom', '全局思维', 10], ['wisdom', '职业规划', 10], ['wisdom', '难题破解', 10],
    ['duty', '岗位履职担当', 15], ['duty', '团队协同担当', 10], ['duty', '青年志愿担当', 5],
    ['discipline', '合规纪律', 10], ['discipline', '职业操守', 10], ['discipline', '自我管理', 0]
  ];
  let bonusCapFixed = 0;
  for (const [code, subName, target] of SUB_BONUS_CAP_FIX) {
    const r = await db.prepare(
      `UPDATE subcategories
          SET bonus_cap = ?
        WHERE name = ?
          AND module_id = (SELECT id FROM modules WHERE dimension_code = ?)
          AND bonus_cap <> ?
          AND bonus_cap = (SELECT bonus_cap FROM modules WHERE dimension_code = ?)`
    ).run(target, subName, code, target, code);
    bonusCapFixed += Number(r.changes || 0);
  }
  if (bonusCapFixed > 0) {
    console.log(`子项加分上限已按表2 校正 ${bonusCapFixed} 条`);
  }

  // ------------------------------------------------------------------
  // 子项分值补齐（依据 表2 的「附加加分」列）
  //
  // subcategories.points 是员工端的「参考加分 / 次」，也是提交页的默认分值。
  // 建表以来它一直是 0 —— 界面上就是一枚「0分」徽章，等于没有分值。
  //
  // 这里填的是"该子项每达成一次可得分"，逐条对得上表2：
  //   有健康  身体健康 10  ←「小组季度共同健康打卡≥2 次，一次性得 10 分，不拆分」
  //   有本领  三项各 10    ←「专业扎实、高效执行、跨界学习类事项按项累计，最高 10 分」
  //   有成长  三项各 10    ←「…按规则累计，上限 60 分」→ 六类事项 × 10
  //   有智慧  三项各 10    ←「建议落地采纳 +10 分/项」等三句
  //   有担当  15 / 10 / 5  ←「牵头专项攻坚 +15 分；应急任务表现突出 +10 分；
  //                          客户/部门正向评价 +5 分」
  //   有纪律  10 / 10 / 5  ←「合规宣讲分享 +10 分/次；主动上报核实风险 +10 分/次」
  //
  // 两处是**酌情**填的，表2 对这两项只有扣分表述、没有加分条款，日后可按实际
  // 执行情况调整：心理健康 10（按情绪复盘/兴趣疗愈/正向倾诉/月度小目标四项）、
  // 自我管理 5（按遵守考勤/按时填报）。
  //
  // 幂等靠 `points = 0` 守卫：只填"从没设过"的行，管理员手工调过的不覆盖，
  // 重跑是 no-op。与上面 bonus_cap 的守卫写法不同 —— 那边要识别"还停在旧错误
  // 状态"，这边要识别"还没填过"，两者是不同的问题，别把守卫抄混了。
  // ------------------------------------------------------------------
  const SUB_POINT_FIX = [
    ['health', '身体健康', 10], ['health', '心理健康', 10],
    ['skill', '专业扎实', 10], ['skill', '高效执行', 10], ['skill', '跨界学习', 10],
    ['growth', '持续成长', 10], ['growth', '自信自强', 10], ['growth', '品质修养', 10],
    ['wisdom', '全局思维', 10], ['wisdom', '职业规划', 10], ['wisdom', '难题破解', 10],
    ['duty', '岗位履职担当', 15], ['duty', '团队协同担当', 10], ['duty', '青年志愿担当', 5],
    ['discipline', '合规纪律', 10], ['discipline', '职业操守', 10], ['discipline', '自我管理', 5]
  ];
  let pointsFixed = 0;
  for (const [code, subName, target] of SUB_POINT_FIX) {
    const r = await db.prepare(
      `UPDATE subcategories
          SET points = ?
        WHERE name = ?
          AND module_id = (SELECT id FROM modules WHERE dimension_code = ?)
          AND points = 0`
    ).run(target, subName, code);
    pointsFixed += Number(r.changes || 0);
  }
  if (pointsFixed > 0) {
    console.log(`子项分值已按表2 补齐 ${pointsFixed} 条`);
  }

  // ------------------------------------------------------------------
  // monthly_tasks 重建：这是唯一必须重建的表
  //
  // monthly_tasks.month_year 带 UNIQUE。季度化之后同一季度会有多行（7/8/9 月各
  // 一行）全被回填成同一个 quarter，此时任何建在 quarter 上的唯一索引都会在
  // initDB() 里抛错，而 initDB 没有 try/catch（index.js 在启动时直接 await 它）
  // —— 进程每次启动即死。这不是理论风险：它只取决于"一个季度里管理员保存过
  // 几次统一任务"这个数据习惯，而本次迁移的目的正是消灭这个习惯。
  //
  // 所以先重建、在重建里顺带去重，再建索引（重建后数据必然干净，索引不可能失败）。
  //
  // 判据用 PRAGMA index_list 找 UNIQUE **列约束**（origin='u'），不要判
  // "表定义里有没有 quarter"：SQLite 的 ALTER TABLE ADD COLUMN 会重写
  // sqlite_master 里存的建表语句，上面第 372 行加完 quarter 之后，表定义里
  // 就同时有 quarter 和 month_year UNIQUE 了 —— 那个判据会永远为假，重建
  // 一次都不会跑，然后唯一索引在 initDB 里炸。
  // ------------------------------------------------------------------
  const mtIdx = await client.execute('PRAGMA index_list(monthly_tasks)');
  const hasColumnUnique = mtIdx.rows.some(r => Number(r.unique) === 1 && r.origin === 'u');
  if (hasColumnUnique) {
    const before = await client.execute('SELECT COUNT(*) AS c FROM monthly_tasks');
    await trx(async (tx) => {
      await tx.prepare('DROP TABLE IF EXISTS monthly_tasks_new').run();
      // 新表：quarter 是权威键，month_year 去掉 UNIQUE 降级为遗留列。
      // 这里不写 UNIQUE(quarter)，改用下面的部分唯一索引 —— 遗留的空 month_year
      // 行会得到 quarter = ''，多行空值不该互撞。
      await tx.prepare(`
        CREATE TABLE monthly_tasks_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          quarter TEXT NOT NULL DEFAULT '',
          month_year TEXT NOT NULL DEFAULT '',
          task_description TEXT NOT NULL,
          created_by INTEGER REFERENCES users(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `).run();
      // 每个季度只保留最新一行（同一季度的多月配置合并成一条季度任务）。
      // 显式列名 —— 绝不用 INSERT ... SELECT *：位置拷贝在列顺序变化时会静默
      // 错位（文本进了 INTEGER 列也不报错），而这里正是最不该丢数据的表。
      await tx.prepare(`
        INSERT INTO monthly_tasks_new (id, quarter, month_year, task_description, created_by, created_at)
        SELECT t.id,
               CASE WHEN t.month_year != '' THEN ${Q_FROM_M('t.month_year')} ELSE '' END,
               t.month_year, t.task_description, t.created_by, t.created_at
          FROM monthly_tasks t
         WHERE t.month_year = ''
            OR t.id = (SELECT MAX(t2.id) FROM monthly_tasks t2
                        WHERE t2.month_year != ''
                          AND ${Q_FROM_M('t2.month_year')} = ${Q_FROM_M('t.month_year')})
      `).run();
      await tx.prepare('DROP TABLE monthly_tasks').run();
      await tx.prepare('ALTER TABLE monthly_tasks_new RENAME TO monthly_tasks').run();
    });
    const after = await client.execute('SELECT COUNT(*) AS c FROM monthly_tasks');
    const dropped = Number(before.rows[0].c) - Number(after.rows[0].c);
    console.log(`[DB] Migrated monthly_tasks: 季度化${dropped > 0 ? `，合并掉 ${dropped} 行同季度重复配置` : ''}`);
  }
  // DROP TABLE 会连带删掉表上的索引，所以上面月度层建的 idx_monthly_tasks_month
  // 在重建路径上没了。month_year 仍是遗留读者要用的列，无条件补一次
  // （幂等；已存在的路径上是空操作）。
  await client.execute('CREATE INDEX IF NOT EXISTS idx_monthly_tasks_month ON monthly_tasks(month_year)');

  // 部分唯一索引：迁移后数据已去重，索引建立不可能失败。
  await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS ux_monthly_tasks_quarter
    ON monthly_tasks(quarter) WHERE quarter != ''`);

  // ------------------------------------------------------------------
  // 回填 quarter —— 位置有硬依赖，必须在上面的 month_year / submissions.quarter
  // 回填之后：points_log 的主分支读 submissions.quarter，兜底分支读自己的
  // month_year，两者都由上面的语句产出。
  // ------------------------------------------------------------------

  // 优先用提交时冻结的季度（与 quarterly_bonus_ledger 同口径），
  // 没有 submission_id 的（团队任务、遗留数据）退回按月份推。
  await client.execute(`UPDATE points_log SET quarter = (
      SELECT s.quarter FROM submissions s WHERE s.id = points_log.submission_id
    ) WHERE quarter = '' AND submission_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM submissions s WHERE s.id = points_log.submission_id AND s.quarter != '')`);

  await client.execute(`UPDATE points_log SET quarter = ${Q_FROM_M('month_year')}
    WHERE quarter = '' AND month_year != ''`);

  for (const table of ['groups', 'fraud_records']) {
    await client.execute(`UPDATE ${table} SET quarter = ${Q_FROM_M('month_year')}
      WHERE quarter = '' AND month_year != ''`);
  }
  // monthly_tasks 的 quarter 已在重建时写好；这里兜住重建未曾执行（表已季度化）的情况
  await client.execute(`UPDATE monthly_tasks SET quarter = ${Q_FROM_M('month_year')}
    WHERE quarter = '' AND month_year != ''`);

  // 团队任务行的判别特征：「同一个 submission_id 被记到了多个不同 user_id 名下」
  // —— 一次团队审核会给全队 N 人各写一行 points_log。
  await client.execute(`UPDATE points_log SET source = 'team_task'
    WHERE source = '' AND submission_id IS NOT NULL AND submission_id IN (
      SELECT submission_id FROM points_log
       WHERE submission_id IS NOT NULL
       GROUP BY submission_id HAVING COUNT(DISTINCT user_id) > 1
    )`);
  await client.execute(`UPDATE points_log SET source = 'submission' WHERE source = '' AND type = 'award'`);

  // Migrate users table CHECK constraint to include 'pending'
  const tableSQL = await client.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'");
  if (tableSQL.rows.length > 0 && !tableSQL.rows[0].sql.includes("'pending'")) {
    await client.executeMultiple(`
      DROP TABLE IF EXISTS users_new;
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        employee_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        department TEXT NOT NULL DEFAULT '',
        avatar_url TEXT DEFAULT '',
        role TEXT NOT NULL DEFAULT 'employee' CHECK(role IN ('employee','admin','superadmin')),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled','pending')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_new SELECT * FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
    console.log('[DB] Migrated users table: added pending status support');
  }
}

module.exports = { db, trx, initDB };
