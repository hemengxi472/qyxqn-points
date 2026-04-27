<template>
  <div>
    <div class="page-header">
      <h3 class="page-title">模块管理</h3>
      <div class="header-actions">
        <el-button type="primary" @click="showModuleDialog = true; editingModule = null">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="margin-right:4px">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          新增模块
        </el-button>
      </div>
    </div>

    <div v-if="loading" class="loading-state">
      <div class="loader" />
      <p>加载中...</p>
    </div>

    <div v-else class="module-list">
      <div v-for="mod in modules" :key="mod.id" class="module-card" :class="{ inactive: !mod.isActive }">
        <div class="mc-header">
          <div class="mc-left">
            <span class="mc-icon">{{ mod.icon }}</span>
            <div class="mc-info">
              <span class="mc-name">{{ mod.name }}</span>
              <span class="mc-desc">{{ mod.description }}</span>
            </div>
          </div>
          <div class="mc-actions">
            <el-switch v-model="mod.isActive" size="small" @change="toggleModule(mod)" />
            <el-button size="small" text @click="openEditModule(mod)">编辑</el-button>
            <el-button size="small" text type="primary" @click="showSubs(mod)">子项管理</el-button>
          </div>
        </div>

        <!-- 展开子项 -->
        <div v-if="expandedId === mod.id" class="mc-sub-list">
          <div class="sub-header">
            <span class="sub-title">积分子项</span>
            <el-button size="small" type="primary" @click="showSubDialog = true; editingSub = null; subModuleId = mod.id">
              新增子项
            </el-button>
          </div>

          <div v-if="subsLoading" class="loading-state">
            <div class="loader" />
          </div>
          <div v-else-if="subcategories.length === 0" style="padding:16px;color:var(--text-placeholder);text-align:center">
            暂无子项
          </div>
          <div v-else class="sub-grid">
            <div v-for="sub in subcategories" :key="sub.id" class="sub-card" :class="{ inactive: !sub.isActive }">
              <div class="sc-info">
                <span class="sc-name">{{ sub.name }} <el-tag size="small" type="warning">{{ sub.points }}分</el-tag></span>
                <span class="sc-desc">{{ sub.description }}</span>
                <span v-if="sub.maxTimes > 0" class="sc-limit">每年限 {{ sub.maxTimes }} 次</span>
                <span class="sc-meta">需照片: {{ sub.requiresPhoto ? '是' : '否' }} · 排序: {{ sub.sortOrder }}</span>
              </div>
              <div class="sc-actions">
                <el-switch v-model="sub.isActive" size="small" @change="toggleSub(sub)" />
                <el-button size="small" text @click="openEditSub(sub)">编辑</el-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 模块弹窗 -->
    <el-dialog v-model="showModuleDialog" :title="editingModule ? '编辑模块' : '新增模块'" width="480px" destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="模块名称" required>
          <el-input v-model="moduleForm.name" placeholder="如：能力" />
        </el-form-item>
        <el-form-item label="图标 (Emoji)">
          <el-input v-model="moduleForm.icon" placeholder="如：📚" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="moduleForm.description" type="textarea" :rows="2" placeholder="模块描述..." />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="moduleForm.sortOrder" :min="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showModuleDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveModule">保存</el-button>
      </template>
    </el-dialog>

    <!-- 子项弹窗 -->
    <el-dialog v-model="showSubDialog" :title="editingSub ? '编辑子项' : '新增子项'" width="500px" destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="子项名称" required>
          <el-input v-model="subForm.name" placeholder="如：获得区级公司奖励" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="subForm.description" type="textarea" :rows="2" placeholder="子项描述..." />
        </el-form-item>
        <el-form-item label="积分值">
          <el-input-number v-model="subForm.points" :min="0" />
        </el-form-item>
        <el-form-item label="每年最多次数 (0=不限)">
          <el-input-number v-model="subForm.maxTimes" :min="0" />
        </el-form-item>
        <el-form-item label="需要上传照片">
          <el-switch v-model="subForm.requiresPhoto" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="subForm.sortOrder" :min="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showSubDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveSub">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../../api'

const modules = ref([])
const subcategories = ref([])
const loading = ref(false)
const subsLoading = ref(false)
const saving = ref(false)
const expandedId = ref(null)

const showModuleDialog = ref(false)
const editingModule = ref(null)
const moduleForm = reactive({ name: '', icon: '', description: '', sortOrder: 0 })

const showSubDialog = ref(false)
const editingSub = ref(null)
const subModuleId = ref(null)
const subForm = reactive({ name: '', description: '', points: 0, maxTimes: 0, requiresPhoto: true, sortOrder: 0 })

onMounted(() => loadModules())

async function loadModules() {
  loading.value = true
  try {
    const data = await api.get('/admin/modules')
    modules.value = data.modules
  } finally { loading.value = false }
}

function openEditModule(mod) {
  editingModule.value = mod
  moduleForm.name = mod.name
  moduleForm.icon = mod.icon
  moduleForm.description = mod.description
  moduleForm.sortOrder = mod.sortOrder
  showModuleDialog.value = true
}

async function saveModule() {
  if (!moduleForm.name.trim()) return ElMessage.warning('请输入模块名称')
  saving.value = true
  try {
    if (editingModule.value) {
      await api.put(`/admin/modules/${editingModule.value.id}`, { ...moduleForm })
      ElMessage.success('模块已更新')
    } else {
      await api.post('/admin/modules', { ...moduleForm })
      ElMessage.success('模块已创建')
    }
    showModuleDialog.value = false
    await loadModules()
  } finally { saving.value = false }
}

async function toggleModule(mod) {
  await api.put(`/admin/modules/${mod.id}/toggle`)
  ElMessage.success(mod.isActive ? '模块已启用' : '模块已禁用')
}

async function showSubs(mod) {
  if (expandedId.value === mod.id) {
    expandedId.value = null
    return
  }
  expandedId.value = mod.id
  subsLoading.value = true
  try {
    const data = await api.get(`/admin/modules/${mod.id}/subcategories`)
    subcategories.value = data.subcategories
  } finally { subsLoading.value = false }
}

function openEditSub(sub) {
  editingSub.value = sub
  subForm.name = sub.name
  subForm.description = sub.description
  subForm.points = sub.points
  subForm.maxTimes = sub.maxTimes
  subForm.requiresPhoto = sub.requiresPhoto
  subForm.sortOrder = sub.sortOrder
  showSubDialog.value = true
}

async function saveSub() {
  if (!subForm.name.trim()) return ElMessage.warning('请输入子项名称')
  saving.value = true
  try {
    if (editingSub.value) {
      await api.put(`/admin/subcategories/${editingSub.value.id}`, { ...subForm })
      ElMessage.success('子项已更新')
    } else {
      await api.post('/admin/subcategories', { moduleId: subModuleId.value, ...subForm })
      ElMessage.success('子项已创建')
    }
    showSubDialog.value = false
    // Refresh subcategory list
    const mod = modules.value.find(m => m.id === expandedId.value)
    if (mod) {
      const data = await api.get(`/admin/modules/${mod.id}/subcategories`)
      subcategories.value = data.subcategories
    }
  } finally { saving.value = false }
}

async function toggleSub(sub) {
  await api.put(`/admin/subcategories/${sub.id}/toggle`)
  ElMessage.success(sub.isActive ? '子项已启用' : '子项已禁用')
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.page-title { margin-bottom: 0; }

.loading-state { text-align: center; padding: 80px 0; color: var(--text-secondary); }
.loader {
  width: 36px; height: 36px;
  border: 3px solid var(--ink-100);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  margin: 0 auto 16px;
}
@keyframes spin { to { transform: rotate(360deg); } }

.module-list { display: flex; flex-direction: column; gap: 12px; }

.module-card {
  background: var(--bg-card); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs); border: 1px solid var(--ink-100);
  padding: 20px 24px; transition: all var(--transition-smooth);
}
.module-card.inactive { opacity: 0.6; }

.mc-header { display: flex; justify-content: space-between; align-items: center; }
.mc-left { display: flex; align-items: center; gap: 14px; }
.mc-icon { font-size: 28px; }
.mc-info { display: flex; flex-direction: column; gap: 2px; }
.mc-name { font-size: 16px; font-weight: 700; color: var(--text-primary); }
.mc-desc { font-size: 13px; color: var(--text-secondary); }
.mc-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

.mc-sub-list {
  margin-top: 16px; padding-top: 16px;
  border-top: 1px solid var(--ink-100);
}
.sub-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.sub-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }

.sub-grid { display: flex; flex-direction: column; gap: 8px; }
.sub-card {
  background: var(--ink-50); border-radius: var(--radius-md);
  padding: 14px 16px; display: flex; justify-content: space-between; align-items: center;
  transition: all var(--transition-smooth);
}
.sub-card.inactive { opacity: 0.5; }
.sc-info { display: flex; flex-direction: column; gap: 3px; }
.sc-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.sc-desc { font-size: 12px; color: var(--text-secondary); }
.sc-limit { font-size: 11px; color: var(--accent-gold); }
.sc-meta { font-size: 11px; color: var(--text-placeholder); }
.sc-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
</style>
