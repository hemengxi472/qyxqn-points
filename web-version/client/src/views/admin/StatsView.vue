<template>
  <div>
    <div class="page-header">
      <h3 class="page-title">数据统计</h3>
      <p class="page-sub">积分系统运营数据概览</p>
    </div>

    <!-- 统计卡片 -->
    <div v-if="stats" class="stat-grid">
      <div class="stat-card stat-blue">
        <div class="stat-icon-box">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
          </svg>
        </div>
        <div class="stat-body">
          <span class="stat-num">{{ stats.totalEmployees }}</span>
          <span class="stat-label">活跃员工</span>
        </div>
      </div>
      <div class="stat-card stat-amber">
        <div class="stat-icon-box">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
          </svg>
        </div>
        <div class="stat-body">
          <span class="stat-num">{{ stats.totalSubmissions }}</span>
          <span class="stat-label">总申请数</span>
        </div>
      </div>
      <div class="stat-card stat-red">
        <div class="stat-icon-box">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <div class="stat-body">
          <span class="stat-num">{{ stats.pendingReview }}</span>
          <span class="stat-label">待审核</span>
        </div>
      </div>
      <div class="stat-card stat-purple">
        <div class="stat-icon-box">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <line x1="9" y1="12" x2="11" y2="14" /><line x1="15" y1="10" x2="11" y2="14" />
          </svg>
        </div>
        <div class="stat-body">
          <span class="stat-num">{{ stats.fraudRecords }}</span>
          <span class="stat-label">作假记录</span>
        </div>
      </div>
    </div>

    <!-- 本月团队任务 -->
    <div v-if="stats?.groups" class="group-card">
      <div class="group-card-head">
        <h4>🤝 本月团队任务</h4>
        <el-button size="small" class="group-link-btn" @click="$router.push('/admin/groups')">
          前往团队管理 &rarr;
        </el-button>
      </div>
      <div class="group-summary">
        <div class="gs-item" :class="stats.groups.submitted > 0 ? 'gs-warn' : ''">
          <span class="gs-num">{{ stats.groups.submitted }}</span>
          <span class="gs-label">待审核</span>
        </div>
        <div class="gs-divider" />
        <div class="gs-item">
          <span class="gs-num">{{ stats.groups.approved }}</span>
          <span class="gs-label">已通过</span>
        </div>
        <div class="gs-divider" />
        <div class="gs-item">
          <span class="gs-num">{{ stats.groups.rejected }}</span>
          <span class="gs-label">已驳回</span>
        </div>
        <div class="gs-divider" />
        <div class="gs-item">
          <span class="gs-num">{{ stats.groups.active }}</span>
          <span class="gs-label">进行中</span>
        </div>
      </div>
      <!-- 待审核团队列表 -->
      <div v-if="stats.groups.submittedList?.length" class="submitted-list">
        <div v-for="g in stats.groups.submittedList" :key="g.id" class="submitted-item">
          <span class="si-dot" />
          <span class="si-name">{{ g.name }}</span>
          <span class="si-count">{{ g.memberCount }} 人</span>
          <el-button size="small" type="primary" class="si-btn" @click="$router.push('/admin/groups')">
            去审核
          </el-button>
        </div>
      </div>
      <div v-else-if="stats.groups.total === 0" class="group-empty">
        本月尚未生成团队，请前往团队管理生成本月团队
      </div>
    </div>

    <!-- 模块积分柱状图 -->
    <div v-if="stats?.pointsByModule?.length" class="chart-card">
      <h4>各模块积分分布</h4>
      <div class="bar-chart">
        <div v-for="m in stats.pointsByModule" :key="m.moduleName" class="bar-row">
          <span class="bar-label">{{ m.moduleName }}</span>
          <div class="bar-track">
            <div class="bar-fill" :class="barColorClass(m.moduleName)" :style="{ width: barWidth(m.total) }">
              <span v-if="m.total > 0" class="bar-val">{{ m.total }} 分</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 排行榜 -->
    <div v-if="stats?.topEmployees?.length" class="rank-card">
      <h4>积分排行榜 TOP{{ stats.topEmployees.length }}</h4>
      <div class="rank-list">
        <div v-for="(e, i) in stats.topEmployees" :key="e.employeeId" class="rank-item">
          <span class="rank-num" :class="`rank-${i + 1}`">{{ i + 1 }}</span>
          <div class="rank-info">
            <span class="rank-name">{{ e.name }}</span>
            <span class="rank-dept">{{ e.department }}</span>
          </div>
          <span class="rank-points">{{ e.totalPoints }} <small>分</small></span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../../api'

const stats = ref(null)

onMounted(async () => {
  const data = await api.get('/admin/stats')
  stats.value = data
})

const maxPoints = () => Math.max(...(stats.value?.pointsByModule?.map(m => m.total) || [1]), 1)
const barWidth = (v) => (v / maxPoints() * 100).toFixed(0) + '%'

const barColorClass = (name) => {
  const map = { '能力': 'bar-blue', '担当': 'bar-green', '道德': 'bar-gold', '纪律': 'bar-red' }
  return map[name] || 'bar-blue'
}
</script>

<style scoped>
.page-header { margin-bottom: 28px; }
.page-title { margin-bottom: 6px; }
.page-sub { font-size: 13px; color: var(--text-secondary); margin-left: 20px; }

/* 统计卡 */
.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }

.stat-card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: 24px;
  display: flex; align-items: center; gap: 16px;
  box-shadow: var(--shadow-xs);
  border: 1px solid var(--ink-100);
  animation: fadeInUp 0.5s var(--transition-smooth) both;
}
.stat-card:nth-child(1) { animation-delay: 0s; }
.stat-card:nth-child(2) { animation-delay: 0.06s; }
.stat-card:nth-child(3) { animation-delay: 0.12s; }
.stat-card:nth-child(4) { animation-delay: 0.18s; }

.stat-icon-box {
  width: 50px; height: 50px;
  border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.stat-blue .stat-icon-box { background: var(--module-ability-light); color: var(--module-ability); }
.stat-amber .stat-icon-box { background: var(--module-morality-light); color: var(--module-morality); }
.stat-red .stat-icon-box { background: var(--status-rejected-bg); color: var(--status-rejected); }
.stat-purple .stat-icon-box { background: var(--module-discipline-light); color: var(--module-discipline); }

.stat-body { display: flex; flex-direction: column; }
.stat-num { font-size: 30px; font-weight: 900; color: var(--text-primary); line-height: 1.1; letter-spacing: -1px; }
.stat-label { font-size: 12px; color: var(--text-secondary); margin-top: 4px; }

/* 团队任务卡片 */
.group-card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: 28px;
  box-shadow: var(--shadow-xs);
  border: 1px solid var(--ink-100);
  margin-bottom: 16px;
  animation: fadeInUp 0.5s 0.12s var(--transition-smooth) both;
}
.group-card-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 20px;
}
.group-card-head h4 {
  font-size: 16px; font-weight: 700; color: var(--text-primary); margin: 0;
}
.group-link-btn {
  border-radius: 14px;
  font-weight: 600;
  font-size: 12px;
  padding: 6px 16px;
  border: 1.5px solid var(--ink-100);
  background: var(--ink-50);
  color: var(--text-secondary);
  transition: all var(--transition-bounce);
}
.group-link-btn:hover {
  background: var(--primary-bg);
  border-color: var(--primary);
  color: var(--primary);
}

.group-summary {
  display: flex; align-items: center; gap: 0;
  background: var(--ink-50);
  border-radius: 16px;
  padding: 16px 8px;
  margin-bottom: 20px;
}
.gs-item {
  flex: 1;
  display: flex; flex-direction: column; align-items: center;
  gap: 4px;
  transition: all var(--transition-bounce);
}
.gs-num {
  font-size: 28px; font-weight: 900; color: var(--text-primary);
  line-height: 1.1;
}
.gs-warn .gs-num {
  color: var(--status-pending);
  animation: breathe 2s ease-in-out infinite;
}
.gs-label {
  font-size: 12px; color: var(--text-secondary); font-weight: 500;
}
.gs-divider {
  width: 1.5px; height: 36px; background: var(--ink-100); border-radius: 1px;
  flex-shrink: 0;
}

.submitted-list {
  display: flex; flex-direction: column; gap: 8px;
}
.submitted-item {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px;
  background: var(--status-pending-bg);
  border-radius: 14px;
  border: 1.5px solid #FDE2B8;
  transition: all var(--transition-bounce);
}
.submitted-item:hover {
  transform: translateX(3px);
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.1);
}
.si-dot {
  width: 10px; height: 10px;
  border-radius: 50%;
  background: var(--status-pending);
  flex-shrink: 0;
  animation: breathe 1.5s ease-in-out infinite;
}
.si-name {
  flex: 1; font-size: 14px; font-weight: 600; color: var(--text-primary);
}
.si-count {
  font-size: 12px; color: var(--text-secondary); font-weight: 500;
}
.si-btn {
  border-radius: 12px;
  font-weight: 600;
  font-size: 12px;
  height: 30px;
  padding: 0 14px;
}
.group-empty {
  text-align: center;
  padding: 24px;
  color: var(--text-placeholder);
  font-size: 13px;
}

/* 柱状图 */
.chart-card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: 28px;
  box-shadow: var(--shadow-xs);
  border: 1px solid var(--ink-100);
  margin-bottom: 16px;
  animation: fadeInUp 0.5s 0.18s var(--transition-smooth) both;
}
.chart-card h4 { font-size: 16px; font-weight: 700; color: var(--text-primary); margin-bottom: 24px; }

.bar-row { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
.bar-label { width: 52px; font-size: 13px; font-weight: 600; color: var(--text-primary); text-align: right; flex-shrink: 0; }
.bar-track { flex: 1; height: 32px; background: var(--ink-50); border-radius: 8px; overflow: hidden; }
.bar-fill {
  height: 100%; border-radius: 8px;
  display: flex; align-items: center; justify-content: flex-end;
  padding-right: 12px;
  transition: width 1s cubic-bezier(0.25, 0.8, 0.25, 1);
  min-width: 2px;
}
.bar-blue { background: linear-gradient(90deg, var(--module-ability), #3b82f6); }
.bar-green { background: linear-gradient(90deg, var(--module-responsibility), #34d399); }
.bar-gold { background: linear-gradient(90deg, var(--module-morality), #f59e0b); }
.bar-red { background: linear-gradient(90deg, var(--module-discipline), #f87171); }
.bar-val { font-size: 12px; font-weight: 700; color: #fff; white-space: nowrap; }

/* 排行榜 */
.rank-card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: 28px;
  box-shadow: var(--shadow-xs);
  border: 1px solid var(--ink-100);
  animation: fadeInUp 0.5s 0.24s var(--transition-smooth) both;
}
.rank-card h4 { font-size: 16px; font-weight: 700; color: var(--text-primary); margin-bottom: 20px; }

.rank-item {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 0;
  border-bottom: 1px solid var(--ink-50);
  transition: background var(--transition-fast);
}
.rank-item:last-child { border-bottom: none; }

.rank-num {
  width: 34px; height: 34px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 800;
  color: var(--text-secondary);
  background: var(--ink-50);
  flex-shrink: 0;
}
.rank-1 { background: #f59e0b; color: #fff; }
.rank-2 { background: #94a3b8; color: #fff; }
.rank-3 { background: #d97706; color: #fff; }

.rank-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.rank-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.rank-dept { font-size: 12px; color: var(--text-secondary); }
.rank-points { font-size: 18px; font-weight: 800; color: var(--primary); }
.rank-points small { font-size: 11px; font-weight: 400; color: var(--text-secondary); margin-left: 2px; }

@media (max-width: 1024px) {
  .stat-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 640px) {
  .stat-grid { grid-template-columns: 1fr; }
}
</style>
