const { db, initDB } = require('./db');
initDB();
console.log('=== MODULES ===');
db.prepare('SELECT * FROM modules ORDER BY sort_order').all().forEach(r => {
  console.log(`id=${r.id} name="${r.name}" icon="${r.icon}" active=${r.is_active}`);
});
console.log('\n=== SUBCATEGORIES ===');
db.prepare('SELECT s.id, s.module_id, m.name as mname, s.name as sname, s.points, s.max_times, s.is_active FROM subcategories s JOIN modules m ON s.module_id = m.id ORDER BY m.sort_order, s.sort_order').all().forEach(r => {
  console.log(`mod_id=${r.module_id} (${r.mname}) sub="${r.sname}" pts=${r.points} max=${r.max_times} active=${r.is_active}`);
});
process.exit(0);
