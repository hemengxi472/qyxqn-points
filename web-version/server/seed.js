const bcrypt = require('bcryptjs');
const { trx } = require('./db');
const { formatQuarter, monthKey } = require('./utils/quarter');

// ---------------------------------------------------------------------------
// 六有青年评价体系内容
//
// modules 行 = 评价维度（有健康…有纪律）；subcategories 行 = 维度下的模块。
// 六个维度各自模块的基础分精确加总为 100，这是映射正确性的判据，
// 由文件末尾的 assertBaseScores() 在每次种子后校验。
//
// 子项的 bonusCap（加分上限）取自 表2 该子项**自己**那条加分细则的分值：
//   有健康  10 / 0        表2 写了"一次性得 10 分，不拆分计分"；心理健康无加分项
//   有本领  10 / 10 / 10  表2 只给了池子"按项累计，最高 10 分"，池值照写到每一项
//                         （写 0 会被读成"此项不可加分"，与表2 相反）
//   有成长  60 / 60 / 60  同上：表2 列了六类事项目共用一个 60 分池，未逐项给分
//   有智慧  10 / 10 / 10  表2 三条细则都是 +10
//   有担当  15 / 10 / 5   表2 的三条细则，按排列顺序对应三个子项
//   有纪律  10 / 10 / 0   表2 两条细则各 +10；自我管理只有扣分、无加分项
//
// 这是**展示值**：真正生效的封顶始终是维度的 bonusCap（见 utils/quarterly.js 的
// bonusApplied 和 admin.js 审核时的 BONUS_CAP_EXCEEDED 校验）。子项值抄成维度值
// 会让员工端把"每项都能拿满 60"读成制度。改了子项值不必同步算法。
//
// 子项的 points（参考加分 / 次）取自 表2 该子项那条加分细则的**每次分值**：
//   有健康  10 / 10       身体健康「一次性得 10 分」；心理健康表2 无加分条款，酌情 10
//   有本领  10 / 10 / 10  表2 三句都是「按项累计」，逐项 10
//   有成长  10 / 10 / 10  表2 六类事项共用一个 60 分池 → 每项 10
//   有智慧  10 / 10 / 10  表2 三句都是「+10 分/项」
//   有担当  15 / 10 / 5   表2 三句细则，按排列顺序对应三个子项
//   有纪律  10 / 10 / 5   表2 两句各 +10；自我管理只有扣分、无加分条款，酌情 5
//
// 这是**员工端展示值 + 提交页的默认分值**：数值必须非 0，否则界面上就是一枚
// 「0分」徽章，等于没有分值（这正是它一直以来的样子）。实际给多少仍由审核人填，
// 上限由 admin.js 的 BONUS_CAP_EXCEEDED 按维度天花板把关。
// ---------------------------------------------------------------------------

const DIMENSIONS = [
  {
    name: '有健康',
    code: 'health',
    icon: '🌱',
    description: '身体健康、心理健康 —— 青年身心双强',
    baseScore: 100,
    bonusCap: 10,
    cycle: '季度',
    coreModules: ['身体健康', '心理健康'],
    themeActivity: '轻行蓄力，向阳成长 —— 青年身心双强户外健康行',
    hasHardZero: 0,
    sortOrder: 1,
    modules: [
      {
        name: '身体健康',
        baseScore: 60,
        points: 10,
        scoreRule: '按月度打卡折算季度得分；包含步数达标、专项运动、工位拉伸、规律饮水、周末户外运动，未达标扣对应分值',
        bonusRule: '上限 10 分：3 人及以上小组季度共同健康打卡≥2 次，一次性得 10 分，不拆分计分',
        bonusCap: 10,
        themeActivities: ['轻行蓄力，向阳成长 —— 青年身心双强户外健康行'],
        evidence: '微信运动截图、运动 APP 记录、工位 / 户外实拍照片',
        requiresPhoto: 1
      },
      {
        name: '心理健康',
        baseScore: 40,
        points: 10,
        scoreRule: '完成情绪复盘、兴趣疗愈、正向倾诉、月度小目标；心态消极不主动调节酌情扣分',
        bonusRule: '',
        bonusCap: 0,
        themeActivities: ['轻行蓄力，向阳成长 —— 青年身心双强户外健康行'],
        evidence: '情绪日记、备忘录截图、活动照片、感悟文字',
        requiresPhoto: 1
      }
    ]
  },
  {
    name: '有本领',
    code: 'skill',
    icon: '🏆',
    description: '专业扎实、高效执行、跨界学习',
    baseScore: 100,
    bonusCap: 10,
    cycle: '季度',
    coreModules: ['专业扎实', '高效执行', '跨界学习'],
    themeActivity: '岗位技能快闪赛、技能充电站、跨界偷师半小时、最烂复盘挑战赛',
    hasHardZero: 0,
    sortOrder: 2,
    modules: [
      {
        name: '专业扎实',
        baseScore: 40,
        points: 10,
        scoreRule: '完成高难度一次性验收任务；复盘报告被部门采纳；纠正业务错误；技能考核前 30%，按完成情况得分',
        bonusRule: '上限 10 分：专业扎实、高效执行、跨界学习类事项按项累计，最高 10 分',
        bonusCap: 10,
        themeActivities: ['岗位技能"快闪赛"', '技能充电站 Excel 硬核 1 小时', '"跨界偷师"半小时', '"最烂复盘"挑战赛'],
        evidence: '任务验收单、复盘报告、业务纠错记录、技能测试成绩、结业证书、跨部门纪要、分享记录',
        requiresPhoto: 1
      },
      {
        name: '高效执行',
        baseScore: 35,
        points: 10,
        scoreRule: '任务提前 20% 交付；承接棘手紧急任务；完成流程优化；季度无逾期拖延，未达标扣分',
        bonusRule: '上限 10 分：专业扎实、高效执行、跨界学习类事项按项累计，最高 10 分',
        bonusCap: 10,
        themeActivities: ['岗位技能"快闪赛"', '技能充电站 Excel 硬核 1 小时', '"跨界偷师"半小时', '"最烂复盘"挑战赛'],
        evidence: '任务验收单、复盘报告、业务纠错记录、技能测试成绩、结业证书、跨部门纪要、分享记录',
        requiresPhoto: 1
      },
      {
        name: '跨界学习',
        baseScore: 25,
        points: 10,
        scoreRule: '学习其他岗位技能并落地；跨部门协作输出总结；向同事分享工具方法；取得外部课程结业证明',
        bonusRule: '上限 10 分：专业扎实、高效执行、跨界学习类事项按项累计，最高 10 分',
        bonusCap: 10,
        themeActivities: ['岗位技能"快闪赛"', '技能充电站 Excel 硬核 1 小时', '"跨界偷师"半小时', '"最烂复盘"挑战赛'],
        evidence: '任务验收单、复盘报告、业务纠错记录、技能测试成绩、结业证书、跨部门纪要、分享记录',
        requiresPhoto: 1
      }
    ]
  },
  {
    name: '有成长',
    code: 'growth',
    icon: '🌿',
    description: '持续成长、自信自强、品质修养',
    baseScore: 100,
    bonusCap: 60,
    cycle: '季度',
    coreModules: ['持续成长', '自信自强', '品质修养'],
    themeActivity: '跨岗挑战赛、高光时刻复盘会、勇气清单打卡、价值观辩论赛、换位一封信活动',
    hasHardZero: 0,
    sortOrder: 3,
    modules: [
      {
        name: '持续成长',
        baseScore: 40,
        points: 10,
        scoreRule: '完成个人成长地图、学习存折打卡；参与跨岗挑战赛、业务前沿分享；季度目标落地情况',
        bonusRule: '上限 60 分：成长导师认证、内训分享、跨部门项目、逆商故事投稿、同事实名表扬、打卡全完成，按规则累计，上限 60 分',
        bonusCap: 60,
        themeActivities: ['跨岗挑战赛', '高光时刻复盘会', '勇气清单打卡', '价值观辩论赛', '换位一封信活动'],
        evidence: '个人成长地图、学习存折、跨岗洞察报告、勇气清单、复盘材料、互评投票结果、互换信件、辅导记录、分享课件、表扬佐证',
        requiresPhoto: 1
      },
      {
        name: '自信自强',
        baseScore: 30,
        points: 10,
        scoreRule: '参与高光复盘；完成勇气清单突破任务；参与极限挑战日，结合同伴互评打分',
        bonusRule: '上限 60 分：成长导师认证、内训分享、跨部门项目、逆商故事投稿、同事实名表扬、打卡全完成，按规则累计，上限 60 分',
        bonusCap: 60,
        themeActivities: ['跨岗挑战赛', '高光时刻复盘会', '勇气清单打卡', '价值观辩论赛', '换位一封信活动'],
        evidence: '个人成长地图、学习存折、跨岗洞察报告、勇气清单、复盘材料、互评投票结果、互换信件、辅导记录、分享课件、表扬佐证',
        requiresPhoto: 1
      },
      {
        name: '品质修养',
        baseScore: 30,
        points: 10,
        scoreRule: '参与辩论赛、换位一封信；参与靠谱指数匿名互评，参与不足扣分',
        bonusRule: '上限 60 分：成长导师认证、内训分享、跨部门项目、逆商故事投稿、同事实名表扬、打卡全完成，按规则累计，上限 60 分',
        bonusCap: 60,
        themeActivities: ['跨岗挑战赛', '高光时刻复盘会', '勇气清单打卡', '价值观辩论赛', '换位一封信活动'],
        evidence: '个人成长地图、学习存折、跨岗洞察报告、勇气清单、复盘材料、互评投票结果、互换信件、辅导记录、分享课件、表扬佐证',
        requiresPhoto: 1
      }
    ]
  },
  {
    name: '有智慧',
    code: 'wisdom',
    icon: '🧠',
    description: '全局思维、职业规划、难题破解',
    baseScore: 100,
    bonusCap: 30,
    cycle: '季度',
    coreModules: ['全局思维', '职业规划', '难题破解'],
    themeActivity: '青年思辨沙龙、案例拆解研讨会、职业规划一对一交流',
    hasHardZero: 0,
    sortOrder: 4,
    modules: [
      {
        name: '全局思维',
        baseScore: 40,
        points: 10,
        scoreRule: '学习战略业务文件输出洞察；提出合理化改进建议；无个人思考酌情扣分',
        bonusRule: '上限 30 分：建议落地采纳 +10 分/项；攻坚案例推广 +10 分/篇；落地创新成果 +10 分/项，累计最高 30 分，无落地凭证不计分',
        bonusCap: 10,
        themeActivities: ['青年思辨沙龙', '复杂案例拆解研讨会', '职业规划一对一交流'],
        evidence: '学习笔记、合理化建议文稿、职业规划书、访谈记录、解决方案、采纳批复、攻坚案例文档',
        requiresPhoto: 1
      },
      {
        name: '职业规划',
        baseScore: 30,
        points: 10,
        scoreRule: '季度更新职业规划；复盘目标差距；完成导师成长访谈',
        bonusRule: '上限 30 分：建议落地采纳 +10 分/项；攻坚案例推广 +10 分/篇；落地创新成果 +10 分/项，累计最高 30 分，无落地凭证不计分',
        bonusCap: 10,
        themeActivities: ['青年思辨沙龙', '复杂案例拆解研讨会', '职业规划一对一交流'],
        evidence: '学习笔记、合理化建议文稿、职业规划书、访谈记录、解决方案、采纳批复、攻坚案例文档',
        requiresPhoto: 1
      },
      {
        name: '难题破解',
        baseScore: 30,
        points: 10,
        scoreRule: '拆解复杂业务输出可行方案；案例研讨贡献新思路',
        bonusRule: '上限 30 分：建议落地采纳 +10 分/项；攻坚案例推广 +10 分/篇；落地创新成果 +10 分/项，累计最高 30 分，无落地凭证不计分',
        bonusCap: 10,
        themeActivities: ['青年思辨沙龙', '复杂案例拆解研讨会', '职业规划一对一交流'],
        evidence: '学习笔记、合理化建议文稿、职业规划书、访谈记录、解决方案、采纳批复、攻坚案例文档',
        requiresPhoto: 1
      }
    ]
  },
  {
    name: '有担当',
    code: 'duty',
    icon: '🛡️',
    description: '岗位履职担当、团队协同担当、青年志愿担当',
    baseScore: 100,
    bonusCap: 30,
    cycle: '季度',
    coreModules: ['岗位履职担当', '团队协同担当', '青年志愿担当'],
    themeActivity: '青年攻坚突击队、岗位先锋实践、志愿服务行动',
    hasHardZero: 0,
    sortOrder: 5,
    modules: [
      {
        name: '岗位履职担当',
        baseScore: 40,
        points: 15,
        scoreRule: '保质完成本职；主动承接急难补位、专项攻坚；推诿退缩扣分',
        bonusRule: '上限 30 分：牵头专项攻坚 +15 分；应急任务表现突出 +10 分；客户 / 部门正向评价 +5 分，累计最高 30 分；仅列席无实际参与不计分',
        bonusCap: 15,
        themeActivities: ['青年攻坚突击队实战行动', '岗位先锋实践活动', '志愿服务行动'],
        evidence: '任务工单、攻坚参与记录、协同交付材料、志愿台账、项目材料、表扬佐证',
        requiresPhoto: 1
      },
      {
        name: '团队协同担当',
        baseScore: 35,
        points: 10,
        scoreRule: '配合团队目标、协助同事；跨项目按时交付；协作消极扣分',
        bonusRule: '上限 30 分：牵头专项攻坚 +15 分；应急任务表现突出 +10 分；客户 / 部门正向评价 +5 分，累计最高 30 分；仅列席无实际参与不计分',
        bonusCap: 10,
        themeActivities: ['青年攻坚突击队实战行动', '岗位先锋实践活动', '志愿服务行动'],
        evidence: '任务工单、攻坚参与记录、协同交付材料、志愿台账、项目材料、表扬佐证',
        requiresPhoto: 1
      },
      {
        name: '青年志愿担当',
        baseScore: 25,
        points: 5,
        scoreRule: '参加团日、突击队、志愿服务；缺席重要集体任务扣分',
        bonusRule: '上限 30 分：牵头专项攻坚 +15 分；应急任务表现突出 +10 分；客户 / 部门正向评价 +5 分，累计最高 30 分；仅列席无实际参与不计分',
        bonusCap: 5,
        themeActivities: ['青年攻坚突击队实战行动', '岗位先锋实践活动', '志愿服务行动'],
        evidence: '任务工单、攻坚参与记录、协同交付材料、志愿台账、项目材料、表扬佐证',
        requiresPhoto: 1
      }
    ]
  },
  {
    name: '有纪律',
    code: 'discipline',
    icon: '⚖️',
    description: '合规纪律、职业操守、自我管理（违纪刚性归零）',
    baseScore: 100,
    bonusCap: 20,
    cycle: '季度',
    coreModules: ['合规纪律', '职业操守', '自我管理'],
    themeActivity: '合规警示教育学习、青年纪律标杆分享会、合规知识擂台小竞赛',
    hasHardZero: 1,
    sortOrder: 6,
    modules: [
      {
        name: '合规纪律',
        baseScore: 45,
        points: 10,
        scoreRule: '参加合规、信息安全、廉洁学习并完成测试；出现风险隐患予以扣分',
        bonusRule: '上限 20 分：合规宣讲分享 +10 分/次；主动上报核实风险 +10 分/次，合计上限 20 分。刚性扣罚：违纪 / 泄密 / 弄虚作假本维度直接 0 分，取消季度奖励资格',
        bonusCap: 10,
        themeActivities: ['合规警示教育专题学习', '青年纪律标杆分享会', '合规知识擂台小竞赛'],
        evidence: '培训签到、线上答题成绩、考勤记录、报送记录、分享课件、风险上报记录、违规处置记录',
        requiresPhoto: 1
      },
      {
        name: '职业操守',
        baseScore: 35,
        points: 10,
        scoreRule: '恪守职业准则，如实反馈工作；弄虚作假视情节大幅扣分',
        bonusRule: '上限 20 分：合规宣讲分享 +10 分/次；主动上报核实风险 +10 分/次，合计上限 20 分。刚性扣罚：违纪 / 泄密 / 弄虚作假本维度直接 0 分，取消季度奖励资格',
        bonusCap: 10,
        themeActivities: ['合规警示教育专题学习', '青年纪律标杆分享会', '合规知识擂台小竞赛'],
        evidence: '培训签到、线上答题成绩、考勤记录、报送记录、分享课件、风险上报记录、违规处置记录',
        requiresPhoto: 1
      },
      {
        name: '自我管理',
        baseScore: 20,
        points: 5,
        scoreRule: '遵守考勤；按时填报平台材料；无故缺勤、逾期报送扣分',
        // 表2 的加分栏只给了「合规宣讲分享」「主动上报核实风险」两条，都落在前两个
        // 子项上；自我管理只有扣分项，所以加分上限是 0（原来是照抄维度的 20）。
        bonusRule: '上限 20 分：合规宣讲分享 +10 分/次；主动上报核实风险 +10 分/次，合计上限 20 分。刚性扣罚：违纪 / 泄密 / 弄虚作假本维度直接 0 分，取消季度奖励资格',
        bonusCap: 0,
        themeActivities: ['合规警示教育专题学习', '青年纪律标杆分享会', '合规知识擂台小竞赛'],
        evidence: '培训签到、线上答题成绩、考勤记录、报送记录、分享课件、风险上报记录、违规处置记录',
        requiresPhoto: 1
      }
    ]
  }
];

// 迁移前的旧四模块。停用（不删除）以保留历史：submissions.module_name、
// points_log.module_name、points_summary.module_points 都是快照，
// 名字和 id 原样留着，只是 is_active=1 的展示面不再显示。
const LEGACY_MODULE_NAMES = ['能力', '担当', '道德', '纪律'];

// 默认只插入不覆盖，保护管理员在「模块管理」里的文案编辑（seed 每次启动都跑，
// 见 index.js）。依赖 seed-on-boot 推送文案的场景可设 SEED_CONTENT=force 恢复旧行为。
const SEED_FORCE = process.env.SEED_CONTENT === 'force';

async function seed(db) {
  const newNames = DIMENSIONS.map(d => d.name);
  const existingModules = (await db.prepare('SELECT COUNT(*) as cnt FROM modules').get()).cnt;

  if (existingModules === 0) {
    await trx(async (tx) => {
      for (const dim of DIMENSIONS) {
        const r = await tx.prepare(
          `INSERT INTO modules
             (name, description, icon, sort_order, is_active,
              dimension_code, base_score, bonus_cap, cycle, core_modules, theme_activity, has_hard_zero)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          dim.name, dim.description, dim.icon, dim.sortOrder,
          dim.code, dim.baseScore, dim.bonusCap, dim.cycle,
          JSON.stringify(dim.coreModules), dim.themeActivity, dim.hasHardZero
        );
        const moduleId = r.lastInsertRowid;

        for (let i = 0; i < dim.modules.length; i++) {
          const m = dim.modules[i];
          await tx.prepare(
            `INSERT INTO subcategories
               (module_id, name, description, points, max_times, requires_photo, sort_order, is_active,
                base_score, score_rule, bonus_rule, bonus_cap, theme_activity, evidence_required)
             VALUES (?, ?, ?, ?, 0, ?, ?, 1, ?, ?, ?, ?, ?, ?)`
          ).run(
            moduleId, m.name, m.scoreRule, m.points, m.requiresPhoto, i + 1,
            m.baseScore, m.scoreRule, m.bonusRule, m.bonusCap,
            JSON.stringify(m.themeActivities), m.evidence
          );
        }
      }
    });
    console.log(`已创建 ${DIMENSIONS.length} 个评价维度及模块`);
  } else {
    // 先停用旧四模块。必须精确匹配 IN（不能用 LIKE），否则「纪律」会匹配上「有纪律」。
    const notIn = newNames.map(() => '?').join(',');
    await db.prepare(
      `UPDATE modules SET is_active = 0
        WHERE name IN (${LEGACY_MODULE_NAMES.map(() => '?').join(',')})
          AND name NOT IN (${notIn})`
    ).run(...LEGACY_MODULE_NAMES, ...newNames);
    console.log('旧四模块已停用（历史数据保留）');

    await trx(async (tx) => {
      for (const dim of DIMENSIONS) {
        const modRow = await tx.prepare('SELECT id FROM modules WHERE name = ?').get(dim.name);
        let moduleId;

        if (!modRow) {
          const r = await tx.prepare(
            `INSERT INTO modules
               (name, description, icon, sort_order, is_active,
                dimension_code, base_score, bonus_cap, cycle, core_modules, theme_activity, has_hard_zero)
             VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            dim.name, dim.description, dim.icon, dim.sortOrder,
            dim.code, dim.baseScore, dim.bonusCap, dim.cycle,
            JSON.stringify(dim.coreModules), dim.themeActivity, dim.hasHardZero
          );
          moduleId = r.lastInsertRowid;
        } else {
          moduleId = modRow.id;
          if (SEED_FORCE) {
            await tx.prepare(
              `UPDATE modules SET description = ?, icon = ?, sort_order = ?, is_active = 1,
                 dimension_code = ?, base_score = ?, bonus_cap = ?, cycle = ?,
                 core_modules = ?, theme_activity = ?, has_hard_zero = ?
               WHERE id = ?`
            ).run(
              dim.description, dim.icon, dim.sortOrder, dim.code, dim.baseScore,
              dim.bonusCap, dim.cycle, JSON.stringify(dim.coreModules),
              dim.themeActivity, dim.hasHardZero, moduleId
            );
          } else {
            // 只确保启用，不改写管理员编辑过的内容
            await tx.prepare('UPDATE modules SET is_active = 1 WHERE id = ?').run(moduleId);
          }
        }

        for (let i = 0; i < dim.modules.length; i++) {
          const m = dim.modules[i];
          const existing = await tx.prepare(
            'SELECT id FROM subcategories WHERE module_id = ? AND name = ?'
          ).get(moduleId, m.name);

          if (existing) {
            if (SEED_FORCE) {
              await tx.prepare(
                `UPDATE subcategories SET is_active = 1, requires_photo = ?, sort_order = ?,
                   base_score = ?, points = ?, score_rule = ?, bonus_rule = ?, bonus_cap = ?,
                   theme_activity = ?, evidence_required = ?, description = ?
                 WHERE id = ?`
              ).run(
                m.requiresPhoto, i + 1, m.baseScore, m.points, m.scoreRule, m.bonusRule,
                m.bonusCap, JSON.stringify(m.themeActivities), m.evidence,
                m.scoreRule, existing.id
              );
            } else {
              await tx.prepare('UPDATE subcategories SET is_active = 1 WHERE id = ?').run(existing.id);
            }
          } else {
            await tx.prepare(
              `INSERT INTO subcategories
                 (module_id, name, description, points, max_times, requires_photo, sort_order, is_active,
                  base_score, score_rule, bonus_rule, bonus_cap, theme_activity, evidence_required)
               VALUES (?, ?, ?, ?, 0, ?, ?, 1, ?, ?, ?, ?, ?, ?)`
            ).run(
              moduleId, m.name, m.scoreRule, m.points, m.requiresPhoto, i + 1,
              m.baseScore, m.scoreRule, m.bonusRule, m.bonusCap,
              JSON.stringify(m.themeActivities), m.evidence
            );
          }
        }

        // 停用该维度下已从内容模型移除的模块。只对 DIMENSIONS 里的维度执行，
        // 所以不会碰到旧四模块的子项。
        const keepNames = dim.modules.map(m => m.name);
        if (keepNames.length > 0) {
          await tx.prepare(
            `UPDATE subcategories SET is_active = 0
              WHERE module_id = ? AND name NOT IN (${keepNames.map(() => '?').join(',')})`
          ).run(moduleId, ...keepNames);
        }
      }
    });
    console.log(`评价维度及模块已同步${SEED_FORCE ? '（SEED_CONTENT=force：覆盖文案）' : '（只插入不覆盖文案）'}`);
  }

  await assertBaseScores(db);

  // Seed super admin (default: admin / admin123)
  const existingAdmin = await db.prepare('SELECT COUNT(*) as cnt FROM users WHERE role = ?').get('superadmin');
  if (existingAdmin.cnt === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await db.prepare(`INSERT INTO users (username, password_hash, employee_id, name, department, role, status) VALUES (?, ?, ?, ?, ?, 'superadmin', 'active')`)
      .run('admin', hash, 'admin001', '超级管理员', '综合部');
    console.log('已创建超级管理员: admin / admin123');
  } else {
    console.log('超级管理员已存在，跳过');
  }

  // Seed employee accounts (persistent across restarts)
  const EMPLOYEES = [
    { username: 'ABC', password: '123456', name: '何孟溪', employeeId: '12345678', department: '青羊区' },
    { username: 'hmx', password: '123456', name: '张三', employeeId: '123', department: '技术部' },
    { username: 'testuser', password: '123456', name: '吴九', employeeId: 'TEST001', department: '技术部' },
    { username: 'user1', password: '123456', name: '李四', employeeId: 'EMP001', department: '技术部' },
    { username: 'user2', password: '123456', name: '王五', employeeId: 'EMP002', department: '市场部' },
    { username: 'user3', password: '123456', name: '赵六', employeeId: 'EMP003', department: '市场部' },
    { username: 'user4', password: '123456', name: '孙七', employeeId: 'EMP004', department: '综合部' },
    { username: 'user5', password: '123456', name: '周八', employeeId: 'EMP005', department: '综合部' },
  ];
  const existingEmployees = (await db.prepare('SELECT COUNT(*) as cnt FROM users WHERE role = ?').get('employee')).cnt;
  if (existingEmployees === 0) {
    await trx(async (tx) => {
      for (const emp of EMPLOYEES) {
        const hash = bcrypt.hashSync(emp.password, 10);
        await tx.prepare('INSERT INTO users (username, password_hash, employee_id, name, department, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(emp.username, hash, emp.employeeId, emp.name, emp.department, 'employee', 'active');
      }
    });
    console.log(`已创建 ${EMPLOYEES.length} 个员工账号，默认密码: 123456`);
  } else {
    console.log(`已有 ${existingEmployees} 个员工账号，跳过`);
  }

  // 恢复"保留"测试账号（何孟溪 ABC）的可登录状态。
  //
  // 这个账号早期靠 status='disabled' 被挡在季度排名之外；后来加了
  // exclude_from_ranking 专门干这件事（见 db.js 该列注释），但它在被禁用后一直
  // 没被重新启用，导致现在连登录都被 auth.js:30-35 挡掉。而且它的密码哈希对不上
  // 名册里登记的 123456（早期数据残留），光启用还不够，得一起重置。
  //
  // 系统没有任何改密码入口（auth 只有 login/register），所以把密码重置回登记值
  // 不会覆盖谁的改动。每次启动幂等：只有状态不是 active、或密码对不上时才写。
  // 其余 7 个废弃测试账号（hmx/user1~5/testuser）不在这里 —— 它们没有
  // exclude_from_ranking，重新启用会把假人带进季度排名，保持禁用。
  const kept = EMPLOYEES.find(e => e.employeeId === '12345678');
  if (kept) {
    const keptUser = await db.prepare(
      'SELECT id, status, password_hash FROM users WHERE employee_id = ?'
    ).get(kept.employeeId);
    if (keptUser && !(keptUser.status === 'active' && bcrypt.compareSync(kept.password, keptUser.password_hash))) {
      const keptHash = bcrypt.hashSync(kept.password, 10);
      await db.prepare("UPDATE users SET status = 'active', password_hash = ?, updated_at = datetime('now') WHERE id = ?")
        .run(keptHash, keptUser.id);
      console.log(`已恢复测试账号：${kept.name}（${kept.username} / ${kept.password}）`);
    }
  }

  await seedNewCohort(db);
  await seedCohortGroups(db);
  await seedRankingExclusions(db);

  console.log('数据库初始化完成');
}

// 保留的测试账号：要能登录走一遍员工端，但不该出现在季度排名里。
//
// 必须是每次启动都跑的 UPDATE，而不是塞进上面的建号 INSERT —— 线上这个账号
// 早就存在了，改标志位得能作用到已有行（INSERT 那条路径在线上根本不会命中）。
// 管理员账号不在这里：listScorableUsers 已经按 role 过滤掉了。
const RANKING_EXCLUDED = ['12345678'];
async function seedRankingExclusions(db) {
  let n = 0;
  for (const employeeId of RANKING_EXCLUDED) {
    const r = await db.prepare(
      'UPDATE users SET exclude_from_ranking = 1 WHERE employee_id = ? AND exclude_from_ranking = 0'
    ).run(employeeId);
    n += r.changes || 0;
  }
  if (n > 0) console.log(`已将 ${n} 个测试账号设为不参与季度排名`);
}

// ---------------------------------------------------------------------------
// 2026 年新员工名册（来源：班组分配表）
//
// **username = 姓名，初始密码 = 工号。** 用姓名当账号是管理员的明确要求：员工
// 不用记一串 E00… 也能登录。这依赖两个前提，改这份名单前请重新确认：
//   1. 30 个姓名互不重复（已核对）；
//   2. 与库里已有账号的 username 不撞车（含以后新注册的）。
// 撞了的话 INSERT 会因为 username UNIQUE 直接抛错，不会静默覆盖。
//
// 幂等键是 employee_id：命中就整条跳过 —— 不重置密码、不覆盖部门，所以重启
// 不会把员工自己改过的密码改回工号，也不会覆盖后台编辑过的部门。代价是：在
// 员工管理里删掉某个账号后，下次重启会把它重新建回来。
//
// group 列来自表格的「组别」，下面的 seedCohortGroups 会照它分组。
// 表格里的出生日期 / 年龄没有入库 —— users 表没有这两列，本次也没要求加。
// ---------------------------------------------------------------------------
const COHORT_QUARTER = '2026-Q3';

const NEW_COHORT = [
  { dept: '青羊商客服务中心',   employeeId: 'E0038541423', name: '刘大方',     group: 1 },
  { dept: '苏坡街道服务中心',   employeeId: 'E0038541417', name: '樊卓军',     group: 1 },
  { dept: '光华街道服务中心',   employeeId: 'E0038042509', name: '覃磊',       group: 1 },
  { dept: '集团客户中心',       employeeId: 'E1000000656', name: '周鹭',       group: 1 },
  { dept: '集团客户中心',       employeeId: 'E1000020800', name: '王钰',       group: 1 },

  { dept: '网络建维中心',       employeeId: 'E0038042848', name: '宋潇肖',     group: 2 },
  { dept: '光华街道服务中心',   employeeId: 'E0038040349', name: '王倩',       group: 2 },
  { dept: '少城街道服务中心',   employeeId: 'E0038541687', name: '王瑶',       group: 2 },
  { dept: '青羊商客服务中心',   employeeId: 'E1000039475', name: '周红君',     group: 2 },
  { dept: '黄田坝街道服务中心', employeeId: 'E0038042902', name: '陈钰洁',     group: 2 },

  { dept: '网络建维中心',       employeeId: 'E0038042504', name: '张翼',       group: 3 },
  { dept: '客户体验中心',       employeeId: 'E0038541577', name: '徐晓霞',     group: 3 },
  { dept: '康河街道服务中心',   employeeId: 'E0038042962', name: '杨佳佳',     group: 3 },
  { dept: '草市街道服务中心',   employeeId: 'E1000000672', name: '张峰齐',     group: 3 },
  { dept: '主城网络支撑中心',   employeeId: 'E1000075699', name: '夏翠翠',     group: 3 },

  { dept: '网络建维中心',       employeeId: 'E1000042272', name: '巴音贝力格', group: 4 },
  { dept: '蔡桥街道服务中心',   employeeId: 'E0038541571', name: '赵书源',     group: 4 },
  { dept: '集团客户中心',       employeeId: 'E1000049743', name: '姚婷',       group: 4 },
  { dept: '府南街道服务中心',   employeeId: 'E0038541574', name: '李薇',       group: 4 },
  { dept: '文家街道服务中心',   employeeId: 'E0038049004', name: '李海鹏',     group: 4 },

  { dept: '少城街道服务中心',   employeeId: 'E0038541689', name: '李雪英',     group: 5 },
  { dept: '金沙街道服务中心',   employeeId: 'E0038042744', name: '杜金华',     group: 5 },
  { dept: '少城街道服务中心',   employeeId: 'E3100231026', name: '董效舒',     group: 5 },
  { dept: '战客服务中心',       employeeId: 'E1000052540', name: '李若金',     group: 5 },
  { dept: '草市街道服务中心',   employeeId: 'E0038042849', name: '漆凌云',     group: 5 },

  { dept: '康河街道服务中心',   employeeId: 'E0038042850', name: '张印全',     group: 6 },
  { dept: '苏坡街道服务中心',   employeeId: 'E0038042944', name: '邓淑萍',     group: 6 },
  { dept: '金沙街道服务中心',   employeeId: 'E0038042847', name: '张玥',       group: 6 },
  { dept: '苏坡街道服务中心',   employeeId: 'E1000058599', name: '王廷元',     group: 6 },
  { dept: '网络建维中心',       employeeId: 'E1000121114', name: '张玉',       group: 6 },
];

async function seedNewCohort(db) {
  let created = 0;
  let skipped = 0;

  await trx(async (tx) => {
    for (const p of NEW_COHORT) {
      // employee_id 是身份，username 是登录名 —— 两个都要查，因为撞 username 的
      // 那个人不一定是同一个工号（比如别人先注册了这个姓名）。
      const existing = await tx.prepare(
        'SELECT id FROM users WHERE employee_id = ? OR username = ?'
      ).get(p.employeeId, p.name);
      if (existing) { skipped++; continue; }

      const hash = bcrypt.hashSync(p.employeeId, 10);
      await tx.prepare(
        `INSERT INTO users (username, password_hash, employee_id, name, department, role, status)
         VALUES (?, ?, ?, ?, ?, 'employee', 'active')`
      ).run(p.name, hash, p.employeeId, p.name, p.dept);
      created++;
    }
  });

  if (created > 0) {
    console.log(`新员工名册：已创建 ${created} 个账号（账号=姓名，初始密码=工号）`);
  }
  if (skipped > 0) {
    console.log(`新员工名册：已存在 ${skipped} 个，跳过（不重置密码、不覆盖部门）`);
  }
}

// 按表格的「组别」建团队 —— 不能用「生成本季度团队」按钮，那是随机分配的，
// 而这份分组是给定的。季度写死为 COHORT_QUARTER 而不是"当前季度"：写成当前
// 季度的话，每翻一个季度就会自动重建同一批组，而这份组别归属只对 2026-Q3 成立。
// 到了 Q4 要么改这个常量，要么删掉本函数改用页面上的随机分组。
async function seedCohortGroups(db) {
  const existing = (await db.prepare(
    'SELECT COUNT(*) AS cnt FROM groups WHERE quarter = ?'
  ).get(COHORT_QUARTER)).cnt;
  if (existing > 0) {
    console.log(`${formatQuarter(COHORT_QUARTER)} 已有 ${existing} 个团队，跳过分组`);
    return;
  }

  // 先把 30 个人按组别归拢，任何一个人不在库里就整体放弃 —— 建出只有 3 个人的
  // 残组比不建更糟，而且没人会注意到。
  const byGroup = new Map();
  for (const p of NEW_COHORT) {
    const u = await db.prepare(
      'SELECT id, employee_id, name, department FROM users WHERE employee_id = ?'
    ).get(p.employeeId);
    if (!u) {
      console.warn(`[新员工分组] 工号 ${p.employeeId}（${p.name}）不在库里，本次不分组`);
      return;
    }
    if (!byGroup.has(p.group)) byGroup.set(p.group, []);
    byGroup.get(p.group).push(u);
  }

  const groupNums = [...byGroup.keys()].sort((a, b) => a - b);
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  await trx(async (tx) => {
    for (const n of groupNums) {
      // 组名沿用 POST /groups/generate 的格式，两处必须一致，否则同一个季度的
      // 团队会出现两种命名。
      const r = await tx.prepare(
        'INSERT INTO groups (name, quarter, month_year, created_at) VALUES (?, ?, ?, ?)'
      ).run(`${formatQuarter(COHORT_QUARTER)} 第${n}组`, COHORT_QUARTER, monthKey(), now);
      const groupId = r.lastInsertRowid;

      for (const m of byGroup.get(n)) {
        await tx.prepare(
          `INSERT INTO group_members (group_id, user_id, employee_id, employee_name, department)
           VALUES (?, ?, ?, ?, ?)`
        ).run(groupId, m.id, m.employee_id, m.name, m.department);
      }
    }
  });

  console.log(`新员工分组：已按组别建 ${groupNums.length} 个团队（${formatQuarter(COHORT_QUARTER)}）`);
}

// 维度内模块基础分必须精确加总为维度基础分（100）。这里静默的算术漂移
// 会造出一个 97 分的维度，一个季度都没人发现。
async function assertBaseScores(db) {
  for (const dim of DIMENSIONS) {
    const modRow = await db.prepare('SELECT id, name, base_score FROM modules WHERE name = ?').get(dim.name);
    if (!modRow) continue;
    const sum = (await db.prepare(
      'SELECT COALESCE(SUM(base_score), 0) AS s FROM subcategories WHERE module_id = ? AND is_active = 1'
    ).get(modRow.id)).s;
    if (Number(sum) !== Number(modRow.base_score)) {
      console.warn(
        `[维度校验] 「${modRow.name}」模块基础分合计 ${sum} ≠ 维度基础分 ${modRow.base_score}，请检查模块配置`
      );
    }
  }

  // 子项分值不能是 0：员工端把它渲染成「0分」徽章，等于告诉员工这一项不值分。
  // db.js 的 SUB_POINT_FIX 会为存量库补上，这里守住全新库和后续误改。
  const zero = await db.prepare(
    'SELECT COUNT(*) AS n FROM subcategories WHERE is_active = 1 AND points = 0'
  ).get();
  if (Number(zero.n) > 0) {
    console.warn(`[分值校验] 有 ${zero.n} 个子项的参考加分是 0，员工端会显示「0分」徽章，请检查配置`);
  }
}

// Run directly if called as script
if (require.main === module) {
  const { db, initDB } = require('./db');
  (async () => {
    await initDB();
    await seed(db);
    process.exit(0);
  })();
}

module.exports = { seed, DIMENSIONS };
