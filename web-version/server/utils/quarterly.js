// 季度评分计算。
//
// 计分模型：
//   模块得分 = max(0, 模块基础分 − 扣分)
//   维度得分 = Σ模块得分 + min(该维度加分合计, 该维度加分上限)
//   刚性归零 → 该维度直接 0 分（已入账的加分不删除，标记解除后自动恢复）
//   季度总分 = 六个维度之和
//
// 扣分只写 quarterly_module_scores 和 quarterly_score_log，不碰 points_log /
// monthly_points / fraud_records / points_summary。所以"季度分"和"累计积分"
// 是两个不同尺度的数，UI 必须分区展示，不能相加。
//
// 加分的两个来源：
//   1. quarterly_bonus_ledger —— 审核通过的个人加分申请，一次申请一行
//   2. points_log WHERE source='team_task' —— 团队任务发放的 5 分
// 二者在本文件的 bonusMap / grantedBonus 里合并。**两条代码路径必须保持字面
// 一致的过滤条件**，否则会出现"审核说还能加 5 分，加完却没变化"。

const { quarterBounds } = require('./quarter');

// 团队任务分计入维度加分上限（决策 #5：占用「有纪律」20 分额度）。
// 单独成常量是为了让批量查询和单点查询共用同一段 WHERE，不会漂移。
const TEAM_TASK_BONUS_WHERE = "quarter = ? AND source = 'team_task' AND type = 'award'";

// 模块得分不落库，一律现算 —— 存了就是第二个真相源，必然漂移。
function moduleScore(baseScore, deduction) {
  return Math.max(0, Number(baseScore || 0) - Number(deduction || 0));
}

// 模块口径的排序 / 索引键
function key(userId, id) {
  return `${userId}:${id}`;
}

// 拉取一个季度的全部输入数据，组装成结构化结果。
// userIds 为 null 时返回空 Map（调用方按需传入要算的人）。
async function buildQuarterlyScores(db, quarter, userIds = null) {
  const dims = await db.prepare(
    `SELECT id, name, icon, dimension_code, base_score, bonus_cap, has_hard_zero, sort_order
       FROM modules WHERE is_active = 1 ORDER BY sort_order`
  ).all();

  const mods = await db.prepare(
    `SELECT id, module_id, name, base_score, bonus_cap
       FROM subcategories WHERE is_active = 1 ORDER BY sort_order`
  ).all();

  const dedRows = await db.prepare(
    'SELECT user_id, module_id, deduction FROM quarterly_module_scores WHERE quarter = ?'
  ).all(quarter);

  const bonusRows = await db.prepare(
    `SELECT user_id, dimension_id, COALESCE(SUM(points), 0) AS total
       FROM quarterly_bonus_ledger WHERE quarter = ? GROUP BY user_id, dimension_id`
  ).all(quarter);

  // 团队任务的 5 分不在 ledger 里（一次团队审核给 N 人各发 5 分，会撞上
  // ledger 的 UNIQUE(submission_id)），所以在算分路径上单独批量查一次再折进
  // bonusMap。这里必须用批量查询：buildQuarterlyScores 是全量算分的，
  // 按人按维度调 N×6 次单点查询会把 /quarterly/ranking 拖成几百次往返。
  //
  // points_log.module_id 是 modules.id 空间，ledger.dimension_id 也是（admin.js
  // 审核时把 sub.module_id 同时传给了这两列）。所以两个来源能按下标对齐 ——
  // 这个对齐是刻意的，不要"清理"审核路径里的那次重复传参。
  const teamRows = await db.prepare(
    `SELECT user_id, module_id AS dimension_id, COALESCE(SUM(points), 0) AS total
       FROM points_log WHERE ${TEAM_TASK_BONUS_WHERE} GROUP BY user_id, module_id`
  ).all(quarter);

  const statusRows = await db.prepare(
    `SELECT user_id, dimension_id, hard_zero, reward_ineligible, reason
       FROM quarterly_dimension_status WHERE quarter = ?`
  ).all(quarter);

  // 作假是**派生**的归零，不落 quarterly_dimension_status：删掉 fraud_records
  // 行分数就自己回来，不用反算当初归零了哪几个维度；也不会把该员工「有纪律」
  // 上一条已存在的人工归零行盖掉。
  const fraudRows = await db.prepare(
    'SELECT user_id, reason FROM fraud_records WHERE quarter = ?'
  ).all(quarter);

  const dedMap = new Map();
  for (const r of dedRows) dedMap.set(key(r.user_id, r.module_id), Number(r.deduction) || 0);

  const bonusMap = new Map();
  for (const r of bonusRows) bonusMap.set(key(r.user_id, r.dimension_id), Number(r.total) || 0);
  for (const r of teamRows) {
    const k = key(r.user_id, r.dimension_id);
    bonusMap.set(k, (bonusMap.get(k) || 0) + (Number(r.total) || 0));
  }

  const statusMap = new Map();
  for (const r of statusRows) statusMap.set(key(r.user_id, r.dimension_id), r);

  const fraudMap = new Map();
  for (const r of fraudRows) if (!fraudMap.has(r.user_id)) fraudMap.set(r.user_id, r.reason || '');

  const modsByDim = new Map();
  for (const m of mods) {
    if (!modsByDim.has(m.module_id)) modsByDim.set(m.module_id, []);
    modsByDim.get(m.module_id).push(m);
  }

  // 满分 = Σ(维度基础分 + 维度加分上限)
  const maxScore = dims.reduce(
    (s, d) => s + Number(d.base_score || 0) + Number(d.bonus_cap || 0), 0
  );

  const result = new Map();
  for (const uid of userIds || []) {
    // 本季度有作假记录 → 六个维度全部归零、取消奖励资格。
    // fraudZero 与 hardZero 分开：界面上 hardZeroCount=6 会读成"刚性归零 6 项"，
    // 而事实上那是一次作假事件，不是六次人工操作。
    const fraudHit = fraudMap.has(uid);
    const fraudReason = fraudHit ? (fraudMap.get(uid) || '') : '';

    const dimensions = dims.map(d => {
      const status = statusMap.get(key(uid, d.id));
      const hardZero = fraudHit || !!(status && status.hard_zero);

      let moduleBaseTotal = 0;
      let deductionTotal = 0;
      const modules = (modsByDim.get(d.id) || []).map(m => {
        const deduction = dedMap.get(key(uid, m.id)) || 0;
        const score = moduleScore(m.base_score, deduction);
        moduleBaseTotal += score;
        deductionTotal += deduction;
        return {
          moduleId: m.id,
          moduleName: m.name,
          baseScore: Number(m.base_score) || 0,
          bonusCap: Number(m.bonus_cap) || 0,
          deduction,
          score,
          bonus: 0 // 下方按维度汇总填充
        };
      });

      const bonusTotal = bonusMap.get(key(uid, d.id)) || 0;
      const bonusCap = Number(d.bonus_cap) || 0;
      const bonusApplied = Math.min(bonusTotal, bonusCap);

      return {
        dimensionId: d.id,
        dimensionCode: d.dimension_code,
        name: d.name,
        icon: d.icon,
        baseTotal: Number(d.base_score) || 0,
        bonusCap,
        moduleBaseTotal,
        deductionTotal,
        bonusTotal,
        bonusApplied,
        // 前端据此决定要不要渲染刚性归零开关 —— 只有配了 has_hard_zero 的维度
        // 才该出现这个按钮，否则点下去只会拿到 400
        hasHardZero: !!d.has_hard_zero,
        hardZero,
        fraudZero: fraudHit,
        // 作假的归零原因优先：它是季度级的事实，人工归零的原因只在没作假时才有意义
        hardZeroReason: fraudHit ? `弄虚作假：${fraudReason || '未填写原因'}`
          : (hardZero ? (status.reason || '') : ''),
        rewardIneligible: fraudHit || !!(status && status.reward_ineligible),
        score: hardZero ? 0 : moduleBaseTotal + bonusApplied,
        modules
      };
    });

    const totalScore = dimensions.reduce((s, d) => s + d.score, 0);
    result.set(uid, {
      quarter,
      totalScore,
      maxScore,
      eligible: !dimensions.some(d => d.rewardIneligible),
      // 作假归零是六个维度一起的，不是六次刚性归零。分开计数，否则排名表的
      // 「归零项数」列会把一次作假显示成"刚性归零 6 项"。
      hardZeroCount: fraudHit ? 0 : dimensions.filter(d => d.hardZero).length,
      fraudZero: fraudHit,
      fraudReason,
      dimensions
    });
  }

  return result;
}

// 加分上限校验用：某人某季度某维度已入账的加分合计。
//
// 与 buildQuarterlyScores 的 bonusMap 是**两条独立路径**（那边是全量批量，
// 这边是单点），必须给出同样的数。过滤条件两处共用 TEAM_TASK_BONUS_WHERE，
// 改动时请同时验证两边 —— 只改一边的症状是"审核说还能加 5 分，加完没变化"。
async function grantedBonus(db, userId, quarter, dimensionId) {
  const row = await db.prepare(
    `SELECT COALESCE(SUM(points), 0) AS g FROM quarterly_bonus_ledger
      WHERE user_id = ? AND quarter = ? AND dimension_id = ?`
  ).get(userId, quarter, dimensionId);

  const team = await db.prepare(
    `SELECT COALESCE(SUM(points), 0) AS g FROM points_log
      WHERE user_id = ? AND module_id = ? AND ${TEAM_TASK_BONUS_WHERE}`
  ).get(userId, dimensionId, quarter);

  return (Number(row ? row.g : 0) || 0) + (Number(team ? team.g : 0) || 0);
}

// 季度内的活跃员工（参与评分的对象）
async function listScorableUsers(db) {
  return db.prepare(
    `SELECT id, employee_id, name, department FROM users
      WHERE status = 'active' ORDER BY department, name`
  ).all();
}

module.exports = {
  buildQuarterlyScores,
  grantedBonus,
  listScorableUsers,
  moduleScore,
  quarterBounds
};
