const jwt = require('jsonwebtoken');
const { db } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'points-system-secret-change-in-production';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: '请先登录' });
  }
  try {
    const token = header.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: '登录已过期，请重新登录' });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ message: '无管理员权限' });
  }
  next();
}

function superAdminMiddleware(req, res, next) {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ message: '仅超级管理员可执行此操作' });
  }
  next();
}

module.exports = { JWT_SECRET, generateToken, authMiddleware, adminMiddleware, superAdminMiddleware };
