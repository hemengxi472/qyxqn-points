<template>
  <div class="uploader">
    <div class="photo-grid">
      <div v-for="(photo, i) in modelValue" :key="i" class="photo-item">
        <img :src="typeof photo === 'string' ? photo : photo.url" />
        <button class="delete-btn" @click.stop="remove(i)" title="删除">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div v-if="modelValue.length < 9" class="add-btn" @click="handlePick">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>添加</span>
      </div>
    </div>
    <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="handleChange" />
    <p class="upload-hint">支持 jpg / png / webp，最多 9 张，单张不超过 10MB</p>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const props = defineProps({ modelValue: { type: Array, default: () => [] } })
const emit = defineEmits(['update:modelValue'])
const fileInput = ref(null)

function handlePick() { fileInput.value.click() }

async function handleChange(e) {
  const files = Array.from(e.target.files)
  if (files.length === 0) return
  if (props.modelValue.length + files.length > 9) {
    ElMessage.warning('最多上传9张照片')
    return
  }
  const previews = files.map(f => ({ url: URL.createObjectURL(f), file: f }))
  const newPhotos = [...props.modelValue, ...previews]
  emit('update:modelValue', newPhotos)
  e.target.value = ''

  const formData = new FormData()
  files.forEach(f => formData.append('files', f))
  try {
    const res = await api.post('/submissions/upload', formData)
    const urls = res.urls
    let urlIdx = 0
    const final = newPhotos.map(p => {
      if (p.file) return urls[urlIdx++] || p.url
      return typeof p === 'string' ? p : (p.url || urls[urlIdx++] || '')
    })
    emit('update:modelValue', final)
  } catch {
    emit('update:modelValue', props.modelValue.filter(p => !p.file))
    return
  }
}

function remove(i) {
  const newList = [...props.modelValue]
  const item = newList[i]
  if (item?.url && item.url.startsWith('blob:')) URL.revokeObjectURL(item.url)
  newList.splice(i, 1)
  emit('update:modelValue', newList)
}
</script>

<style scoped>
.photo-grid { display: flex; flex-wrap: wrap; gap: 10px; }

.photo-item {
  width: 92px; height: 92px;
  position: relative;
  border-radius: 16px;
  overflow: hidden;
  border: 2px solid var(--ink-100);
  transition: all var(--transition-bounce);
}
.photo-item:hover {
  border-color: var(--primary-light);
  transform: scale(1.04);
  box-shadow: 0 6px 20px rgba(255, 123, 138, 0.15);
}
.photo-item img { width: 100%; height: 100%; object-fit: cover; }
.delete-btn {
  position: absolute; top: 5px; right: 5px;
  width: 22px; height: 22px;
  border-radius: 8px;
  background: rgba(0,0,0,0.4);
  color: #fff;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
  backdrop-filter: blur(4px);
}
.delete-btn:hover { background: var(--primary); transform: scale(1.1); }

.add-btn {
  width: 92px; height: 92px;
  border: 2.5px dashed var(--primary-light);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--primary-light);
  font-size: 11px;
  font-weight: 600;
  gap: 4px;
  transition: all var(--transition-bounce);
}
.add-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-bg);
  transform: scale(1.04);
}

.upload-hint {
  font-size: 11px;
  color: var(--text-placeholder);
  margin-top: 10px;
}
</style>
