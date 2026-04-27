<template>
  <div>
    <div class="page-header">
      <h3 class="page-title">📋 积分记录</h3>
      <p class="page-sub">查看所有积分变动记录</p>
    </div>

    <EmptyState v-if="logs.length === 0 && !loading" text="暂无积分记录，去申请吧" />

    <div v-else class="log-card">
      <div class="log-head">
        <span class="log-head-label">记录</span>
        <span class="log-head-count">共 {{ total }} 条</span>
      </div>
      <div
        v-for="(log, i) in logs"
        :key="log.id"
        class="log-item"
        :style="{ animationDelay: `${i * 0.03}s` }"
      >
        <div class="log-icon" :class="log.type === 'award' ? 'icon-award' : 'icon-deduct'">
          <span>{{ log.type === 'award' ? '+' : '−' }}</span>
        </div>
        <div class="log-body">
          <div class="log-top">
            <span class="log-title">{{ log.moduleName }} · {{ log.subcategoryName }}</span>
            <span class="log-points" :class="log.type === 'award' ? 'positive' : 'negative'">
              {{ log.type === 'award' ? '+' : '−' }}{{ log.points }}
            </span>
          </div>
          <span class="log-desc">{{ log.description }}</span>
          <span class="log-time">{{ log.createdAt }}</span>
        </div>
      </div>
    </div>

    <div v-if="hasMore" class="load-wrap">
      <el-button :loading="loading" size="large" class="load-btn" @click="loadMore">加载更多</el-button>
    </div>
    <p v-if="!hasMore && logs.length > 0" class="end-text">— 已加载全部记录 —</p>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'
import EmptyState from '../components/EmptyState.vue'

const logs = ref([])
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const hasMore = ref(true)

onMounted(() => loadData(true))

async function loadData(reset = false) {
  if (loading.value) return
  const p = reset ? 1 : page.value
  loading.value = true
  try {
    const data = await api.get('/points/history', { params: { page: p, pageSize: 20 } })
    logs.value = reset ? data.items : [...logs.value, ...data.items]
    page.value = p + 1
    total.value = data.total
    hasMore.value = logs.value.length < data.total
  } finally { loading.value = false }
}

function loadMore() { loadData() }
</script>

<style scoped>
.page-header { margin-bottom: 24px; }
.page-title { margin-bottom: 6px; }
.page-sub { font-size: 13px; color: var(--text-secondary); margin-left: 20px; }

.log-card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  border: 1.5px solid var(--ink-100);
  overflow: hidden;
}
.log-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1.5px solid var(--ink-50);
  background: var(--ink-50);
}
.log-head-label { font-size: 12px; font-weight: 700; color: var(--text-secondary); letter-spacing: 1.5px; }
.log-head-count { font-size: 12px; color: var(--text-placeholder); font-weight: 500; }

.log-item {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 16px 20px;
  border-bottom: 1.5px solid var(--ink-50);
  animation: fadeInUp 0.35s var(--transition-bounce) both;
  transition: background var(--transition-fast);
}
.log-item:last-child { border-bottom: none; }
.log-item:hover { background: var(--bg-card-hover); }

.log-icon {
  width: 36px; height: 36px;
  border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 800; flex-shrink: 0; margin-top: 2px;
}
.icon-award { background: var(--status-approved-bg); color: var(--status-approved); }
.icon-deduct { background: var(--status-rejected-bg); color: var(--status-rejected); }

.log-body { flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.log-top { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.log-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.log-desc { font-size: 12px; color: var(--text-secondary); }
.log-time { font-size: 11px; color: var(--text-placeholder); font-weight: 500; }

.log-points { font-size: 18px; font-weight: 800; flex-shrink: 0; }
.log-points.positive { color: var(--status-approved); }
.log-points.negative { color: var(--status-rejected); }

.load-wrap { text-align: center; margin-top: 24px; }
.load-btn { min-width: 160px; border-radius: 16px; height: 46px; font-weight: 600; }
.end-text { text-align: center; color: var(--text-placeholder); font-size: 13px; margin-top: 20px; font-weight: 500; }
</style>
