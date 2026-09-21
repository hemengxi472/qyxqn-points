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
const {
  quarterKey, monthKey, isValidQuarter, formatQuarter,
  isScoredQuarter, SCORING_START_QUARTER
} = require('../utils/quarter');

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
// 三条约束，改之前先读完：
//
// ① **有健康、有纪律两个维度铺厚一点**（用户："有健康和有纪录分多一点"）。
//    健康是对外的样板维度，纪律是试运行期最想立起来的规矩，这两个分高。
//
// ② **但不要统一** —— 区间本身给足随机。"健康人人都 70 分"这种整齐数据
//    一眼假，而且排名会失去区分度，那就白铺了。
//
// ③ **下界不是 0**，且 planSubmissions 里另有"每子项至少 1 次"的兜底。
//    上一版公式是 Math.max(0, R() * 0.75 - 0.12)，会抽出 0，结果是 30 人里
//    有 9~14 人在有本领/有成长/有智慧/有担当/有纪律 上整个维度是 0 分 ——
//    员工端看到一片 0。**别再改回带 0 的抽样。**
//
// 目标：总分最高落在 400 多（用户："分数最高控制在400多分左右"），30 人各不相同。
//
// 当前这套区间实测（2026-09，30 名参评人）：均值 353.7、标准差 35.6、
// 区间 285~430、21 种不同分值。调完记得重跑 --status 复核这四个数。
//
// 想再抬高就把 health 的 lo/span 往上调，**别**把六个区间一起加 —— 一起加会把
// 最低分也顶上去，30 个人的分布会挤成一团，排名反而更没区分度。
//
// 天花板余量：健康最高 92 / 维度上限 110 → 留 18 分，够扛一条 10 分的审核通过。
// 这是「最高 400 多」和「现场可演示」折中后的结果，想留更多余量就得压低最高分。
// ---------------------------------------------------------------------------
const DIM_FRACTION = {
  health:     { lo: 0.58, span: 0.34 },  // 58~92
  discipline: { lo: 0.48, span: 0.40 },  // 48~88
};

function targetFraction(dimCode, R) {
  const { lo, span } = DIM_FRACTION[dimCode] ?? { lo: 0.33, span: 0.35 }; // 33~68
  return lo + R() * span;
}

// 整个季度不参与的人数（总分 0、六个维度全 0）。
//
// 用户要求「允许少部分人为 0」。全员都有分反而不可信 —— 真实的一个季度里总有
// 人出差、借调、或者干脆没参加，排名表末尾有几个 0 才像真的。
//
// 与 planSubmissions 里「每子项至少 1 次」的兜底**不矛盾**，两者针对的是不同的
// 东西：那条兜底是防止**参与者**某个维度意外为 0（那看着像程序出错），这里是
// **整人**不参与，是有意为之的 0。改的时候别把一个当成另一个的例外。
//
// 固定人数而非按比例抽签：比例抽签这一次可能抽出 1 个、下一次 5 个，
// 演示前没法预知台上会看到几个 0。30 人取 3 人 ≈ 10%。
const NON_PARTICIPANT_COUNT = 3;

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

  // 选出本季度不参与的人：按 'nonpart:' + 工号的哈希排序取前 N 个。
  //
  // 用独立的哈希而不是复用每人那个 R：R 在下面的循环里是一条被按顺序消费的
  // 随机流，在这里先抽一次会把所有人的后续取值整体错位，样本数据全变。
  // 这个名单也与人无关地稳定，换季度重跑仍是同一批人。
  const nonPart = new Set(
    [...users]
      .sort((a, b) =>
        hashStr('nonpart:' + (a.employee_id || a.id)) -
        hashStr('nonpart:' + (b.employee_id || b.id)))
      .slice(0, NON_PARTICIPANT_COUNT)
      .map(u => u.id)
  );

  let subsWritten = 0;
  let logsWritten = 0;

  await trx(async (tx) => {
    for (const u of users) {
      // 不参与的人一条记录都不写 —— 六个维度天然为 0，总分 0。
      // 不需要"把分数设成 0"这步：分数是算出来的，没有流水就是 0。
      if (nonPart.has(u.id)) continue;

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

  const idle = users.filter(u => nonPart.has(u.id));
  console.log(`已写入样本数据（${formatQuarter(quarter)}）：`);
  console.log(`  参评人 ${users.length} 人 | 申请单 ${subsWritten} 条 | 积分流水 ${logsWritten} 条`);
  console.log(`  本季度未参与 ${idle.length} 人（0 分）：${idle.map(u => u.name).join('、')}`);
  console.log(`  备份已存到 ${BACKUP}`);
  const report = await status(quarter);

  // 返回结构化结果给 HTTP 路由用（CLI 不看返回值，只看上面的输出）
  return {
    quarter,
    scorableUsers: users.length,
    submissions: subsWritten,
    pointsLogs: logsWritten,
    nonParticipants: idle.map(u => u.name),
    backupFile: BACKUP,
    ...report
  };
}

// ---------------------------------------------------------------------------
// 只读状态
// ---------------------------------------------------------------------------
async function status(quarter) {
  // 三个计数都按季度过滤。以前它们不带 quarter 条件，于是 `--status --quarter=2026-Q2`
  // 会报出本季度的 1121 条样本数据 —— 明明那季度一条都没有。标题写着季度、数字却是
  // 全局的，看到的人只会得出"上个季度也灌了 1121 条"这个错误结论。
  const demoLogs = await db.prepare(
    `SELECT COUNT(*) AS n FROM points_log WHERE source = 'demo' AND quarter = ?`
  ).get(quarter);
  const demoSubs = await db.prepare(
    `SELECT COUNT(*) AS n FROM submissions WHERE review_comment LIKE ? AND quarter = ?`
  ).get(`${DEMO_TAG}%`, quarter);
  const demoQsl = await db.prepare(
    `SELECT COUNT(*) AS n FROM quarterly_score_log WHERE source = 'demo' AND quarter = ?`
  ).get(quarter);
  const lock = await db.prepare(
    'SELECT COUNT(*) AS n FROM quarterly_reward_snapshots WHERE quarter = ?'
  ).get(quarter);

  console.log(`=== ${formatQuarter(quarter)} 样本数据状态 ===`);
  if (!isScoredQuarter(quarter)) {
    console.log(`  该季度在计分起点（${formatQuarter(SCORING_START_QUARTER)}）之前，不计分，下面一律 0。`);
  }
  console.log(`  demo 积分流水   ${demoLogs.n} 条`);
  console.log(`  demo 申请单     ${demoSubs.n} 条`);
  console.log(`  demo 季度流水   ${demoQsl.n} 条`);
  console.log(`  备份文件        ${fs.existsSync(BACKUP) ? BACKUP : '（无）'}`);
  console.log(`  季度锁定快照    ${lock.n} 行${Number(lock.n) > 0 ? ' ← 已锁定，排名页会读快照而不是实时分' : ''}`);

  // 返回结构化状态给 HTTP 路由用；CLI 忽略返回值，只看上面的打印。
  const base = {
    demoPointsLogs: Number(demoLogs.n),
    demoSubmissions: Number(demoSubs.n),
    demoQuarterlyLogs: Number(demoQsl.n),
    backupFile: fs.existsSync(BACKUP) ? BACKUP : null,
    lockedSnapshotRows: Number(lock.n),
    scorableUsers: 0,
    minScore: 0,
    maxScore: 0,
    distinctScores: 0,
    zeroScoreUsers: 0
  };

  const users = await listScorableUsers(db);
  const scores = await buildQuarterlyScores(db, quarter, users.map(u => u.id));
  const rows = [...scores.values()].sort((a, b) => b.totalScore - a.totalScore);
  if (rows.length === 0) {
    console.log('  （没有参评人）');
    return base;
  }
  const totals = rows.map(r => r.totalScore);
  const stats = {
    ...base,
    scorableUsers: rows.length,
    minScore: Math.min(...totals),
    // maxScore 是**实际最高分**，ceiling 才是理论上限（760）。
    // 两者混用会让界面显示"分数区间 0 ~ 760"，那是天花板不是任何人的分。
    maxScore: Math.max(...totals),
    ceiling: rows[0].maxScore,
    distinctScores: new Set(totals).size,
    zeroScoreUsers: totals.filter(t => t === 0).length
  };
  console.log(`  实时分区间      ${stats.minScore} ~ ${stats.maxScore} / 上限 ${stats.ceiling}（${rows.length} 人）`);

  // 计分起点之前的季度必然是"30 人全 0、只有 1 种分值"，这两句本来就是为
  // 本季度诊断用的，照打出来只会让人以为样本数据没灌进去。上面已经写明原因了。
  if (!isScoredQuarter(quarter)) return stats;

  console.log(`  不同分值        ${stats.distinctScores} 种${stats.distinctScores === 1 ? ' ← 全都一样，排名没有区分度' : ''}`);
  if (stats.zeroScoreUsers > 0) console.log(`  0 分人数        ${stats.zeroScoreUsers} 人`);
  return stats;
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

  // 计分起点是 2026-Q3（见 utils/quarter.js）。往这之前灌样本数据是有害的：
  // 数据写进去了、累计积分也涨了，季度页却全按 0 显示，看上去像"脚本灌失败了"。
  // 与其让人对着一个必然为 0 的结果排查，不如在这里直接拒绝。
  // --status 放行 —— 看一眼旧季度是合法需求。
  if (mode !== '--status' && !isScoredQuarter(quarter)) {
    console.error(
      `${formatQuarter(quarter)} 在计分起点（${formatQuarter(SCORING_START_QUARTER)}）之前，不计分，不能灌样本数据。`
    );
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

// 只有直接 `node scripts/demo-participation.js` 时才跑 CLI。
//
// 没有这个判断的话，服务端 `require` 这个文件来复用 seed/cleanup 会顺带执行
// 一次 main()：它去读 process.argv（那是 Node 自己的参数，不是脚本参数），
// 匹配不到任何模式就打印用法然后 process.exit(1) —— **把整个服务进程干掉**。
if (require.main === module) {
  main().catch(e => {
    console.error('执行失败：', e && e.message ? e.message : e);
    process.exit(1);
  });
}

// 给 server/routes/demo.js 复用。CLI 与 HTTP 两条路走的是同一份实现，
// 不复制逻辑 —— 复制出来的第二份迟早在"哪些行算 demo 数据"上跟第一份分叉。
//
// cleanupAll 而不是直接导出 cleanup：后者要求调用方自己开事务（CLI 里是
// `trx(async tx => cleanup(tx))`）。让 HTTP 路由去记这件事，就是同一个坑挖两次。
module.exports = {
  seed,
  status,
  cleanupAll: async () => {
    let counts;
    await trx(async (tx) => { counts = await cleanup(tx); });
    return counts;
  }
};
