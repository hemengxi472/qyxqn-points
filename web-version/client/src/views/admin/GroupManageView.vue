<template>
  <div>
    <div class="page-header">
      <h3 class="page-title">团队管理</h3>
      <div class="header-actions">
        <el-button type="primary" size="large" @click="handleGenerate" :loading="generating">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="margin-right:6px">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          生成本月团队
        </el-button>
      </div>
    </div>

    <!-- 本月统一任务 -->
    <div class="monthly-task-card">
      <h4>本月统一任务 <span class="task-badge">所有团队共用</span></h4>
      <el-input
        v-model="monthlyTaskDesc"
        type="textarea"
        :rows="3"
        placeholder="输入本月所有团队的统一任务要求..."
      />
      <div class="task-actions">
        <el-button type="primary" size="small" :loading="savingTask" @click="saveMonthlyTask">
          保存统一任务
        </el-button>
        <span v-if="!monthlyTaskDesc && !savingTask" class="task-hint">尚未设置本月任务，成员将看到空白任务描述</span>
      </div>
    </div>

    <div v-if="groups.length === 0 && !loading" class="empty-wrap">
      <EmptyState text="暂无团队数据，点击上方按钮生成本月团队" />
    </div>

    <div v-else class="group-list">
      <div v-for="g in groups" :key="g.id" class="group-card" @click="showDetail(g)">
        <div class="gc-left">
          <span class="gc-status-dot" :class="`dot-${g.status}`" />
        </div>
        <div class="gc-body">
          <span class="gc-name">{{ g.name }}</span>
          <span class="gc-meta">{{ g.memberCount }} 人 · {{ statusMap[g.status] }}</span>
        </div>
        <el-button
          size="small"
          class="gc-del"
          @click.stop="handleDelete(g)"
          :loading="deleting === g.id"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
        </el-button>
        <span class="gc-arrow">&rarr;</span>
      </div>
    </div>

    <!-- 团队详情弹窗 -->
    <el-dialog v-model="dialogVisible" :title="detailGroup?.name" width="600px" destroy-on-close>
      <template v-if="detailGroup">
        <!-- 成员 -->
        <h4 class="detail-label">团队成员（{{ detailMembers.length }} 人）</h4>
        <div class="member-tags">
          <el-tag v-for="m in detailMembers" :key="m.id" size="large" class="member-tag">
            {{ m.employeeName }} · {{ m.department }}
          </el-tag>
        </div>

        <!-- 统一任务要求（只读） -->
        <h4 class="detail-label" style="margin-top:20px">统一任务要求</h4>
        <p class="detail-text">{{ monthlyTaskDesc || '未设置' }}</p>

        <!-- 提交内容 -->
        <template v-if="detailSubmission">
          <h4 class="detail-label" style="margin-top:20px">完成描述</h4>
          <p class="detail-text">{{ detailSubmission.description }}</p>
          <div v-if="detailSubmission.photoUrls && detailSubmission.photoUrls.length" class="photo-row">
            <img v-for="(url, i) in detailSubmission.photoUrls" :key="i" :src="url" class="photo-thumb" />
          </div>
        </template>

        <template v-if="!detailSubmission && detailGroup.completionDescription">
          <h4 class="detail-label" style="margin-top:20px">完成描述</h4>
          <p class="detail-text">{{ detailGroup.completionDescription }}</p>
        </template>

        <!-- 审核操作 -->
        <div v-if="detailGroup.status === 'submitted'" class="review-actions">
          <el-button
            class="action-btn"
            type="success"
            size="large"
            :loading="reviewing === detailGroup.id"
            @click="handleReview(detailGroup, 'approved')"
          >
            通过
          </el-button>
          <el-button
            class="action-btn"
            type="danger"
            size="large"
            :loading="reviewing === detailGroup.id"
            @click="handleReview(detailGroup, 'rejected')"
          >
            驳回
          </el-button>
        </div>
        <div v-if="detailGroup.status === 'approved'" class="review-done approved">
          审核通过 · {{ detailGroup.reviewerName }} · {{ detailGroup.reviewedAt }}
        </div>
        <div v-if="detailGroup.status === 'rejected'" class="review-done rejected">
          已驳回 · {{ detailGroup.reviewerName }} · {{ detailGroup.reviewedAt }}
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../../api'
import EmptyState from '../../components/EmptyState.vue'

const groups = ref([])
const loading = ref(false)
const generating = ref(false)
const deleting = ref(null)
const reviewing = ref(null)
const dialogVisible = ref(false)
const detailGroup = ref(null)
const detailMembers = ref([])
const detailSubmission = ref(null)
const monthlyTaskDesc = ref('')
const savingTask = ref(false)

const statusMap = { active: '进行中', submitted: '已提交', approved: '已通过', rejected: '已驳回' }

onMounted(() => { loadGroups(); loadMonthlyTask() })

async function loadGroups() {
  loading.value = true
  try {
    const data = await api.get('/admin/groups', { params: { monthYear: new Date().toISOString().substring(0, 7) } })
    groups.value = data.groups
  } finally { loading.value = false }
}

async function loadMonthlyTask() {
  const monthYear = new Date().toISOString().substring(0, 7)
  try {
    const data = await api.get(`/admin/tasks/${monthYear}`)
    monthlyTaskDesc.value = data.task ? data.task.taskDescription : ''
  } catch { /* */ }
}

async function saveMonthlyTask() {
  savingTask.value = true
  const monthYear = new Date().toISOString().substring(0, 7)
  try {
    await api.post('/admin/tasks', { monthYear, taskDescription: monthlyTaskDesc.value })
    ElMessage.success('统一任务已保存')
  } finally { savingTask.value = false }
}

async function handleGenerate() {
  try {
    await ElMessageBox.confirm('将为所有在职员工随机生成团队（3-5人/组），确定继续？', '生成团队', { type: 'info' })
  } catch { return }

  generating.value = true
  try {
    const data = await api.post('/admin/groups/generate')
    ElMessage.success(`已生成 ${data.groups.length} 个团队`)
    groups.value = data.groups
  } finally { generating.value = false }
}

async function handleDelete(g) {
  try {
    await ElMessageBox.confirm(`确定删除团队"${g.name}"及其所有成员数据？此操作不可恢复。`, '确认删除', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
  } catch { return }

  deleting.value = g.id
  try {
    await api.delete(`/admin/groups/${g.id}`)
    ElMessage.success(`团队"${g.name}"已删除`)
    groups.value = groups.value.filter(x => x.id !== g.id)
  } finally { deleting.value = null }
}

async function handleReview(g, action) {
  const label = action === 'approved' ? '通过' : '驳回'
  try {
    await ElMessageBox.confirm(`确定${label}该团队的月度任务提交？`, `确认${label}`, { type: 'info' })
  } catch { return }

  reviewing.value = g.id
  try {
    await api.post(`/admin/groups/${g.id}/review`, { action })
    ElMessage.success(`团队任务已${label}`)
    dialogVisible.value = false
    await loadGroups()
  } finally { reviewing.value = null }
}

async function showDetail(g) {
  const data = await api.get(`/admin/groups/${g.id}`)
  detailGroup.value = data.group
  detailMembers.value = data.group.members
  detailSubmission.value = data.group.submission
  dialogVisible.value = true
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
.page-title { margin-bottom: 0; }

.empty-wrap { margin-top: 40px; }

/* 月度统一任务 */
.monthly-task-card {
  background: var(--bg-card); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs); border: 1px solid var(--ink-100);
  padding: 24px; margin-bottom: 24px;
}
.monthly-task-card h4 { font-size: 16px; font-weight: 700; color: var(--text-primary); margin-bottom: 16px; }
.task-badge {
  font-size: 11px; font-weight: 500; color: var(--primary);
  background: var(--primary-bg); padding: 2px 10px; border-radius: 10px;
  margin-left: 8px; vertical-align: middle;
}
.task-actions { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.task-hint { font-size: 12px; color: var(--text-placeholder); }

.group-list { display: flex; flex-direction: column; gap: 8px; }

.group-card {
  background: var(--bg-card); border-radius: var(--radius-md);
  padding: 16px 20px; display: flex; align-items: center; gap: 14px;
  cursor: pointer; box-shadow: var(--shadow-xs);
  border: 1px solid var(--ink-100);
  transition: all var(--transition-smooth);
  animation: fadeInUp 0.4s var(--transition-smooth) both;
}
.group-card:hover { box-shadow: var(--shadow-md); border-color: var(--primary); transform: translateX(2px); }

.gc-status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dot-active { background: var(--primary); }
.dot-submitted { background: var(--status-pending); }
.dot-approved { background: var(--status-approved); }
.dot-rejected { background: var(--status-rejected); }

.gc-body { flex: 1; display: flex; flex-direction: column; gap: 3px; }
.gc-name { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.gc-meta { font-size: 12px; color: var(--text-secondary); }
.gc-del {
  color: var(--text-placeholder);
  border-radius: 12px;
  flex-shrink: 0;
  padding: 6px 10px;
  border: none !important;
  background: transparent !important;
  transition: all var(--transition-fast);
}
.gc-del:hover {
  color: var(--status-rejected) !important;
  background: var(--status-rejected-bg) !important;
}
.gc-arrow { color: var(--text-placeholder); font-size: 18px; transition: all var(--transition-fast); }
.group-card:hover .gc-arrow { color: var(--primary); }

.detail-label { font-size: 14px; font-weight: 700; color: var(--text-primary); margin-bottom: 10px; }
.detail-text { font-size: 14px; color: var(--text-regular); line-height: 1.8; }
.member-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.photo-row { display: flex; gap: 8px; margin-top: 8px; }
.photo-thumb { width: 80px; height: 80px; border-radius: 8px; object-fit: cover; border: 2px solid var(--ink-100); }

.review-actions { display: flex; gap: 14px; margin-top: 24px; }
.action-btn { flex: 1; height: 48px; font-size: 15px; font-weight: 600; border-radius: var(--radius-md); }

@media (max-width: 768px) {
  .page-header { flex-wrap: wrap; gap: 10px; }
  .group-card { padding: 14px 16px; gap: 10px; }
  .photo-thumb { width: 64px; height: 64px; }
  .action-btn { height: 44px; font-size: 14px; }
  .monthly-task-card { padding: 18px; }
  .review-actions { flex-direction: column; gap: 10px; }
}
</style>
