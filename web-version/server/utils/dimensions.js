// 评价维度的稳定解析。
//
// 背景：团队任务审核通过后给全队发"纪律"积分，旧代码把 module_id=4 和
// name='纪律' 直接写死在 admin.js 和 groups.js 里。迁移后库里会有两行沾边的
// 模块——旧的「纪律」被停用（is_active=0，用于保留历史），新的「有纪律」是
// 活跃维度。所以不能写死 id，也不能只按名字查，必须让活跃的那行胜出。

const DISCIPLINE_CODE = 'discipline';
const DISCIPLINE_NAMES = ['有纪律', '纪律'];

// 返回 { id, name, dimension_code }，找不到就抛错（不要静默发分）
async function resolveDisciplineModule(db) {
  const placeholders = DISCIPLINE_NAMES.map(() => '?').join(',');
  const row = await db.prepare(
    `SELECT id, name, dimension_code FROM modules
      WHERE dimension_code = ? OR name IN (${placeholders})
      ORDER BY is_active DESC, id DESC
      LIMIT 1`
  ).get(DISCIPLINE_CODE, ...DISCIPLINE_NAMES);

  if (!row) {
    throw Object.assign(
      new Error('纪律维度未配置，无法发放团队任务积分'),
      { status: 500 }
    );
  }
  return row;
}

module.exports = { resolveDisciplineModule, DISCIPLINE_CODE, DISCIPLINE_NAMES };
