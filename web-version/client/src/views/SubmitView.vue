<template>
  <div>
    <el-page-header @back="$router.back()" class="back-nav">
      <template #content><span class="nav-title">提交申请</span></template>
    </el-page-header>

    <div class="content-grid">
      <!-- 左侧摘要 + 表单 -->
      <div class="main-col">
        <!-- 摘要栏 -->
        <div class="summary-bar">
          <div class="summary-item">
            <span class="s-label">模块</span>
            <span class="s-value">{{ moduleName }}</span>
          </div>
          <div class="s-divider" />
          <div class="summary-item">
            <span class="s-label">子项</span>
            <span class="s-value">{{ subcategoryName }}</span>
          </div>
          <div class="s-divider" />
          <div class="summary-item">
            <span class="s-label">默认分值</span>
            <span class="s-value s-points">{{ defaultPoints }} 分</span>
          </div>
        </div>

        <!-- 表单卡片 -->
        <div class="form-card">
          <el-form label-position="top">
            <el-form-item label="描述说明">
              <el-input
                v-model="description"
                type="textarea"
                :rows="4"
                placeholder="请简要描述本次申请的积分事项，例如：2026年4月在成都市青羊区参加无偿献血..."
              />
            </el-form-item>
            <el-form-item label="证明材料照片">
              <PhotoUploader v-model="photos" />
            </el-form-item>
            <el-form-item>
              <el-button
                type="primary"
                size="large"
                :loading="submitting"
                @click="handleSubmit"
                class="submit-btn"
              >
                <svg class="submit-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                提交申请
              </el-button>
            </el-form-item>
          </el-form>
        </div>
      </div>

      <!-- 右侧提示 -->
      <div class="tip-col">
        <div class="tip-card">
          <h4>提交须知</h4>
          <ul>
            <li>请如实填写积分事项描述</li>
            <li>上传清晰的照片作为证明材料</li>
            <li>审核通过后积分将自动到账</li>
            <li>同一子项每年有申请次数上限</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import api from '../api'
import PhotoUploader from '../components/PhotoUploader.vue'

const route = useRoute()
const router = useRouter()

const moduleId = route.query.moduleId
const moduleName = route.query.moduleName
const subcategoryName = route.query.subcategoryName
const defaultPoints = Number(route.query.defaultPoints) || 0

const description = ref('')
const photos = ref([])
const submitting = ref(false)

async function handleSubmit() {
  if (!description.value.trim()) return ElMessage.warning('请填写描述说明')
  if (photos.value.length === 0) return ElMessage.warning('请上传证明材料照片')

  submitting.value = true
  try {
    const photoUrls = photos.value.filter(p => typeof p === 'string')
    await api.post('/submissions', {
      moduleId: Number(moduleId),
      subcategoryName,
      description: description.value.trim(),
      photoUrls
    })
    ElMessage.success('提交成功，等待审核')
    setTimeout(() => router.back(), 1200)
  } finally { submitting.value = false }
}
</script>

<style scoped>
.back-nav { margin-bottom: 20px; }
.nav-title { font-size: 18px; font-weight: 700; color: var(--text-primary); }

.content-grid {
  display: grid;
  grid-template-columns: 1fr 240px;
  gap: 20px;
  align-items: start;
}

/* ===== 摘要栏 ===== */
.summary-bar {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 20px 24px;
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  border: 1.5px solid var(--ink-100);
  margin-bottom: 16px;
  animation: fadeInUp 0.4s var(--transition-bounce);
}
.summary-item { display: flex; flex-direction: column; gap: 2px; }
.s-label { font-size: 10px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700; }
.s-value { font-size: 15px; font-weight: 700; color: var(--text-primary); }
.s-points { color: var(--primary); font-size: 20px; font-weight: 800; }
.s-divider { width: 1.5px; height: 40px; background: var(--ink-100); flex-shrink: 0; border-radius: 1px; }

/* ===== 表单卡 ===== */
.form-card {
  background: var(--bg-card);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
  border: 1.5px solid var(--ink-100);
  padding: 28px;
  animation: fadeInUp 0.5s 0.05s var(--transition-bounce) both;
}
.submit-btn {
  width: 100%; height: 52px; font-size: 16px; font-weight: 700;
  letter-spacing: 2px; border-radius: 16px;
}
.submit-icon { margin-right: 8px; }

/* ===== 提示侧栏 ===== */
.tip-card {
  background: linear-gradient(155deg, #FFF8F7, #FFF0F3);
  border-radius: var(--radius-xl);
  padding: 24px;
  border: 1.5px solid #FFD5DA;
  animation: fadeInUp 0.5s 0.1s var(--transition-bounce) both;
}
.tip-card h4 { font-size: 15px; font-weight: 800; color: var(--text-primary); margin-bottom: 14px; }
.tip-card ul { list-style: none; padding: 0; margin: 0; }
.tip-card li {
  font-size: 13px; color: var(--text-secondary);
  padding: 8px 0;
  border-bottom: 1.5px solid rgba(255, 123, 138, 0.08);
  line-height: 1.6;
  padding-left: 18px;
  position: relative;
}
.tip-card li::before {
  content: '';
  position: absolute;
  left: 0; top: 14px;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--primary-light);
}
.tip-card li:last-child { border-bottom: none; }

@media (max-width: 768px) {
  .content-grid { grid-template-columns: 1fr; }
  .tip-card { display: none; }
  .summary-bar { flex-direction: column; align-items: flex-start; gap: 10px; }
  .s-divider { width: 100%; height: 1.5px; }
}
</style>
