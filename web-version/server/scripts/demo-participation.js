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
//   1) **只删自己写的东西**。所有写入都带**不可见**的来源标记 ——
//      points_log.source='demo'、quarterly_score_log.source='demo'，提交单靠
//      points_log 里的 submission_id 反查。可见字段（评审意见、描述、审核人）不再
//      带任何 [DEMO]/「演示」字样 —— 数据要长得和真实提交一模一样。--cleanup 只按
//      这些不可见标记删，不碰任何真实数据。
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

// 真实评审意见：真实审核时管理员随手写的短评。取一个小集合按人轮换，上千条记录
// 不能全部一字不差 —— 全一样的评语一眼就是生成的。
const REVIEW_COMMENTS = [
  '材料齐全，符合加分条件',
  '情况属实，同意加分',
  '已核实，按标准加分',
  '记录完整，予以通过',
];

// 员工提交时自己填写的活动描述。真实提交的 description 是自由文本，这里给每个
// 子项一句符合语境的描述，替代原来「本季度参与记录 1/2/3」那种一眼假的编号描述。
// 找不到对应子项时退回一个通用说法。
const SUB_DESCRIPTIONS = {
  身体健康: '坚持每日健康打卡',
  心理健康: '参加心理健康活动',
  专业扎实: '完成专业培训学习',
  高效执行: '高效完成工作任务',
  跨界学习: '参加跨界学习分享',
  持续成长: '制定并落实成长计划',
  自信自强: '参与自信自强主题活动',
  品质修养: '践行品质修养要求',
  全局思维: '提出全局优化建议',
  职业规划: '完善个人职业规划',
  难题破解: '参与难题攻关',
  岗位履职担当: '认真履行岗位职责',
  团队协同担当: '积极配合团队工作',
  青年志愿担当: '参加青年志愿活动',
  合规纪律: '参加合规纪律宣讲',
  职业操守: '严格遵守职业操守',
  自我管理: '自觉遵守考勤制度',
};

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
// 用户要求（本次调整）：有健康、有纪律铺厚，其余四个「很少很少」。
//
// 为什么这么切：健康（打卡）和纪律（考勤/合规）是试运行期人人都在做、也最该做的
// 日常维度；而本领/成长/智慧/担当需要实际成果（获奖、攻关、牵头项目），真实试运行
// 期参与度天然很低。所以这两个给高、其余四个给到极低，排名看着才像真季度。
//
// 其余四个给的是个**很低的完成度**（4~16%），配合 planSubmissions 里不再有
// "每子项至少 1 次"的兜底 —— round 出来多是 0 次，整个维度经常只有一两笔甚至为 0，
// 相对健康/纪律只是零头。这不是 bug，是有意为之的稀疏。
//
// 上界为什么不超过 92：维度上限 = 100 + bonus_cap（健康是 110），留 ~18 分余量，
// 够演示现场再真实提交并审核通过一条，不被 BONUS_CAP_EXCEEDED 顶回来。
// ---------------------------------------------------------------------------
const DIM_FRACTION = {
  health:     { lo: 0.62, span: 0.28 },  // 62~90 — 样板维度，铺厚
  discipline: { lo: 0.55, span: 0.33 },  // 55~88 — 试运行立规矩，铺厚
};
// 其余四个维度共用的默认完成度。给得够低，让它们成为健康/纪律的零头。
const SPARSE = { lo: 0.04, span: 0.12 }; // 4~16%

function targetFraction(dimCode, R) {
  const { lo, span } = DIM_FRACTION[dimCode] ?? SPARSE;
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
// 没有次数下界：round(want / per) 可能是 0，这个子项就不写记录 —— 这正是
// 「其余维度很少很少」要的效果：上进维度完成度给得低，多数子项是 0 次；
// 而健康/纪律完成度高，每个子项自然有多次。cap 为 0 的子项（分值为 0、
// 或基础分不够一次）在前一行就跳过了。
function planSubmissions(dim, subs, frac, R) {
  const plan = [];
  for (const m of subs) {
    const per = Number(m.points) || 0;
    if (per <= 0) continue; // 分值为 0 的子项无从计算，跳过（db.js 的 SUB_POINT_FIX 会补上）
    const cap = Math.floor((Number(m.base_score) || 0) / per);
    if (cap <= 0) continue;
    const want = (Number(m.base_score) || 0) * frac;
    const count = Math.min(cap, Math.round(want / per));
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

  // 先收集要删的 demo 提交 id —— ledger 和 score_log 都要按它级联。
  // 从 points_log 反查（source='demo' 且带 submission_id），不再靠 review_comment
  // 里可见的 [DEMO] 标记 —— 现在那些可见字段已经和真实提交长得一样了。
  const subRows = await tx.prepare(
    `SELECT DISTINCT submission_id AS id FROM points_log WHERE source = 'demo' AND submission_id IS NOT NULL`
  ).all();
  const subIds = subRows.map(r => Number(r.id)).filter(id => id > 0);

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

  counts.submissions = subIds.length > 0
    ? Number((await tx.prepare(
        `DELETE FROM submissions WHERE id IN (${subIds.map(() => '?').join(',')})`
      ).run(...subIds)).changes || 0)
    : 0;

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

  // 审核人取真实的超管账号（id + name），和真实审核路径 admin.js 里 reviewer.name
  // 保持一致 —— 数据里的 reviewer 是真人名，而不是「示例数据」。
  const admin = await db.prepare(
    `SELECT id, name FROM users WHERE role = 'superadmin' ORDER BY id LIMIT 1`
  ).get();
  const reviewerId = admin?.id ?? null;
  const reviewerName = admin?.name || '管理员';

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

      for (const { dim, item, ts } of rows) {
        const desc = SUB_DESCRIPTIONS[item.sub.name] || `本季度${item.sub.name}参与记录`;
        const comment = REVIEW_COMMENTS[Math.floor(R() * REVIEW_COMMENTS.length)];
        const subRes = await tx.prepare(`
          INSERT INTO submissions
            (user_id, employee_id, employee_name, department, module_id, module_name,
             subcategory_name, description, photo_urls, status, points_awarded,
             reviewer_id, reviewer_name, review_comment, reviewed_at, created_at,
             month_year, quarter)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 'approved', ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          u.id, u.employee_id, u.name, u.department, dim.id, dim.name,
          item.sub.name, desc, item.points,
          reviewerId, reviewerName, comment,
          ts, ts, monthKey(), quarter
        );
        const subId = Number(subRes.lastInsertRowid);
        subsWritten++;

        // points_log 是**算分的唯一输入**（utils/quarterly.js 按 quarter + module_id
        // 汇总它的签名净额）。source='demo' 既是判分来源、也是 --cleanup 的删除依据
        // （不可见标记，可见的 description 与真实提交同格式）。
        // month_year 写真实当月只为满足 NOT NULL，季度归属读的是 quarter 列。
        await tx.prepare(`
          INSERT INTO points_log
            (user_id, employee_id, submission_id, module_id, module_name, subcategory_name,
             points, type, description, created_at, month_year, quarter, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'award', ?, ?, ?, ?, 'demo')
        `).run(
          u.id, u.employee_id, subId, dim.id, dim.name, item.sub.name,
          item.points, `${item.sub.name} - ${desc}`, ts, monthKey(), quarter
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
          VALUES (?, ?, ?, ?, ?, 'bonus', ?, ?, ?, ?, ?, ?, 'demo')
        `).run(u.id, u.employee_id, quarter, dim.id, dim.id, item.points,
          '审核通过加分', subId, reviewerId, reviewerName, ts);

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
    `SELECT COUNT(DISTINCT submission_id) AS n FROM points_log WHERE source = 'demo' AND quarter = ? AND submission_id IS NOT NULL`
  ).get(quarter);
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
