<template>
  <div>
    <h3 class="page-title">🤝 团队任务</h3>

    <!-- 当月团队 -->
    <div v-if="group" class="current-group">
      <div class="group-status-bar" :class="`status-${group.status}`">
        <StatusBadge :status="statusBadge" />
        <span class="status-label">{{ statusLabel }}</span>
      </div>

      <div class="group-card">
        <h3 class="g-name">{{ group.name }}</h3>
        <p class="g-month">{{ group.monthYear }}</p>

        <!-- 成员 -->
        <div class="g-section">
          <h4>团队成员（{{ group.members.length }} 人）</h4>
          <div class="g-members">
            <div v-for="m in group.members" :key="m.employeeId" class="g-member">
              <el-avatar :size="40" :style="{ background: 'linear-gradient(135deg, #FFB3BF, #FF7B8A)' }">{{ m.employeeName.charAt(0) }}</el-avatar>
              <div class="gm-info">
                <span class="gm-name">{{ m.employeeName }}</span>
                <span class="gm-dept">{{ m.department }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 任务描述 -->
        <div class="g-section">
          <h4>任务要求</h4>
          <p v-if="group.taskRequirement" class="g-desc">{{ group.taskRequirement }}</p>
          <p v-else class="g-desc g-placeholder">等待管理员设置本月统一任务...</p>
        </div>

        <!-- 完成描述 -->
        <div v-if="(group.status === 'submitted' || group.status === 'approved') && group.completionDescription" class="g-section">
          <h4>完成描述</h4>
          <p class="g-desc">{{ group.completionDescription }}</p>
        </div>

        <!-- 等待审核提示 -->
        <div v-if="group.status === 'submitted'" class="g-section submitted-notice">
          <div class="notice-icon">⏳</div>
          <div class="notice-text">
            <strong>已提交，等待管理员审核</strong>
            <span>团队任务只需一位成员提交即可，审核通过后全员自动获得积分</span>
          </div>
        </div>

        <!-- 审核信息 -->
        <div v-if="group.status === 'approved' || group.status === 'rejected'" class="g-section">
          <h4>审核结果</h4>
          <p class="g-review">
            审核人：{{ group.reviewerName }}<br />
            意见：{{ group.reviewComment || '无' }}<br />
            时间：{{ group.reviewedAt }}
          </p>
        </div>

        <!-- 提交按钮 -->
        <div v-if="group.status === 'active'" class="g-actions">
          <el-button type="primary" size="large" class="submit-btn" @click="showDialog = true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            提交团队任务
          </el-button>
        </div>
      </div>
    </div>

    <!-- 无团队 -->
    <EmptyState v-else text="本月暂无团队任务，请等待管理员分组" />

    <!-- 提交弹窗 -->
    <el-dialog v-model="showDialog" title="提交团队任务" width="500px" destroy-on-close @open="description = ''; photos = []">
      <el-form label-position="top">
        <el-form-item label="任务完成描述" required>
          <el-input
            v-model="description"
            type="textarea"
            :rows="4"
            placeholder="请描述团队任务的完成情况..."
          />
        </el-form-item>
        <el-form-item label="证明照片" required>
          <PhotoUploader v-model="photos" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">提交</el-button>
      </template>
    </el-dialog>

    <!-- 历史 -->
    <div v-if="history.length" class="history-section">
      <h3 class="section-title">历史团队</h3>
      <div class="hist-list">
        <div v-for="g in history" :key="g.id" class="hist-item">
          <span class="hi-name">{{ g.name }}</span>
          <span class="hi-month">{{ g.monthYear }}</span>
          <span class="hi-status" :class="`hi-${g.status}`">{{ statusMap[g.status] }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'
import StatusBadge from '../components/StatusBadge.vue'
import EmptyState from '../components/EmptyState.vue'
import PhotoUploader from '../components/PhotoUploader.vue'

const group = ref(null)
const history = ref([])
const showDialog = ref(false)
const description = ref('')
const photos = ref([])
const submitting = ref(false)

const statusMap = { active: '进行中', submitted: '已提交', approved: '已通过', rejected: '已驳回' }

const statusBadge = computed(() => {
  const map = { active: 'pending', submitted: 'pending', approved: 'approved', rejected: 'rejected' }
  return map[group.value?.status] || 'pending'
})
const statusLabel = computed(() => statusMap[group.value?.status] || '')

onMounted(async () => {
  try {
    const data = await api.get('/groups/mine')
    group.value = data.group
  } catch { /* handled */ }
  try {
    const hist = await api.get('/groups/mine/history')
    history.value = hist.groups || []
  } catch { /* handled */ }
})

async function handleSubmit() {
  const desc = description.value.trim()
  if (!desc) return ElMessage.warning('请填写任务完成描述')
  if (photos.value.length === 0) return ElMessage.warning('请上传证明照片')

  submitting.value = true
  try {
    const res = await api.post('/groups/mine/submit', {
      description: desc,
      photoUrls: photos.value.filter(p => typeof p === 'string')
    })
    ElMessage.success(res.message || '团队任务提交成功')
    showDialog.value = false
    const data = await api.get('/groups/mine')
    group.value = data.group
  } catch { /* handled */ }
  finally { submitting.value = false }
}
</script>

<style scoped>
/* 状态栏 */
.group-status-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 16px 20px; border-radius: var(--radius-lg);
  margin-bottom: 16px;
}
.status-active { background: var(--primary-bg); border: 1.5px solid #FFD5DA; }
.status-submitted { background: var(--status-pending-bg); border: 1.5px solid #FDE2B8; }
.status-approved { background: var(--status-approved-bg); border: 1.5px solid #B8E8CE; }
.status-rejected { background: var(--status-rejected-bg); border: 1.5px solid #FFC5CC; }
.status-label { font-size: 14px; font-weight: 700; color: var(--text-primary); }

/* 团队卡片 */
.group-card {
  background: var(--bg-card); border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm); border: 1.5px solid var(--ink-100);
  padding: 28px; animation: fadeInUp 0.5s var(--transition-bounce);
}
.g-name { font-size: 24px; font-weight: 900; color: var(--text-primary); }
.g-month { font-size: 13px; color: var(--text-secondary); margin-top: 4px; font-weight: 500; }
.g-section { margin-top: 24px; }
.g-section h4 { font-size: 14px; font-weight: 800; color: var(--text-primary); margin-bottom: 12px; }
.g-desc { font-size: 14px; color: var(--text-regular); line-height: 1.8; }
.g-placeholder { color: var(--text-placeholder); font-style: italic; }
.g-review { font-size: 13px; color: var(--text-secondary); line-height: 1.8; }

.submitted-notice {
  background: linear-gradient(135deg, #FFF8E7, #FFF3DC);
  border: 1.5px solid #FDE2B8;
  border-radius: 16px;
  padding: 20px 22px;
  display: flex;
  align-items: flex-start;
  gap: 14px;
  animation: fadeInUp 0.4s var(--transition-bounce);
}
.notice-icon { font-size: 28px; line-height: 1; flex-shrink: 0; animation: float 3s ease-in-out infinite; }
.notice-text { display: flex; flex-direction: column; gap: 4px; }
.notice-text strong { font-size: 14px; color: #B45309; font-weight: 700; }
.notice-text span { font-size: 12px; color: #92400E; opacity: 0.75; line-height: 1.6; }

.g-members { display: flex; flex-wrap: wrap; gap: 12px; }
.g-member {
  display: flex; align-items: center; gap: 10px;
  background: var(--ink-50); padding: 10px 16px;
  border-radius: var(--radius-md);
  transition: all var(--transition-bounce);
}
.g-member:hover { background: var(--primary-bg); transform: scale(1.03); }
.gm-info { display: flex; flex-direction: column; }
.gm-name { font-size: 13px; font-weight: 700; color: var(--text-primary); }
.gm-dept { font-size: 11px; color: var(--text-secondary); }

.g-actions { margin-top: 28px; }

/* submit dialog form */
.submit-form { display: flex; flex-direction: column; gap: 6px; }
.sf-label { font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 2px; }
.submit-btn { width: 100%; height: 50px; font-size: 16px; font-weight: 700; letter-spacing: 2px; border-radius: 16px; }

.history-section { margin-top: 32px; }
.section-title { font-size: 18px; font-weight: 800; color: var(--text-primary); margin-bottom: 14px; }
.hist-list { display: flex; flex-direction: column; gap: 8px; }
.hist-item {
  display: flex; align-items: center; gap: 16px;
  background: var(--bg-card); border-radius: var(--radius-md);
  padding: 16px 20px; box-shadow: var(--shadow-xs); border: 1.5px solid var(--ink-100);
  transition: all var(--transition-bounce);
}
.hist-item:hover { transform: translateX(3px); box-shadow: var(--shadow-sm); }
.hi-name { font-size: 14px; font-weight: 700; color: var(--text-primary); flex: 1; }
.hi-month { font-size: 12px; color: var(--text-secondary); font-weight: 500; }
.hi-status { font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 14px; }
.hi-active { background: var(--primary-bg); color: var(--primary); }
.hi-submitted { background: var(--status-pending-bg); color: var(--status-pending); }
.hi-approved { background: var(--status-approved-bg); color: var(--status-approved); }
.hi-rejected { background: var(--status-rejected-bg); color: var(--status-rejected); }

@media (max-width: 768px) {
  .group-card { padding: 20px 16px; }
  .g-name { font-size: 20px; }
  .group-status-bar { padding: 12px 16px; }
  .g-members { gap: 8px; }
  .g-member { padding: 8px 12px; }
  .submit-btn { height: 46px; font-size: 15px; }
  .hist-item { padding: 12px 16px; gap: 10px; }
  .hi-name { font-size: 13px; }
}
</style>
