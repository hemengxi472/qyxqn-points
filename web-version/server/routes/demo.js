// 样本数据的 HTTP 入口。
//
// 为什么需要这个文件：scripts/demo-participation.js 只能在**能拿到数据库连接**的
// 地方跑。线上库是 Turso，凭据（TURSO_URL / TURSO_AUTH_TOKEN）只配在 Render 的
// 环境变量里，本机没有 —— 于是"往线上灌演示数据"这件事原本只有 Render Shell
// 一条路，每次演示前都得去后台敲命令。
//
// 这个路由把同一条路搬到管理端界面上：服务端自己就握着那个连接。
//
// 三条约束：
//   1) **逻辑只有一份**。这里全部转调 scripts/demo-participation.js 导出的函数，
//      不复制任何"哪些行算 demo 数据"的判断 —— 复制出来的第二份迟早会分叉，
//      然后 cleanup 删不干净第一次灌进去的东西。
//   2) **只认 superadmin**。灌数据会一次性写入上千条已通过的申请、并抬高
//      30 个人的累计积分；清数据会把 points_summary 整行还原。
//      这不该是普通管理员误点一下就能发生的事。
//   3) **拒绝计分起点之前的季度**，与脚本 CLI 的判断一致（见 utils/quarter.js）。

const express = require('express');
const { authMiddleware, superAdminMiddleware } = require('../middleware/auth');
const { quarterKey, isValidQuarter, formatQuarter, isScoredQuarter, SCORING_START_QUARTER } = require('../utils/quarter');
const demo = require('../scripts/demo-participation');

const router = express.Router();
router.use(authMiddleware, superAdminMiddleware);

// 季度从 query 取，默认当前季度。校验放在一处，三个接口共用。
function resolveQuarter(req) {
  const q = String(req.query.quarter || quarterKey());
  if (!isValidQuarter(q)) {
    return { error: `季度格式无效：${q}（应为 YYYY-QN）` };
  }
  if (!isScoredQuarter(q)) {
    return { error: `${formatQuarter(q)} 在计分起点（${formatQuarter(SCORING_START_QUARTER)}）之前，不计分，不能灌样本数据。` };
  }
  return { quarter: q };
}

// 只读：现在有没有样本数据、分数区间是多少
router.get('/status', async (req, res) => {
  const { quarter, error } = resolveQuarter(req);
  if (error) return res.status(400).json({ message: error });
  try {
    const summary = await demo.status(quarter);
    res.json({ quarter, summary });
  } catch (e) {
    console.error('[demo] status 失败', e);
    res.status(500).json({ message: '读取样本数据状态失败：' + (e.message || e) });
  }
});

// 写入样本数据（幂等：先清掉自己上一次写的，再重写）
router.post('/seed', async (req, res) => {
  const { quarter, error } = resolveQuarter(req);
  if (error) return res.status(400).json({ message: error });
  try {
    const result = await demo.seed(quarter);
    res.json({ quarter, message: `${formatQuarter(quarter)} 样本数据已写入`, result });
  } catch (e) {
    console.error('[demo] seed 失败', e);
    res.status(500).json({ message: '写入样本数据失败：' + (e.message || e) });
  }
});

// 清除样本数据，并把累计积分还原到灌数据之前
router.post('/cleanup', async (req, res) => {
  const { quarter, error } = resolveQuarter(req);
  if (error) return res.status(400).json({ message: error });
  try {
    const counts = await demo.cleanupAll();
    res.json({ quarter, message: `${formatQuarter(quarter)} 样本数据已清除`, counts });
  } catch (e) {
    console.error('[demo] cleanup 失败', e);
    res.status(500).json({ message: '清除样本数据失败：' + (e.message || e) });
  }
});

module.exports = router;
