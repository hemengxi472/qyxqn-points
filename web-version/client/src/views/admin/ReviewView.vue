<template>
  <div>
    <div class="page-header">
      <h3 class="page-title">审核管理</h3>
      <p class="page-sub">审核员工提交的积分申请</p>
    </div>

    <!-- Tab 切换 -->
    <div class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: currentTab === tab.key }"
        @click="switchTab(tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>

    <EmptyState v-if="items.length === 0 && !loading" :text="emptyText" />

    <div v-else class="review-list">
      <div
        v-for="(item, i) in items"
        :key="item.id"
        class="review-card"
        :style="{ animationDelay: `${i * 0.04}s` }"
        @click="$router.push(`/admin/review/${item.id}`)"
      >
        <StatusBadge :status="item.status" />
        <div class="rc-body">
          <span class="rc-title">{{ item.moduleName }} · {{ item.subcategoryName }}</span>
          <span class="rc-meta">{{ item.employeeName }} · {{ item.department }} · {{ item.createdAt }}</span>
        </div>
        <span class="rc-arrow">&rarr;</span>
      </div>
    </div>

    <div v-if="hasMore" class="load-wrap">
      <el-button :loading="loading" size="large" class="load-btn" @click="loadData">加载更多</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import api from '../../api'
import StatusBadge from '../../components/StatusBadge.vue'
import EmptyState from '../../components/EmptyState.vue'

const tabs = [
  { key: 'pending', label: '待审核' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已拒绝' }
]
const currentTab = ref('pending')
const items = ref([])
const page = ref(1)
const loading = ref(false)
const hasMore = ref(true)

const emptyText = computed(() => {
  const map = { pending: '暂无待审核记录', approved: '暂无已通过记录', rejected: '暂无已拒绝记录' }
  return map[currentTab.value] || '暂无记录'
})

onMounted(() => loadData(true))

async function loadData(reset = false) {
  if (loading.value) return
  const p = reset ? 1 : page.value
  loading.value = true
  try {
    const data = await api.get('/admin/reviews', { params: { status: currentTab.value, page: p, pageSize: 20 } })
    items.value = reset ? data.items : [...items.value, ...data.items]
    page.value = p + 1
    hasMore.value = items.value.length < data.total
  } finally { loading.value = false }
}

function switchTab(tab) {
  currentTab.value = tab
  items.value = []
  page.value = 1
  hasMore.value = true
  loadData(true)
}
</script>

<style scoped>
.page-header { margin-bottom: 24px; }
.page-title { margin-bottom: 6px; }
.page-sub { font-size: 13px; color: var(--text-secondary); margin-left: 20px; }

.tab-bar {
  display: flex; gap: 4px;
  margin-bottom: 20px;
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 4px;
  box-shadow: var(--shadow-xs);
  border: 1px solid var(--ink-100);
}
.tab-btn {
  flex: 1;
  padding: 10px 20px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.tab-btn.active {
  color: #fff;
  background: var(--primary);
  font-weight: 600;
  box-shadow: 0 2px 8px var(--primary-glow);
}

.review-list { display: flex; flex-direction: column; gap: 8px; }

.review-card {
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 16px 20px;
  display: flex;
  align-items: center;
  gap: 14px;
  cursor: pointer;
  box-shadow: var(--shadow-xs);
  border: 1px solid var(--ink-100);
  transition: all var(--transition-smooth);
  animation: fadeInUp 0.4s var(--transition-smooth) both;
}
.review-card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--primary);
  transform: translateX(3px);
}

.rc-body { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.rc-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.rc-meta { font-size: 12px; color: var(--text-secondary); }
.rc-arrow { color: var(--text-placeholder); font-size: 18px; transition: all var(--transition-fast); flex-shrink: 0; }
.review-card:hover .rc-arrow { color: var(--primary); transform: translateX(2px); }

.load-wrap { text-align: center; margin-top: 24px; }
.load-btn { min-width: 160px; border-radius: var(--radius-md); height: 44px; }

@media (max-width: 768px) {
  .tab-btn { padding: 8px 14px; font-size: 12px; }
  .review-card { padding: 14px 16px; gap: 10px; }
  .rc-meta { font-size: 11px; }
  .rc-arrow { font-size: 16px; }
  .load-btn { min-width: 140px; height: 42px; }
}
</style>
