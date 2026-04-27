<template>
  <div>
    <el-page-header @back="$router.back()" class="back-nav">
      <template #content>申请详情</template>
    </el-page-header>

    <template v-if="submission">
      <!-- 状态横幅 -->
      <div class="status-banner" :class="`status-${submission.status}`">
        <div class="banner-left">
          <StatusBadge :status="submission.status" />
          <span class="banner-divider" />
          <span v-if="submission.status === 'approved'" class="banner-big">+{{ submission.pointsAwarded }} 分</span>
          <span v-else-if="submission.status === 'rejected'" class="banner-text">审核未通过</span>
          <span v-else class="banner-text">等待管理员审核</span>
        </div>
        <div class="banner-right">
          <span class="banner-time">{{ submission.createdAt }}</span>
        </div>
      </div>

      <!-- 详情卡片 -->
      <div class="detail-card">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="积分模块">{{ submission.moduleName }}</el-descriptions-item>
          <el-descriptions-item label="积分子项">{{ submission.subcategoryName }}</el-descriptions-item>
          <el-descriptions-item label="申请描述">{{ submission.description }}</el-descriptions-item>
          <el-descriptions-item label="提交时间">{{ submission.createdAt }}</el-descriptions-item>
          <el-descriptions-item v-if="submission.reviewerName" label="审核人">{{ submission.reviewerName }}</el-descriptions-item>
          <el-descriptions-item v-if="submission.reviewComment" label="审核意见">{{ submission.reviewComment }}</el-descriptions-item>
          <el-descriptions-item v-if="submission.reviewedAt" label="审核时间">{{ submission.reviewedAt }}</el-descriptions-item>
        </el-descriptions>
      </div>

      <!-- 照片 -->
      <div v-if="submission.photoUrls.length" class="photo-card">
        <h4>证明材料（{{ submission.photoUrls.length }} 张）</h4>
        <div class="photo-grid">
          <div v-for="(url, i) in submission.photoUrls" :key="i" class="photo-item" @click="preview(i)">
            <img :src="url" />
            <div class="photo-overlay">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </template>

    <PhotoPreview v-model:visible="previewVisible" :urls="submission?.photoUrls || []" :initial-index="previewIndex" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import api from '../api'
import StatusBadge from '../components/StatusBadge.vue'
import PhotoPreview from '../components/PhotoPreview.vue'

const route = useRoute()
const submission = ref(null)
const previewVisible = ref(false)
const previewIndex = ref(0)

onMounted(async () => {
  const data = await api.get(`/submissions/${route.params.id}`)
  submission.value = data.submission
})

function preview(i) {
  previewIndex.value = i
  previewVisible.value = true
}
</script>

<style scoped>
.back-nav { margin-bottom: 20px; }

/* 状态横幅 */
.status-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-radius: var(--radius-lg);
  margin-bottom: 20px;
  animation: fadeInDown 0.4s var(--transition-smooth);
}
.status-pending { background: var(--status-pending-bg); border: 1px solid var(--module-morality-border); }
.status-approved { background: var(--status-approved-bg); border: 1px solid var(--module-responsibility-border); }
.status-rejected { background: var(--status-rejected-bg); border: 1px solid #fecaca; }
.banner-left { display: flex; align-items: center; gap: 14px; }
.banner-divider { width: 1px; height: 24px; background: rgba(0,0,0,0.1); }
.banner-big { font-size: 28px; font-weight: 900; color: var(--status-approved); }
.banner-text { font-size: 16px; font-weight: 600; color: var(--text-regular); }
.status-pending .banner-text { color: var(--status-pending); }
.status-rejected .banner-text { color: var(--status-rejected); }
.banner-time { font-size: 12px; color: var(--text-secondary); }

/* 详情卡 */
.detail-card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  border: 1px solid var(--ink-100);
  padding: 24px;
  margin-bottom: 16px;
}

/* 照片区 */
.photo-card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  border: 1px solid var(--ink-100);
  padding: 24px;
}
.photo-card h4 { font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 16px; }
.photo-grid { display: flex; flex-wrap: wrap; gap: 10px; }
.photo-item {
  width: 104px; height: 104px;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  position: relative;
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
  opacity: 0;
  transition: opacity var(--transition-fast);
}
.photo-item:hover .photo-overlay { opacity: 1; }
</style>
