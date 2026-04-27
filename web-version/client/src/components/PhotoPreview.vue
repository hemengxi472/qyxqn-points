<template>
  <el-dialog v-model="visible" title="照片预览" :close-on-click-modal="true" destroy-on-close width="80vw">
    <div class="preview-body" v-if="urls.length">
      <el-carousel :initial-index="initialIndex" height="60vh" arrow="always" indicator-position="outside">
        <el-carousel-item v-for="(url, i) in urls" :key="i">
          <img :src="url" style="width:100%;height:100%;object-fit:contain" />
        </el-carousel-item>
      </el-carousel>
      <p class="counter">{{ currentIndex + 1 }} / {{ urls.length }}</p>
    </div>
    <EmptyState v-else text="无照片" />
  </el-dialog>
</template>

<script setup>
import { computed } from 'vue'
import EmptyState from './EmptyState.vue'

const props = defineProps({
  visible: Boolean,
  urls: { type: Array, default: () => [] },
  initialIndex: { type: Number, default: 0 }
})
const emit = defineEmits(['update:visible'])

const visible = computed({
  get: () => props.visible,
  set: v => emit('update:visible', v)
})
const currentIndex = computed(() => props.initialIndex)
</script>
