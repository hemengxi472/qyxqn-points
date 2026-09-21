// 季度奖励：排名 → 调休假期天数。
//
// 档位只在服务端定义，前端一律拿服务端下发的值，不得自行推导 —— 这套数字
// 是员工申诉时会引用的依据，两处各算一遍迟早对不上。

const REWARD_TIERS = [
  { from: 1, to: 1, days: 2, label: '第 1 名' },
  { from: 2, to: 3, days: 1.5, label: '第 2-3 名' },
  { from: 4, to: 6, days: 1, label: '第 4-6 名' },
  { from: 7, to: 10, days: 0.5, label: '第 7-10 名' }
];

const REWARD_USAGE_NOTE = '优先统筹部门工作，提前履行公司内部请假审批流程';

const REWARD_PROCESS = [
  '每季度积分锁定，团支部导出完整积分排名，在内部青年工作群进行季度积分排名公示（公示期 3 个工作日，专门接受异议申诉）；青年提出申诉需要提交书面说明以及对应的补充佐证材料，团支部在 2 个工作日内完成复核工作，并将复核结果一对一答复申诉青年。',
  '公示无异议后，将获奖人员名单报送人力资源部门备案，明确每名青年可享受调休时长。',
  '获奖青年在本季度之内，结合岗位工作实际，提前履行公司正常请假审批流程使用调休假期。',
  '当季度未使用完毕的调休额度自动清零，不跨季度累积，不折算工资、福利。',
  '人力资源部建立专项假期台账做好登记管理，数字化平台个人电子档案同步记录奖励获得情况、实际休假记录。'
];

const REWARD_IMPORTANT_NOTE = '调休假期奖励建立在不影响部门正常业务运转前提下，部门负责人可结合业务攻坚、重大保障工作实际合理安排休假时间，青年员工不能因获得奖励假期强行要求在业务攻坚高峰期、重大通信保障时段申请休假。';

// 排名 → 调休天数；10 名之外为 0
function leaveDaysForRank(rank) {
  const tier = REWARD_TIERS.find(t => rank >= t.from && rank <= t.to);
  return tier ? tier.days : 0;
}

module.exports = {
  REWARD_TIERS,
  REWARD_USAGE_NOTE,
  REWARD_PROCESS,
  REWARD_IMPORTANT_NOTE,
  leaveDaysForRank
};
