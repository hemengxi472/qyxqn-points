const express = require('express');
const { db } = require('../db');

const router = express.Router();

function parseJsonArray(s, fallback = []) {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

// GET /api/modules
router.get('/', async (_req, res) => {
  const modules = (await db.prepare(`
    SELECT * FROM modules WHERE is_active = 1 ORDER BY sort_order
  `).all());

  const result = await Promise.all(modules.map(async (mod) => {
    const subcategories = await db.prepare(`
      SELECT id, name, description, points, base_score, score_rule, bonus_rule, bonus_cap,
             theme_activity, evidence_required, max_times, requires_photo, sort_order
      FROM subcategories WHERE module_id = ? AND is_active = 1 ORDER BY sort_order
    `).all(mod.id);

    return {
      id: mod.id,
      name: mod.name,
      description: mod.description,
      icon: mod.icon,
      sortOrder: mod.sort_order,
      // dimensionCode 是稳定 slug，前端所有按维度分支/配色的逻辑都走它，
      // 不要再依赖 id 或中文名
      dimensionCode: mod.dimension_code,
      baseScore: mod.base_score,
      bonusCap: mod.bonus_cap,
      cycle: mod.cycle,
      coreModules: parseJsonArray(mod.core_modules),
      themeActivity: mod.theme_activity,
      hasHardZero: !!mod.has_hard_zero,
      subcategories: subcategories.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        // points = 参考加分/次（旧语义保留，员工端显示与提交页预填用）
        points: s.points,
        // baseScore = 季度基础分，与 points 是两个不同的数
        baseScore: s.base_score,
        scoreRule: s.score_rule,
        bonusRule: s.bonus_rule,
        bonusCap: s.bonus_cap,
        themeActivity: parseJsonArray(s.theme_activity),
        evidenceRequired: s.evidence_required,
        maxTimes: s.max_times,
        requiresPhoto: !!s.requires_photo
      }))
    };
  }));

  res.json({ modules: result });
});

module.exports = router;
