<template>
  <div class="empty">
    <div class="empty-icon-box">
      <svg width="56" height="56" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <!-- 脸 -->
        <circle cx="16" cy="16" r="14" stroke="currentColor" stroke-width="1.3" fill="none"/>
        <!-- 眼睛 (●) -->
        <circle cx="11" cy="14" r="1.8" fill="currentColor" />
        <circle cx="21" cy="14" r="1.8" fill="currentColor" />
        <!-- 微笑 -->
        <path d="M10 21 Q16 26 22 21" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" />
        <!-- 腮红 -->
        <ellipse cx="7.5" cy="19" rx="3" ry="2" fill="#FFB3BF" opacity="0.6" />
        <ellipse cx="24.5" cy="19" rx="3" ry="2" fill="#FFB3BF" opacity="0.6" />
      </svg>
    </div>
    <p class="empty-text">{{ text }}</p>
  </div>
</template>

<script setup>
defineProps({ text: { type: String, default: '暂无数据' } })
</script>

<style scoped>
.empty {
  text-align: center;
  padding: 80px 20px;
  animation: scaleInSpring 0.6s var(--transition-spring);
}
.empty-icon-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100px; height: 100px;
  border-radius: 36px;
  background: linear-gradient(135deg, #FFF0F3, #FFF8F7);
  color: var(--primary-light);
  margin-bottom: 20px;
  box-shadow: 0 8px 32px rgba(255, 123, 138, 0.1);
  animation: float 3s ease-in-out infinite;
}
.empty-text {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-placeholder);
}
</style>
