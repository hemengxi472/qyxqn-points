const express = require('express');
const { db, trx } = require('../db');
const { authMiddleware, adminMiddleware, superAdminMiddleware } = require('../middleware/auth');
const { monthKey, quarterKey, quarterOfMonth, isValidQuarter, quarterBounds, formatQuarter } = require('../utils/quarter');
const { resolveDisciplineModule } = require('../utils/dimensions');
const { buildQuarterlyScores, listScorableUsers, grantedBonus } = require('../utils/quarterly');
const {
  leaveDaysForRank, REWARD_TIERS, REWARD_USAGE_NOTE, REWARD_PROCESS, REWARD_IMPORTANT_NOTE
} = require('../utils/reward');

const router = express.Router();
router.use(authMiddleware, adminMiddleware);

const GROUP_TASK_POINTS = 5;

function parseJsonArray(s, fallback = []) {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

// ===== existing review routes =====
router.get('/reviews', async (req, res) => {
  const { status = 'pending', department, page = 1, pageSize = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(pageSize);

  let where = 'WHERE status = ?';
  const params = [status];
  if (department) {
    where += ' AND department = ?';
    params.push(department);
  }

  const total = (await db.prepare(`SELECT COUNT(*) as cnt FROM submissions ${where}`).get(...params)).cnt;
  const items = await db.prepare(`
    SELECT * FROM submissions ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, Number(pageSize), offset);

  res.json({
    items: items.map(formatSubmission),
    total,
    page: Number(page),
    pageSize: Number(pageSize)
  });
});

// GET /api/admin/reviews/:id
router.get('/reviews/:id', async (req, res) => {
  const submission = await db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!submission) return res.status(404).json({ message: '申请记录不存在' });

  // 审核人看到的剩余额度。服务端校验才是准绳，这里只是让「填了 200 才被拒」
  // 少发生 —— 输入框的 :max 绑的就是 remaining。
  const dim = await db.prepare('SELECT id, name, bonus_cap, has_hard_zero FROM modules WHERE id = ?')
    .get(submission.module_id);

  let bonusContext = null;
  if (dim && Number(dim.bonus_cap) > 0) {
    const quarter = submission.quarter || quarterOfMonth(submission.month_year);
    const granted = quarter ? await grantedBonus(db, submission.user_id, quarter, dim.id) : 0;
    const status = quarter ? await db.prepare(
      `SELECT hard_zero, reason FROM quarterly_dimension_status
        WHERE user_id = ? AND quarter = ? AND dimension_id = ?`
    ).get(submission.user_id, quarter, dim.id) : null;

    // 作假是派生归零（不落 quarterly_dimension_status），所以必须单独查一次，
    // 否则审核人会把加分发给一个季度分已经是 0 的人 —— 加分明细照常入账，
    // 但分数被归零盖住，要等作假记录被撤销才突然出现。
    const fraud = quarter ? await db.prepare(
      'SELECT id, reason FROM fraud_records WHERE user_id = ? AND quarter = ? LIMIT 1'
    ).get(submission.user_id, quarter) : null;

    bonusContext = {
      quarter,
      dimensionName: dim.name,
      bonusCap: Number(dim.bonus_cap),
      granted,
      remaining: Math.max(0, Number(dim.bonus_cap) - granted),
      hasHardZero: !!dim.has_hard_zero,
      hardZero: !!(status && status.hard_zero),
      hardZeroReason: status ? (status.reason || '') : '',
      fraudZero: !!fraud,
      fraudReason: fraud ? (fraud.reason || '') : ''
    };
  }

  res.json({ submission: formatSubmission(submission), bonusContext });
});

// POST /api/admin/reviews/:id/action
router.post('/reviews/:id/action', async (req, res) => {
  const { action, points, comment } = req.body;
  if (!action || (action !== 'approve' && action !== 'reject')) {
    return res.status(400).json({ message: '无效操作' });
  }

  // 原来写的是 `!points || points < 0`，有三个问题：
  //   1) points === 0 被拒 —— 客户端 :min="0" 明确允许，新模型下 0 也有意义
  //      （"通过，不加分，基础分已覆盖"）
  //   2) 非数字能通过 —— 'abc' 既不 falsy 也不小于 0，随后被写进 INTEGER 列，
  //      SUM(points) 把它当 0 读：行里声称有奖励，分数却消失
  //   3) 同一个逻辑值传字符串 '0' 能过、传数字 0 不能过
  const p = Number(points);
  if (action === 'approve' && (!Number.isInteger(p) || p < 0)) {
    return res.status(400).json({ message: '请填写有效的非负整数积分' });
  }

  const sub = await db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!sub) return res.status(404).json({ message: '申请记录不存在' });
  if (sub.status !== 'pending') return res.status(400).json({ message: '该申请已审核，不可重复操作' });

  const reviewer = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  // 该维度配了加分上限才做封顶校验；遗留模块（bonus_cap=0）行为与以前完全一致
  const dim = await db.prepare('SELECT id, name, bonus_cap FROM modules WHERE id = ?').get(sub.module_id);
  const quarter = sub.quarter || quarterOfMonth(sub.month_year);

  try {
    await trx(async (tx) => {
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

      if (action === 'approve') {
        // 上限校验必须在事务内：同人同季度同维度的两个并发审核若在事务外读已用量，
        // 会读到同样的值而双双通过。
        if (dim && Number(dim.bonus_cap) > 0 && quarter) {
          const granted = await grantedBonus(tx, sub.user_id, quarter, dim.id);
          const remaining = Math.max(0, Number(dim.bonus_cap) - granted);
          if (p > remaining) {
            throw Object.assign(new Error(
              `本季度「${dim.name}」附加加分上限 ${dim.bonus_cap} 分，已使用 ${granted} 分，本次最多可加 ${remaining} 分`
            ), { status: 400, code: 'BONUS_CAP_EXCEEDED' });
          }
        }

        await tx.prepare(`
          UPDATE submissions SET status = 'approved', points_awarded = ?, reviewer_id = ?, reviewer_name = ?, review_comment = ?, reviewed_at = ?
          WHERE id = ?
        `).run(p, reviewer.id, reviewer.name, comment || '', now, req.params.id);

        // month_year / quarter / source 三列必须显式写，不能靠列默认值 + 重启回填：
        // 缺失时 month_year 是 ''，而作假的扣减口径是 WHERE quarter = ?，两者都读不到
        // 这笔 —— 于是"因作假被清零的人"在撤销作假时会凭空多出这些分。
        // quarter 用提交时冻结的那个（与上面的 quarterly_bonus_ledger 同口径），
        // month_year 写真实当月，只为满足 NOT NULL 且让遗留读者看到合理值。
        await tx.prepare(`
          INSERT INTO points_log (user_id, employee_id, submission_id, module_id, module_name, subcategory_name, points, type, description, month_year, quarter, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'award', ?, ?, ?, 'submission')
        `).run(sub.user_id, sub.employee_id, sub.id, sub.module_id, sub.module_name, sub.subcategory_name, p,
          `${sub.subcategory_name} - ${sub.description || '审核通过'}`, monthKey(), quarter || '');

        // 季度加分台账 —— 与 points_summary 同事务双写，一次审核事件喂两个视图。
        // 年度/季度分与累计分是两套不同尺度的数，不能互相换算。
        if (quarter) {
          await tx.prepare(`
            INSERT INTO quarterly_bonus_ledger
              (user_id, employee_id, quarter, dimension_id, module_id, module_name, submission_id, points)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(sub.user_id, sub.employee_id, quarter, sub.module_id, sub.module_id, sub.module_name, sub.id, p);

          await tx.prepare(`
            INSERT INTO quarterly_score_log
              (user_id, employee_id, quarter, dimension_id, module_id, type, delta, reason, submission_id, actor_id, actor_name)
            VALUES (?, ?, ?, ?, ?, 'bonus', ?, ?, ?, ?, ?)
          `).run(sub.user_id, sub.employee_id, quarter, sub.module_id, sub.module_id,
            p, comment || '', sub.id, reviewer.id, reviewer.name);
        }

        // points_summary 的增量逻辑保持不变（生命周期累加、按字符串 module id 索引）。
        // 不要改成季度口径 —— 作假回退按 module_id 从 points_log 反推再加回 mp[key]。
        const summary = await tx.prepare('SELECT * FROM points_summary WHERE user_id = ?').get(sub.user_id);
        const moduleKey = String(sub.module_id);

        if (!summary) {
          await tx.prepare(`
            INSERT INTO points_summary (user_id, employee_id, total_points, module_points, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(sub.user_id, sub.employee_id, p, JSON.stringify({ [moduleKey]: p }), now);
        } else {
          const mp = JSON.parse(summary.module_points || '{}');
          mp[moduleKey] = (mp[moduleKey] || 0) + p;
          await tx.prepare(`
            UPDATE points_summary SET total_points = total_points + ?, module_points = ?, updated_at = ?
            WHERE user_id = ?
          `).run(p, JSON.stringify(mp), now, sub.user_id);
        }
      } else {
        await tx.prepare(`
          UPDATE submissions SET status = 'rejected', reviewer_id = ?, reviewer_name = ?, review_comment = ?, reviewed_at = ?
          WHERE id = ?
        `).run(reviewer.id, reviewer.name, comment || '', now, req.params.id);
      }
    });
  } catch (e) {
    if (e && e.code === 'BONUS_CAP_EXCEEDED') {
      return res.status(400).json({ message: e.message, code: e.code });
    }
    throw e;
  }

  res.json({ success: true, action });
});

// POST /api/admin/reviews/:id/revert — 撤销已通过的审核（限超管）
//
// 为什么必须有：加分有维度上限，误把 10 输成 100 会让整个季度脏掉，
// 而系统原本没有任何回退路径，只能直接改数据库。
//
// 状态回到 pending 而不是 rejected：这个端点的用途就是纠错（10 录成了 100），
// 回到 pending 才能重新录入正确分值。回 rejected 的话申请就再也改不了了 ——
// /action 要求 status === 'pending'，员工只能重新提交一遍并重传材料。
// 如果审核人本来就认为不该通过，撤销后再点一次驳回即可，两步就到 rejected。
//
// 注意不碰 monthly_points：单条申请的审核加分量从来没写过 monthly_points
// （只有团队任务写），所以这里回退它会把团队任务挣的分一起扣掉。
router.post('/reviews/:id/revert', superAdminMiddleware, async (req, res) => {
  const sub = await db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!sub) return res.status(404).json({ message: '申请记录不存在' });
  if (sub.status !== 'approved') return res.status(400).json({ message: '只有已通过的申请可以撤销' });

  const reviewer = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const pts = Number(sub.points_awarded) || 0;
  const quarter = sub.quarter || quarterOfMonth(sub.month_year);
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  await trx(async (tx) => {
    // 审核人字段一并清空：这条记录回到未审核状态，留着上次的审核人和
    // 审核时间会让队列里显示"已由 X 审核"。
    await tx.prepare(`
      UPDATE submissions SET status = 'pending', points_awarded = NULL,
        reviewer_id = NULL, reviewer_name = NULL, review_comment = NULL, reviewed_at = NULL
      WHERE id = ?
    `).run(sub.id);

    await tx.prepare('DELETE FROM quarterly_bonus_ledger WHERE submission_id = ?').run(sub.id);

    if (quarter) {
      await tx.prepare(`
        INSERT INTO quarterly_score_log
          (user_id, employee_id, quarter, dimension_id, module_id, type, delta, reason, submission_id, actor_id, actor_name)
        VALUES (?, ?, ?, ?, ?, 'bonus_revert', ?, ?, ?, ?, ?)
      `).run(sub.user_id, sub.employee_id, quarter, sub.module_id, sub.module_id,
        -pts, req.body.reason || '撤销审核', sub.id, reviewer.id, reviewer.name);
    }

    if (pts > 0) {
      // 与作假扣减同款独立 clamp（模块级和总分各自 Math.max(0, ...)）
      const summary = await tx.prepare('SELECT * FROM points_summary WHERE user_id = ?').get(sub.user_id);
      if (summary) {
        const mp = JSON.parse(summary.module_points || '{}');
        const moduleKey = String(sub.module_id);
        mp[moduleKey] = Math.max(0, (mp[moduleKey] || 0) - pts);
        await tx.prepare(`
          UPDATE points_summary SET total_points = ?, module_points = ?, updated_at = ? WHERE user_id = ?
        `).run(Math.max(0, (summary.total_points || 0) - pts), JSON.stringify(mp), now, sub.user_id);
      }

      // type='deduct' —— 前端 HistoryView / DashboardView 已按 type !== 'award'
      // 渲染负号，不需要改前端
      //
      // quarter 取原申请的冻结季度（这笔冲的就是那条加分），month_year 取真实当月。
      // 不能用 sub.month_year 兜底到 '' —— 那一行的 quarter 就会是空的，
      // 而作假的扣减口径按 quarter 走。
      await tx.prepare(`
        INSERT INTO points_log (user_id, employee_id, submission_id, module_id, module_name, subcategory_name, points, type, description, month_year, quarter, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'deduct', ?, ?, ?, 'submission')
      `).run(sub.user_id, sub.employee_id, sub.id, sub.module_id, sub.module_name,
        sub.subcategory_name, pts, `撤销审核 - ${sub.subcategory_name}`, monthKey(), quarter || '');
    }
  });

  res.json({ success: true, message: '已撤销审核并回退积分，申请已回到待审核列表' });
});

// GET /api/admin/employees
router.get('/employees', async (req, res) => {
  const { department, page = 1, pageSize = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(pageSize);

  let where = '';
  const params = [];
  if (department) {
    where = 'WHERE department = ?';
    params.push(department);
  }

  const total = (await db.prepare(`SELECT COUNT(*) as cnt FROM users ${where}`).get(...params)).cnt;
  const users = await db.prepare(`
    SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, Number(pageSize), offset);

  const items = await Promise.all(users.map(async (u) => {
    const summary = await db.prepare('SELECT total_points FROM points_summary WHERE user_id = ?').get(u.id);
    return {
      id: u.id,
      employeeId: u.employee_id,
      name: u.name,
      department: u.department,
      role: u.role,
      status: u.status,
      totalPoints: summary ? summary.total_points : 0,
      createdAt: u.created_at
    };
  }));

  res.json({ items, total, page: Number(page), pageSize: Number(pageSize) });
});

// GET /api/admin/stats
router.get('/stats', async (_req, res) => {
  const empCount = (await db.prepare('SELECT COUNT(*) as cnt FROM users WHERE status = ?').get('active')).cnt;
  const subTotal = (await db.prepare('SELECT COUNT(*) as cnt FROM submissions').get()).cnt;
  const pendingCount = (await db.prepare("SELECT COUNT(*) as cnt FROM submissions WHERE status = 'pending'").get()).cnt;

  // 不能过滤 is_active：旧四模块停用后，历史积分全在它们的 id 下，
  // 一带 WHERE 柱状图就会把全部历史分布显示成 0。
  const modules = (await db.prepare(
    'SELECT id, name, is_active, dimension_code FROM modules ORDER BY sort_order'
  ).all());
  const allSummaries = (await db.prepare('SELECT * FROM points_summary').all());

  const pointsByModule = new Map();
  modules.forEach(m => {
    pointsByModule.set(m.name, { moduleName: m.name, total: 0, dimensionCode: m.dimension_code || '', isActive: !!m.is_active });
  });
  allSummaries.forEach(s => {
    const mp = JSON.parse(s.module_points || '{}');
    modules.forEach(m => {
      const entry = pointsByModule.get(m.name);
      if (entry) entry.total += mp[String(m.id)] || 0;
    });
  });

  const topEmployees = await Promise.all(
    allSummaries
      .sort((a, b) => (b.total_points || 0) - (a.total_points || 0))
      .slice(0, 10)
      .map(async (s) => {
        const emp = await db.prepare('SELECT name, department FROM users WHERE employee_id = ?').get(s.employee_id);
        return {
          employeeId: s.employee_id,
          name: emp ? emp.name : '未知',
          department: emp ? emp.department : '未知',
          totalPoints: s.total_points
        };
      })
  );

  const fraudCount = (await db.prepare('SELECT COUNT(*) as cnt FROM fraud_records').get()).cnt;

  // Group stats —— 按季度统计（团队任务已季度化）
  const currentQuarter = quarterKey();
  const groupStats = await db.prepare(`
    SELECT status, COUNT(*) as cnt FROM groups WHERE quarter = ?
    GROUP BY status
  `).all(currentQuarter);
  const groupCounts = { active: 0, submitted: 0, approved: 0, rejected: 0 };
  for (const r of groupStats) { groupCounts[r.status] = r.cnt; }

  const submittedGroups = await db.prepare(`
    SELECT g.*, (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
    FROM groups g WHERE g.quarter = ? AND g.status = 'submitted'
    ORDER BY g.created_at DESC
  `).all(currentQuarter);

  res.json({
    totalEmployees: empCount,
    totalSubmissions: subTotal,
    pendingReview: pendingCount,
    fraudRecords: fraudCount,
    pointsByModule: [...pointsByModule.values()],
    topEmployees,
    groups: {
      quarter: currentQuarter,
      total: groupCounts.active + groupCounts.submitted + groupCounts.approved + groupCounts.rejected,
      active: groupCounts.active,
      submitted: groupCounts.submitted,
      approved: groupCounts.approved,
      rejected: groupCounts.rejected,
      submittedList: submittedGroups.map(formatGroup)
    }
  });
});

// POST /api/admin/employees/:id/promote
router.post('/employees/:id/promote', superAdminMiddleware, async (req, res) => {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ message: '员工不存在' });

  await db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?')
    .run('admin', new Date().toISOString().replace('T', ' ').substring(0, 19), req.params.id);

  res.json({ success: true });
});

// POST /api/admin/employees/:id/disable
router.post('/employees/:id/disable', superAdminMiddleware, async (req, res) => {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ message: '员工不存在' });

  const newStatus = user.status === 'active' ? 'disabled' : 'active';
  await db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?')
    .run(newStatus, new Date().toISOString().replace('T', ' ').substring(0, 19), req.params.id);

  res.json({ success: true, status: newStatus });
});

function formatSubmission(s) {
  return {
    id: s.id,
    employeeId: s.employee_id,
    employeeName: s.employee_name,
    department: s.department,
    moduleId: s.module_id,
    moduleName: s.module_name,
    subcategoryName: s.subcategory_name,
    description: s.description,
    photoUrls: JSON.parse(s.photo_urls || '[]'),
    status: s.status,
    pointsAwarded: s.points_awarded,
    reviewerName: s.reviewer_name,
    reviewComment: s.review_comment,
    reviewedAt: s.reviewed_at,
    createdAt: s.created_at
  };
}

// ===== Group Management =====

// POST /api/admin/groups/generate — random team assignment
router.post('/groups/generate', async (req, res) => {
  const quarter = quarterKey();
  // 每季度只能生成一次。守卫查 quarter 而不是 month_year —— 那两列在同一个季度里
  // 会同时存在多个月份值，按月份查等于没守卫。
  const existing = (await db.prepare('SELECT COUNT(*) as cnt FROM groups WHERE quarter = ?').get(quarter)).cnt;
  if (existing > 0) {
    return res.status(400).json({ message: `${formatQuarter(quarter)} 团队已生成，如需重新生成请先删除` });
  }

  const employees = await db.prepare("SELECT * FROM users WHERE status = 'active' AND role = 'employee' ORDER BY RANDOM()").all();
  if (employees.length < 3) {
    return res.status(400).json({ message: '在职员工不足3人，无法生成团队' });
  }

  const shuffled = employees.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Partition into groups of 3-5
  const groups = [];
  let idx = 0;
  while (idx < shuffled.length) {
    const remaining = shuffled.length - idx;
    let size = 4;
    if (remaining < 3) {
      for (let k = 0; k < remaining; k++) {
        const target = groups[k % groups.length];
        if (target.length < 5) target.push(shuffled[idx + k]);
      }
      idx += remaining;
      continue;
    }
    if (remaining === 3) size = 3;
    else if (remaining === 4) size = 4;
    else size = Math.min(5, Math.max(3, Math.floor(remaining / Math.ceil(remaining / 4))));
    groups.push(shuffled.slice(idx, idx + size));
    idx += size;
  }

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  let groupNum = 1;

  await trx(async (tx) => {
    for (const members of groups) {
      const name = `${formatQuarter(quarter)} 第${groupNum}组`;
      // month_year 写真实当月（列 NOT NULL 且遗留读者要看），季度归属一律看 quarter
      const result = await tx.prepare(`
        INSERT INTO groups (name, quarter, month_year, created_at) VALUES (?, ?, ?, ?)
      `).run(name, quarter, monthKey(), now);
      const groupId = result.lastInsertRowid;

      for (const emp of members) {
        await tx.prepare(`
          INSERT INTO group_members (group_id, user_id, employee_id, employee_name, department)
          VALUES (?, ?, ?, ?, ?)
        `).run(groupId, emp.id, emp.employee_id, emp.name, emp.department);
      }
      groupNum++;
    }
  });

  const created = await db.prepare(`
    SELECT g.*, (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
    FROM groups g WHERE g.quarter = ? ORDER BY g.name
  `).all(quarter);

  res.json({ groups: created.map(formatGroup), quarter });
});

// GET /api/admin/groups — list groups
router.get('/groups', async (req, res) => {
  // 一个发布周期内同时接受 quarter 和遗留的 monthYear（滚动发布兼容）：
  // 服务端托管的是已提交的 client/dist，先发服务端时旧 bundle 还在传 monthYear。
  const quarter = req.query.quarter || quarterOfMonth(req.query.monthYear);
  let where = '';
  const params = [];
  if (quarter) {
    where = 'WHERE g.quarter = ?';
    params.push(quarter);
  }
  const groups = await db.prepare(`
    SELECT g.*, (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
    FROM groups g ${where} ORDER BY g.quarter DESC, g.name
  `).all(...params);
  res.json({ groups: groups.map(formatGroup) });
});

// GET /api/admin/groups/:id — group detail with members
router.get('/groups/:id', async (req, res) => {
  const group = await db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ message: '团队不存在' });

  const members = await db.prepare(`
    SELECT gm.*, u.name as uname, u.department as udept
    FROM group_members gm JOIN users u ON gm.user_id = u.id WHERE gm.group_id = ?
  `).all(req.params.id);

  const submission = group.submission_id
    ? await db.prepare('SELECT * FROM submissions WHERE id = ?').get(group.submission_id)
    : null;

  res.json({
    group: {
      ...formatGroup(group),
      members: members.map(m => ({
        id: m.id,
        userId: m.user_id,
        employeeId: m.employee_id,
        employeeName: m.employee_name,
        department: m.department
      })),
      submission: submission ? {
        id: submission.id,
        description: submission.description,
        photoUrls: JSON.parse(submission.photo_urls || '[]'),
        createdAt: submission.created_at
      } : null
    }
  });
});

// POST /api/admin/groups/:id/review — approve or reject group submission
router.post('/groups/:id/review', async (req, res) => {
  const group = await db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ message: '团队不存在' });
  if (group.status !== 'submitted') return res.status(400).json({ message: '该团队未提交任务，无法审核' });

  const { action } = req.body;
  if (!action || (action !== 'approved' && action !== 'rejected')) {
    return res.status(400).json({ message: '无效操作，请选择通过或驳回' });
  }

  const submission = await db.prepare('SELECT * FROM submissions WHERE id = ?').get(group.submission_id);
  if (!submission) return res.status(400).json({ message: '提交记录不存在' });

  const reviewer = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const allMembers = await db.prepare('SELECT * FROM group_members WHERE group_id = ?').all(group.id);
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  // 纪律维度按名字运行时解析：旧的「纪律」已停用、新的「有纪律」活跃，
  // 写死 id=4 / '纪律' 会让新积分全部挂在停用模块下。
  // resolveDisciplineModule 找不到会抛错，而 admin.js 的 async 处理器没有统一
  // 错误中间件（Express 4），抛出去是挂住的请求而不是 500，所以在这里兜住。
  let discipline;
  try {
    discipline = await resolveDisciplineModule(db);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }

  let responseMessage = '';

  await trx(async (tx) => {
    if (action === 'approved') {
      const points = GROUP_TASK_POINTS;
      const moduleKey = String(discipline.id);

      await tx.prepare(`
        UPDATE submissions SET status = 'approved', points_awarded = ?, reviewer_id = ?, reviewer_name = ?, reviewed_at = ?
        WHERE id = ?
      `).run(points, reviewer.id, reviewer.name, now, group.submission_id);

      await tx.prepare(`
        UPDATE groups SET status = 'approved', reviewer_name = ?, review_comment = ?, reviewed_at = ?
        WHERE id = ?
      `).run(reviewer.name, '审核通过', now, group.id);

      // 季度归属：优先用组上冻结的 quarter（提交时就写好了），老组没有才退回
      // 按 month_year 推。整个发放循环共用同一个值，逐成员重复推导只会漂移。
      const taskQuarter = group.quarter || quarterOfMonth(group.month_year);
      let awarded = 0;
      const skipped = [];

      for (const m of allMembers) {
        // 本季度已被弄虚作假归零的成员不再发放 —— 以前这个守卫查的是
        // monthly_points.is_fraud_reset，那个标记随月度层一起作废了。
        if (taskQuarter) {
          const fraud = await tx.prepare(
            'SELECT 1 AS x FROM fraud_records WHERE user_id = ? AND quarter = ? LIMIT 1'
          ).get(m.user_id, taskQuarter);
          if (fraud) {
            skipped.push(m.employee_name);
            continue;
          }
        }
        awarded++;

        // source='team_task' 是团队任务分在算分路径上的唯一判别特征 ——
        // quarterly.js 的 bonusMap 和 grantedBonus 都按它把 5 分折进「有纪律」
        // 的加分上限。漏写这一列，团队任务分就会从季度分里静默消失。
        await tx.prepare(`
          INSERT INTO points_log (user_id, employee_id, submission_id, module_id, module_name,
            subcategory_name, points, type, description, month_year, quarter, source)
          VALUES (?, ?, ?, ?, ?, '团队任务完成', ?, 'award', ?, ?, ?, 'team_task')
        `).run(m.user_id, m.employee_id, group.submission_id, discipline.id, discipline.name, points,
          `团队任务完成 - ${group.name}`, monthKey(), taskQuarter || '');

        // 刻意不写 quarterly_bonus_ledger：一次团队审核给全队 N 人各发 5 分，
        // 而 ledger 有 UNIQUE(submission_id)，第 2 个人就会被拒。团队任务的
        // 季度加分走派生（见 quarterly.js 的 TEAM_TASK_BONUS_WHERE）。

        const summary = await tx.prepare('SELECT * FROM points_summary WHERE user_id = ?').get(m.user_id);
        if (!summary) {
          await tx.prepare(`
            INSERT INTO points_summary (user_id, employee_id, total_points, module_points, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(m.user_id, m.employee_id, points, JSON.stringify({ [moduleKey]: points }), now);
        } else {
          const mp = JSON.parse(summary.module_points || '{}');
          mp[moduleKey] = (mp[moduleKey] || 0) + points;
          await tx.prepare(`
            UPDATE points_summary SET total_points = total_points + ?, module_points = ?, updated_at = ?
            WHERE user_id = ?
          `).run(points, JSON.stringify(mp), now, m.user_id);
        }

        // 不再写 monthly_points —— 月度层已废弃，该表停止写入（旧行保留）。
        // 「本季度是否已归零」的事实由上面的 fraud_records 查询提供。
      }

      responseMessage = `已通过，${awarded} 位成员各获得 ${points} 积分`;
      // 被跳过的成员必须明说：静默少发会让管理员以为全员到账，
      // 而员工那边看到的是"我的团队任务分呢"。
      if (skipped.length) {
        responseMessage += `；${skipped.join('、')} 因本季度弄虚作假归零，未发放`;
      }
    } else {
      await tx.prepare(`
        UPDATE submissions SET status = 'rejected', reviewer_id = ?, reviewer_name = ?, reviewed_at = ?
        WHERE id = ?
      `).run(reviewer.id, reviewer.name, now, group.submission_id);

      await tx.prepare(`
        UPDATE groups SET status = 'rejected', reviewer_name = ?, review_comment = ?, reviewed_at = ?
        WHERE id = ?
      `).run(reviewer.name, '审核驳回', now, group.id);

      responseMessage = '已驳回';
    }
  });

  res.json({ success: true, action, message: responseMessage });
});

// DELETE /api/admin/groups/:id — delete a group
router.delete('/groups/:id', async (req, res) => {
  const group = await db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ message: '团队不存在' });

  await trx(async (tx) => {
    await tx.prepare('DELETE FROM group_members WHERE group_id = ?').run(req.params.id);
    await tx.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);
  });
  res.json({ success: true });
});

// ===== Fraud Management =====

// POST /api/admin/tasks — create/update the unified QUARTERLY task
//
// 一个季度一条（ux_monthly_tasks_quarter 唯一索引保证）。遗留的 monthYear 参数
// 仍在接受范围内：服务端托管的是已提交的 client/dist，先发服务端时旧 bundle
// 还在传月份。等 dist 同批发布后删掉兼容分支。
router.post('/tasks', async (req, res) => {
  const { taskDescription } = req.body;
  const quarter = req.body.quarter || quarterOfMonth(req.body.monthYear);
  if (!quarter || !taskDescription || !taskDescription.trim()) {
    return res.status(400).json({ message: '请提供季度和任务描述' });
  }
  if (!isValidQuarter(quarter)) {
    return res.status(400).json({ message: '季度格式无效，应为 YYYY-Q1 ~ YYYY-Q4' });
  }

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  // 放在事务里：唯一索引会在并发插入时抛错，而这个 async 处理器没有统一错误
  // 中间件（Express 4），抛出去是挂住的请求而不是 500。
  await trx(async (tx) => {
    const existing = await tx.prepare('SELECT * FROM monthly_tasks WHERE quarter = ?').get(quarter);
    if (existing) {
      await tx.prepare(`UPDATE monthly_tasks SET task_description = ?, month_year = ?, created_by = ?, created_at = ?
        WHERE id = ?`).run(taskDescription.trim(), monthKey(), req.user.id, now, existing.id);
    } else {
      await tx.prepare('INSERT INTO monthly_tasks (quarter, month_year, task_description, created_by) VALUES (?, ?, ?, ?)')
        .run(quarter, monthKey(), taskDescription.trim(), req.user.id);
    }
  });

  res.json({ success: true, message: `${formatQuarter(quarter)}任务已保存`, quarter });
});

// GET /api/admin/tasks — list all quarterly tasks
router.get('/tasks', async (_req, res) => {
  const tasks = await db.prepare('SELECT * FROM monthly_tasks ORDER BY quarter DESC').all();
  res.json({
    tasks: tasks.map(t => ({
      id: t.id,
      quarter: t.quarter || quarterOfMonth(t.month_year),
      taskDescription: t.task_description,
      createdBy: t.created_by,
      createdAt: t.created_at
    }))
  });
});

// GET /api/admin/tasks/:period — get the task for a specific quarter
//
// 路径参数按形状自适应：带 '-Q' 的是季度，'YYYY-MM' 的按遗留月份处理。
// 客户端在同一发布周期内会从 /tasks/2026-09 切到 /tasks/2026-Q3。
router.get('/tasks/:period', async (req, res) => {
  const raw = req.params.period;
  const quarter = isValidQuarter(raw) ? raw : quarterOfMonth(raw);
  const task = quarter
    ? await db.prepare('SELECT * FROM monthly_tasks WHERE quarter = ?').get(quarter)
    : null;
  res.json({
    task: task ? {
      id: task.id,
      quarter: task.quarter || quarterOfMonth(task.month_year),
      taskDescription: task.task_description,
      createdBy: task.created_by,
      createdAt: task.created_at
    } : null
  });
});

// POST /api/admin/fraud — report fraud
//
// 按季度口径。除了清掉累计积分，这个季度**六个维度全部归零、取消奖励资格** ——
// 后者不落库，是 buildQuarterlyScores 从 fraud_records 派生的（见 quarterly.js），
// 所以删掉这条记录分数就自己回来，不需要反算当初归零了哪几个维度。
router.post('/fraud', async (req, res) => {
  const { userId, reason } = req.body;
  const quarter = req.body.quarter || quarterOfMonth(req.body.monthYear);
  if (!userId || !quarter || !reason) return res.status(400).json({ message: '请填写完整信息' });
  if (!isValidQuarter(quarter)) {
    return res.status(400).json({ message: '季度格式无效，应为 YYYY-Q1 ~ YYYY-Q4' });
  }

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ message: '员工不存在' });

  // 同一 (人, 季度) 只允许一条：两条记录的撤销会各自加回一份积分，
  // 把累计分推到作假前的水平之上。
  //
  // 刻意不建 UNIQUE(user_id, quarter) 索引：历史遗留的「同季度多条月度记录」
  // 是合法旧状态，建唯一索引会在 initDB 里炸，而删历史作假记录是破坏性的。
  const dup = await db.prepare('SELECT id FROM fraud_records WHERE user_id = ? AND quarter = ?').get(userId, quarter);
  if (dup) {
    return res.status(409).json({
      message: `${user.name} 在 ${formatQuarter(quarter)} 已有作假记录（#${dup.id}），请先删除原记录再重新录入`
    });
  }

  // 按 quarter 口径取该季度该员工的**净贡献**：award − deduct。
  //
  // 只算 award 是错的：一笔被撤销审核冲掉的加分（type='deduct'）说明这笔分
  // 已经收回过了，再清一次就是在清这个人别的历史。样本：某人 Q3 模块 5 有
  // award 15、deduct 6，钱包里实际只有 9；按 award 口径清 15 会把他模块里
  // 另外 6 分也清掉，且因为下面的 clamp 不对称，撤销后永久多出 6 分。
  //
  // 含团队任务分（source='team_task'）—— 那同样是这个季度挣的。
  const modBreakdown = await db.prepare(`
    SELECT module_id,
           SUM(CASE WHEN type = 'award' THEN points ELSE -points END) AS pts
      FROM points_log
     WHERE user_id = ? AND quarter = ? AND type IN ('award', 'deduct')
     GROUP BY module_id
    HAVING pts > 0
  `).all(userId, quarter);

  const wantedTotal = modBreakdown.reduce((s, r) => s + (Number(r.pts) || 0), 0);
  const wanted = {};
  for (const row of modBreakdown) wanted[String(row.module_id)] = Number(row.pts) || 0;

  const reviewer = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  // 快照存**实际扣掉的数**，不是"想扣的数"。
  //
  // 扣减对每个模块和总分各自 clamp（Math.max(0, ...)），所以钱包里不够时实扣会
  // 小于应扣。若快照记应扣、撤销时按应扣加回，扣减与撤销就不是互逆的 ——
  // 一次作假+撤销会给这个人的模块分凭空多出差额。记录实扣数，撤销就必定是
  // 精确逆运算：apply = applied 的加回。
  let applied = {};
  let appliedTotal = 0;

  await trx(async (tx) => {
    const summary = await tx.prepare('SELECT * FROM points_summary WHERE user_id = ?').get(userId);

    if (summary && wantedTotal > 0) {
      const mp = JSON.parse(summary.module_points || '{}');
      for (const [k, pts] of Object.entries(wanted)) {
        const have = Number(mp[k]) || 0;
        const take = Math.min(pts, have);
        if (take > 0) { applied[k] = take; mp[k] = have - take; }
      }
      appliedTotal = Math.min(wantedTotal, Number(summary.total_points) || 0);

      await tx.prepare('UPDATE points_summary SET total_points = total_points - ?, module_points = ?, updated_at = ? WHERE user_id = ?')
        .run(appliedTotal, JSON.stringify(mp), now, userId);
    }

    await tx.prepare(`
      INSERT INTO fraud_records (user_id, employee_id, month_year, quarter, reason, points_reset, module_breakdown, reviewer_id, reviewer_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, user.employee_id, monthKey(), quarter, reason, appliedTotal,
      JSON.stringify(applied), reviewer.id, reviewer.name);

    // 审计流水：dimension_id = NULL 代表"全部维度"（这是季度级事件，不属于某一个
    // 维度）。source='fraud' 让它与人工刚性归零在本表里可区分。
    await tx.prepare(`
      INSERT INTO quarterly_score_log
        (user_id, employee_id, quarter, dimension_id, module_id, type, delta, reason, actor_id, actor_name, source)
      VALUES (?, ?, ?, NULL, NULL, 'hard_zero_set', ?, ?, ?, ?, 'fraud')
    `).run(userId, user.employee_id, quarter, -appliedTotal, `弄虚作假：${reason}`, reviewer.id, reviewer.name);
  });

  res.json({
    success: true,
    quarter,
    pointsReset: appliedTotal,
    message: `已记录 ${user.name} 在 ${formatQuarter(quarter)} 弄虚作假：累计积分扣减 ${appliedTotal} 分，该季度六个维度全部归零并取消奖励资格`
  });
});

// GET /api/admin/fraud — list fraud records
router.get('/fraud', async (_req, res) => {
  const records = await db.prepare(`
    SELECT fr.*, u.name as employee_name
    FROM fraud_records fr JOIN users u ON fr.user_id = u.id
    ORDER BY fr.created_at DESC
  `).all();

  res.json({
    records: records.map(r => ({
      id: r.id,
      userId: r.user_id,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      quarter: r.quarter || quarterOfMonth(r.month_year),
      reason: r.reason,
      pointsReset: r.points_reset,
      reviewerName: r.reviewer_name,
      createdAt: r.created_at
    }))
  });
});

// DELETE /api/admin/fraud/:id — remove fraud and restore points (superadmin only)
//
// 恢复口径 = **当初扣掉的那份**，不是"现在这个季度有多少分"。
//
// 原实现在撤销时重算金额，只要两次记录之间有新的加分落库，加回的就会多于
// 当初扣掉的。本库里这就是坏的：fraud_records id=2 的 points_reset = 0，
// 而 user 6 名下现在有 5 分奖励 —— 旧代码撤销它会凭空加 5 分。
//
// 所以：总分按 points_reset 原样加回（它就是当初扣的数），分模块按存储的
// module_breakdown 快照加回。
router.delete('/fraud/:id', superAdminMiddleware, async (req, res) => {
  const fraud = await db.prepare('SELECT * FROM fraud_records WHERE id = ?').get(req.params.id);
  if (!fraud) return res.status(404).json({ message: '作假记录不存在' });

  const quarter = fraud.quarter || quarterOfMonth(fraud.month_year);
  const restoreTotal = Number(fraud.points_reset) || 0;

  let breakdown = {};
  try {
    breakdown = JSON.parse(fraud.module_breakdown || '{}') || {};
  } catch {
    breakdown = {};
  }

  // 遗留记录（本次迁移之前创建的）没有快照，module_breakdown 是默认的 '{}'。
  // 这类记录的分模块还原只能按当时的查询重算 —— 但**总额仍走 points_reset**，
  // 这正是旧实现的错处所在（它把总额也重算了）。
  // 口径与 POST 保持一致：净贡献（award − deduct），不是只算 award。
  if (Object.keys(breakdown).length === 0 && restoreTotal > 0 && quarter) {
    const rows = await db.prepare(`
      SELECT module_id,
             SUM(CASE WHEN type = 'award' THEN points ELSE -points END) AS pts
        FROM points_log
       WHERE user_id = ? AND quarter = ? AND type IN ('award', 'deduct')
       GROUP BY module_id HAVING pts > 0
    `).all(fraud.user_id, quarter);
    for (const row of rows) breakdown[String(row.module_id)] = Number(row.pts) || 0;
  }

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  await trx(async (tx) => {
    if (restoreTotal > 0) {
      const summary = await tx.prepare('SELECT * FROM points_summary WHERE user_id = ?').get(fraud.user_id);
      if (summary) {
        const mp = JSON.parse(summary.module_points || '{}');
        for (const [k, pts] of Object.entries(breakdown)) {
          mp[k] = (mp[k] || 0) + (Number(pts) || 0);
        }
        await tx.prepare('UPDATE points_summary SET total_points = total_points + ?, module_points = ?, updated_at = ? WHERE user_id = ?')
          .run(restoreTotal, JSON.stringify(mp), now, fraud.user_id);
      }
    }

    // 归零是派生的（quarterly.js 查 fraud_records），删掉这行分数自己就回来了，
    // 不需要反写任何维度状态。这条流水只是为了审计留痕。
    if (quarter) {
      const actor = await tx.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
      await tx.prepare(`
        INSERT INTO quarterly_score_log
          (user_id, employee_id, quarter, dimension_id, module_id, type, delta, reason, actor_id, actor_name, source)
        VALUES (?, ?, ?, NULL, NULL, 'hard_zero_clear', ?, ?, ?, ?, 'fraud')
      `).run(fraud.user_id, fraud.employee_id, quarter, restoreTotal,
        `撤销弄虚作假：${fraud.reason || ''}`, actor ? actor.id : null, actor ? actor.name : '');
    }

    // monthly_points 不再维护 —— 月度层已废弃。旧行原样留着，不"恢复"它们：
    // 那是个没人读的表，改它只会制造与 points_summary 不一致的第三个数字。
    await tx.prepare('DELETE FROM fraud_records WHERE id = ?').run(req.params.id);
  });

  res.json({
    success: true,
    pointsRestored: restoreTotal,
    message: `作假记录已删除，${formatQuarter(quarter)} 的归零已解除，累计积分恢复 ${restoreTotal} 分`
  });
});

function formatGroup(g) {
  return {
    id: g.id,
    name: g.name,
    quarter: g.quarter || quarterOfMonth(g.month_year),
    taskDescription: g.task_description,
    completionDescription: g.completion_description,
    status: g.status,
    memberCount: g.member_count,
    submissionId: g.submission_id,
    reviewerName: g.reviewer_name,
    reviewComment: g.review_comment,
    reviewedAt: g.reviewed_at,
    createdAt: g.created_at
  };
}

// ===== Registration Approval =====

// GET /api/admin/registrations — list pending registrations
router.get('/registrations', async (req, res) => {
  const { status = 'pending' } = req.query;
  const users = await db.prepare(`
    SELECT * FROM users WHERE status = ? ORDER BY created_at DESC
  `).all(status);

  res.json({
    items: users.map(u => ({
      id: u.id,
      username: u.username,
      employeeId: u.employee_id,
      name: u.name,
      department: u.department,
      avatarUrl: u.avatar_url,
      role: u.role,
      status: u.status,
      createdAt: u.created_at
    }))
  });
});

// POST /api/admin/registrations/:id/approve
router.post('/registrations/:id/approve', async (req, res) => {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ message: '用户不存在' });
  if (user.status !== 'pending') return res.status(400).json({ message: '该用户不在待审批状态' });

  await db.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString().replace('T', ' ').substring(0, 19), req.params.id);

  res.json({ success: true, message: `${user.name} 审批通过` });
});

// POST /api/admin/registrations/:id/reject
router.post('/registrations/:id/reject', async (req, res) => {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ message: '用户不存在' });
  if (user.status !== 'pending') return res.status(400).json({ message: '该用户不在待审批状态' });

  await db.prepare("UPDATE users SET status = 'disabled', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString().replace('T', ' ').substring(0, 19), req.params.id);

  res.json({ success: true, message: `${user.name} 已驳回` });
});

// ===== Module & Subcategory CRUD =====

// dimension_code 是前端所有维度分支/配色的稳定键，必须是这六个之一（或空 =
// 未分类的遗留模块）。写错一个字符，前端那个维度就会掉进 fallback 样式。
const DIMENSION_CODES = ['health', 'skill', 'growth', 'wisdom', 'duty', 'discipline'];

// 空值放行（遗留模块本来就没有维度码），非空则必须命中白名单。
// 不校验的话，管理员把 discipline 打成 dicipline，前端那个维度会静默掉进
// fallback 样式和 fallback 跳转逻辑，且没有任何报错。
// 返回错误消息而不是抛异常：admin.js 的 async 处理器没有统一错误中间件，
// 抛出会变成一个挂住的请求而不是 400。
function dimensionCodeError(v) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (s && !DIMENSION_CODES.includes(s)) {
    return `维度标识必须是 ${DIMENSION_CODES.join(' / ')} 之一`;
  }
  return null;
}

function normalizeDimensionCode(v) {
  return String(v === undefined || v === null ? '' : v).trim();
}

function toJsonArrayText(v, fallback = '[]') {
  if (v === undefined) return fallback;
  if (Array.isArray(v)) return JSON.stringify(v.map(String));
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return '[]';
    try {
      const parsed = JSON.parse(t);
      if (Array.isArray(parsed)) return JSON.stringify(parsed.map(String));
    } catch { /* 纯文本按单元素数组处理，管理员手敲「身体健康」也能存 */ }
    return JSON.stringify([t]);
  }
  return fallback;
}

// GET /api/admin/modules — list all modules (including inactive)
router.get('/modules', async (_req, res) => {
  // subBaseSum 随列表一起下发：「Σ 子项基础分 = 维度基础分」这个不变量最容易
  // 在管理员编辑子项时被破坏，把求和值送到会破坏它的那个对话框里。
  // 不这么做的话前端得为每个维度各发一次请求才能算出这个提示。
  const modules = (await db.prepare(`
    SELECT m.*,
      (SELECT COALESCE(SUM(s.base_score), 0) FROM subcategories s
        WHERE s.module_id = m.id AND s.is_active = 1) AS sub_base_sum,
      (SELECT COUNT(*) FROM subcategories s
        WHERE s.module_id = m.id AND s.is_active = 1) AS sub_count
    FROM modules m
    -- 未分类（dimension_code 为空）的都是停用的历史模块，一律排到最后：
    -- 新旧模块共用一张 sort_order 序列，不这样排会在管理列表里交错出现
    -- （能力、有健康、担当、有本领…），六个维度根本没法扫读。
    ORDER BY (m.dimension_code = ''), m.sort_order
  `).all());

  res.json({
    modules: modules.map(m => ({
      id: m.id,
      name: m.name,
      description: m.description,
      icon: m.icon,
      sortOrder: m.sort_order,
      isActive: !!m.is_active,
      dimensionCode: m.dimension_code || '',
      baseScore: m.base_score,
      bonusCap: m.bonus_cap,
      cycle: m.cycle || '',
      coreModules: parseJsonArray(m.core_modules),
      themeActivity: m.theme_activity || '',
      hasHardZero: !!m.has_hard_zero,
      subBaseSum: m.sub_base_sum,
      subCount: m.sub_count,
      createdAt: m.created_at
    }))
  });
});

// POST /api/admin/modules — create a module
router.post('/modules', async (req, res) => {
  const {
    name, description, icon, sortOrder,
    dimensionCode, baseScore, bonusCap, cycle, coreModules, themeActivity, hasHardZero
  } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: '请输入模块名称' });
  const codeErr = dimensionCodeError(dimensionCode);
  if (codeErr) return res.status(400).json({ message: codeErr });

  const result = await db.prepare(`
    INSERT INTO modules (name, description, icon, sort_order,
      dimension_code, base_score, bonus_cap, cycle, core_modules, theme_activity, has_hard_zero)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name.trim(), description || '', icon || '', sortOrder || 0,
    normalizeDimensionCode(dimensionCode), Number(baseScore) || 0, Number(bonusCap) || 0,
    cycle || '', toJsonArrayText(coreModules), themeActivity || '', hasHardZero ? 1 : 0
  );

  res.json({ success: true, id: result.lastInsertRowid });
});

// PUT /api/admin/modules/:id — update a module
//
// 注意：解构和 UPDATE 的列清单必须同步扩展。只在前端对话框加字段而不改这里，
// 新字段会被静默丢弃（不报错、不生效），是这套 CRUD 最容易踩的坑。
router.put('/modules/:id', async (req, res) => {
  const mod = await db.prepare('SELECT * FROM modules WHERE id = ?').get(req.params.id);
  if (!mod) return res.status(404).json({ message: '模块不存在' });

  const {
    name, description, icon, sortOrder,
    dimensionCode, baseScore, bonusCap, cycle, coreModules, themeActivity, hasHardZero
  } = req.body;

  const code = dimensionCode === undefined ? (mod.dimension_code || '') : normalizeDimensionCode(dimensionCode);
  const codeErr = dimensionCodeError(code);
  if (codeErr) return res.status(400).json({ message: codeErr });

  await db.prepare(`
    UPDATE modules SET name = ?, description = ?, icon = ?, sort_order = ?,
      dimension_code = ?, base_score = ?, bonus_cap = ?, cycle = ?, core_modules = ?,
      theme_activity = ?, has_hard_zero = ?
    WHERE id = ?
  `).run(
    name ? name.trim() : mod.name,
    description !== undefined ? description : mod.description,
    icon !== undefined ? icon : mod.icon,
    sortOrder !== undefined ? sortOrder : mod.sort_order,
    code,
    baseScore !== undefined ? (Number(baseScore) || 0) : mod.base_score,
    bonusCap !== undefined ? (Number(bonusCap) || 0) : mod.bonus_cap,
    cycle !== undefined ? cycle : mod.cycle,
    toJsonArrayText(coreModules, mod.core_modules || '[]'),
    themeActivity !== undefined ? themeActivity : mod.theme_activity,
    hasHardZero !== undefined ? (hasHardZero ? 1 : 0) : mod.has_hard_zero,
    req.params.id
  );

  res.json({ success: true });
});

// PUT /api/admin/modules/:id/toggle — toggle module active state
router.put('/modules/:id/toggle', async (req, res) => {
  const mod = await db.prepare('SELECT * FROM modules WHERE id = ?').get(req.params.id);
  if (!mod) return res.status(404).json({ message: '模块不存在' });

  const newState = mod.is_active ? 0 : 1;
  await db.prepare('UPDATE modules SET is_active = ? WHERE id = ?').run(newState, req.params.id);
  res.json({ success: true, isActive: !!newState });
});

// GET /api/admin/modules/:moduleId/subcategories
router.get('/modules/:moduleId/subcategories', async (req, res) => {
  const subcategories = await db.prepare(`
    SELECT * FROM subcategories WHERE module_id = ? ORDER BY sort_order
  `).all(req.params.moduleId);

  res.json({
    subcategories: subcategories.map(s => ({
      id: s.id,
      moduleId: s.module_id,
      name: s.name,
      description: s.description,
      points: s.points,
      maxTimes: s.max_times,
      requiresPhoto: !!s.requires_photo,
      sortOrder: s.sort_order,
      isActive: !!s.is_active,
      baseScore: s.base_score,
      scoreRule: s.score_rule || '',
      bonusRule: s.bonus_rule || '',
      bonusCap: s.bonus_cap,
      themeActivity: parseJsonArray(s.theme_activity),
      evidenceRequired: s.evidence_required || ''
    }))
  });
});

// POST /api/admin/subcategories — create subcategory
router.post('/subcategories', async (req, res) => {
  const {
    moduleId, name, description, points, maxTimes, requiresPhoto, sortOrder,
    baseScore, scoreRule, bonusRule, bonusCap, themeActivity, evidenceRequired
  } = req.body;
  if (!moduleId || !name || !name.trim()) return res.status(400).json({ message: '请填写模块和子项名称' });

  const mod = await db.prepare('SELECT * FROM modules WHERE id = ?').get(moduleId);
  if (!mod) return res.status(404).json({ message: '模块不存在' });

  const result = await db.prepare(`
    INSERT INTO subcategories (module_id, name, description, points, max_times, requires_photo, sort_order,
      base_score, score_rule, bonus_rule, bonus_cap, theme_activity, evidence_required)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    moduleId, name.trim(), description || '', points || 0, maxTimes || 0, requiresPhoto ? 1 : 0, sortOrder || 0,
    Number(baseScore) || 0, scoreRule || '', bonusRule || '', Number(bonusCap) || 0,
    toJsonArrayText(themeActivity), evidenceRequired || ''
  );

  res.json({ success: true, id: result.lastInsertRowid });
});

// PUT /api/admin/subcategories/:id — update subcategory
router.put('/subcategories/:id', async (req, res) => {
  const sub = await db.prepare('SELECT * FROM subcategories WHERE id = ?').get(req.params.id);
  if (!sub) return res.status(404).json({ message: '子项不存在' });

  const {
    name, description, points, maxTimes, requiresPhoto, sortOrder,
    baseScore, scoreRule, bonusRule, bonusCap, themeActivity, evidenceRequired
  } = req.body;
  await db.prepare(`
    UPDATE subcategories SET name = ?, description = ?, points = ?, max_times = ?, requires_photo = ?, sort_order = ?,
      base_score = ?, score_rule = ?, bonus_rule = ?, bonus_cap = ?, theme_activity = ?, evidence_required = ?
    WHERE id = ?
  `).run(
    name ? name.trim() : sub.name,
    description !== undefined ? description : sub.description,
    points !== undefined ? points : sub.points,
    maxTimes !== undefined ? maxTimes : sub.max_times,
    requiresPhoto !== undefined ? (requiresPhoto ? 1 : 0) : sub.requires_photo,
    sortOrder !== undefined ? sortOrder : sub.sort_order,
    baseScore !== undefined ? (Number(baseScore) || 0) : sub.base_score,
    scoreRule !== undefined ? scoreRule : sub.score_rule,
    bonusRule !== undefined ? bonusRule : sub.bonus_rule,
    bonusCap !== undefined ? (Number(bonusCap) || 0) : sub.bonus_cap,
    toJsonArrayText(themeActivity, sub.theme_activity || '[]'),
    evidenceRequired !== undefined ? evidenceRequired : sub.evidence_required,
    req.params.id
  );

  res.json({ success: true });
});

// PUT /api/admin/subcategories/:id/toggle — toggle subcategory active state
router.put('/subcategories/:id/toggle', async (req, res) => {
  const sub = await db.prepare('SELECT * FROM subcategories WHERE id = ?').get(req.params.id);
  if (!sub) return res.status(404).json({ message: '子项不存在' });

  const newState = sub.is_active ? 0 : 1;
  await db.prepare('UPDATE subcategories SET is_active = ? WHERE id = ?').run(newState, req.params.id);
  res.json({ success: true, isActive: !!newState });
});

// ===== Quarterly Scoring =====

// 本季度有作假记录的人 → 作假原因。
//
// 以前这里返回的是"月份区间内的月份列表"，季度化之后那样会渲染出
// 「（2026-07）」这种月份串出现在季度口径的界面里，而且只对完全相同的月份串
// 去重，遗留月度记录 + 新记录会显示成两个。现在直接按 quarter 查，
// 有就是有。
async function fraudReasonByUser(quarter) {
  const rows = await db.prepare(
    'SELECT user_id, reason FROM fraud_records WHERE quarter = ?'
  ).all(quarter);

  const out = {};
  for (const r of rows) if (!(r.user_id in out)) out[r.user_id] = r.reason || '';
  return out;
}

// 作假期间的季度分是**派生**归零的（quarterly.js 查 fraud_records），任何人工
// 录入的扣分/归零都会被那层归零盖住 —— 管理员录下一笔永远不可见的扣分，
// 等作假被撤销时它才突然出现。所以直接拒绝，并告诉管理员先撤销什么。
//
// 返回消息字符串（null = 没作假），不抛错：admin.js 的 async 处理器没有统一
// 错误中间件（Express 4），抛出是挂住的请求而不是 500。
async function fraudLockMessage(db, userId, quarter) {
  const rec = await db.prepare(
    'SELECT id, reason FROM fraud_records WHERE user_id = ? AND quarter = ? LIMIT 1'
  ).get(userId, quarter);
  if (!rec) return null;
  return `该员工在 ${formatQuarter(quarter)} 已被弄虚作假归零（记录 #${rec.id}），`
    + '六个维度均为 0 分，无需再录扣分；如需调整请先在作假管理中撤销该记录';
}

// 季度名册 + 排名 + 调休天数。排名与调休档位只在服务端算一处，
// 前端不得自行推导 —— 员工申诉时引用的就是这个口径。
async function quarterlyRoster(quarter) {
  const users = await listScorableUsers(db);
  const scores = await buildQuarterlyScores(db, quarter, users.map(u => u.id));
  const maxRow = await db.prepare(
    'SELECT COALESCE(SUM(base_score + bonus_cap), 0) AS m FROM modules WHERE is_active = 1'
  ).get();
  const fraud = await fraudReasonByUser(quarter);

  const all = users.map(u => {
    const s = scores.get(u.id);
    return {
      userId: u.id,
      employeeId: u.employee_id,
      name: u.name,
      department: u.department,
      totalScore: s.totalScore,
      eligible: s.eligible,
      hardZeroCount: s.hardZeroCount,
      rewardIneligible: !s.eligible,
      // fraudZero 与 hardZero 分开传：界面要能说"弄虚作假（全部维度）"，
      // 而不是把一次作假事件渲染成"刚性归零 6 项"。
      fraudZero: !!s.fraudZero,
      fraudReason: s.fraudReason || fraud[u.id] || '',
      dimensions: s.dimensions
    };
  }).sort((a, b) => b.totalScore - a.totalScore || a.userId - b.userId);

  // 排名只在合格者之间做。奖励是按名次的（第 7-10 名也有 0.5 天），
  // 被刚性归零的人总分仍可能进前 10，所以必须整行剔除而不是记 0 分留在表里。
  const rows = all.filter(r => r.eligible);
  rows.forEach((r, i) => {
    r.rank = i + 1;
    r.leaveDays = leaveDaysForRank(i + 1);
  });

  const ineligible = all.filter(r => !r.eligible).map(r => {
    r.rank = null;
    r.leaveDays = 0;
    return r;
  });

  return { quarter, maxScore: Number(maxRow.m) || 0, rows, ineligible };
}

const REWARD_PAYLOAD = {
  tiers: REWARD_TIERS,
  usageNote: REWARD_USAGE_NOTE,
  process: REWARD_PROCESS,
  importantNote: REWARD_IMPORTANT_NOTE
};

// GET /api/admin/quarterly?quarter=2026-Q3
router.get('/quarterly', async (req, res) => {
  const quarter = req.query.quarter || quarterKey();
  if (!isValidQuarter(quarter)) return res.status(400).json({ message: '季度格式无效，应为 YYYY-QN' });

  const roster = await quarterlyRoster(quarter);
  const snap = await db.prepare(
    `SELECT COUNT(*) AS cnt, MAX(locked_at) AS locked_at, MAX(locked_by) AS locked_by
       FROM quarterly_reward_snapshots WHERE quarter = ?`
  ).get(quarter);

  res.json({
    ...roster,
    locked: !!(snap && snap.cnt > 0),
    lockedAt: snap ? snap.locked_at : null,
    lockedBy: snap ? snap.locked_by : null,
    reward: REWARD_PAYLOAD
  });
});

// GET /api/admin/quarterly/ranking?quarter= — 已锁定则返回冻结快照，否则返回实时排名
router.get('/quarterly/ranking', async (req, res) => {
  const quarter = req.query.quarter || quarterKey();
  if (!isValidQuarter(quarter)) return res.status(400).json({ message: '季度格式无效，应为 YYYY-QN' });

  const snapshots = await db.prepare(
    `SELECT rank, user_id, employee_id, employee_name, department, total_score, leave_days, hard_zero_count
       FROM quarterly_reward_snapshots WHERE quarter = ? ORDER BY rank`
  ).all(quarter);

  if (snapshots.length > 0) {
    return res.json({
      quarter,
      locked: true,
      source: 'snapshot',
      rows: snapshots.map(s => ({
        rank: s.rank,
        userId: s.user_id,
        employeeId: s.employee_id,
        name: s.employee_name,
        department: s.department,
        totalScore: s.total_score,
        leaveDays: s.leave_days,
        hardZeroCount: s.hard_zero_count
      })),
      reward: REWARD_PAYLOAD
    });
  }

  const roster = await quarterlyRoster(quarter);
  res.json({
    quarter,
    locked: false,
    source: 'live',
    maxScore: roster.maxScore,
    rows: roster.rows.map(r => ({
      rank: r.rank,
      userId: r.userId,
      employeeId: r.employeeId,
      name: r.name,
      department: r.department,
      totalScore: r.totalScore,
      leaveDays: r.leaveDays,
      hardZeroCount: r.hardZeroCount,
      fraudZero: r.fraudZero,
      fraudReason: r.fraudReason
    })),
    ineligible: roster.ineligible.map(r => ({
      userId: r.userId,
      name: r.name,
      department: r.department,
      totalScore: r.totalScore,
      hardZeroCount: r.hardZeroCount,
      fraudZero: r.fraudZero,
      fraudReason: r.fraudReason
    })),
    reward: REWARD_PAYLOAD
  });
});

// PUT /api/admin/quarterly/score — 录入某模块的扣分
//
// 只接受扣分，不接受得分：模块基础分是满分（季初默认满分，管理员录扣分）。
// base_score 在此快照落库，防止后台改基础分回写历史季度。
router.put('/quarterly/score', async (req, res) => {
  const { userId, quarter, moduleId, deduction, reason } = req.body;
  if (!isValidQuarter(quarter)) return res.status(400).json({ message: '季度格式无效，应为 YYYY-QN' });

  const d = Number(deduction);
  if (!Number.isInteger(d) || d < 0) return res.status(400).json({ message: '扣分必须是非负整数' });

  const user = await db.prepare('SELECT id, employee_id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ message: '员工不存在' });

  const fraudLock = await fraudLockMessage(db, userId, quarter);
  if (fraudLock) return res.status(409).json({ message: fraudLock, code: 'FRAUD_LOCKED' });

  // moduleId 是 subcategories.id（模块），其 module_id 指向所属维度（modules.id）
  const mod = await db.prepare('SELECT * FROM subcategories WHERE id = ?').get(moduleId);
  if (!mod) return res.status(404).json({ message: '模块不存在' });

  if (d > Number(mod.base_score || 0)) {
    return res.status(400).json({
      message: `该模块基础分 ${mod.base_score} 分，扣分不能超过基础分`
    });
  }

  const actor = await db.prepare('SELECT id, name FROM users WHERE id = ?').get(req.user.id);
  const before = await db.prepare(
    'SELECT deduction FROM quarterly_module_scores WHERE user_id = ? AND quarter = ? AND module_id = ?'
  ).get(userId, quarter, moduleId);
  const prev = before ? Number(before.deduction) || 0 : 0;

  await trx(async (tx) => {
    await tx.prepare(`
      INSERT INTO quarterly_module_scores
        (user_id, employee_id, quarter, dimension_id, module_id, module_name, base_score, deduction, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, quarter, module_id) DO UPDATE SET
        deduction = excluded.deduction,
        base_score = excluded.base_score,
        module_name = excluded.module_name,
        updated_at = excluded.updated_at
    `).run(userId, user.employee_id, quarter, mod.module_id, mod.id, mod.name,
      Number(mod.base_score) || 0, d);

    // 0 → 0 不写流水（界面每敲一次数字就发一次请求的噪声不落库）；
    // 归零则记一条 deduction_revert，审计上要能看出"扣分被撤销"
    if (d !== prev) {
      await tx.prepare(`
        INSERT INTO quarterly_score_log
          (user_id, employee_id, quarter, dimension_id, module_id, type, delta, reason, actor_id, actor_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, user.employee_id, quarter, mod.module_id, mod.id,
        d === 0 ? 'deduction_revert' : 'deduction',
        d === 0 ? -prev : d - prev, reason || '', actor.id, actor.name);
    }
  });

  const scores = await buildQuarterlyScores(db, quarter, [Number(userId)]);
  const me = scores.get(Number(userId));
  const dim = me ? me.dimensions.find(x => x.dimensionId === mod.module_id) : null;

  res.json({
    success: true,
    moduleScore: Math.max(0, Number(mod.base_score || 0) - d),
    dimension: dim || null,
    quarterly: me || null
  });
});

// PUT /api/admin/quarterly/status — 刚性归零的开启/解除（维度级）
router.put('/quarterly/status', async (req, res) => {
  const { userId, quarter, dimensionId, hardZero, reason } = req.body;
  if (!isValidQuarter(quarter)) return res.status(400).json({ message: '季度格式无效，应为 YYYY-QN' });

  const dim = await db.prepare('SELECT * FROM modules WHERE id = ? AND is_active = 1').get(dimensionId);
  if (!dim) return res.status(404).json({ message: '维度不存在或已停用' });
  if (!dim.has_hard_zero) {
    return res.status(400).json({ message: `「${dim.name}」未启用刚性归零` });
  }

  const user = await db.prepare('SELECT id, employee_id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ message: '员工不存在' });

  const fraudLock = await fraudLockMessage(db, userId, quarter);
  if (fraudLock) return res.status(409).json({ message: fraudLock, code: 'FRAUD_LOCKED' });

  const isSuper = req.user.role === 'superadmin';
  const turningOn = !!hardZero;

  // 开启限管理员，解除限超管 —— 归零会取消季度奖励资格，解除是推翻这个决定，
  // 权限不该对等。
  if (!turningOn && !isSuper) {
    return res.status(403).json({ message: '仅超级管理员可解除刚性归零' });
  }
  // 原因必填：申诉流程需要能答复"为什么把我归零"
  if (turningOn && (!reason || !String(reason).trim())) {
    return res.status(400).json({ message: '请填写刚性归零原因' });
  }

  const actor = await db.prepare('SELECT id, name FROM users WHERE id = ?').get(req.user.id);
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  await trx(async (tx) => {
    // 已入账的加分不删除：删了审计链断掉、解除时也无法重建（会重复计分）。
    // 归零只是把维度得分压到 0，解除后加分自动恢复。
    await tx.prepare(`
      INSERT INTO quarterly_dimension_status
        (user_id, employee_id, quarter, dimension_id, hard_zero, reason, reward_ineligible,
         set_by, set_by_name, set_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, quarter, dimension_id) DO UPDATE SET
        hard_zero = excluded.hard_zero,
        reason = excluded.reason,
        reward_ineligible = excluded.reward_ineligible,
        set_by = excluded.set_by,
        set_by_name = excluded.set_by_name,
        set_at = excluded.set_at
    `).run(userId, user.employee_id, quarter, dim.id,
      turningOn ? 1 : 0, String(reason || '').trim(), turningOn ? 1 : 0,
      actor.id, actor.name, now);

    await tx.prepare(`
      INSERT INTO quarterly_score_log
        (user_id, employee_id, quarter, dimension_id, type, delta, reason, actor_id, actor_name)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(userId, user.employee_id, quarter, dim.id,
      turningOn ? 'hard_zero_set' : 'hard_zero_clear',
      String(reason || '').trim(), actor.id, actor.name);
  });

  const scores = await buildQuarterlyScores(db, quarter, [Number(userId)]);
  res.json({ success: true, quarterly: scores.get(Number(userId)) || null });
});

// POST /api/admin/quarterly/lock — 冻结本季度排名快照（超管）
//
// 规范链路是"锁定 → 导出 → 公示 → 申诉 → 备案"。没有快照的话，公示期间任何
// 一次扣分录入都会悄悄改掉一份已经给员工看过、已经报出去的排名。
router.post('/quarterly/lock', superAdminMiddleware, async (req, res) => {
  const quarter = req.body.quarter || quarterKey();
  if (!isValidQuarter(quarter)) return res.status(400).json({ message: '季度格式无效，应为 YYYY-QN' });

  const existing = (await db.prepare(
    'SELECT COUNT(*) AS cnt FROM quarterly_reward_snapshots WHERE quarter = ?'
  ).get(quarter)).cnt;
  if (existing > 0) {
    return res.status(400).json({ message: `${quarter} 已锁定，不可重复锁定` });
  }

  const roster = await quarterlyRoster(quarter);
  if (roster.rows.length === 0) {
    return res.status(400).json({ message: '该季度没有可参与排名的员工，无法锁定' });
  }

  const actor = await db.prepare('SELECT name FROM users WHERE id = ?').get(req.user.id);

  await trx(async (tx) => {
    for (const r of roster.rows) {
      await tx.prepare(`
        INSERT INTO quarterly_reward_snapshots
          (quarter, user_id, employee_id, employee_name, department, rank, total_score,
           leave_days, hard_zero_count, locked_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(quarter, user_id) DO UPDATE SET
          rank = excluded.rank, total_score = excluded.total_score, leave_days = excluded.leave_days,
          hard_zero_count = excluded.hard_zero_count, locked_at = datetime('now'), locked_by = excluded.locked_by
      `).run(quarter, r.userId, r.employeeId, r.name, r.department, r.rank, r.totalScore,
        r.leaveDays, r.hardZeroCount, actor ? actor.name : '');
    }

    // 快照是quarter级的，但有活人就有用户行；lock 流水记在每个被冻结的人身上，
    // 保证"这个人这个季度的分是什么时候被冻的"可从流水回答。
    for (const r of roster.rows) {
      await tx.prepare(`
        INSERT INTO quarterly_score_log
          (user_id, employee_id, quarter, type, delta, reason, actor_id, actor_name)
        VALUES (?, ?, ?, 'lock', 0, ?, ?, ?)
      `).run(r.userId, r.employeeId, quarter, `锁定排名第 ${r.rank} 名`, req.user.id, actor ? actor.name : '');
    }
  });

  res.json({
    success: true,
    message: `已锁定 ${quarter} 排名，共 ${roster.rows.length} 人`,
    count: roster.rows.length
  });
});

module.exports = router;
