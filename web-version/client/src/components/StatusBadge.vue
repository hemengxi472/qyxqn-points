<template>
  <span class="status-badge" :class="`status-${status}`">
    <span class="status-dot" />
    {{ cfg.label }}
  </span>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({ status: { type: String, default: 'pending' } })

const MAP = {
  pending:  { label: '待审核' },
  approved: { label: '已通过' },
  rejected: { label: '已拒绝' }
}

const cfg = computed(() => MAP[props.status] || { label: '未知' })
</script>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 18px;
  border-radius: 24px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  white-space: nowrap;
  transition: all var(--transition-bounce);
}
.status-badge:hover {
  transform: scale(1.05);
}
.status-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  animation: breathe 2s ease-in-out infinite;
}

.status-pending {
  background: var(--status-pending-bg);
  color: var(--status-pending);
  border: 1.5px solid #FDE2B8;
}
.status-pending .status-dot { background: var(--status-pending); }

.status-approved {
  background: var(--status-approved-bg);
  color: var(--status-approved);
  border: 1.5px solid #B8E8CE;
}
.status-approved .status-dot { background: var(--status-approved); }

.status-rejected {
  background: var(--status-rejected-bg);
  color: var(--status-rejected);
  border: 1.5px solid #FFC5CC;
}
.status-rejected .status-dot { background: var(--status-rejected); }
</style>
