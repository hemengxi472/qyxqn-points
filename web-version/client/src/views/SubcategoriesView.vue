<template>
  <div>
    <el-page-header @back="$router.back()" class="back-nav">
      <template #content>
        <span class="nav-title">{{ moduleName }}</span>
      </template>
    </el-page-header>

    <p class="page-sub">选择该模块下的积分子项进行申请</p>

    <div v-if="moduleIdNum === 4" class="empty-discipline">
      <div class="discipline-icon">⚖️</div>
      <h3>纪律积分通过团队任务获得</h3>
      <p>纪律模块的积分由管理员每月统一设置团队任务，完成后由任意成员提交即可为全队发放积分。</p>
      <el-button type="primary" size="large" @click="$router.push('/group')">前往团队任务</el-button>
    </div>

    <div v-else-if="subcategories.length === 0" class="empty-discipline">
      <p>该模块暂无可用积分子项</p>
    </div>

    <div v-else class="sub-list">
      <div
        v-for="(sub, i) in subcategories"
        :key="sub.name"
        class="sub-card"
        :style="{ animationDelay: `${i * 0.06}s` }"
        @click="goSubmit(sub)"
      >
        <div class="sub-body">
          <div class="sub-info">
            <span class="sub-name">{{ sub.name }}</span>
            <span class="sub-desc">{{ sub.description }}</span>
            <span v-if="sub.maxTimes > 0" class="sub-limit">每年限 {{ sub.maxTimes }} 次</span>
          </div>
          <div class="sub-points-box">
            <span class="sub-points">{{ sub.points }}</span>
            <span class="sub-unit">分 / 次</span>
          </div>
        </div>
        <div class="sub-footer">
          <span>点击申请</span>
          <span class="sub-footer-arrow">&rarr;</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'

const route = useRoute()
const router = useRouter()
const moduleId = ref(route.params.moduleId)
const moduleIdNum = computed(() => Number(moduleId.value))
const moduleName = ref(route.query.moduleName || '积分子项')
const subcategories = ref([])

onMounted(async () => {
  const data = await api.get('/modules')
  const mod = data.modules.find(m => m.id === Number(moduleId.value))
  if (mod) {
    moduleName.value = mod.name
    subcategories.value = mod.subcategories
  }
})

function goSubmit(sub) {
  router.push({
    path: '/submit',
    query: { moduleId: moduleId.value, moduleName: moduleName.value, subcategoryName: sub.name, defaultPoints: sub.points }
  })
}
</script>

<style scoped>
.back-nav { margin-bottom: 8px; }
.nav-title { font-size: 18px; font-weight: 700; color: var(--text-primary); }
.page-sub { font-size: 13px; color: var(--text-secondary); margin-bottom: 20px; margin-left: 0; }

.sub-list { display: flex; flex-direction: column; gap: 12px; }

.sub-card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  cursor: pointer;
  box-shadow: var(--shadow-xs);
  border: 1.5px solid var(--ink-100);
  overflow: hidden;
  transition: all var(--transition-bounce);
  animation: fadeInUp 0.4s var(--transition-bounce) both;
}
.sub-card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--primary-light);
  transform: translateY(-2px);
}
.sub-card:active {
  transform: scale(0.98);
}

.sub-body {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 22px 24px;
}
.sub-info { display: flex; flex-direction: column; gap: 4px; }
.sub-name { font-size: 17px; font-weight: 700; color: var(--text-primary); }
.sub-desc { font-size: 13px; color: var(--text-secondary); }
.sub-limit {
  font-size: 11px; font-weight: 600;
  color: var(--accent-gold);
  background: var(--accent-gold-bg);
  padding: 3px 12px;
  border-radius: 12px;
  width: fit-content;
  margin-top: 4px;
  border: 1px solid #FDE2B8;
}

.sub-points-box { text-align: center; flex-shrink: 0; }
.sub-points { font-size: 34px; font-weight: 900; color: var(--primary); line-height: 1; }
.sub-unit { font-size: 11px; color: var(--text-secondary); display: block; margin-top: 2px; font-weight: 500; }

.sub-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  padding: 12px 24px;
  border-top: 1.5px solid var(--ink-50);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-placeholder);
  transition: all var(--transition-smooth);
}
.sub-card:hover .sub-footer { background: var(--primary-bg); color: var(--primary); }
.sub-footer-arrow { transition: transform var(--transition-bounce); }
.sub-card:hover .sub-footer-arrow { transform: translateX(4px); }

.empty-discipline {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-secondary);
}
.empty-discipline h3 { font-size: 18px; color: var(--text-primary); margin-bottom: 12px; }
.empty-discipline p { font-size: 14px; margin-bottom: 24px; max-width: 480px; margin-left: auto; margin-right: auto; line-height: 1.7; }
.discipline-icon { font-size: 60px; margin-bottom: 16px; }

@media (max-width: 768px) {
  .sub-body { padding: 16px 18px; }
  .sub-points { font-size: 26px; }
  .sub-footer { padding: 10px 18px; }
  .sub-name { font-size: 15px; }
  .empty-discipline { padding: 40px 16px; }
  .discipline-icon { font-size: 44px; }
}
</style>
