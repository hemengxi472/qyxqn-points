// 季度评分计算。
//
// 计分模型（累加制）：
//   维度累计 = Σ signed(points_log)   -- 'award' 记正、'deduct' 记负
//   维度扣分 = Σ quarterly_module_scores.deduction（该维度下属子项的人工扣分）
//   维度得分 = (fraudZero || hardZero) ? 0
//                                     : min( max(0, 维度累计 − 维度扣分), 100 + 维度加分上限 )
//   季度总分 = 六个维度之和
//   上限     = Σ(100 + 维度加分上限) = 760
//
// 为什么改掉了扣分制：老模型季初默认送出 subcategories.base_score，于是每个人
// 每个维度都恰好 100 分、季度总分永远是 600 —— 排名没有任何区分度。现在基础分
// 不再默认送出，什么都不参加的人得 0 分。modules.base_score（100）只作为上限
// 公式里的常数项存在；subcategories.base_score（60/40…）降级为展示字段，与
// subcategories.bonus_cap 的地位相同，UI 上应称作「本项上限」。
//
// 扣分功能**没有**取消：表2 里「未达标扣对应分值」「弄虚作假视情节大幅扣分」
// 是规范条款，刚性归零也是表2 明写的。改的是「不再默认扣」，不是删掉扣分。
// 所以 quarterly_module_scores / PUT /quarterly/score / 刚性归零全部保留。
//
// 两条必须守住的口径：
//   1) 必须用**签名净额**，不能只 WHERE type='award'。撤销审核的回收写成
//      type='deduct'（见 admin.js 的 revert 分支），只看 award 会把一笔
//      「加 10 又撤 6」记成 10，真值是 4。
//   2) points_log.module_id 是**维度 id**（modules.id），不是子项 id —— 审核路径
//      把 sub.module_id 传给了它，而 sub.module_id 指向的本来就是维度（见
//      admin.js 里那次刻意的重复传参）。所以维度口径直接可用；子项口径没有 id
//      可依，只能靠 subcategory_name 归集，见 buildQuarterlyScores 的注释。
//
// 「季度分」和「累计积分」（points_summary）是两个不同尺度的数，UI 必须分区
// 展示，不能相加。本文件的任何查询都不写 points_summary。

const { quarterBounds, isScoredQuarter } = require('./quarter');

// 签名净额的聚合表达式。批量与单点共用，避免两处 SQL 漂移。
const NET_SUM = "COALESCE(SUM(CASE WHEN type = 'award' THEN points ELSE -points END), 0)";
const NET_TYPES = "type IN ('award', 'deduct')";

// 维度 / 子项口径的排序索引键
function key(userId, id) {
  return `${userId}:${id}`;
}

// 子项归集键：必须带上维度 id —— 不同维度理论上可以有同名子项，
// 只按名字归集会把他们并成一项。
function subKey(userId, dimensionId, subName) {
  return `${userId}:${dimensionId}:${subName || ''}`;
}

// 拉取一个季度的全部输入数据，组装成结构化结果。
// userIds 为 null 时返回空 Map（调用方按需传入要算的人）。
async function buildQuarterlyScores(db, quarter, userIds = null) {
  const dims = await db.prepare(
    `SELECT id, name, icon, dimension_code, base_score, bonus_cap, has_hard_zero, sort_order
       FROM modules WHERE is_active = 1 ORDER BY sort_order`
  ).all();

  const mods = await db.prepare(
    `SELECT id, module_id, name, base_score
       FROM subcategories WHERE is_active = 1 ORDER BY sort_order`
  ).all();

  // 计分起点之前一律 0 分、不做积分（见 utils/quarter.js 的 SCORING_START_QUARTER）。
  //
  // 做法是把**全部输入置空**，而不是算完之后再把结果改成 0：分值是「累计 − 扣分」
  // 推出来的，只改输出的话，维度里的 earned / deductionTotal / 子项明细仍然是真值，
  // 界面会出现「维度 0 分、点开明细每项都有分」这种读不通的状态。输入为空，
  // 六个维度、全部子项、上限和 ceiling 之外的一切自然都是 0，口径唯一。
  //
  // 上限（ceiling / maxScore）**保持原值**：那是维度的属性，不是某季度的得分。
  // 之前季度的界面因此显示「0 / 上限 110」，读起来正是「这一季没计分」。
  const scored = isScoredQuarter(quarter);

  const dedRows = scored ? await db.prepare(
    'SELECT user_id, module_id, deduction FROM quarterly_module_scores WHERE quarter = ?'
  ).all(quarter) : [];

  // 维度累计：唯一的算分输入。
  //
  // 这里刻意不再读 quarterly_bonus_ledger —— points_log 已经含了全部加分（个人
  // 审核、团队任务发放、以及撤销审核的负向回收），再叠一次 ledger 就是重复计数。
  // ledger 从此只作为审核留痕，不参与算分。
  //
  // 顺带一提，老代码在这里有一段把 source='team_task' 单独折进 bonusMap 的特判，
  // 现在删掉了：团队任务行本来就在 points_log 里，被这个查询自然覆盖。
  //
  // 遗留行的 module_id 是 4（旧「纪律」），不落在任何在用维度上，自动被忽略 ——
  // 这是对的，不要去"救"它们（与「遗留 key 不重写」的原则一致）。
  const earnRows = scored ? await db.prepare(
    `SELECT user_id, module_id AS dimension_id, ${NET_SUM} AS net
       FROM points_log
      WHERE quarter = ? AND ${NET_TYPES}
      GROUP BY user_id, module_id`
  ).all(quarter) : [];

  // 子项明细：points_log 没有子项 id，只能按 subcategory_name 归集。
  // 按 subcategory_name 归集的**只用于展示**，维度的权威值永远是上面的 earnRows：
  // 名字对不上在用子项的历史行（旧命名、团队任务行）会落在明细之外，所以子项之和
  // 不保证等于维度合计。UI 上必须写明这一点，别让它看起来像个算错。
  //
  // 用一次批量查询而不是按人按维度调 N×6 次 —— buildQuarterlyScores 是全量算分的，
  // 单点查询会把 /quarterly/ranking 拖成几百次往返。
  const subRows = scored ? await db.prepare(
    `SELECT user_id, module_id, subcategory_name, ${NET_SUM} AS net
       FROM points_log
      WHERE quarter = ? AND ${NET_TYPES}
      GROUP BY user_id, module_id, subcategory_name`
  ).all(quarter) : [];

  const statusRows = scored ? await db.prepare(
    `SELECT user_id, dimension_id, hard_zero, reward_ineligible, reason
       FROM quarterly_dimension_status WHERE quarter = ?`
  ).all(quarter) : [];

  // 作假是**派生**的归零，不落 quarterly_dimension_status：删掉 fraud_records
  // 行分数就自己回来，不用反算当初归零了哪几个维度；也不会把该员工「有纪律」
  // 上一条已存在的人工归零行盖掉。
  const fraudRows = scored ? await db.prepare(
    'SELECT user_id, reason FROM fraud_records WHERE quarter = ?'
  ).all(quarter) : [];

  const dedMap = new Map();
  for (const r of dedRows) dedMap.set(key(r.user_id, r.module_id), Number(r.deduction) || 0);

  const earnMap = new Map();
  for (const r of earnRows) earnMap.set(key(r.user_id, r.dimension_id), Number(r.net) || 0);

  const subMap = new Map();
  for (const r of subRows) {
    subMap.set(subKey(r.user_id, r.module_id, r.subcategory_name), Number(r.net) || 0);
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

  // 上限 = Σ(维度基础分 + 维度加分上限)。这是天花板，不是目标值 —— 累加制下
  // 没人拿得到，UI 上必须写「上限」而不是「满分」。
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

      const baseTotal = Number(d.base_score) || 0;
      const bonusCap = Number(d.bonus_cap) || 0;
      const ceiling = baseTotal + bonusCap;

      // 维度累计取原始净额（不 clamp）：UI 上「已得」要能看到真实入账，
      // 扣成负数时由 max(0, …) 在 score 里兜底。
      const earned = earnMap.get(key(uid, d.id)) || 0;
      const deductionTotal = (modsByDim.get(d.id) || [])
        .reduce((s, m) => s + (dedMap.get(key(uid, m.id)) || 0), 0);

      const modules = (modsByDim.get(d.id) || []).map(m => {
        const deduction = dedMap.get(key(uid, m.id)) || 0;
        const net = subMap.get(subKey(uid, d.id, m.name)) || 0;
        return {
          moduleId: m.id,
          moduleName: m.name,
          // 本项上限（原「基础分」）。展示用 —— 累加制下它不再默认送出，
          // 只是表2 对 100 分的拆分说明。
          baseScore: Number(m.base_score) || 0,
          // 本项已得，按 subcategory_name 归集，**仅供参考**
          earned: Math.max(0, net - deduction),
          // 未经扣分的原始归集额。客户端要实时预览"改扣分后会变成多少"，
          // 有这个数就不用去做 net = earned + deduction 的反推（那样会把
          // 已经被 max(0, …) 夹掉的部分算错）。
          net,
          deduction
        };
      });

      const score = hardZero
        ? 0
        : Math.min(Math.max(0, earned - deductionTotal), ceiling);

      return {
        dimensionId: d.id,
        dimensionCode: d.dimension_code,
        name: d.name,
        icon: d.icon,
        // 基础分仍是上限公式里的常数项（100），不是默认送出的分
        baseTotal,
        bonusCap,
        ceiling,
        earned,
        deductionTotal,
        // bonusTotal / bonusApplied 重定义为「超出基础分 100 的部分」，
        // 这样客户端那句「加分 X / 上限 Y」无需改代码即语义正确。
        bonusTotal: Math.max(0, earned - deductionTotal - baseTotal),
        bonusApplied: Math.max(0, score - baseTotal),
        // 前端据此决定要不要渲染刚性归零开关 —— 只有配了 has_hard_zero 的维度
        // 才该出现这个按钮，否则点下去只会拿到 400
        hasHardZero: !!d.has_hard_zero,
        hardZero,
        fraudZero: fraudHit,
        // 作假的归零原因优先：它是季度级的事实，人工归零的原因只在没作假时才有意义
        hardZeroReason: fraudHit ? `弄虚作假：${fraudReason || '未填写原因'}`
          : (hardZero ? (status.reason || '') : ''),
        rewardIneligible: fraudHit || !!(status && status.reward_ineligible),
        score,
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

// 某人某季度某维度已入账的净得分。
//
// 这是**单点**版本，供审核环节的上限校验用；buildQuarterlyScores 里的 earnMap
// 是同一口径的批量版本。两者必须给出同样的数 —— 所以共用 NET_SUM / NET_TYPES，
// 改动时请同时验证两边。老代码在这一点上摔过：批量走 bonusMap、单点走
// grantedBonus，两套 SQL 一旦漂移，症状是「审核说还能加 5 分，加完却没变化」。
async function dimensionEarned(db, userId, quarter, dimensionId) {
  // 计分起点之前返回 0 —— 必须和 buildQuarterlyScores 的 scored 判断一致。
  // 少了这一句就会出现：排名页该季度显示 0 分，而审核时说「该维度已得 90 分，超上限」，
  // 管理员完全无从判断哪边是真的。
  if (!isScoredQuarter(quarter)) return 0;

  const row = await db.prepare(
    `SELECT ${NET_SUM} AS net FROM points_log
      WHERE user_id = ? AND quarter = ? AND module_id = ? AND ${NET_TYPES}`
  ).get(userId, quarter, dimensionId);
  return Number(row && row.net) || 0;
}

// 维度上限：基础分 + 加分上限。审核校验和前端展示都用它，别再各自算一遍。
function dimensionCeiling(dim) {
  return Number(dim && dim.base_score || 0) + Number(dim && dim.bonus_cap || 0);
}

// 季度内的活跃员工（参与评分的对象）
//
// 三个条件缺一不可：
//   status = 'active'          —— 禁用的人不该出现在排名里
//   role = 'employee'          —— 管理员是评分的人，不是被评的人
//   exclude_from_ranking = 0   —— 能登录但不参赛的账号（测试、借调）
//
// 这是排名范围的**唯一**定义：/admin/quarterly 和 /quarterly/ranking 都从这里取人，
// 加条件只改这一处，两边的名单不会漂移。
async function listScorableUsers(db) {
  return db.prepare(
    `SELECT id, employee_id, name, department FROM users
      WHERE status = 'active' AND role = 'employee' AND exclude_from_ranking = 0
      ORDER BY department, name`
  ).all();
}

module.exports = {
  buildQuarterlyScores,
  dimensionEarned,
  dimensionCeiling,
  listScorableUsers,
  quarterBounds
};
