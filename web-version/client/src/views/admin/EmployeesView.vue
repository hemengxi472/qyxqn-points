<template>
  <div>
    <div class="page-header">
      <h3 class="page-title">员工管理</h3>
      <p class="page-sub">管理系统中的员工账号</p>
    </div>

    <div class="table-card table-scroll">
      <el-table :data="employees" stripe border style="min-width:750px" v-loading="loading">
        <el-table-column prop="name" label="姓名" width="100" />
        <el-table-column prop="employeeId" label="工号" width="120" />
        <el-table-column prop="department" label="部门" min-width="140" />
        <!-- 分值走季度评分（与季度评分页同一套 buildQuarterlyScores），不再是
             生命周期累计。只有参评对象有值，管理员/禁用/不排名显示 "—"。 -->
        <el-table-column width="130" align="center">
          <template #header>
            <el-tooltip content="本季度得分，与季度评分页同口径" placement="top">
              <span style="cursor:help;border-bottom:1px dashed var(--ink-200)">季度得分</span>
            </el-tooltip>
          </template>
          <template #default="{ row }">
            <span class="points-cell">{{ row.quarterScore == null ? '—' : row.quarterScore }}</span>
          </template>
        </el-table-column>
        <el-table-column label="角色" width="120" align="center">
          <template #default="{ row }">
            <span v-if="row.role === 'superadmin'" class="role-tag tag-super">超级管理</span>
            <span v-else-if="row.role === 'admin'" class="role-tag tag-admin">管理员</span>
            <span v-else class="role-text">员工</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="150" align="center">
          <template #default="{ row }">
            <span class="status-dot" :class="row.status === 'active' ? 'dot-active' : 'dot-disabled'" />
            {{ row.status === 'active' ? '正常' : '禁用' }}
            <!-- 「不参与排名」不是状态，人是正常的 —— 单列一枚标签，避免读成被停用 -->
            <span v-if="row.excludeFromRanking" class="norank-tag">不排名</span>
          </template>
        </el-table-column>
        <el-table-column v-if="auth.isSuperAdmin" label="操作" width="320" align="center" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.role === 'employee'" type="primary" link size="small" @click="handlePromote(row)">提拔管理</el-button>
            <el-button type="danger" link size="small" @click="handleDisable(row)">
              {{ row.status === 'active' ? '禁用' : '启用' }}
            </el-button>
            <!-- 管理员不在排名里是代码决定的，不给开关，免得设了没有效果 -->
            <el-button
              v-if="row.role === 'employee'"
              type="warning" link size="small"
              @click="handleRanking(row)"
            >{{ row.excludeFromRanking ? '参与排名' : '不排名' }}</el-button>
            <!-- 超级管理员没有「删除」：服务端也会拒，这里不显示免得点出一个必然的失败 -->
            <el-button
              v-if="row.role !== 'superadmin'"
              type="danger" link size="small"
              @click="handleDelete(row)"
            >删除</el-button>
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

// 「不参与排名」是可逆的，影响的只有季度评分名单和调休排名 —— 人照常登录、
// 照常提交、累计积分照常涨。所以确认框要讲清它**不**做什么，否则会被当成禁用。
async function handleRanking(row) {
  const exiting = !row.excludeFromRanking
  try {
    await ElMessageBox.confirm(
      exiting
        ? `将把 ${row.name} 移出季度评分名单和调休排名。\n\n他能照常登录、提交积分申请，累计积分也不受影响；只是不再出现在季度排名里，也不会获得调休额度。`
        : `将把 ${row.name} 重新纳入季度评分名单和调休排名。`,
      exiting ? '设为不参与排名' : '恢复参与排名',
      { type: 'warning' }
    )
    await api.post(`/admin/employees/${row.id}/ranking`)
    ElMessage.success(exiting ? `已把 ${row.name} 移出排名` : `已恢复 ${row.name} 的排名`)
    loadData(true)
  } catch { /* cancelled 或已由拦截器提示 */ }
}

// 删除是不可恢复的，所以确认框里必须写清「和他的记录一起没」，而不是一句
// 「确定删除吗」。删除失败的原因（当过审核人、进过快照）由服务端返回 409，
// 消息本身就是解释，交给 api 拦截器弹出即可。
async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(
      `将从系统中彻底删除 ${row.name}（${row.employeeId}），并同时删除他名下的积分申请、积分流水、累计积分、团队成员记录和季度评分数据。\n\n此操作不可恢复，也无法通过任何界面撤销。如果只是想让对方登不进来，请用「禁用」。`,
      '彻底删除员工',
      { type: 'error', confirmButtonText: '确认删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }
    )
    await api.delete(`/admin/employees/${row.id}`)
    ElMessage.success(`已删除 ${row.name}`)
    loadData(true)
  } catch { /* cancelled 或已由拦截器提示 */ }
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

.norank-tag {
  display: inline-block; margin-left: 6px;
  font-size: 11px; font-weight: 600; line-height: 1.5;
  padding: 1px 7px; border-radius: 10px;
  background: var(--ink-100); color: var(--text-secondary);
}

.load-wrap { text-align: center; margin-top: 24px; }
.load-btn { min-width: 160px; border-radius: var(--radius-md); height: 44px; }
</style>
