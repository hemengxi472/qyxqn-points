const express = require('express');
const cors = require('cors');
const path = require('path');
const { db, initDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

(async () => {
// Init database
await initDB();
await require('./seed').seed(db);

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/modules', require('./routes/modules'));
app.use('/api/submissions', require('./routes/submissions'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/points', require('./routes/points'));
app.use('/api/admin', require('./routes/admin'));
// 样本数据的 HTTP 入口（仅 superadmin）。线上库是 Turso，凭据只在 Render 的
// 环境变量里，本机拿不到 —— 没有这个入口，往线上灌演示数据就只能去 Render Shell
// 敲命令。它转调 scripts/demo-participation.js，逻辑与 CLI 同一份。
app.use('/api/admin/demo', require('./routes/demo'));

// Serve frontend static files in production
let clientDist = path.join(__dirname, 'client', 'dist');       // Docker
if (!require('fs').existsSync(path.join(clientDist, 'index.html'))) {
  clientDist = path.join(__dirname, '..', 'client', 'dist');   // Local dev
}

// 带内容哈希的资源（/assets/index-abc123.js）内容永不改变，可以放心长缓存；
// index.html 必须每次回源，否则浏览器会拿着上一次部署的入口包，去要已经被
// 这次部署删掉的 chunk 文件名。
app.use('/assets', express.static(path.join(clientDist, 'assets'), {
  immutable: true,
  maxAge: '1y'
}));
app.use(express.static(clientDist, {
  setHeaders: (res, filePath) => {
    // 只有 index.html（以及其它非哈希资源）走这里，一律不强缓存
    if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

// SPA 回退：把前端路由交给 index.html。
//
// 但**不能**把 /assets/ 下的未命中一起吞掉。以前这里是 app.get('*')，
// 任何缺失的 chunk 都会拿到 200 + index.html —— 浏览器把 HTML 当 JS 解析，
// 报的是语法错误，而真正的原因是"这个文件在这次部署里已经不存在了"。
// 线上"季度评分/员工管理打不开"就是这么来的：旧标签页里的入口包引用的
// chunk 已经被新部署删掉。回 404 才能让浏览器干净地重新拉一次入口包。
app.get(/^\/assets\//, (_req, res) => {
  res.status(404).type('text/plain').send('asset not found');
});

// 同一类问题：没匹配上的 /api/* 以前也会落进下面的 SPA 回退，返回 HTML 200。
// 客户端拿到的就不是 JSON，res.message 永远是 undefined，报错信息全丢。
// 接口路径就该回 JSON 404。
app.use('/api', (_req, res) => {
  res.status(404).json({ message: '接口不存在' });
});

app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Default admin: admin / admin123`);
});
})();
