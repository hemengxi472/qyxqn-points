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

// Serve frontend static files in production
let clientDist = path.join(__dirname, 'client', 'dist');       // Docker
if (!require('fs').existsSync(path.join(clientDist, 'index.html'))) {
  clientDist = path.join(__dirname, '..', 'client', 'dist');   // Local dev
}
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Default admin: admin / admin123`);
});
})();
