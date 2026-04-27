<template>
  <div class="points-card">
    <div class="pc-icon-box">
      <span class="pc-icon">{{ icon }}</span>
    </div>
    <div class="pc-info">
      <span class="pc-name">{{ moduleName }}</span>
      <span class="pc-points">{{ points }} <small>分</small></span>
    </div>
  </div>
</template>

<script setup>
defineProps({
  icon: { type: String, default: '' },
  moduleName: { type: String, default: '' },
  points: { type: Number, default: 0 }
})
</script>

<style scoped>
.points-card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 14px;
  box-shadow: var(--shadow-xs);
  border: 1.5px solid var(--ink-100);
  transition: all var(--transition-bounce);
}
.points-card:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-4px);
  border-color: var(--primary-light);
}
.pc-icon-box {
  width: 52px; height: 52px;
  border-radius: 18px;
  background: linear-gradient(135deg, var(--primary-bg), #FFF8F7);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(255, 123, 138, 0.1);
}
.pc-icon { font-size: 26px; }
.pc-name { font-size: 14px; font-weight: 600; color: var(--text-primary); display: block; }
.pc-points { font-size: 24px; font-weight: 800; color: var(--primary); }
.pc-points small { font-size: 11px; font-weight: 500; color: var(--text-secondary); }
</style>
