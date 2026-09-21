// 季度键工具（前端）。
//
// 与 server/utils/quarter.js 是同一套规则的镜像：本地时间，不用 toISOString。
// 前端只用它做三件事 —— 取当前季度、给季度选择器列出候选值、把 '2026-Q3'
// 显示成 '2026年第三季度'。一切涉及"某人的季度分是多少"的计算都在服务端，
// 前端不得自行推导排名或调休档位，否则公示口径会出现第二个版本。
//
// 旧的 monthKey 已经删掉：月度概念在本次改造中从系统里移除了，留一个没有
// 调用方的月份函数在这里，只会让下一个人以为还能按月取数。

// '2026-Q3'
export function quarterKey(date = new Date()) {
  return `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`;
}

const CN_QUARTER = { 1: '一', 2: '二', 3: '三', 4: '四' };

// '2026-Q3' → '2026年第三季度'
export function formatQuarter(quarter) {
  const m = /^(\d{4})-Q([1-4])$/.exec(String(quarter || ''));
  if (!m) return quarter || '';
  return `${m[1]}年第${CN_QUARTER[Number(m[2])]}季度`;
}

// 最近 n 个季度（含当前），倒序 —— 给季度选择器用
export function recentQuarters(n = 8, from = new Date()) {
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

// dimension_code → CSS 变量后缀。服务端可能返回空（停用的历史模块），
// 用中文名兜底让历史柱子仍有颜色。
const NAME_TO_CODE = {
  有健康: 'health',
  有本领: 'skill',
  有成长: 'growth',
  有智慧: 'wisdom',
  有担当: 'duty',
  有纪律: 'discipline',
  能力: 'skill',
  担当: 'duty',
  道德: 'growth',
  纪律: 'discipline'
};

export function moduleColorKey(code, name) {
  if (code) return code;
  return NAME_TO_CODE[name] || 'skill';
}
