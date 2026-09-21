// 季度 / 月度键工具。
//
// 为什么用本地时间而不是 toISOString()：旧代码到处用
// `new Date().toISOString().substring(0,7)`，那是 UTC，在 UTC+8 下每月 1 号
// 00:00–08:00 提交的东西会被记到上个月。新写入一律走这里。
//
// 为什么季度要落库、不在读时推导：历史事件的归属必须冻结。如果从 created_at
// 读时算季度，那么任何一次推导逻辑变更（时区、服务器迁移、有人"修"了这个
// 文件）都会把已经公示过的季度排名挪到别的季度，调休奖励不可复现。

function pad2(n) {
  return String(n).padStart(2, '0');
}

// '2026-Q3'
function quarterKey(date = new Date()) {
  return `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`;
}

// '2026-09'
function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

// '2026-09' → '2026-Q3'
function quarterOfMonth(monthYear) {
  const parts = String(monthYear || '').split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!year || !month) return '';
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
}

function isValidQuarter(s) {
  return /^\d{4}-Q[1-4]$/.test(String(s || ''));
}

// '2026-Q3' → { start, end, startMonth, endMonth }
function quarterBounds(quarter) {
  const m = /^(\d{4})-Q([1-4])$/.exec(String(quarter || ''));
  if (!m) return null;
  const year = Number(m[1]);
  const q = Number(m[2]);
  const firstMonth = (q - 1) * 3 + 1;
  const lastMonth = firstMonth + 2;
  // new Date(year, lastMonth, 0) 是"下个月的第 0 天"，即本月最后一天
  const lastDay = new Date(year, lastMonth, 0).getDate();
  return {
    start: `${year}-${pad2(firstMonth)}-01`,
    end: `${year}-${pad2(lastMonth)}-${pad2(lastDay)}`,
    startMonth: `${year}-${pad2(firstMonth)}`,
    endMonth: `${year}-${pad2(lastMonth)}`
  };
}

const CN_QUARTER = { 1: '一', 2: '二', 3: '三', 4: '四' };

// '2026-Q3' → '2026年第三季度'
//
// 客户端 client/src/utils/quarter.js 有一份逐字相同的实现。两处必须保持一致 ——
// 组名、审计流水的措辞和公示表会同时出现在服务端和界面上，对不上就是口径不一致。
function formatQuarter(quarter) {
  const m = /^(\d{4})-Q([1-4])$/.exec(String(quarter || ''));
  if (!m) return quarter || '';
  return `${m[1]}年第${CN_QUARTER[Number(m[2])]}季度`;
}

// 最近 n 个季度（含当前），倒序 —— 给季度选择器用
function recentQuarters(n = 8, from = new Date()) {
  const out = [];
  let year = from.getFullYear();
  let q = Math.floor(from.getMonth() / 3) + 1;
  for (let i = 0; i < n; i++) {
    out.push(`${year}-Q${q}`);
    q -= 1;
    if (q === 0) {
      q = 4;
      year -= 1;
    }
  }
  return out;
}

module.exports = {
  quarterKey,
  monthKey,
  quarterOfMonth,
  isValidQuarter,
  quarterBounds,
  recentQuarters,
  formatQuarter
};
