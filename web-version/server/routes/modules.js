const express = require('express');
const { db } = require('../db');

const router = express.Router();

// GET /api/modules
router.get('/', (_req, res) => {
  const modules = db.prepare(`
    SELECT * FROM modules WHERE is_active = 1 ORDER BY sort_order
  `).all();

  const result = modules.map(mod => {
    const subcategories = db.prepare(`
      SELECT name, description, points, max_times, requires_photo, sort_order, is_active
      FROM subcategories WHERE module_id = ? AND is_active = 1 ORDER BY sort_order
    `).all(mod.id);

    return {
      id: mod.id,
      name: mod.name,
      description: mod.description,
      icon: mod.icon,
      sortOrder: mod.sort_order,
      subcategories: subcategories.map(s => ({
        name: s.name,
        description: s.description,
        points: s.points,
        maxTimes: s.max_times,
        requiresPhoto: !!s.requires_photo
      }))
    };
  });

  res.json({ modules: result });
});

module.exports = router;
