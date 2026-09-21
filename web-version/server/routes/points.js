const express = require('express');
const { db } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { quarterKey, quarterOfMonth, isValidQuarter } = require('../utils/quarter');
const { buildQuarterlyScores, listScorableUsers } = require('../utils/quarterly');
const { leaveDaysForRank, REWARD_TIERS, REWARD_USAGE_NOTE, REWARD_PROCESS, REWARD_IMPORTANT_NOTE } = require('../utils/reward');

const router = express.Router();

// 某人在某季度的季度分 + 排名 + 调休额度。
// 排名只统计 eligible（未因刚性归零被取消资格）的人。
async function quarterlyPayload(userId, quarter) {
  const users = await listScorableUsers(db);
  const scores = await buildQuarterlyScores(db, quarter, users.map(u => u.id));
  const me = scores.get(userId);
  if (!me) return null;

  const ranked = users
    .map(u => ({ userId: u.id, ...scores.get(u.id) }))
    .filter(r => r.eligible)
    .sort((a, b) => b.totalScore - a.totalScore || a.userId - b.userId);

  const idx = ranked.findIndex(r => r.userId === userId);
  const rank = idx >= 0 ? idx + 1 : null;

  return {
    quarter,
    totalScore: me.totalScore,
    maxScore: me.maxScore,
    rank,
    rankedTotal: ranked.length,
    eligible: me.eligible,
    hardZeroCount: me.hardZeroCount,
    leaveDays: rank ? leaveDaysForRank(rank) : 0,
    dimensions: me.dimensions
  };
}

// GET /api/points/dashboard
router.get('/dashboard', authMiddleware, async (req, res) => {
  const summary = await db.prepare('SELECT * FROM points_summary WHERE user_id = ?').get(req.user.id);
  const currentQuarter = quarterKey();

  // 本季度的组
  const member = await db.prepare(`
    SELECT gm.group_id FROM group_members gm
    JOIN groups g ON gm.group_id = g.id
    WHERE gm.user_id = ? AND g.quarter = ?
  `).get(req.user.id, currentQuarter);

  let group = null;
  if (member) {
    const g = await db.prepare('SELECT * FROM groups WHERE id = ?').get(member.group_id);
    const quarterTask = await db.prepare('SELECT task_description FROM monthly_tasks WHERE quarter = ?').get(currentQuarter);
    const members = await db.prepare(`
      SELECT gm.employee_name, gm.department
      FROM group_members gm WHERE gm.group_id = ?
    `).all(member.group_id);
    group = {
      id: g.id,
      name: g.name,
      quarter: g.quarter || quarterOfMonth(g.month_year),
      // taskRequirement = 管理员设的本季度统一任务；taskDescription 是组自己写的
      // 完成描述。以前这里叫 taskDescription，而 groups.js 的 /mine 把同一份
      // 统一任务叫 taskRequirement —— 同一个东西两个名字，界面各自读到一个就
      // 以为读到了全部。统一成 taskRequirement。
      taskRequirement: quarterTask ? quarterTask.task_description : '',
      taskDescription: g.task_description,
      status: g.status,
      members: members.map(m => ({ employeeName: m.employee_name, department: m.department }))
    };
  }

  const quarterly = await quarterlyPayload(req.user.id, currentQuarter);

  if (!summary) {
    return res.json({
      totalPoints: 0, moduleBreakdown: [], recentLogs: [], legacyPoints: 0,
      group, currentQuarter, quarterly
    });
  }

  const modules = (await db.prepare(
    'SELECT id, name, icon, dimension_code FROM modules WHERE is_active = 1 ORDER BY sort_order'
  ).all());
  const modulePoints = JSON.parse(summary.module_points || '{}');

  const moduleBreakdown = modules.map(m => ({
    moduleId: m.id,
    moduleName: m.name,
    dimensionCode: m.dimension_code,
    icon: m.icon,
    points: modulePoints[String(m.id)] || 0
  }));

  // 历史积分：旧四模块停用后残留在 module_points 里的键。
  // 不重写这些键 —— 作假回退的数学依赖它们（admin.js 按 module_id 从
  // points_log 反推各模块明细再加回 mp[key]），改 key 会让历史回退加到
  // 从未持有这些分的键上。所以在读路径里单独兜住。
  const activeIds = new Set(modules.map(m => String(m.id)));
  const legacyPoints = Object.entries(modulePoints)
    .filter(([k]) => !activeIds.has(k))
    .reduce((s, [, v]) => s + (Number(v) || 0), 0);

  const recentLogs = await db.prepare(`
    SELECT id, module_name, subcategory_name, points, type, description, created_at
    FROM points_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 5
  `).all(req.user.id);

  res.json({
    totalPoints: summary.total_points,
    moduleBreakdown,
    legacyPoints,
    recentLogs: recentLogs.map(l => ({
      id: l.id,
      moduleName: l.module_name,
      subcategoryName: l.subcategory_name,
      points: l.points,
      type: l.type,
      description: l.description,
      createdAt: l.created_at
    })),
    group,
    currentQuarter,
    quarterly
  });
});

// GET /api/points/quarterly?quarter=2026-Q3 — 季度分明细（含各维度模块级拆分）
router.get('/quarterly', authMiddleware, async (req, res) => {
  const quarter = req.query.quarter || quarterKey();
  if (!isValidQuarter(quarter)) return res.status(400).json({ message: '季度格式无效，应为 YYYY-QN' });

  const payload = await quarterlyPayload(req.user.id, quarter);
  if (!payload) return res.json({ quarterly: null });

  res.json({
    quarterly: payload,
    reward: {
      tiers: REWARD_TIERS,
      usageNote: REWARD_USAGE_NOTE,
      process: REWARD_PROCESS,
      importantNote: REWARD_IMPORTANT_NOTE
    }
  });
});

// GET /api/points/history
router.get('/history', authMiddleware, async (req, res) => {
  const { page = 1, pageSize = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(pageSize);

  const total = (await db.prepare('SELECT COUNT(*) as cnt FROM points_log WHERE user_id = ?').get(req.user.id)).cnt;
  // quarter 是这条记录的季度归属（决策 #4：历史按季度归集展示，原始数值不动）。
  // 老行可能还没有 quarter（迁移兜底用 month_year 推），所以这里也推一次。
  const items = await db.prepare(`
    SELECT id, module_name, subcategory_name, points, type, description, created_at, quarter, month_year
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
      quarter: l.quarter || quarterOfMonth(l.month_year),
      createdAt: l.created_at
    })),
    total,
    page: Number(page),
    pageSize: Number(pageSize)
  });
});

module.exports = router;
