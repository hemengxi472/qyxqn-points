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

  // 索引沿用 CREATE INDEX IF NOT EXISTS 惯例（见上方月度层的写法），没有 helper。
  // groups.quarter 只建普通索引：一个季度本来就有多组。
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_groups_quarter ON groups(quarter)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_points_log_quarter ON points_log(user_id, quarter)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_fraud_records_quarter ON fraud_records(user_id, quarter)`);

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
