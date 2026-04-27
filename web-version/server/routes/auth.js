const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db');
const { generateToken, authMiddleware } = require('../middleware/auth');

const router = express.Router();

const avatarStorage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (_req, file, cb) => {
    cb(null, 'avatar_' + uuidv4() + path.extname(file.originalname));
  }
});
const avatarUpload = multer({ storage: avatarStorage, limits: { fileSize: 5 * 1024 * 1024 } });

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: '请输入用户名和密码' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    return res.status(401).json({ message: '用户名或密码错误' });
  }
  if (user.status === 'disabled') {
    return res.status(403).json({ message: '账号已被禁用，请联系管理员' });
  }
  if (user.status === 'pending') {
    return res.status(403).json({ message: '账号正在审核中，请等待管理员审批' });
  }
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ message: '用户名或密码错误' });
  }

  const token = generateToken(user);
  res.json({
    token,
    user: { id: user.id, employeeId: user.employee_id, name: user.name, department: user.department, avatarUrl: user.avatar_url, role: user.role }
  });
});

// POST /api/auth/register
router.post('/register', avatarUpload.single('avatar'), (req, res) => {
  const { username, password, name, employeeId, department } = req.body;
  if (!username || !password || !name || !employeeId || !department) {
    return res.status(400).json({ message: '请填写完整信息' });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: '密码至少6位' });
  }

  const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existingUser) {
    return res.status(400).json({ message: '该用户名已被注册' });
  }
  const existingEmp = db.prepare('SELECT id FROM users WHERE employee_id = ?').get(employeeId);
  if (existingEmp) {
    return res.status(400).json({ message: '该工号已被注册' });
  }

  const avatarUrl = req.file ? '/uploads/' + req.file.filename : '';

  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO users (username, password_hash, employee_id, name, department, avatar_url, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(username, hash, employeeId, name, department, avatarUrl);

  res.json({ message: '注册成功，请等待管理员审核' });
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    return res.status(404).json({ message: '用户不存在' });
  }
  res.json({
    user: { id: user.id, employeeId: user.employee_id, name: user.name, department: user.department, avatarUrl: user.avatar_url, role: user.role }
  });
});

module.exports = router;
