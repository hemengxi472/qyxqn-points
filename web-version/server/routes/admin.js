const express = require('express');
const { db, trx } = require('../db');
const { authMiddleware, adminMiddleware, superAdminMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, adminMiddleware);

const GROUP_TASK_POINTS = 5;

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
  res.json({ submission: formatSubmission(submission) });
});

// POST /api/admin/reviews/:id/action
router.post('/reviews/:id/action', async (req, res) => {
  const { action, points, comment } = req.body;
  if (!action || (action !== 'approve' && action !== 'reject')) {
    return res.status(400).json({ message: '无效操作' });
  }
  if (action === 'approve' && (!points || points < 0)) {
    return res.status(400).json({ message: '请填写有效积分' });
  }

  const sub = await db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!sub) return res.status(404).json({ message: '申请记录不存在' });
  if (sub.status !== 'pending') return res.status(400).json({ message: '该申请已审核，不可重复操作' });

  const reviewer = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  await trx(async (tx) => {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    if (action === 'approve') {
      await tx.prepare(`
        UPDATE submissions SET status = 'approved', points_awarded = ?, reviewer_id = ?, reviewer_name = ?, review_comment = ?, reviewed_at = ?
        WHERE id = ?
      `).run(points, reviewer.id, reviewer.name, comment || '', now, req.params.id);

      await tx.prepare(`
        INSERT INTO points_log (user_id, employee_id, submission_id, module_id, module_name, subcategory_name, points, type, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'award', ?)
      `).run(sub.user_id, sub.employee_id, sub.id, sub.module_id, sub.module_name, sub.subcategory_name, points, `${sub.subcategory_name} - ${sub.description || '审核通过'}`);

      const summary = await tx.prepare('SELECT * FROM points_summary WHERE user_id = ?').get(sub.user_id);
      const moduleKey = String(sub.module_id);

      if (!summary) {
        await tx.prepare(`
          INSERT INTO points_summary (user_id, employee_id, total_points, module_points, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(sub.user_id, sub.employee_id, points, JSON.stringify({ [moduleKey]: points }), now);
      } else {
        const mp = JSON.parse(summary.module_points || '{}');
        mp[moduleKey] = (mp[moduleKey] || 0) + points;
        await tx.prepare(`
          UPDATE points_summary SET total_points = total_points + ?, module_points = ?, updated_at = ?
          WHERE user_id = ?
        `).run(points, JSON.stringify(mp), now, sub.user_id);
      }
    } else {
      await tx.prepare(`
        UPDATE submissions SET status = 'rejected', reviewer_id = ?, reviewer_name = ?, review_comment = ?, reviewed_at = ?
        WHERE id = ?
      `).run(reviewer.id, reviewer.name, comment || '', now, req.params.id);
    }
  });

  res.json({ success: true, action });
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

  const modules = (await db.prepare('SELECT id, name FROM modules WHERE is_active = 1 ORDER BY sort_order').all());
  const allSummaries = (await db.prepare('SELECT * FROM points_summary').all());

  const pointsByModule = {};
  modules.forEach(m => { pointsByModule[m.name] = 0; });
  allSummaries.forEach(s => {
    const mp = JSON.parse(s.module_points || '{}');
    modules.forEach(m => {
      pointsByModule[m.name] = (pointsByModule[m.name] || 0) + (mp[String(m.id)] || 0);
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

  // Group stats
  const currentMonth = new Date().toISOString().substring(0, 7);
  const groupStats = await db.prepare(`
    SELECT status, COUNT(*) as cnt FROM groups WHERE month_year = ?
    GROUP BY status
  `).all(currentMonth);
  const groupCounts = { active: 0, submitted: 0, approved: 0, rejected: 0 };
  for (const r of groupStats) { groupCounts[r.status] = r.cnt; }

  const submittedGroups = await db.prepare(`
    SELECT g.*, (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
    FROM groups g WHERE g.month_year = ? AND g.status = 'submitted'
    ORDER BY g.created_at DESC
  `).all(currentMonth);

  res.json({
    totalEmployees: empCount,
    totalSubmissions: subTotal,
    pendingReview: pendingCount,
    fraudRecords: fraudCount,
    pointsByModule: Object.entries(pointsByModule).map(([name, total]) => ({ moduleName: name, total })),
    topEmployees,
    groups: {
      monthYear: currentMonth,
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
  const monthYear = new Date().toISOString().substring(0, 7);

  const existing = (await db.prepare('SELECT COUNT(*) as cnt FROM groups WHERE month_year = ?').get(monthYear)).cnt;
  if (existing > 0) {
    return res.status(400).json({ message: `${monthYear} 团队已生成，如需重新生成请先删除` });
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
      const name = `${monthYear.replace('-', '年')}月 第${groupNum}组`;
      const result = await tx.prepare(`
        INSERT INTO groups (name, month_year, created_at) VALUES (?, ?, ?)
      `).run(name, monthYear, now);
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
    FROM groups g WHERE g.month_year = ? ORDER BY g.name
  `).all(monthYear);

  res.json({ groups: created.map(formatGroup), monthYear });
});

// GET /api/admin/groups — list groups
router.get('/groups', async (req, res) => {
  const { monthYear } = req.query;
  let where = '';
  const params = [];
  if (monthYear) {
    where = 'WHERE month_year = ?';
    params.push(monthYear);
  }
  const groups = await db.prepare(`
    SELECT g.*, (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
    FROM groups g ${where} ORDER BY g.month_year DESC, g.name
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

  let responseMessage = '';

  await trx(async (tx) => {
    if (action === 'approved') {
      const points = GROUP_TASK_POINTS;

      await tx.prepare(`
        UPDATE submissions SET status = 'approved', points_awarded = ?, reviewer_id = ?, reviewer_name = ?, reviewed_at = ?
        WHERE id = ?
      `).run(points, reviewer.id, reviewer.name, now, group.submission_id);

      await tx.prepare(`
        UPDATE groups SET status = 'approved', reviewer_name = ?, review_comment = ?, reviewed_at = ?
        WHERE id = ?
      `).run(reviewer.name, '审核通过', now, group.id);

      for (const m of allMembers) {
        await tx.prepare(`
          INSERT INTO points_log (user_id, employee_id, submission_id, module_id, module_name,
            subcategory_name, points, type, description, month_year)
          VALUES (?, ?, ?, 4, '纪律', '团队任务完成', ?, 'award', ?, ?)
        `).run(m.user_id, m.employee_id, group.submission_id, points,
          `团队任务完成 - ${group.name}`, group.month_year);

        const summary = await tx.prepare('SELECT * FROM points_summary WHERE user_id = ?').get(m.user_id);
        if (!summary) {
          await tx.prepare(`
            INSERT INTO points_summary (user_id, employee_id, total_points, module_points, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(m.user_id, m.employee_id, points, JSON.stringify({ '4': points }), now);
        } else {
          const mp = JSON.parse(summary.module_points || '{}');
          mp['4'] = (mp['4'] || 0) + points;
          await tx.prepare(`
            UPDATE points_summary SET total_points = total_points + ?, module_points = ?, updated_at = ?
            WHERE user_id = ?
          `).run(points, JSON.stringify(mp), now, m.user_id);
        }

        const mpRow = await tx.prepare('SELECT * FROM monthly_points WHERE user_id = ? AND month_year = ?')
          .get(m.user_id, group.month_year);
        if (mpRow) {
          if (!mpRow.is_fraud_reset) {
            await tx.prepare('UPDATE monthly_points SET points = points + ?, updated_at = ? WHERE id = ?')
              .run(points, now, mpRow.id);
          }
        } else {
          await tx.prepare('INSERT INTO monthly_points (user_id, employee_id, month_year, points) VALUES (?, ?, ?, ?)')
            .run(m.user_id, m.employee_id, group.month_year, points);
        }
      }

      responseMessage = `已通过，${allMembers.length} 位成员各获得 ${points} 积分`;
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

// POST /api/admin/tasks — create/update unified monthly task
router.post('/tasks', async (req, res) => {
  const { monthYear, taskDescription } = req.body;
  if (!monthYear || !taskDescription || !taskDescription.trim()) {
    return res.status(400).json({ message: '请提供月份和任务描述' });
  }

  const existing = await db.prepare('SELECT * FROM monthly_tasks WHERE month_year = ?').get(monthYear);

  if (existing) {
    await db.prepare('UPDATE monthly_tasks SET task_description = ?, created_by = ?, created_at = datetime(\'now\') WHERE id = ?')
      .run(taskDescription.trim(), req.user.id, existing.id);
  } else {
    await db.prepare('INSERT INTO monthly_tasks (month_year, task_description, created_by) VALUES (?, ?, ?)')
      .run(monthYear, taskDescription.trim(), req.user.id);
  }

  res.json({ success: true, message: '月度任务已保存' });
});

// GET /api/admin/tasks — list all monthly tasks
router.get('/tasks', async (_req, res) => {
  const tasks = await db.prepare('SELECT * FROM monthly_tasks ORDER BY month_year DESC').all();
  res.json({
    tasks: tasks.map(t => ({
      id: t.id,
      monthYear: t.month_year,
      taskDescription: t.task_description,
      createdBy: t.created_by,
      createdAt: t.created_at
    }))
  });
});

// GET /api/admin/tasks/:monthYear — get task for specific month
router.get('/tasks/:monthYear', async (req, res) => {
  const task = await db.prepare('SELECT * FROM monthly_tasks WHERE month_year = ?').get(req.params.monthYear);
  res.json({
    task: task ? {
      id: task.id,
      monthYear: task.month_year,
      taskDescription: task.task_description,
      createdBy: task.created_by,
      createdAt: task.created_at
    } : null
  });
});

// POST /api/admin/fraud — report fraud
router.post('/fraud', async (req, res) => {
  const { userId, monthYear, reason } = req.body;
  if (!userId || !monthYear || !reason) return res.status(400).json({ message: '请填写完整信息' });

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ message: '员工不存在' });

  // Calculate points for that month from points_log
  const monthLogs = await db.prepare(`
    SELECT SUM(points) as total FROM points_log
    WHERE user_id = ? AND month_year = ? AND type = 'award'
  `).get(userId, monthYear);

  const totalMonthPoints = monthLogs.total || 0;
  const reviewer = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  await trx(async (tx) => {
    // Insert fraud record
    await tx.prepare(`
      INSERT INTO fraud_records (user_id, employee_id, month_year, reason, points_reset, reviewer_id, reviewer_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, user.employee_id, monthYear, reason, totalMonthPoints, reviewer.id, reviewer.name);

    // Zero monthly points
    const mpRow = await tx.prepare('SELECT * FROM monthly_points WHERE user_id = ? AND month_year = ?').get(userId, monthYear);
    if (mpRow) {
      await tx.prepare('UPDATE monthly_points SET points = 0, is_fraud_reset = 1, updated_at = ? WHERE id = ?')
        .run(now, mpRow.id);
    } else {
      await tx.prepare('INSERT INTO monthly_points (user_id, employee_id, month_year, points, is_fraud_reset) VALUES (?, ?, ?, 0, 1)')
        .run(userId, user.employee_id, monthYear);
    }

    // Deduct from points_summary
    if (totalMonthPoints > 0) {
      const summary = await tx.prepare('SELECT * FROM points_summary WHERE user_id = ?').get(userId);
      if (summary) {
        const mp = JSON.parse(summary.module_points || '{}');
        const modBreakdown = await tx.prepare(`
          SELECT module_id, SUM(points) as pts FROM points_log
          WHERE user_id = ? AND month_year = ? AND type = 'award'
          GROUP BY module_id
        `).all(userId, monthYear);

        for (const row of modBreakdown) {
          const key = String(row.module_id);
          mp[key] = Math.max(0, (mp[key] || 0) - row.pts);
        }

        const newTotal = Math.max(0, summary.total_points - totalMonthPoints);
        await tx.prepare('UPDATE points_summary SET total_points = ?, module_points = ?, updated_at = ? WHERE user_id = ?')
          .run(newTotal, JSON.stringify(mp), now, userId);
      }
    }
  });

  res.json({ success: true, message: `已将 ${user.name} ${monthYear} 的 ${totalMonthPoints} 积分清零` });
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
      monthYear: r.month_year,
      reason: r.reason,
      pointsReset: r.points_reset,
      reviewerName: r.reviewer_name,
      createdAt: r.created_at
    }))
  });
});

// DELETE /api/admin/fraud/:id — remove fraud and restore points (superadmin only)
router.delete('/fraud/:id', superAdminMiddleware, async (req, res) => {
  const fraud = await db.prepare('SELECT * FROM fraud_records WHERE id = ?').get(req.params.id);
  if (!fraud) return res.status(404).json({ message: '作假记录不存在' });

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  await trx(async (tx) => {
    // Recalculate points for that month
    const monthLogs = await tx.prepare(`
      SELECT SUM(points) as total FROM points_log
      WHERE user_id = ? AND month_year = ? AND type = 'award'
    `).get(fraud.user_id, fraud.month_year);

    const recalculated = monthLogs.total || 0;

    // Restore monthly_points
    await tx.prepare('UPDATE monthly_points SET points = ?, is_fraud_reset = 0, updated_at = ? WHERE user_id = ? AND month_year = ?')
      .run(recalculated, now, fraud.user_id, fraud.month_year);

    // Restore points_summary
    const summary = await tx.prepare('SELECT * FROM points_summary WHERE user_id = ?').get(fraud.user_id);
    if (summary && recalculated > 0) {
      const modBreakdown = await tx.prepare(`
        SELECT module_id, SUM(points) as pts FROM points_log
        WHERE user_id = ? AND month_year = ? AND type = 'award'
        GROUP BY module_id
      `).all(fraud.user_id, fraud.month_year);

      const mp = JSON.parse(summary.module_points || '{}');
      for (const row of modBreakdown) {
        const key = String(row.module_id);
        mp[key] = (mp[key] || 0) + row.pts;
      }

      await tx.prepare('UPDATE points_summary SET total_points = total_points + ?, module_points = ?, updated_at = ? WHERE user_id = ?')
        .run(recalculated, JSON.stringify(mp), now, fraud.user_id);
    }

    await tx.prepare('DELETE FROM fraud_records WHERE id = ?').run(req.params.id);
  });

  res.json({ success: true, message: '作假记录已删除，积分已恢复' });
});

function formatGroup(g) {
  return {
    id: g.id,
    name: g.name,
    monthYear: g.month_year,
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

// GET /api/admin/modules — list all modules (including inactive)
router.get('/modules', async (_req, res) => {
  const modules = (await db.prepare('SELECT * FROM modules ORDER BY sort_order').all());
  res.json({
    modules: modules.map(m => ({
      id: m.id,
      name: m.name,
      description: m.description,
      icon: m.icon,
      sortOrder: m.sort_order,
      isActive: !!m.is_active,
      createdAt: m.created_at
    }))
  });
});

// POST /api/admin/modules — create a module
router.post('/modules', async (req, res) => {
  const { name, description, icon, sortOrder } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: '请输入模块名称' });

  const result = await db.prepare(`
    INSERT INTO modules (name, description, icon, sort_order) VALUES (?, ?, ?, ?)
  `).run(name.trim(), description || '', icon || '', sortOrder || 0);

  res.json({ success: true, id: result.lastInsertRowid });
});

// PUT /api/admin/modules/:id — update a module
router.put('/modules/:id', async (req, res) => {
  const mod = await db.prepare('SELECT * FROM modules WHERE id = ?').get(req.params.id);
  if (!mod) return res.status(404).json({ message: '模块不存在' });

  const { name, description, icon, sortOrder } = req.body;
  await db.prepare(`
    UPDATE modules SET name = ?, description = ?, icon = ?, sort_order = ? WHERE id = ?
  `).run(
    name ? name.trim() : mod.name,
    description !== undefined ? description : mod.description,
    icon !== undefined ? icon : mod.icon,
    sortOrder !== undefined ? sortOrder : mod.sort_order,
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
      isActive: !!s.is_active
    }))
  });
});

// POST /api/admin/subcategories — create subcategory
router.post('/subcategories', async (req, res) => {
  const { moduleId, name, description, points, maxTimes, requiresPhoto, sortOrder } = req.body;
  if (!moduleId || !name || !name.trim()) return res.status(400).json({ message: '请填写模块和子项名称' });

  const mod = await db.prepare('SELECT * FROM modules WHERE id = ?').get(moduleId);
  if (!mod) return res.status(404).json({ message: '模块不存在' });

  const result = await db.prepare(`
    INSERT INTO subcategories (module_id, name, description, points, max_times, requires_photo, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(moduleId, name.trim(), description || '', points || 0, maxTimes || 0, requiresPhoto ? 1 : 0, sortOrder || 0);

  res.json({ success: true, id: result.lastInsertRowid });
});

// PUT /api/admin/subcategories/:id — update subcategory
router.put('/subcategories/:id', async (req, res) => {
  const sub = await db.prepare('SELECT * FROM subcategories WHERE id = ?').get(req.params.id);
  if (!sub) return res.status(404).json({ message: '子项不存在' });

  const { name, description, points, maxTimes, requiresPhoto, sortOrder } = req.body;
  await db.prepare(`
    UPDATE subcategories SET name = ?, description = ?, points = ?, max_times = ?, requires_photo = ?, sort_order = ? WHERE id = ?
  `).run(
    name ? name.trim() : sub.name,
    description !== undefined ? description : sub.description,
    points !== undefined ? points : sub.points,
    maxTimes !== undefined ? maxTimes : sub.max_times,
    requiresPhoto !== undefined ? (requiresPhoto ? 1 : 0) : sub.requires_photo,
    sortOrder !== undefined ? sortOrder : sub.sort_order,
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

module.exports = router;
