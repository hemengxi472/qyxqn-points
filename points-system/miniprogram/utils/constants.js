const STATUS_MAP = {
  pending:   { label: '待审核', color: '#f9ab00', bg: '#fef7e0' },
  approved:  { label: '已通过', color: '#0f9d58', bg: '#e6f4ea' },
  rejected:  { label: '已拒绝', color: '#ea4335', bg: '#fce8e6' },
  cancelled: { label: '已取消', color: '#9aa0a6', bg: '#f1f3f4' }
};

const ROLE_MAP = {
  employee:   '普通员工',
  admin:      '管理员',
  superadmin: '超级管理员'
};

const POINTS_TYPE_MAP = {
  award: '积分获得',
  deduct: '积分扣减'
};

const DEFAULT_MODULES = [
  {
    name: '能力',
    description: '专业能力提升相关积分，包括技术认证、项目获奖、论文发表等',
    icon: '📚',
    sortOrder: 1,
    isActive: true,
    subcategories: [
      { name: '技术认证', description: '获得行业认可的技术资格证书', points: 5, maxTimes: 0, requiresPhoto: true, sortOrder: 1, isActive: true },
      { name: '项目获奖', description: '参与项目获得公司/行业奖项', points: 10, maxTimes: 0, requiresPhoto: true, sortOrder: 2, isActive: true },
      { name: '论文发表', description: '在期刊或会议上发表学术论文', points: 8, maxTimes: 0, requiresPhoto: true, sortOrder: 3, isActive: true },
      { name: '专利发明', description: '获得国家认可的专利发明', points: 15, maxTimes: 0, requiresPhoto: true, sortOrder: 4, isActive: true },
      { name: '技能竞赛', description: '参加公司或行业技能竞赛获奖', points: 5, maxTimes: 0, requiresPhoto: true, sortOrder: 5, isActive: true }
    ]
  },
  {
    name: '担当',
    description: '责任担当相关积分，包括攻坚克难、导师带徒、临时任务等',
    icon: '🛡️',
    sortOrder: 2,
    isActive: true,
    subcategories: [
      { name: '攻坚克难', description: '完成公司急难险重任务', points: 10, maxTimes: 0, requiresPhoto: true, sortOrder: 1, isActive: true },
      { name: '导师带徒', description: '担任新员工导师并完成带教任务', points: 8, maxTimes: 0, requiresPhoto: true, sortOrder: 2, isActive: true },
      { name: '临时任务', description: '承担额外安排的临时重要任务', points: 5, maxTimes: 0, requiresPhoto: true, sortOrder: 3, isActive: true },
      { name: '跨部门协作', description: '积极参与跨部门协作项目', points: 5, maxTimes: 0, requiresPhoto: true, sortOrder: 4, isActive: true }
    ]
  },
  {
    name: '道德',
    description: '道德品质相关积分，包括献血、志愿服务、见义勇为等',
    icon: '❤️',
    sortOrder: 3,
    isActive: true,
    subcategories: [
      { name: '献血', description: '参加无偿献血活动', points: 2, maxTimes: 4, requiresPhoto: true, sortOrder: 1, isActive: true },
      { name: '志愿者服务', description: '参与社区或公司组织的志愿服务活动', points: 3, maxTimes: 0, requiresPhoto: true, sortOrder: 2, isActive: true },
      { name: '见义勇为', description: '保护国家/集体/他人生命财产安全', points: 10, maxTimes: 0, requiresPhoto: true, sortOrder: 3, isActive: true },
      { name: '爱心捐助', description: '参与扶贫/助学/救灾等捐助活动', points: 3, maxTimes: 0, requiresPhoto: true, sortOrder: 4, isActive: true }
    ]
  }
];

module.exports = { STATUS_MAP, ROLE_MAP, POINTS_TYPE_MAP, DEFAULT_MODULES };
