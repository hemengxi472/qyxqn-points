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

  // Migrations
  await addColumnIfMissing('submissions', 'month_year', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing('points_log', 'month_year', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing('groups', 'completion_description', "TEXT DEFAULT ''");

  // Backfill month_year
  await client.execute(`UPDATE submissions SET month_year = strftime('%Y-%m', created_at) WHERE month_year = ''`);
  await client.execute(`UPDATE points_log SET month_year = strftime('%Y-%m', created_at) WHERE month_year = ''`);

  // Migrate overwritten task_description to completion_description
  await client.execute(`UPDATE groups SET completion_description = task_description, task_description = ''
    WHERE status IN ('submitted', 'approved', 'rejected') AND task_description != '' AND completion_description = ''`);

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
