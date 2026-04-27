<template>
  <div>
    <div class="page-header">
      <h3 class="page-title">员工管理</h3>
      <p class="page-sub">管理系统中的员工账号</p>
    </div>

    <div class="table-card">
      <el-table :data="employees" stripe border style="width:100%" v-loading="loading">
        <el-table-column prop="name" label="姓名" width="100" />
        <el-table-column prop="employeeId" label="工号" width="120" />
        <el-table-column prop="department" label="部门" min-width="140" />
        <el-table-column label="总积分" width="110" align="center">
          <template #default="{ row }">
            <span class="points-cell">{{ row.totalPoints }}</span>
          </template>
        </el-table-column>
        <el-table-column label="角色" width="120" align="center">
          <template #default="{ row }">
            <span v-if="row.role === 'superadmin'" class="role-tag tag-super">超级管理</span>
            <span v-else-if="row.role === 'admin'" class="role-tag tag-admin">管理员</span>
            <span v-else class="role-text">员工</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }">
            <span class="status-dot" :class="row.status === 'active' ? 'dot-active' : 'dot-disabled'" />
            {{ row.status === 'active' ? '正常' : '禁用' }}
          </template>
        </el-table-column>
        <el-table-column v-if="auth.isSuperAdmin" label="操作" width="180" align="center" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.role === 'employee'" type="primary" link size="small" @click="handlePromote(row)">提拔管理</el-button>
            <el-button type="danger" link size="small" @click="handleDisable(row)">
              {{ row.status === 'active' ? '禁用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-if="hasMore" class="load-wrap">
      <el-button :loading="loading" size="large" class="load-btn" @click="loadData">加载更多</el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useAuthStore } from '../../stores/auth'
import api from '../../api'

const auth = useAuthStore()
const employees = ref([])
const page = ref(1)
const loading = ref(false)
const hasMore = ref(true)

onMounted(() => loadData(true))

async function loadData(reset = false) {
  if (loading.value) return
  const p = reset ? 1 : page.value
  loading.value = true
  try {
    const data = await api.get('/admin/employees', { params: { page: p, pageSize: 50 } })
    employees.value = reset ? data.items : [...employees.value, ...data.items]
    page.value = p + 1
    hasMore.value = employees.value.length < data.total
  } finally { loading.value = false }
}

async function handlePromote(row) {
  try {
    await ElMessageBox.confirm(`确定将 ${row.name} 提升为管理员吗？`, '提拔管理员', { type: 'warning' })
    await api.post(`/admin/employees/${row.id}/promote`)
    ElMessage.success('已提升为管理员')
    loadData(true)
  } catch { /* cancelled */ }
}

async function handleDisable(row) {
  const action = row.status === 'active' ? '禁用' : '启用'
  try {
    await ElMessageBox.confirm(`确定${action} ${row.name} 的账号吗？`, `${action}员工`, { type: 'warning' })
    await api.post(`/admin/employees/${row.id}/disable`)
    ElMessage.success(`已${action}`)
    loadData(true)
  } catch { /* cancelled */ }
}
</script>

<style scoped>
.page-header { margin-bottom: 24px; }
.page-title { margin-bottom: 6px; }
.page-sub { font-size: 13px; color: var(--text-secondary); margin-left: 20px; }

.table-card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  border: 1px solid var(--ink-100);
  overflow: hidden;
}

.points-cell { color: var(--primary); font-weight: 800; font-size: 15px; }

.role-tag {
  display: inline-block;
  font-size: 11px; font-weight: 600;
  padding: 3px 10px; border-radius: 12px;
}
.tag-super { background: var(--status-rejected-bg); color: var(--accent-red); }
.tag-admin { background: var(--module-morality-light); color: var(--module-morality); }
.role-text { color: var(--text-secondary); font-size: 12px; }

.status-dot {
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  margin-right: 5px;
  vertical-align: middle;
}
.dot-active { background: var(--status-approved); }
.dot-disabled { background: var(--text-placeholder); }

.load-wrap { text-align: center; margin-top: 24px; }
.load-btn { min-width: 160px; border-radius: var(--radius-md); height: 44px; }
</style>
