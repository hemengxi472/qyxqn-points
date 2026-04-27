<template>
  <div>
    <div class="page-header">
      <h3 class="page-title">🌟 积分模块</h3>
      <p class="page-sub">选择积分模块，查看可申请的积分子项</p>
    </div>

    <div v-if="modules.length === 0" class="loading-state">
      <div class="loader" />
      <p>加载中...</p>
    </div>

    <div v-else class="module-grid">
      <div
        v-for="(mod, i) in modules"
        :key="mod.id"
        class="module-card"
        :class="cardClass(mod.id)"
        :style="{ animationDelay: `${i * 0.1}s` }"
        @click="goModule(mod)"
      >
        <!-- 装饰圆 -->
        <div class="mc-bg-pattern" />
        <!-- 内容 -->
        <div class="mc-body">
          <div class="mc-header">
            <div class="mc-icon-box">
              <span class="mc-icon">{{ mod.icon }}</span>
            </div>
            <div class="mc-badge">{{ mod.subcategories.length }} 项</div>
          </div>
          <h3 class="mc-name">{{ mod.name }}</h3>
          <p class="mc-desc">{{ mod.description }}</p>
        </div>
        <div class="mc-footer">
          <span class="mc-action">查看子项</span>
          <span class="mc-arrow">&rarr;</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'

const router = useRouter()
const modules = ref([])

onMounted(async () => {
  const data = await api.get('/modules')
  modules.value = data.modules
})

function goModule(mod) {
  if (mod.id === 4) {
    router.push('/group')
  } else {
    router.push(`/subcategories/${mod.id}`)
  }
}

const cardClass = (id) => ({ 1: 'card-ability', 2: 'card-responsibility', 3: 'card-morality', 4: 'card-discipline' }[id] || '')
</script>

<style scoped>
.page-header { margin-bottom: 24px; }
.page-title { margin-bottom: 6px; }
.page-sub { font-size: 13px; color: var(--text-secondary); margin-left: 20px; }

.loading-state { text-align: center; padding: 80px 0; color: var(--text-secondary); }
.loader {
  width: 40px; height: 40px;
  border: 3px solid var(--ink-100);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  margin: 0 auto 16px;
}
@keyframes spin { to { transform: rotate(360deg); } }

.module-grid { display: flex; flex-direction: column; gap: 16px; }

.module-card {
  background: var(--bg-card);
  border-radius: var(--radius-xl);
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  border: 1.5px solid var(--ink-100);
  overflow: hidden;
  position: relative;
  transition: all var(--transition-bounce);
  animation: fadeInUp 0.5s var(--transition-bounce) both;
  display: flex;
  flex-direction: column;
}
.module-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
}
.module-card:active {
  transform: scale(0.98);
}

/* 装饰背景 */
.mc-bg-pattern {
  position: absolute;
  top: -50px; right: -50px;
  width: 180px; height: 180px;
  border-radius: 50%;
  opacity: 0.05;
  transition: all var(--transition-smooth);
}
.card-ability .mc-bg-pattern { background: var(--module-ability); }
.card-responsibility .mc-bg-pattern { background: var(--module-responsibility); }
.card-morality .mc-bg-pattern { background: var(--module-morality); }
.card-discipline .mc-bg-pattern { background: var(--module-discipline); }
.module-card:hover .mc-bg-pattern {
  transform: scale(1.4);
  opacity: 0.1;
}

.mc-body { padding: 28px 28px 0; position: relative; z-index: 1; }
.mc-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; }
.mc-icon-box {
  width: 60px; height: 60px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(0,0,0,0.04);
}
.card-ability .mc-icon-box { background: var(--module-ability-light); }
.card-responsibility .mc-icon-box { background: var(--module-responsibility-light); }
.card-morality .mc-icon-box { background: var(--module-morality-light); }
.card-discipline .mc-icon-box { background: var(--module-discipline-light); }
.mc-icon { font-size: 32px; }

.mc-badge {
  font-size: 12px;
  font-weight: 700;
  color: var(--primary);
  background: var(--primary-bg);
  padding: 6px 16px;
  border-radius: 24px;
}

.mc-name { font-size: 22px; font-weight: 800; color: var(--text-primary); margin-bottom: 8px; letter-spacing: 0.03em; }
.mc-desc { font-size: 14px; color: var(--text-secondary); line-height: 1.7; margin: 0; }

.mc-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  padding: 18px 28px;
  margin-top: 8px;
  border-top: 1.5px solid var(--ink-50);
  transition: all var(--transition-smooth);
}
.module-card:hover .mc-footer { background: var(--bg-card-hover); }
.mc-action { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
.mc-arrow {
  font-size: 16px; color: var(--text-placeholder);
  transition: all var(--transition-bounce);
}
.module-card:hover .mc-arrow { color: var(--primary); transform: translateX(4px); }
.module-card:hover .mc-action { color: var(--primary); }

@media (max-width: 768px) {
  .mc-body { padding: 22px 20px 0; }
  .mc-icon-box { width: 48px; height: 48px; }
  .mc-icon { font-size: 26px; }
  .mc-name { font-size: 18px; }
  .mc-badge { padding: 4px 12px; font-size: 11px; }
  .mc-footer { padding: 14px 20px; }
}
@media (max-width: 480px) {
  .mc-body { padding: 16px 14px 0; }
  .mc-icon-box { width: 40px; height: 40px; }
  .mc-icon { font-size: 22px; }
  .mc-name { font-size: 16px; }
}
</style>
