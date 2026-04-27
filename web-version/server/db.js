const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'points.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function addColumnIfMissing(table, column, type) {
  const rows = db.pragma(`table_info(${table})`);
  if (!rows.some(r => r.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

function initDB() {
  db.exec(`
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

    -- 团队分组
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

    -- 作假记录
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

    -- 月度积分物化
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

    -- 月度统一任务
    CREATE TABLE IF NOT EXISTS monthly_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month_year TEXT NOT NULL UNIQUE,
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
  `);

  // Migrate existing tables — add month_year column
  addColumnIfMissing('submissions', 'month_year', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('points_log', 'month_year', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('groups', 'completion_description', "TEXT DEFAULT ''");

  // Backfill month_year from created_at
  db.exec(`
    UPDATE submissions SET month_year = strftime('%Y-%m', created_at) WHERE month_year = '';
    UPDATE points_log SET month_year = strftime('%Y-%m', created_at) WHERE month_year = '';
  `);

  // Migrate overwritten task_description to completion_description
  db.exec(`
    UPDATE groups SET completion_description = task_description, task_description = ''
    WHERE status IN ('submitted', 'approved', 'rejected') AND task_description != ''
      AND completion_description = '';
  `);

  // Migrate users table CHECK constraint to include 'pending' status
  const tableSQL = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (tableSQL && !tableSQL.sql.includes("'pending'")) {
    // Clean up leftover from previous failed migration
    db.exec('DROP TABLE IF EXISTS users_new');
    db.exec(`
      PRAGMA foreign_keys = OFF;
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
      PRAGMA foreign_keys = ON;
    `);
    console.log('[DB] Migrated users table: added pending status support');
  }
}

module.exports = { db, initDB };
