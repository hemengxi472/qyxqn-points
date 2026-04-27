const express = require('express');
const { db } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// File upload config
const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (_req, file, cb) => {
    cb(null, uuidv4() + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// POST /api/upload - single file upload
router.post('/upload', authMiddleware, upload.array('files', 9), (req, res) => {
  const urls = (req.files || []).map(f => '/uploads/' + f.filename);
  res.json({ urls });
});

// POST /api/submissions - create submission
router.post('/', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ message: '用户不存在' });

  const { moduleId, subcategoryName, description, photoUrls } = req.body;
  if (!moduleId || !subcategoryName) {
    return res.status(400).json({ message: '请选择积分模块和子项' });
  }

  const module = db.prepare('SELECT * FROM modules WHERE id = ?').get(moduleId);
  if (!module || !module.is_active) {
    return res.status(404).json({ message: '模块不存在或已禁用' });
  }

  const sub = db.prepare('SELECT * FROM subcategories WHERE module_id = ? AND name = ? AND is_active = 1').get(moduleId, subcategoryName);
  if (!sub) {
    return res.status(404).json({ message: '积分子项不存在或已禁用' });
  }
  if (sub.requires_photo && (!photoUrls || photoUrls.length === 0)) {
    return res.status(400).json({ message: '请上传证明材料照片' });
  }

  // Check maxTimes per year
  if (sub.max_times > 0) {
    const yearStart = new Date().getFullYear() + '-01-01';
    const count = db.prepare(`
      SELECT COUNT(*) as cnt FROM submissions
      WHERE user_id = ? AND module_id = ? AND subcategory_name = ?
        AND status IN ('pending', 'approved') AND created_at >= ?
    `).get(user.id, moduleId, subcategoryName, yearStart);
    if (count.cnt >= sub.max_times) {
      return res.status(400).json({ message: `该子项本年度最多申请${sub.max_times}次` });
    }
  }

  const result = db.prepare(`
    INSERT INTO submissions (user_id, employee_id, employee_name, department, module_id, module_name, subcategory_name, description, photo_urls, month_year)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(user.id, user.employee_id, user.name, user.department, moduleId, module.name, subcategoryName, description || '', JSON.stringify(photoUrls || []),
    new Date().toISOString().substring(0, 7));

  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(result.lastInsertRowid);
  res.json({ submission: formatSubmission(submission) });
});

// GET /api/submissions - my submissions
router.get('/', authMiddleware, (req, res) => {
  const { status, page = 1, pageSize = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(pageSize);

  let where = 'WHERE user_id = ?';
  const params = [req.user.id];
  if (status) {
    where += ' AND status = ?';
    params.push(status);
  }

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM submissions ${where}`).get(...params).cnt;
  const items = db.prepare(`
    SELECT * FROM submissions ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, Number(pageSize), offset);

  res.json({ items: items.map(formatSubmission), total, page: Number(page), pageSize: Number(pageSize) });
});

// GET /api/submissions/:id
router.get('/:id', authMiddleware, (req, res) => {
  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!submission) return res.status(404).json({ message: '申请记录不存在' });
  if (submission.user_id !== req.user.id && req.user.role === 'employee') {
    return res.status(403).json({ message: '无权查看该申请' });
  }
  res.json({ submission: formatSubmission(submission) });
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

module.exports = router;
