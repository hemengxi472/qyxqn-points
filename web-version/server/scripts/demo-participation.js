// 演示用的「本季度参与记录」样本数据。
//
// 目的：季度评分改成累加制后，一个什么都没参加的人得 0 分，排名页会是一排 0。
// 这个脚本按表2 的规则给每位参评人生成一批**格式完整的已通过申请单**，让排名
// 有真实梯度，并且每个人都有健康打卡记录。
//
//   node scripts/demo-participation.js --status       只读，看现在有什么、备份在不在
//   node scripts/demo-participation.js --seed         写入样本数据
//   node scripts/demo-participation.js --cleanup      只删自己写的，还原 points_summary
//   node scripts/demo-participation.js --clear-lock   删本季度的排名快照（本机残留专用）
//
// 三种模式都可以加 --quarter=2026-Q3 指定季度，默认当前季度。
//
// 两条安全设计：
//   1) **只删自己写的东西**。所有写入都带标记 —— points_log.source='demo'、
//      submissions.review_comment 以 [DEMO] 开头、quarterly_score_log.source='demo'。
//      --cleanup 只按这些标记删，不碰任何真实数据。
//   2) **可重复执行**。每个人的数据由 employee_id 哈希出的伪随机数决定，同一个人
//      每次跑得到同一份数据；--seed 会先清掉自己的旧数据再写。
//
// points_summary（累计积分）是生命周期累加的，不像季度分那样能重算，所以 --seed
// 会先把受影响的行原样存进 .demo-backup.json，--cleanup 优先从那里还原。备份文件
// 不在（比如换了台机器）时才退化成"按确定性金额减回去"。
//
// ⚠️ 由此带来一个必须知道的副作用：--cleanup 是把 points_summary **整行还原**到
// 备份时的值。所以在样本数据存在期间，如果这 30 个人里有人走正规流程通过了申请、
// 或被录了作假，那笔对累计积分的改动会在 --cleanup 时一并被抹掉。季度分不受影响
// （它是从 points_log 现算的，只删 demo 行）。要保留样本期间的正式数据，就先
// 手动记下 points_summary，或者改用 --cleanup 之后单独补录。

const fs = require('fs');
const path = require('path');
const { db, initDB, trx } = require('../db');
const { buildQuarterlyScores, listScorableUsers } = require('../utils/quarterly');
const { quarterKey, monthKey, isValidQuarter, formatQuarter } = require('../utils/quarter');

const BACKUP = path.join(__dirname, '.demo-backup.json');
const DEMO_TAG = '[DEMO]';
const DEMO_REVIEWER = '示例数据';

function pad2(n) { return String(n).padStart(2, '0'); }
function now() { return new Date().toISOString().replace('T', ' ').substring(0, 19); }

// ---------------------------------------------------------------------------
// 确定性伪随机：同一个 employee_id 永远得到同一串数。
// 用 FNV-1a 把工号散列成种子，再喂 mulberry32。不是密码学随机，也不需要是。
// ---------------------------------------------------------------------------
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (const ch of String(s)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 每人每维度要达到的完成度（0~1，乘维度基础分 100）
//
// 有健康对所有人生成 50~70%：用户明确要求"这个季度每个人都打开健康和纪录"。
// 其余五个维度 30~65%。
//
// 下界是 0.3 而不是 0，且 planSubmissions 里另有"每子项至少 1 次"的兜底：
// 上一版的公式是 Math.max(0, R() * 0.75 - 0.12)，会抽出 0，结果是 30 人里
// 有 9~14 人在有本领/有成长/有智慧/有担当/有纪律 上整个维度是 0 分 —— 员工端
// 看到一片 0，"六个维度都铺满、不能是 0 分"的要求根本没达成。**别再改回带 0 的抽样。**
//
// 上限刻意压在 65~70%：维度天花板是 100 + 加分上限，要留出 40 分以上余量，
// 演示现场还能真的提交一条、审核通过、看着分数涨上去。
// ---------------------------------------------------------------------------
function targetFraction(dimCode, R) {
  if (dimCode === 'health') return 0.5 + R() * 0.2;
  return 0.3 + R() * 0.35;
}

// 把完成度拆成"每个子项提交几次"。次数只能是整数，所以维度合计会略偏离目标，
// 这是对的 —— 真实数据本来就长这样，凑成整百反而是假的。
//
// 次数上限 = 子项基础分 / 子项每次分值，也就是该子项做到"本项上限"为止。
// 次数下界是 1：每个子项至少留一条记录，这样"维度分非 0"和"子项已得非 0"
// 同时成立。cap 为 0 的子项（分值为 0、或基础分不够一次）在前一行就跳过了，
// 所以这里的 max(1, ...) 不会越过 cap。
function planSubmissions(dim, subs, frac, R) {
  const plan = [];
  for (const m of subs) {
    const per = Number(m.points) || 0;
    if (per <= 0) continue; // 分值为 0 的子项无从计算，跳过（db.js 的 SUB_POINT_FIX 会补上）
    const cap = Math.floor((Number(m.base_score) || 0) / per);
    if (cap <= 0) continue;
    const want = (Number(m.base_score) || 0) * frac;
    const count = Math.min(cap, Math.max(1, Math.round(want / per)));
    for (let i = 0; i < count; i++) plan.push({ sub: m, points: per });
  }
  // 打乱子项顺序，免得日志里所有"身体健康"都挤在月初 —— 一眼就能看出是生成的
  for (let i = plan.length - 1; i > 0; i--) {
    const j = Math.floor(R() * (i + 1));
    [plan[i], plan[j]] = [plan[j], plan[i]];
  }
  return plan;
}

// 提交时间：本季度内**当前这个月**的 1 号到今天的随机时刻。
// 当月的任何一天都落在当前季度内，所以不需要额外判断月份边界。
function makeTimeFactory(R) {
  const mk = monthKey();
  const today = new Date().getDate();
  const days = Math.max(1, today);
  return () => {
    const day = 1 + Math.floor(R() * days);
    const hh = 8 + Math.floor(R() * 12); // 08:00~19:59，上班时间才像真的
    const mm = Math.floor(R() * 60);
    const ss = Math.floor(R() * 60);
    return `${mk}-${pad2(day)} ${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
  };
}

// ---------------------------------------------------------------------------
// 清理：只删带标记的行。返回逐表删除行数，让人看得见它到底动了什么。
// ---------------------------------------------------------------------------
async function cleanup(tx, { keepSummary = false } = {}) {
  const counts = {};

  // 先收集要删的 demo 提交 id —— ledger 和 score_log 都要按它级联
  const subRows = await tx.prepare(
    `SELECT id FROM submissions WHERE review_comment LIKE ?`
  ).all(`${DEMO_TAG}%`);
  const subIds = subRows.map(r => Number(r.id));

  counts.quarterly_score_log = Number((await tx.prepare(
    `DELETE FROM quarterly_score_log WHERE source = 'demo'`
  ).run()).changes || 0);

  if (subIds.length > 0) {
    const ph = subIds.map(() => '?').join(',');
    counts.quarterly_bonus_ledger = Number((await tx.prepare(
      `DELETE FROM quarterly_bonus_ledger WHERE submission_id IN (${ph})`
    ).run(...subIds)).changes || 0);
  } else {
    counts.quarterly_bonus_ledger = 0;
  }

  counts.points_log = Number((await tx.prepare(
    `DELETE FROM points_log WHERE source = 'demo'`
  ).run()).changes || 0);

  counts.submissions = Number((await tx.prepare(
    `DELETE FROM submissions WHERE review_comment LIKE ?`
  ).run(`${DEMO_TAG}%`)).changes || 0);

  // points_summary 不按标记删 —— 它没有来源列，只能整体还原（见 restoreSummary）
  counts.points_summary = keepSummary ? 0 : await restoreSummary(tx);

  return counts;
}

// 还原累计积分：优先用备份文件里的原值，其次按确定性金额减回去并 clamp 到 0。
async function restoreSummary(tx) {
  let backup = null;
  if (fs.existsSync(BACKUP)) {
    try { backup = JSON.parse(fs.readFileSync(BACKUP, 'utf8')); } catch { backup = null; }
  }

  if (backup && Array.isArray(backup.pointsSummary)) {
    let n = 0;
    for (const row of backup.pointsSummary) {
      if (row.missing) {
        // 种之前这个人没有 points_summary 行 —— 整行删掉，恢复原状
        n += Number((await tx.prepare('DELETE FROM points_summary WHERE user_id = ?').run(row.user_id)).changes || 0);
      } else {
        n += Number((await tx.prepare(
          `UPDATE points_summary SET total_points = ?, module_points = ?, updated_at = ? WHERE user_id = ?`
        ).run(row.total_points, row.module_points, row.updated_at, row.user_id)).changes || 0);
      }
    }
    return n;
  }

  // 没有备份文件：把 demo 流水按 module_id 汇总后从 module_points 里减掉
  const rows = await tx.prepare(
    `SELECT user_id, module_id, COALESCE(SUM(points), 0) AS pts
       FROM points_log WHERE source = 'demo' AND type = 'award'
      GROUP BY user_id, module_id`
  ).all();

  let n = 0;
  for (const r of rows) {
    const row = await tx.prepare('SELECT * FROM points_summary WHERE user_id = ?').get(r.user_id);
    if (!row) continue;
    const mp = JSON.parse(row.module_points || '{}');
    const k = String(r.module_id);
    const next = Math.max(0, (Number(mp[k]) || 0) - Number(r.pts || 0));
    if (next > 0) mp[k] = next; else delete mp[k];
    const total = Math.max(0, Number(row.total_points || 0) - Number(r.pts || 0));
    n += Number((await tx.prepare(
      `UPDATE points_summary SET total_points = ?, module_points = ?, updated_at = ? WHERE user_id = ?`
    ).run(total, JSON.stringify(mp), now(), r.user_id)).changes || 0);
  }
  return n;
}

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------
async function seed(quarter) {
  const users = await listScorableUsers(db);
  if (users.length === 0) {
    console.log('没有参评人（listScorableUsers 为空），无事可做');
    return;
  }

  const dims = await db.prepare(
    `SELECT id, name, dimension_code, base_score FROM modules WHERE is_active = 1 ORDER BY sort_order`
  ).all();
  const allSubs = await db.prepare(
    `SELECT id, module_id, name, base_score, points FROM subcategories WHERE is_active = 1`
  ).all();
  const subsByDim = new Map();
  for (const s of allSubs) {
    if (!subsByDim.has(s.module_id)) subsByDim.set(s.module_id, []);
    subsByDim.get(s.module_id).push(s);
  }

  // 先清掉上一次跑的，再备份。
  //
  // 顺序不能反：cleanup 会**从备份还原** points_summary，所以备份必须反映"还没有
  // 任何 demo 数据"的状态。先备份的话，第二次跑时备份里存的已经是被上一次跑灌大的
  // 数字，还原就还原了个错的。
  await trx(async (tx) => { await cleanup(tx); });

  const backup = { quarter, takenAt: now(), pointsSummary: [] };
  for (const u of users) {
    const row = await db.prepare('SELECT * FROM points_summary WHERE user_id = ?').get(u.id);
    backup.pointsSummary.push(row
      ? { user_id: row.user_id, total_points: row.total_points, module_points: row.module_points, updated_at: row.updated_at }
      : { user_id: u.id, missing: true });
  }
  fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 1));

  let subsWritten = 0;
  let logsWritten = 0;

  await trx(async (tx) => {
    for (const u of users) {
      const R = rng(hashStr(u.employee_id || u.id));
      const at = makeTimeFactory(R);

      // 每个人的提交按时间排序后再写，让自增 id 与时间同序 —— 否则列表按 id 排
      // 会和按时间排不一致，看着像数据错乱。
      const rows = [];
      for (const dim of dims) {
        const frac = targetFraction(dim.dimension_code, R);
        if (frac <= 0) continue;
        for (const item of planSubmissions(dim, subsByDim.get(dim.id) || [], frac, R)) {
          rows.push({ dim, item, ts: at() });
        }
      }
      rows.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

      let seq = 0;
      for (const { dim, item, ts } of rows) {
        const desc = `${item.sub.name} — 本季度参与记录 ${++seq}`;
        const subRes = await tx.prepare(`
          INSERT INTO submissions
            (user_id, employee_id, employee_name, department, module_id, module_name,
             subcategory_name, description, photo_urls, status, points_awarded,
             reviewer_id, reviewer_name, review_comment, reviewed_at, created_at,
             month_year, quarter)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 'approved', ?, NULL, ?, ?, ?, ?, ?, ?)
        `).run(
          u.id, u.employee_id, u.name, u.department, dim.id, dim.name,
          item.sub.name, desc, item.points,
          DEMO_REVIEWER, `${DEMO_TAG} 本季度样本参与记录，用于季度排名演示`,
          ts, ts, monthKey(), quarter
        );
        const subId = Number(subRes.lastInsertRowid);
        subsWritten++;

        // points_log 是**算分的唯一输入**（utils/quarterly.js 按 quarter + module_id
        // 汇总它的签名净额）。source='demo' 既是判分来源、也是 --cleanup 的删除依据。
        // month_year 写真实当月只为满足 NOT NULL，季度归属读的是 quarter 列。
        await tx.prepare(`
          INSERT INTO points_log
            (user_id, employee_id, submission_id, module_id, module_name, subcategory_name,
             points, type, description, created_at, month_year, quarter, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'award', ?, ?, ?, ?, 'demo')
        `).run(
          u.id, u.employee_id, subId, dim.id, dim.name, item.sub.name,
          item.points, `${item.sub.name} - ${DEMO_TAG}`, ts, monthKey(), quarter
        );
        logsWritten++;

        await tx.prepare(`
          INSERT INTO quarterly_bonus_ledger
            (user_id, employee_id, quarter, dimension_id, module_id, module_name, submission_id, points, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(u.id, u.employee_id, quarter, dim.id, dim.id, dim.name, subId, item.points, ts);

        await tx.prepare(`
          INSERT INTO quarterly_score_log
            (user_id, employee_id, quarter, dimension_id, module_id, type, delta, reason,
             submission_id, actor_id, actor_name, created_at, source)
          VALUES (?, ?, ?, ?, ?, 'bonus', ?, ?, ?, NULL, ?, ?, 'demo')
        `).run(u.id, u.employee_id, quarter, dim.id, dim.id, item.points,
          `${DEMO_TAG} 样本数据`, subId, DEMO_REVIEWER, ts);

        // 累计积分（生命周期尺度，与季度分是两套数）。按字符串 module id 索引，
        // 与 admin.js 审核路径的写法一致。
        const summary = await tx.prepare('SELECT * FROM points_summary WHERE user_id = ?').get(u.id);
        const mk = String(dim.id);
        if (!summary) {
          await tx.prepare(`
            INSERT INTO points_summary (user_id, employee_id, total_points, module_points, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(u.id, u.employee_id, item.points, JSON.stringify({ [mk]: item.points }), ts);
        } else {
          const mp = JSON.parse(summary.module_points || '{}');
          mp[mk] = (Number(mp[mk]) || 0) + item.points;
          await tx.prepare(`
            UPDATE points_summary SET total_points = total_points + ?, module_points = ?, updated_at = ?
            WHERE user_id = ?
          `).run(item.points, JSON.stringify(mp), ts, u.id);
        }
      }
    }
  });

  console.log(`已写入样本数据（${formatQuarter(quarter)}）：`);
  console.log(`  参评人 ${users.length} 人 | 申请单 ${subsWritten} 条 | 积分流水 ${logsWritten} 条`);
  console.log(`  备份已存到 ${BACKUP}`);
  await status(quarter);
}

// ---------------------------------------------------------------------------
// 只读状态
// ---------------------------------------------------------------------------
async function status(quarter) {
  const demoLogs = await db.prepare(
    `SELECT COUNT(*) AS n FROM points_log WHERE source = 'demo'`
  ).get();
  const demoSubs = await db.prepare(
    `SELECT COUNT(*) AS n FROM submissions WHERE review_comment LIKE ?`
  ).get(`${DEMO_TAG}%`);
  const demoQsl = await db.prepare(
    `SELECT COUNT(*) AS n FROM quarterly_score_log WHERE source = 'demo'`
  ).get();
  const lock = await db.prepare(
    'SELECT COUNT(*) AS n FROM quarterly_reward_snapshots WHERE quarter = ?'
  ).get(quarter);

  console.log(`=== ${formatQuarter(quarter)} 样本数据状态 ===`);
  console.log(`  demo 积分流水   ${demoLogs.n} 条`);
  console.log(`  demo 申请单     ${demoSubs.n} 条`);
  console.log(`  demo 季度流水   ${demoQsl.n} 条`);
  console.log(`  备份文件        ${fs.existsSync(BACKUP) ? BACKUP : '（无）'}`);
  console.log(`  季度锁定快照    ${lock.n} 行${Number(lock.n) > 0 ? ' ← 已锁定，排名页会读快照而不是实时分' : ''}`);

  const users = await listScorableUsers(db);
  const scores = await buildQuarterlyScores(db, quarter, users.map(u => u.id));
  const rows = [...scores.values()].sort((a, b) => b.totalScore - a.totalScore);
  if (rows.length === 0) {
    console.log('  （没有参评人）');
    return;
  }
  const totals = rows.map(r => r.totalScore);
  console.log(`  实时分区间      ${Math.min(...totals)} ~ ${Math.max(...totals)} / 上限 ${rows[0].maxScore}（${rows.length} 人）`);
  const distinct = new Set(totals).size;
  console.log(`  不同分值        ${distinct} 种${distinct === 1 ? ' ← 全都一样，排名没有区分度' : ''}`);
  const zero = totals.filter(t => t === 0).length;
  if (zero > 0) console.log(`  0 分人数        ${zero} 人`);
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2);
  const mode = argv.find(a => a.startsWith('--') && a !== '--quarter');
  const qArg = argv.find(a => a.startsWith('--quarter='));
  const quarter = qArg ? qArg.split('=')[1] : quarterKey();

  if (!['--seed', '--status', '--cleanup', '--clear-lock'].includes(mode)) {
    console.log('用法: node scripts/demo-participation.js --status|--seed|--cleanup|--clear-lock [--quarter=2026-Q3]');
    process.exit(1);
  }
  if (!isValidQuarter(quarter)) {
    console.error(`季度格式无效：${quarter}（应为 YYYY-QN）`);
    process.exit(1);
  }

  await initDB();

  if (mode === '--status') {
    await status(quarter);
    return;
  }

  if (mode === '--clear-lock') {
    // 本机测试残留专用。生产正常情况下这里应该是 0 行 —— 删了就等于把已公示的
    // 排名作废，所以要把删掉的行数打出来，让人看清它到底动没动东西。
    const r = await db.prepare('DELETE FROM quarterly_reward_snapshots WHERE quarter = ?').run(quarter);
    console.log(`已删除 ${formatQuarter(quarter)} 的排名快照 ${Number(r.changes || 0)} 行`);
    if (Number(r.changes || 0) > 0) {
      console.log('  注意：这些是已锁定的排名记录。删掉之后排名页会改读实时分。');
    }
    return;
  }

  if (mode === '--cleanup') {
    let counts;
    await trx(async (tx) => { counts = await cleanup(tx); });
    console.log(`已清除样本数据（${formatQuarter(quarter)}）：`);
    for (const [t, n] of Object.entries(counts)) console.log(`  ${t.padEnd(24)} -${n}`);
    if (!fs.existsSync(BACKUP)) {
      console.log('  备份文件不存在，累计积分是按确定性金额减回去的，请抽查 points_summary');
    } else {
      console.log('  累计积分已整行还原到灌数据之前的值 —— 样本数据存在期间的正式审核/作假，');
      console.log('  如果动过这 30 个人的累计积分，也一并被还原了，需要的话请单独补录。');
    }
    await status(quarter);
    return;
  }

  await seed(quarter);
}

main().catch(e => {
  console.error('执行失败：', e && e.message ? e.message : e);
  process.exit(1);
});
