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

// 计分起点，与 server/utils/quarter.js 的 SCORING_START_QUARTER 一致。
// 用户明确要求「2026 第三季度以前都是 0 分不做积分」——那之前的季度在服务端
// 一律算作 0 分（见 utils/quarterly.js 的 scored 判断）。列在选择器里没有任何
// 意义：点进去只会看到 30 个人整整齐齐的 0，然后来问是不是数据没灌进去。
// 改这个值时必须两边一起改，否则选择器给出的季度和服务端认可的范围会错位。
export const SCORING_START_QUARTER = '2026-Q3'

export function isScoredQuarter(quarter) {
  return String(quarter || '') >= SCORING_START_QUARTER
}

// 最近 n 个季度（含当前），倒序 —— 给季度选择器用。
// 到计分起点为止就停，不会列出 2026-Q3 之前的季度。
export function recentQuarters(n = 8, from = new Date()) {
  const out = [];
  let year = from.getFullYear();
  let q = Math.floor(from.getMonth() / 3) + 1;
  for (let i = 0; i < n; i++) {
    const key = `${year}-Q${q}`;
    if (!isScoredQuarter(key)) break;
    out.push(key);
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
