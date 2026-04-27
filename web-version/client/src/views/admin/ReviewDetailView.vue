<template>
  <div>
    <el-page-header @back="$router.back()" class="back-nav">
      <template #content>审核详情</template>
    </el-page-header>

    <template v-if="submission">
      <!-- 状态横幅 -->
      <div class="status-banner" :class="`status-${submission.status}`">
        <StatusBadge :status="submission.status" />
        <span v-if="submission.pointsAwarded" class="banner-points">{{ submission.pointsAwarded }} 分</span>
      </div>

      <!-- 申请信息 -->
      <div class="info-grid">
        <div class="detail-card">
          <h4>申请信息</h4>
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="员工">{{ submission.employeeName }}（{{ submission.department }}）</el-descriptions-item>
            <el-descriptions-item label="工号">{{ submission.employeeId }}</el-descriptions-item>
            <el-descriptions-item label="积分模块">{{ submission.moduleName }}</el-descriptions-item>
            <el-descriptions-item label="积分子项">{{ submission.subcategoryName }}</el-descriptions-item>
            <el-descriptions-item label="申请描述">{{ submission.description }}</el-descriptions-item>
            <el-descriptions-item label="提交时间">{{ submission.createdAt }}</el-descriptions-item>
            <el-descriptions-item v-if="submission.reviewComment" label="审核意见">{{ submission.reviewComment }}</el-descriptions-item>
          </el-descriptions>
        </div>

        <!-- 照片 -->
        <div v-if="submission.photoUrls.length" class="photo-card">
          <h4>证明材料（{{ submission.photoUrls.length }} 张）</h4>
          <div class="photo-grid">
            <div v-for="(url, i) in submission.photoUrls" :key="i" class="photo-item" @click="preview(i)">
              <img :src="url" />
              <div class="photo-overlay">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 审核表单 -->
      <div v-if="submission.status === 'pending'" class="review-box">
        <h4>审核操作</h4>
        <el-form label-position="top">
          <el-form-item label="审核意见（可选）">
            <el-input v-model="comment" type="textarea" :rows="3" placeholder="填写审核意见或拒绝原因..." />
          </el-form-item>
          <el-form-item label="审批积分">
            <el-input-number v-model="reviewPoints" :min="0" :max="100" size="large" style="width:150px" />
          </el-form-item>
          <div class="review-actions">
            <el-button type="success" size="large" :loading="reviewing" class="action-btn" @click="handleApprove">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              通过
            </el-button>
            <el-button type="danger" size="large" :loading="reviewing" class="action-btn" @click="handleReject">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="margin-right:6px">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              拒绝
            </el-button>
          </div>
        </el-form>
      </div>
    </template>

    <PhotoPreview v-model:visible="previewVisible" :urls="submission?.photoUrls || []" :initial-index="previewIndex" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import api from '../../api'
import StatusBadge from '../../components/StatusBadge.vue'
import PhotoPreview from '../../components/PhotoPreview.vue'

const route = useRoute()
const router = useRouter()
const submission = ref(null)
const comment = ref('')
const reviewPoints = ref(0)
const reviewing = ref(false)
const previewVisible = ref(false)
const previewIndex = ref(0)

onMounted(async () => {
  const data = await api.get(`/admin/reviews/${route.params.id}`)
  submission.value = data.submission
  reviewPoints.value = data.submission.pointsAwarded || 0
})

function preview(i) {
  previewIndex.value = i
  previewVisible.value = true
}

async function handleApprove() {
  reviewing.value = true
  try {
    await api.post(`/admin/reviews/${submission.value.id}/action`, {
      action: 'approve', points: reviewPoints.value, comment: comment.value
    })
    ElMessage.success('审核通过')
    setTimeout(() => router.back(), 800)
  } finally { reviewing.value = false }
}

async function handleReject() {
  reviewing.value = true
  try {
    await api.post(`/admin/reviews/${submission.value.id}/action`, {
      action: 'reject', points: 0, comment: comment.value
    })
    ElMessage.success('已拒绝')
    setTimeout(() => router.back(), 800)
  } finally { reviewing.value = false }
}
</script>

<style scoped>
.back-nav { margin-bottom: 20px; }

.status-banner {
  display: flex; align-items: center; gap: 16px;
  padding: 20px 24px;
  border-radius: var(--radius-lg);
  margin-bottom: 20px;
  animation: fadeInDown 0.4s var(--transition-smooth);
}
.status-pending { background: var(--status-pending-bg); border: 1px solid var(--module-morality-border); }
.status-approved { background: var(--status-approved-bg); border: 1px solid var(--module-responsibility-border); }
.status-rejected { background: var(--status-rejected-bg); border: 1px solid #fecaca; }
.banner-points { font-size: 28px; font-weight: 900; color: var(--status-approved); }

.info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; align-items: start; }

.detail-card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  border: 1px solid var(--ink-100);
  padding: 24px;
}
.detail-card h4 { font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 14px; }

.photo-card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  border: 1px solid var(--ink-100);
  padding: 24px;
}
.photo-card h4 { font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 14px; }
.photo-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.photo-item {
  width: 96px; height: 96px;
  border-radius: 10px; overflow: hidden;
  cursor: pointer; position: relative;
  border: 2px solid var(--ink-100);
  transition: all var(--transition-smooth);
}
.photo-item img { width: 100%; height: 100%; object-fit: cover; transition: transform var(--transition-slow); }
.photo-item:hover { border-color: var(--primary); }
.photo-item:hover img { transform: scale(1.12); }
.photo-overlay {
  position: absolute; inset: 0;
  background: rgba(0,0,0,0.35);
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity var(--transition-fast);
}
.photo-item:hover .photo-overlay { opacity: 1; }

/* 审核表单 */
.review-box {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--ink-100);
  border-left: 4px solid var(--primary);
  padding: 28px;
}
.review-box h4 { font-size: 17px; font-weight: 700; color: var(--text-primary); margin-bottom: 20px; }

.review-actions { display: flex; gap: 14px; }
.action-btn { flex: 1; height: 48px; font-size: 15px; font-weight: 600; border-radius: var(--radius-md); }

@media (max-width: 768px) {
  .info-grid { grid-template-columns: 1fr; }
}
</style>
