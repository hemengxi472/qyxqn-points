const express = require('express');
const { db, trx } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const GROUP_TASK_POINTS = 5;

// GET /api/groups/mine — current month's group info
router.get('/mine', async (req, res) => {
  const monthYear = new Date().toISOString().substring(0, 7);

  const member = await db.prepare(`
    SELECT gm.*, g.id as gid, g.name as gname, g.month_year, g.task_description,
           g.completion_description, g.status as gstatus,
           g.reviewer_name, g.review_comment, g.reviewed_at, g.created_at
    FROM group_members gm
    JOIN groups g ON gm.group_id = g.id
    WHERE gm.user_id = ? AND g.month_year = ?
  `).get(req.user.id, monthYear);

  if (!member) return res.json({ group: null });

  const monthlyTask = await db.prepare('SELECT task_description FROM monthly_tasks WHERE month_year = ?').get(monthYear);

  const members = await db.prepare(`
    SELECT gm.employee_id, gm.employee_name, gm.department
    FROM group_members gm WHERE gm.group_id = ?
  `).all(member.gid);

  res.json({
    group: {
      id: member.gid,
      name: member.gname,
      monthYear: member.month_year,
      taskRequirement: monthlyTask ? monthlyTask.task_description : '',
      taskDescription: member.task_description,
      completionDescription: member.completion_description,
      status: member.gstatus,
      reviewerName: member.reviewer_name,
      reviewComment: member.review_comment,
      reviewedAt: member.reviewed_at,
      createdAt: member.created_at,
      members: members.map(m => ({
        employeeId: m.employee_id,
        employeeName: m.employee_name,
        department: m.department
      }))
    }
  });
});

// GET /api/groups/mine/history — past groups
router.get('/mine/history', async (req, res) => {
  const memberGroups = (await db.prepare(`
    SELECT gm.group_id FROM group_members gm WHERE gm.user_id = ?
  `).all(req.user.id)).map(r => r.group_id);

  if (memberGroups.length === 0) return res.json({ groups: [] });

  const placeholders = memberGroups.map(() => '?').join(',');
  const groups = await db.prepare(`
    SELECT * FROM groups WHERE id IN (${placeholders}) ORDER BY month_year DESC
  `).all(...memberGroups);

  res.json({
    groups: groups.map(g => ({
      id: g.id,
      name: g.name,
      monthYear: g.month_year,
      taskDescription: g.task_description,
      status: g.status,
      createdAt: g.created_at
    }))
  });
});

// POST /api/groups/mine/submit — submit for admin review
router.post('/mine/submit', async (req, res) => {
  const monthYear = new Date().toISOString().substring(0, 7);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  const member = await db.prepare(`
    SELECT gm.*, g.id as gid, g.name as gname, g.status as gstatus
    FROM group_members gm
    JOIN groups g ON gm.group_id = g.id
    WHERE gm.user_id = ? AND g.month_year = ?
  `).get(req.user.id, monthYear);

  if (!member) return res.status(404).json({ message: '本月无团队任务，请等待管理员分组' });
  if (member.gstatus !== 'active') return res.status(400).json({ message: '该团队任务已完成，无需重复提交' });

  const { description, photoUrls } = req.body;
  if (!description || !description.trim()) return res.status(400).json({ message: '请填写任务完成描述' });
  if (!photoUrls || !Array.isArray(photoUrls) || photoUrls.length === 0) return res.status(400).json({ message: '请上传证明照片' });

  const allMembers = await db.prepare('SELECT * FROM group_members WHERE group_id = ?').all(member.gid);

  await trx(async (tx) => {
    const result = await tx.prepare(`
      INSERT INTO submissions (user_id, employee_id, employee_name, department, module_id, module_name,
        subcategory_name, description, photo_urls, status, month_year)
      VALUES (?, ?, ?, ?, 4, '纪律', '团队任务完成', ?, ?, 'pending', ?)
    `).run(req.user.id, user.employee_id, user.name, user.department,
      description.trim(), JSON.stringify(photoUrls), monthYear);

    await tx.prepare(`
      UPDATE groups SET status = 'submitted', completion_description = ?, submission_id = ?
      WHERE id = ?
    `).run(description.trim(), result.lastInsertRowid, member.gid);
  });

  res.json({
    success: true,
    message: `团队任务已提交，等待管理员审核（${allMembers.length} 位成员）`,
    memberCount: allMembers.length
  });
});

module.exports = router;
