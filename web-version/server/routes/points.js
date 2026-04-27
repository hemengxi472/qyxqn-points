const express = require('express');
const { db } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/points/dashboard
router.get('/dashboard', authMiddleware, (req, res) => {
  const summary = db.prepare('SELECT * FROM points_summary WHERE user_id = ?').get(req.user.id);
  const monthYear = new Date().toISOString().substring(0, 7);

  // Current month's group
  const member = db.prepare(`
    SELECT gm.group_id FROM group_members gm
    JOIN groups g ON gm.group_id = g.id
    WHERE gm.user_id = ? AND g.month_year = ?
  `).get(req.user.id, monthYear);

  let group = null;
  if (member) {
    const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(member.group_id);
    const monthlyTask = db.prepare('SELECT task_description FROM monthly_tasks WHERE month_year = ?').get(monthYear);
    const members = db.prepare(`
      SELECT gm.employee_name, gm.department
      FROM group_members gm WHERE gm.group_id = ?
    `).all(member.group_id);
    group = {
      id: g.id,
      name: g.name,
      taskDescription: monthlyTask ? monthlyTask.task_description : '',
      status: g.status,
      members: members.map(m => ({ employeeName: m.employee_name, department: m.department }))
    };
  }

  // Monthly points
  const mp = db.prepare('SELECT * FROM monthly_points WHERE user_id = ? AND month_year = ?').get(req.user.id, monthYear);

  if (!summary) {
    return res.json({
      totalPoints: 0, moduleBreakdown: [], recentLogs: [],
      monthlyPoints: 0, monthYear, isFraudReset: false, group
    });
  }

  const modules = db.prepare('SELECT id, name, icon FROM modules WHERE is_active = 1 ORDER BY sort_order').all();
  const modulePoints = JSON.parse(summary.module_points || '{}');
  const moduleBreakdown = modules.map(m => ({
    moduleId: m.id,
    moduleName: m.name,
    icon: m.icon,
    points: modulePoints[String(m.id)] || 0
  }));

  const recentLogs = db.prepare(`
    SELECT id, module_name, subcategory_name, points, type, description, created_at
    FROM points_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 5
  `).all(req.user.id);

  res.json({
    totalPoints: summary.total_points,
    moduleBreakdown,
    recentLogs: recentLogs.map(l => ({
      id: l.id,
      moduleName: l.module_name,
      subcategoryName: l.subcategory_name,
      points: l.points,
      type: l.type,
      description: l.description,
      createdAt: l.created_at
    })),
    monthlyPoints: mp ? mp.points : 0,
    monthYear,
    isFraudReset: mp ? !!mp.is_fraud_reset : false,
    group
  });
});

// GET /api/points/history
router.get('/history', authMiddleware, (req, res) => {
  const { page = 1, pageSize = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(pageSize);

  const total = db.prepare('SELECT COUNT(*) as cnt FROM points_log WHERE user_id = ?').get(req.user.id).cnt;
  const items = db.prepare(`
    SELECT id, module_name, subcategory_name, points, type, description, created_at
    FROM points_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(req.user.id, Number(pageSize), offset);

  res.json({
    items: items.map(l => ({
      id: l.id,
      moduleName: l.module_name,
      subcategoryName: l.subcategory_name,
      points: l.points,
      type: l.type,
      description: l.description,
      createdAt: l.created_at
    })),
    total,
    page: Number(page),
    pageSize: Number(pageSize)
  });
});

module.exports = router;
