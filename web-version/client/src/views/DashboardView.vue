<template>
  <div class="dashboard">
    <!-- 欢迎横幅 -->
    <div class="welcome-banner">
      <div class="welcome-left">
        <div class="brand-block">
          <span class="brand-char">青</span>
        </div>
        <div class="welcome-text">
          <h1 class="welcome-title">青春梦工厂</h1>
          <p class="welcome-sub">青羊新青年</p>
        </div>
      </div>
      <div class="welcome-right">
        <div class="date-badge">{{ today }}</div>
      </div>
    </div>

    <!-- 总积分 Hero 卡片 -->
    <div class="hero-card">
      <div class="hero-bg">
        <div class="hero-circle c1" />
        <div class="hero-circle c2" />
        <div class="hero-circle c3" />
      </div>
      <!-- 浮动糖果点 -->
      <div class="hero-glow hg1" />
      <div class="hero-glow hg2" />
      <div class="hero-glow hg3" />
      <!-- 可爱小精灵 -->
      <div class="sprites">
        <span class="sprite s1">⭐</span>
        <span class="sprite s2">💫</span>
        <span class="sprite s3">✨</span>
        <span class="sprite s4">🌟</span>
        <span class="sprite s5">💖</span>
        <span class="sprite s6">✨</span>
      </div>
      <div class="hero-content">
        <p class="hero-label">🌟 我的累计积分</p>
        <div class="hero-points-wrap">
          <span class="hero-points">{{ animatedPoints }}</span>
          <span class="hero-unit">分</span>
        </div>
        <div class="hero-divider" />
        <p class="hero-hint">建库至今累计，含往季</p>
        <!-- 把季度分直接摆在累计分下面：这两个数在演示账号上恰好相等（那些账号
             的分全部来自本季度），两块大数字并排出现而没有任何说明时，
             看到的人只会以为有一个算错了。 -->
        <p v-if="quarterly" class="hero-quarter">
          本季度 {{ quarterly.totalScore }} 分 · 第 {{ quarterly.rank }} 名（两套口径，不可相加）
        </p>
      </div>
      <!-- 糖果粒子 -->
      <div class="particles">
        <span v-for="n in 24" :key="n" class="pt" :style="particleStyle(n)" />
      </div>
    </div>

    <!-- 本季度评价维度 -->
    <!-- 注意：这是与"累计积分"完全不同的一种尺度。季度分按当季实际参与累计，
         季初不送基础分（累加制），所以没参加任何活动的人这里是 0 分。
         两个数绝不能相加或合并展示 —— 一个人可以季度 0 分而累计 300 分。 -->
    <div v-if="quarterly" class="section">
      <div class="section-header">
        <h3 class="section-title">📊 本季度评价维度</h3>
        <span class="section-hint">{{ formatQuarter(quarterly.quarter) }} · 上限 {{ quarterly.maxScore }}</span>
      </div>

      <div class="quarter-banner" :class="{ ineligible: !quarterly.eligible }">
        <div class="qb-left">
          <span class="qb-label">季度总分</span>
          <span class="qb-score">{{ quarterly.totalScore }}<small>/{{ quarterly.maxScore }}</small></span>
        </div>
        <div class="qb-right">
          <template v-if="quarterly.eligible">
            <span class="qb-rank">第 {{ quarterly.rank }} 名</span>
            <span class="qb-sub">共 {{ quarterly.rankedTotal }} 人参与排名</span>
            <span class="qb-leave">调休 {{ quarterly.leaveDays }} 天</span>
          </template>
          <template v-else>
            <span class="qb-rank danger">不计入排名</span>
            <span class="qb-sub">刚性归零 {{ quarterly.hardZeroCount }} 项，本季度奖励资格已取消</span>
          </template>
        </div>
      </div>

      <div class="module-grid">
        <div
          v-for="(d, i) in quarterly.dimensions"
          :key="d.dimensionId"
          class="module-card"
          :class="[dimensionClass(d.dimensionCode), 'mc-quarter', { 'mc-zero': d.hardZero }]"
          :style="{ animationDelay: `${0.08 + i * 0.08}s` }"
        >
          <div class="mc-stripe" />
          <div class="mc-content">
            <div class="mc-icon-wrap">
              <span class="mc-icon">{{ d.icon }}</span>
            </div>
            <div class="mc-info">
              <span class="mc-name">{{ d.name }}</span>
              <span class="mc-points">{{ d.score }} <small>/ {{ d.ceiling }}</small></span>
              <!-- 累加制下绝大多数人拿不到基础分 100 以上，所以"加分 0/10"这种
                   常态文案没有信息量。超出部分才叫加分，没超出就直接显示已得。 -->
              <span v-if="d.bonusApplied > 0" class="mc-bonus">含加分 {{ d.bonusApplied }}/{{ d.bonusCap }}</span>
              <span v-else class="mc-bonus">已得 {{ d.earned }} 分</span>
            </div>
          </div>
          <el-tooltip v-if="d.hardZero" :content="d.hardZeroReason || '该维度已刚性归零'" placement="top">
            <el-tag class="mc-zero-tag" size="small" type="danger" effect="dark">已归零</el-tag>
          </el-tooltip>
        </div>
      </div>
    </div>

    <!-- 累计积分（含历史） -->
    <div v-if="moduleBreakdown.length || legacyPoints > 0" class="section">
      <div class="section-header">
        <h3 class="section-title">📚 历史累计积分</h3>
        <span class="section-hint">建库至今，含往季 · 点击卡片进入申请</span>
      </div>
      <div class="module-grid">
        <!-- 历史积分卡：旧四模块停用后，这部分分只存在于 module_points 里，
             不单独列出来的话老用户会看到一排 0 而总分却不是 0。 -->
        <div
          v-if="legacyPoints > 0"
          class="module-card mc-legacy"
          :style="{ animationDelay: '0.08s' }"
        >
          <div class="mc-stripe" />
          <div class="mc-content">
            <div class="mc-icon-wrap">
              <span class="mc-icon">📦</span>
            </div>
            <div class="mc-info">
              <span class="mc-name">历史积分</span>
              <span class="mc-points">{{ legacyPoints }} <small>分</small></span>
            </div>
          </div>
        </div>
        <div
          v-for="(m, i) in moduleBreakdown"
          :key="m.moduleId"
          class="module-card"
          :class="dimensionClass(m.dimensionCode || legacyCodeOf(m.moduleName))"
          :style="{ animationDelay: `${0.16 + i * 0.08}s` }"
          @click="$router.push('/modules')"
        >
          <div class="mc-stripe" />
          <div class="mc-content">
            <div class="mc-icon-wrap">
              <span class="mc-icon">{{ m.icon }}</span>
            </div>
            <div class="mc-info">
              <span class="mc-name">{{ m.moduleName }}</span>
              <span class="mc-points">{{ m.points }} <small>分</small></span>
            </div>
          </div>
          <div class="mc-arrow">&rarr;</div>
        </div>
      </div>
    </div>

    <!-- 本季度团队任务 -->
    <div class="section">
      <div class="section-header">
        <h3 class="section-title">🤝 本季度团队任务</h3>
        <span class="section-hint">{{ formatQuarter(currentQuarter) }}</span>
      </div>
      <div v-if="group" class="group-card" @click="$router.push('/group')">
        <div class="group-status" :class="`group-${group.status}`">
          <StatusBadge :status="groupStatusBadge" />
        </div>
        <div class="group-info">
          <span class="group-name">{{ group.name }}</span>
          <span class="group-members">
            <span v-for="m in group.members" :key="m.employeeName" class="group-member-tag">{{ m.employeeName }}</span>
          </span>
          <!-- taskRequirement 是本季度统一任务（管理员设置），不是组自己写的完成描述 -->
          <span v-if="group.taskRequirement" class="group-desc">{{ group.taskRequirement }}</span>
        </div>
        <span class="group-arrow">&rarr;</span>
      </div>
      <div v-else class="group-card group-empty">
        <div class="group-empty-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="8" r="5" />
            <path d="M3 21v-2a7 7 0 017-7h4a7 7 0 017 7v2" />
          </svg>
        </div>
        <span class="group-empty-text">本季度暂无团队任务，等待管理员分组</span>
      </div>
    </div>

    <!-- 最近动态 -->
    <div class="section">
      <div class="section-header">
        <h3 class="section-title">最近动态</h3>
      </div>
      <EmptyState v-if="recentLogs.length === 0" text="还没有积分记录，去申请吧" />
      <div v-else class="log-card">
        <div
          v-for="(log, i) in recentLogs"
          :key="log.id"
          class="log-item"
          :style="{ animationDelay: `${i * 0.04}s` }"
        >
          <div class="log-icon" :class="log.type === 'award' ? 'icon-award' : 'icon-deduct'">
            <span>{{ log.type === 'award' ? '+' : '−' }}</span>
          </div>
          <div class="log-body">
            <span class="log-title">{{ log.moduleName }} · {{ log.subcategoryName }}</span>
            <span class="log-desc">{{ log.description }}</span>
          </div>
          <span class="log-points" :class="log.type === 'award' ? 'positive' : 'negative'">
            {{ log.type === 'award' ? '+' : '−' }}{{ log.points }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'
import EmptyState from '../components/EmptyState.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { formatQuarter, quarterKey } from '../utils/quarter'

const router = useRouter()
const totalPoints = ref(0)
const animatedPoints = ref(0)
const moduleBreakdown = ref([])
const legacyPoints = ref(0)
const quarterly = ref(null)
const recentLogs = ref([])
const group = ref(null)
// 优先用服务端下发的 currentQuarter：这里渲染的是"团队任务属于哪个季度"，
// 而团队任务的分组键是服务端算的。本地 quarterKey() 只在首次渲染、接口还没
// 回来时兜底 —— 否则一个跨季度不关的标签页会给服务端的 Q3 团队贴上 Q4 的标签。
const currentQuarter = ref(quarterKey())

const today = computed(() => {
  const d = new Date()
  const week = ['日','一','二','三','四','五','六']
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 星期${week[d.getDay()]}`
})

// 按服务端下发的 dimension_code 取样式。中文名回退是给 dimensionCode 为空的
// 历史模块用的（旧四模块停用后接口仍会返回它们的累计分）。
const dimensionClass = (code) => (code ? `mc-${code}` : '')

const LEGACY_NAME_CODE = {
  能力: 'skill', 担当: 'duty', 道德: 'growth', 纪律: 'discipline',
  有健康: 'health', 有本领: 'skill', 有成长: 'growth',
  有智慧: 'wisdom', 有担当: 'duty', 有纪律: 'discipline'
}
const legacyCodeOf = (name) => LEGACY_NAME_CODE[name] || ''

const groupStatusBadge = computed(() => {
  const map = { active: 'pending', submitted: 'pending', approved: 'approved', rejected: 'rejected' }
  return map[group.value?.status] || 'pending'
})

function particleStyle(n) {
  const angle = (n / 24) * 360
  const dist = 50 + (n % 4) * 28
  const colors = ['#FFB3BF', '#FFC77D', '#7EE8CA', '#FFD27E', '#C5DAFF', '#fff']
  const color = colors[n % colors.length]
  return {
    '--angle': `${angle}deg`,
    '--dist': `${dist}%`,
    '--color': color,
    width: `${3 + (n % 3) * 2}px`,
    height: `${3 + (n % 3) * 2}px`,
    animationDelay: `${n * 0.12}s`
  }
}

onMounted(async () => {
  try {
    const data = await api.get('/points/dashboard')
    // totalPoints 仍是生命周期累计（含历史），季度分是另一套尺度的数，
    // 服务端分字段下发，前端不做任何换算
    totalPoints.value = data.totalPoints
    moduleBreakdown.value = data.moduleBreakdown
    legacyPoints.value = data.legacyPoints || 0
    quarterly.value = data.quarterly || null
    recentLogs.value = data.recentLogs
    group.value = data.group
    if (data.currentQuarter) currentQuarter.value = data.currentQuarter
    animateCount(0, data.totalPoints, 1200)
  } catch { /* handled by interceptor */ }
})

function animateCount(from, to, duration) {
  const start = performance.now()
  function tick(now) {
    const elapsed = now - start
    const progress = Math.min(elapsed / duration, 1)
    const eased = 1 - Math.pow(1 - progress, 5)
    animatedPoints.value = Math.round(from + (to - from) * eased)
    if (progress < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
</script>

<style scoped>
/* ===== 欢迎横幅 ===== */
.welcome-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 28px;
  animation: fadeInDown 0.5s var(--transition-bounce);
}
.welcome-left {
  display: flex;
  align-items: center;
  gap: 14px;
}
.brand-block {
  width: 48px; height: 48px;
  background: linear-gradient(135deg, #FF7B8A, #FFB3BF);
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 20px rgba(255, 123, 138, 0.3);
}
.brand-char {
  color: #fff;
  font-size: 24px;
  font-weight: 900;
}
.welcome-title {
  font-size: 26px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: 2px;
  line-height: 1.2;
  animation: gentleFloat 4.2s ease-in-out infinite, textGlow 2.8s ease-in-out infinite;
}
.welcome-sub {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
  letter-spacing: 1px;
}
.date-badge {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-card);
  border: 1.5px solid var(--ink-100);
  padding: 10px 18px;
  border-radius: 24px;
}

/* ===== Hero 总积分 ===== */
.hero-card {
  position: relative;
  background: linear-gradient(155deg, #FF9F8E 0%, #FF7B8A 35%, #FFB08C 70%, #FFC77D 100%);
  border-radius: var(--radius-2xl);
  padding: 52px 40px;
  margin-bottom: 32px;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(255, 123, 138, 0.28), 0 6px 20px rgba(0,0,0,0.06);
  animation: scaleInSpring 0.8s var(--transition-spring);
}
.hero-bg { position: absolute; inset: 0; pointer-events: none; }
.hero-circle {
  position: absolute;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.15);
  left: 50%; top: 50%;
  transform: translate(-50%, -50%);
}
.c1 { width: 480px; height: 480px; }
.c2 { width: 340px; height: 340px; border-color: rgba(255,255,255,0.1); }
.c3 { width: 200px; height: 200px; border-color: rgba(255,255,255,0.08); }
.hero-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
}
.hg1 { width: 220px; height: 220px; background: rgba(255,255,255,0.25); top: -70px; right: -50px; }
.hg2 { width: 180px; height: 180px; background: rgba(255,179,191,0.3); bottom: -50px; left: -30px; }
.hg3 { width: 140px; height: 140px; background: rgba(255,199,125,0.2); top: 50%; left: 50%; }

.hero-content { position: relative; z-index: 1; text-align: center; }
.hero-label {
  font-size: 14px; color: rgba(255,255,255,0.75);
  letter-spacing: 5px; margin-bottom: 10px; font-weight: 600;
}
.hero-points-wrap { margin-bottom: 16px; }
.hero-points {
  font-size: 88px; font-weight: 900; color: #fff;
  line-height: 1; letter-spacing: -3px;
  text-shadow: 0 6px 28px rgba(0,0,0,0.12);
}
.hero-unit { font-size: 24px; color: rgba(255,255,255,0.8); margin-left: 6px; font-weight: 400; }
.hero-divider {
  width: 52px; height: 3px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
  margin: 0 auto 14px;
  border-radius: 2px;
}
.hero-hint { font-size: 13px; color: rgba(255,255,255,0.5); letter-spacing: 3px; }
.hero-quarter {
  margin-top: 10px; font-size: 13px; font-weight: 600;
  color: rgba(255,255,255,0.92);
  background: rgba(255,255,255,0.16);
  border-radius: 20px; padding: 6px 16px;
  display: inline-block;
}

/* 可爱小精灵浮动 */
.sprites { position: absolute; inset: 0; pointer-events: none; z-index: 0; }
.sprite {
  position: absolute;
  font-size: 20px;
  animation: float 4s ease-in-out infinite;
  opacity: 0.7;
}
.s1 { top: 12%; left: 8%; animation-delay: 0s; font-size: 22px; }
.s2 { top: 8%; right: 14%; animation-delay: 0.8s; font-size: 18px; }
.s3 { top: 60%; left: 5%; animation-delay: 1.6s; font-size: 20px; }
.s4 { top: 70%; right: 8%; animation-delay: 2.4s; font-size: 24px; }
.s5 { top: 35%; left: 90%; animation-delay: 3.2s; font-size: 16px; }
.s6 { top: 25%; left: 88%; animation-delay: 1.2s; font-size: 14px; }

/* 糖果粒子 */
.particles { position: absolute; inset: 0; pointer-events: none; }
.pt {
  position: absolute;
  left: 50%; top: 50%;
  background: var(--color);
  border-radius: 50%;
  animation: dotPulse 4.5s ease-in-out infinite;
  transform: translate(-50%, -50%)
    rotate(var(--angle))
    translateY(calc(var(--dist) * -1));
}

/* ===== 模块积分 ===== */
.section { margin-bottom: 28px; }
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 16px;
}
.section-title {
  font-size: 18px; font-weight: 800; color: var(--text-primary); letter-spacing: 0.03em;
}
.section-hint { font-size: 12px; color: var(--text-placeholder); font-weight: 500; }

.module-grid {
  display: grid;
  /* 6 个维度横排三列两行，比 repeat(4) 更容易读 */
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.module-card {
  position: relative;
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  display: flex;
  align-items: stretch;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  border: 1.5px solid var(--ink-100);
  overflow: hidden;
  transition: all var(--transition-bounce);
  animation: fadeInUp 0.5s var(--transition-bounce) both;
}
.module-card:hover {
  transform: translateY(-5px);
  box-shadow: var(--shadow-lg);
}
.module-card:active {
  transform: scale(0.97);
}
/* 季度卡不可点（维度明细在管理员端），历史积分卡没有对应申请入口。
   不加这条的话卡片会显示手型光标点下去却什么都不发生。 */
.module-card.mc-legacy,
.module-card.mc-quarter { cursor: default; }
.module-card.mc-legacy:hover,
.module-card.mc-quarter:hover { transform: none; box-shadow: var(--shadow-sm); }
.module-card.mc-legacy:active,
.module-card.mc-quarter:active { transform: none; }

.mc-stripe {
  width: 5px; flex-shrink: 0;
  border-radius: 0 3px 3px 0;
  transition: width var(--transition-smooth);
}
.module-card:hover .mc-stripe { width: 8px; }
.mc-health .mc-stripe { background: var(--module-health); }
.mc-skill .mc-stripe { background: var(--module-skill); }
.mc-growth .mc-stripe { background: var(--module-growth); }
.mc-wisdom .mc-stripe { background: var(--module-wisdom); }
.mc-duty .mc-stripe { background: var(--module-duty); }
.mc-discipline .mc-stripe { background: var(--module-discipline); }
/* 旧四模块色，保留一版不删：dimension_code 为空的历史模块回退到这里 */
.mc-ability .mc-stripe { background: var(--module-ability); }
.mc-responsibility .mc-stripe { background: var(--module-responsibility); }
.mc-morality .mc-stripe { background: var(--module-morality); }
.mc-legacy .mc-stripe { background: var(--text-placeholder); }

.mc-content {
  flex: 1; padding: 22px 18px;
  display: flex; align-items: center; gap: 14px;
}
.mc-icon-wrap {
  width: 56px; height: 56px;
  border-radius: 18px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.mc-health .mc-icon-wrap { background: var(--module-health-light); }
.mc-skill .mc-icon-wrap { background: var(--module-skill-light); }
.mc-growth .mc-icon-wrap { background: var(--module-growth-light); }
.mc-wisdom .mc-icon-wrap { background: var(--module-wisdom-light); }
.mc-duty .mc-icon-wrap { background: var(--module-duty-light); }
.mc-discipline .mc-icon-wrap { background: var(--module-discipline-light); }
.mc-ability .mc-icon-wrap { background: var(--module-ability-light); }
.mc-responsibility .mc-icon-wrap { background: var(--module-responsibility-light); }
.mc-morality .mc-icon-wrap { background: var(--module-morality-light); }
.mc-legacy .mc-icon-wrap { background: var(--ink-100); }
.mc-icon { font-size: 30px; }

.mc-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mc-name { font-size: 14px; font-weight: 700; color: var(--text-primary); }
.mc-points { font-size: 26px; font-weight: 900; }
.mc-health .mc-points { color: var(--module-health); }
.mc-skill .mc-points { color: var(--module-skill); }
.mc-growth .mc-points { color: var(--module-growth); }
.mc-wisdom .mc-points { color: var(--module-wisdom); }
.mc-duty .mc-points { color: var(--module-duty); }
.mc-discipline .mc-points { color: var(--module-discipline); }
.mc-ability .mc-points { color: var(--module-ability); }
.mc-responsibility .mc-points { color: var(--module-responsibility); }
.mc-morality .mc-points { color: var(--module-morality); }
.mc-legacy .mc-points { color: var(--text-secondary); }
.mc-points small { font-size: 12px; font-weight: 500; color: var(--text-secondary); margin-left: 2px; }
.mc-bonus { font-size: 11px; color: var(--text-placeholder); }

/* 刚性归零的维度：整卡弱化，红色描边，分数压暗 */
.module-card.mc-zero { border-color: var(--status-rejected); background: var(--status-rejected-bg); }
.module-card.mc-zero .mc-points { color: var(--status-rejected); }
.mc-zero-tag { position: absolute; top: 10px; right: 12px; }

/* ===== 季度横幅 ===== */
.quarter-banner {
  display: flex; justify-content: space-between; align-items: center;
  background: linear-gradient(135deg, #FFF5F3, #FFF8ED);
  border: 1px solid var(--ink-100);
  border-radius: var(--radius-lg);
  padding: 18px 22px;
  margin-bottom: 16px;
}
.quarter-banner.ineligible { background: var(--status-rejected-bg); border-color: var(--status-rejected); }
.qb-left { display: flex; align-items: baseline; gap: 10px; }
.qb-label { font-size: 13px; color: var(--text-secondary); }
.qb-score { font-size: 30px; font-weight: 900; color: var(--primary); }
.qb-score small { font-size: 14px; font-weight: 500; color: var(--text-placeholder); }
.qb-right { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.qb-rank { font-size: 16px; font-weight: 700; color: var(--text-primary); }
.qb-rank.danger { color: var(--status-rejected); }
.qb-sub { font-size: 12px; color: var(--text-placeholder); }
.qb-leave { font-size: 13px; font-weight: 700; color: var(--accent-gold); }

.mc-arrow {
  display: flex; align-items: center; padding: 0 16px;
  color: var(--ink-200); font-size: 18px; font-weight: 700;
  transition: all var(--transition-bounce);
}
.module-card:hover .mc-arrow { color: var(--primary); transform: translateX(4px); }

/* ===== 最近动态 ===== */
.log-card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  border: 1.5px solid var(--ink-100);
  overflow: hidden;
}
.log-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
  border-bottom: 1.5px solid var(--ink-50);
  animation: fadeInUp 0.4s var(--transition-bounce) both;
  transition: background var(--transition-fast);
}
.log-item:last-child { border-bottom: none; }
.log-item:hover { background: var(--bg-card-hover); }

.log-icon {
  width: 40px; height: 40px;
  border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  font-size: 17px; font-weight: 800; flex-shrink: 0;
}
.icon-award { background: var(--status-approved-bg); color: var(--status-approved); }
.icon-deduct { background: var(--status-rejected-bg); color: var(--status-rejected); }

.log-body { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.log-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.log-desc { font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.log-points { font-size: 18px; font-weight: 800; flex-shrink: 0; }
.log-points.positive { color: var(--status-approved); }
.log-points.negative { color: var(--status-rejected); }

/* ===== 团队任务卡片 ===== */
.group-card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  border: 1.5px solid var(--ink-100);
  padding: 20px 24px;
  display: flex;
  align-items: center;
  gap: 16px;
  cursor: pointer;
  transition: all var(--transition-bounce);
  animation: fadeInUp 0.5s var(--transition-bounce) both;
}
.group-card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--primary-light);
  transform: translateY(-2px);
}
.group-info { flex: 1; display: flex; flex-direction: column; gap: 6px; }
.group-name { font-size: 16px; font-weight: 800; color: var(--text-primary); }
.group-members { display: flex; flex-wrap: wrap; gap: 4px; }
.group-member-tag {
  font-size: 11px; font-weight: 600;
  background: var(--primary-bg); color: var(--primary-dark);
  padding: 3px 10px; border-radius: 14px;
}
.group-desc { font-size: 12px; color: var(--text-placeholder); }
.group-arrow { font-size: 18px; color: var(--text-placeholder); transition: all var(--transition-bounce); flex-shrink: 0; }
.group-card:hover .group-arrow { color: var(--primary); transform: translateX(3px); }

.group-empty { cursor: default; justify-content: center; }
.group-empty:hover { box-shadow: var(--shadow-sm); border-color: var(--ink-100); transform: none; }
.group-empty-icon { color: var(--primary-light); }
.group-empty-text { font-size: 13px; color: var(--text-placeholder); font-weight: 500; }

@media (max-width: 768px) {
  .module-grid { grid-template-columns: repeat(2, 1fr); }
  .hero-card { padding: 36px 24px; border-radius: var(--radius-xl); }
  .hero-points { font-size: 60px; }
  .welcome-title { font-size: 20px; }
}
@media (max-width: 480px) {
  .module-grid { grid-template-columns: 1fr; }
  .hero-card { padding: 28px 18px; }
  .hero-points { font-size: 44px; }
  .welcome-title { font-size: 17px; }
  .welcome-banner { flex-wrap: wrap; gap: 10px; }
  .group-card { padding: 16px 18px; }
}
</style>
