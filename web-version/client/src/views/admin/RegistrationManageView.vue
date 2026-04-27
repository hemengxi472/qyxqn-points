<template>
  <div>
    <div class="page-header">
      <h3 class="page-title">注册审批</h3>
      <p class="page-sub">审核新注册用户的申请</p>
    </div>

    <div v-if="loading" class="loading-state">
      <div class="loader" />
      <p>加载中...</p>
    </div>

    <div v-else-if="items.length === 0" class="empty-wrap">
      <EmptyState text="暂无待审批的注册申请" />
    </div>

    <div v-else class="reg-list">
      <div v-for="u in items" :key="u.id" class="reg-card">
        <div class="reg-avatar">
          <img v-if="u.avatarUrl" :src="u.avatarUrl" class="avatar-img" />
          <span v-else class="avatar-text">{{ u.name.charAt(0) }}</span>
        </div>
        <div class="reg-body">
          <span class="reg-name">{{ u.name }}</span>
          <span class="reg-meta">{{ u.department }} · {{ u.employeeId }}</span>
          <span class="reg-meta">用户名: {{ u.username }}</span>
          <span class="reg-time">{{ u.createdAt }}</span>
        </div>
        <div class="reg-actions">
          <el-button type="success" size="small" :loading="acting === u.id" @click="approve(u)">
            通过
          </el-button>
          <el-button type="danger" size="small" :loading="acting === u.id" @click="reject(u)">
            驳回
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../../api'
import EmptyState from '../../components/EmptyState.vue'

const items = ref([])
const loading = ref(false)
const acting = ref(null)

onMounted(() => loadRegistrations())

async function loadRegistrations() {
  loading.value = true
  try {
    const data = await api.get('/admin/registrations')
    items.value = data.items
  } finally { loading.value = false }
}

async function approve(user) {
  acting.value = user.id
  try {
    await api.post(`/admin/registrations/${user.id}/approve`)
    ElMessage.success(`${user.name} 审批通过`)
    items.value = items.value.filter(u => u.id !== user.id)
  } finally { acting.value = null }
}

async function reject(user) {
  acting.value = user.id
  try {
    await api.post(`/admin/registrations/${user.id}/reject`)
    ElMessage.success(`${user.name} 已驳回`)
    items.value = items.value.filter(u => u.id !== user.id)
  } finally { acting.value = null }
}
</script>

<style scoped>
.page-header { margin-bottom: 24px; }
.page-sub { font-size: 13px; color: var(--text-secondary); margin-left: 20px; }

.loading-state { text-align: center; padding: 80px 0; color: var(--text-secondary); }
.loader {
  width: 36px; height: 36px;
  border: 3px solid var(--ink-100);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  margin: 0 auto 16px;
}
@keyframes spin { to { transform: rotate(360deg); } }

.empty-wrap { margin-top: 40px; }

.reg-list { display: flex; flex-direction: column; gap: 12px; }

.reg-card {
  background: var(--bg-card); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs); border: 1px solid var(--ink-100);
  padding: 20px 24px; display: flex; align-items: center; gap: 16px;
  transition: all var(--transition-smooth);
  animation: fadeInUp 0.4s var(--transition-smooth) both;
}
.reg-card:hover { box-shadow: var(--shadow-md); }

.reg-avatar {
  width: 48px; height: 48px; border-radius: 50%;
  overflow: hidden; flex-shrink: 0;
  background: linear-gradient(135deg, var(--primary), #60a5fa);
  display: flex; align-items: center; justify-content: center;
}
.avatar-img { width: 100%; height: 100%; object-fit: cover; }
.avatar-text { font-size: 20px; font-weight: 700; color: #fff; }

.reg-body { flex: 1; display: flex; flex-direction: column; gap: 3px; }
.reg-name { font-size: 16px; font-weight: 700; color: var(--text-primary); }
.reg-meta { font-size: 12px; color: var(--text-secondary); }
.reg-time { font-size: 11px; color: var(--text-placeholder); }

.reg-actions { display: flex; gap: 8px; flex-shrink: 0; }
</style>
