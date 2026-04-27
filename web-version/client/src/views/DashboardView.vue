<template>
  <div class="dashboard">
    <!-- 欢迎横幅 -->
    <div class="welcome-banner">
      <div class="welcome-left">
        <div class="brand-block">
          <span class="brand-char">青</span>
        </div>
        <div class="welcome-text">
          <h1 class="welcome-title">青羊新青年</h1>
          <p class="welcome-sub">青年员工能力积分系统</p>
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
        <p class="hero-label">🌟 我的总积分</p>
        <div class="hero-points-wrap">
          <span class="hero-points">{{ animatedPoints }}</span>
          <span class="hero-unit">分</span>
        </div>
        <div class="hero-divider" />
        <p class="hero-hint">持续积累，见证成长</p>
      </div>
      <!-- 糖果粒子 -->
      <div class="particles">
        <span v-for="n in 24" :key="n" class="pt" :style="particleStyle(n)" />
      </div>
    </div>

    <!-- 模块积分卡片 -->
    <div v-if="moduleBreakdown.length" class="section">
      <div class="section-header">
        <h3 class="section-title">📚 各模块积分</h3>
        <span class="section-hint">点击卡片进入申请</span>
      </div>
      <div class="module-grid">
        <div
          v-for="(m, i) in moduleBreakdown"
          :key="m.moduleId"
          class="module-card"
          :class="moduleClass(m.moduleId)"
          :style="{ animationDelay: `${0.08 + i * 0.08}s` }"
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

    <!-- 本月团队任务 -->
    <div class="section">
      <div class="section-header">
        <h3 class="section-title">🤝 本月团队任务</h3>
        <span class="section-hint">{{ monthYear }}</span>
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
          <span v-if="group.taskDescription" class="group-desc">{{ group.taskDescription }}</span>
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
        <span class="group-empty-text">本月暂无团队任务，等待管理员分组</span>
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

const router = useRouter()
const totalPoints = ref(0)
const animatedPoints = ref(0)
const moduleBreakdown = ref([])
const recentLogs = ref([])
const group = ref(null)
const monthYear = ref('')
const isFraudReset = ref(false)

const today = computed(() => {
  const d = new Date()
  const week = ['日','一','二','三','四','五','六']
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 星期${week[d.getDay()]}`
})

const moduleClass = (id) => ({
  1: 'mc-ability', 2: 'mc-responsibility', 3: 'mc-morality', 4: 'mc-discipline'
}[id] || '')

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
    totalPoints.value = data.totalPoints
    moduleBreakdown.value = data.moduleBreakdown
    recentLogs.value = data.recentLogs
    group.value = data.group
    monthYear.value = data.monthYear
    isFraudReset.value = data.isFraudReset
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
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.module-card {
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

.mc-stripe {
  width: 5px; flex-shrink: 0;
  border-radius: 0 3px 3px 0;
  transition: width var(--transition-smooth);
}
.module-card:hover .mc-stripe { width: 8px; }
.mc-ability .mc-stripe { background: var(--module-ability); }
.mc-responsibility .mc-stripe { background: var(--module-responsibility); }
.mc-morality .mc-stripe { background: var(--module-morality); }
.mc-discipline .mc-stripe { background: var(--module-discipline); }

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
.mc-ability .mc-icon-wrap { background: var(--module-ability-light); }
.mc-responsibility .mc-icon-wrap { background: var(--module-responsibility-light); }
.mc-morality .mc-icon-wrap { background: var(--module-morality-light); }
.mc-discipline .mc-icon-wrap { background: var(--module-discipline-light); }
.mc-icon { font-size: 30px; }

.mc-info { display: flex; flex-direction: column; gap: 2px; }
.mc-name { font-size: 14px; font-weight: 700; color: var(--text-primary); }
.mc-points { font-size: 26px; font-weight: 900; }
.mc-ability .mc-points { color: var(--module-ability); }
.mc-responsibility .mc-points { color: var(--module-responsibility); }
.mc-morality .mc-points { color: var(--module-morality); }
.mc-discipline .mc-points { color: var(--module-discipline); }
.mc-points small { font-size: 12px; font-weight: 500; color: var(--text-secondary); margin-left: 2px; }

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
