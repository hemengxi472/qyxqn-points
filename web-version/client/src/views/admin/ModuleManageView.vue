<template>
  <div>
    <div class="page-header">
      <h3 class="page-title">模块管理</h3>
      <div class="header-actions">
        <el-button type="primary" @click="editingModule = null; resetModuleForm(); showModuleDialog = true">
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
              <span class="mc-name">
                {{ mod.name }}
                <el-tag v-if="mod.dimensionCode" size="small" effect="plain">{{ mod.dimensionCode }}</el-tag>
                <el-tag v-else size="small" type="info" effect="plain">未分类</el-tag>
              </span>
              <span class="mc-desc">{{ mod.description }}</span>
              <span class="mc-meta">
                基础分 {{ mod.baseScore }} · 加分上限 {{ mod.bonusCap }} · 周期 {{ mod.cycle || '—' }}
                <span v-if="mod.subCount" :class="{ bad: mod.subBaseSum !== mod.baseScore }">
                  · 子项合计 {{ mod.subBaseSum }}{{ mod.subBaseSum !== mod.baseScore ? ' ⚠️' : '' }}
                </span>
                <span v-if="mod.hasHardZero"> · 刚性归零</span>
              </span>
            </div>
          </div>
          <div class="mc-actions">
            <el-switch v-model="mod.isActive" size="small" @change="toggleModule(mod)" />
            <el-button size="small" text @click="openEditModule(mod)">编辑</el-button>
            <el-button size="small" text type="primary" @click="showSubs(mod)">子项管理</el-button>
            <el-button size="small" text type="danger" @click="deleteModule(mod)">删除</el-button>
          </div>
        </div>

        <!-- 展开子项 -->
        <div v-if="expandedId === mod.id" class="mc-sub-list">
          <div class="sub-header">
            <span class="sub-title">积分子项</span>
            <el-button size="small" type="primary" @click="editingSub = null; resetSubForm(); subModuleId = mod.id; showSubDialog = true">
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
    <el-dialog v-model="showModuleDialog" :title="editingModule ? '编辑模块' : '新增模块'" width="560px" destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="模块名称" required>
          <el-input v-model="moduleForm.name" placeholder="如：有健康" />
        </el-form-item>
        <el-form-item label="维度标识 (dimension_code)">
          <el-select v-model="moduleForm.dimensionCode" clearable placeholder="留空 = 历史/未分类模块" style="width:100%">
            <el-option v-for="c in dimensionCodes" :key="c" :label="c" :value="c" />
          </el-select>
          <div class="form-hint">
            必须是六个之一，前端的所有维度配色和跳转分支都读这个值。写错不会报错，那个维度会静默用上默认样式。
          </div>
        </el-form-item>
        <el-form-item label="图标 (Emoji)">
          <el-input v-model="moduleForm.icon" placeholder="如：🌱" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="moduleForm.description" type="textarea" :rows="2" placeholder="模块描述..." />
        </el-form-item>

        <div class="form-row two">
          <el-form-item label="季度基础分">
            <el-input-number v-model="moduleForm.baseScore" :min="0" style="width:100%" />
          </el-form-item>
          <el-form-item label="附加加分上限">
            <el-input-number v-model="moduleForm.bonusCap" :min="0" style="width:100%" />
          </el-form-item>
        </div>

        <el-alert
          v-if="baseScoreMismatch"
          type="warning"
          show-icon
          :closable="false"
          style="margin-bottom:16px"
          :title="`子项基础分合计 ${baseScoreMismatch}，与季度基础分 ${moduleForm.baseScore} 不一致`"
          description="这个维度不会满分 100。季度评分按子项基础分逐项算，所以维度满分实际由子项决定 —— 请核对子项的基础分。"
        />

        <el-form-item label="赋分周期">
          <el-input v-model="moduleForm.cycle" placeholder="如：季度" />
        </el-form-item>
        <el-form-item label="核心评价模块">
          <el-select
            v-model="moduleForm.coreModules"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="输入后回车添加"
            style="width:100%"
          />
        </el-form-item>
        <el-form-item label="配套线下活动">
          <el-input v-model="moduleForm.themeActivity" type="textarea" :rows="2" placeholder="如：轻行蓄力，向阳成长 —— 青年身心双强户外健康行" />
        </el-form-item>
        <el-form-item label="启用刚性归零">
          <el-switch v-model="moduleForm.hasHardZero" />
          <div class="form-hint">
            开启后，管理员可在季度评分里把某人该维度直接置 0，并取消其本季度奖励资格。触发条件需事先在制度里写明 —— 员工申诉时要拿它对照。
          </div>
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
    <el-dialog v-model="showSubDialog" :title="editingSub ? '编辑子项' : '新增子项'" width="560px" destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="子项名称" required>
          <el-input v-model="subForm.name" placeholder="如：身体健康" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="subForm.description" type="textarea" :rows="2" placeholder="子项描述..." />
        </el-form-item>

        <div class="form-row three">
          <el-form-item label="季度基础分">
            <el-input-number v-model="subForm.baseScore" :min="0" style="width:100%" />
          </el-form-item>
          <el-form-item label="参考加分/次">
            <el-input-number v-model="subForm.points" :min="0" style="width:100%" />
          </el-form-item>
          <el-form-item label="加分上限">
            <el-input-number v-model="subForm.bonusCap" :min="0" style="width:100%" />
          </el-form-item>
        </div>
        <div class="form-hint" style="margin:-10px 0 16px">
          季度基础分是季初默认拿到的分（管理员之后录扣分）；参考加分/次只在员工端展示，实际给分由审核人按上限填入。
        </div>

        <el-form-item label="积分规则">
          <el-input v-model="subForm.scoreRule" type="textarea" :rows="2" placeholder="如：积极参加健康活动，保持规律作息与运动习惯" />
        </el-form-item>
        <el-form-item label="附加加分及上限">
          <el-input v-model="subForm.bonusRule" type="textarea" :rows="2" placeholder="如：完成一次健康打卡 +2 分，本维度上限 10 分" />
        </el-form-item>
        <el-form-item label="所需佐证材料">
          <el-input v-model="subForm.evidenceRequired" type="textarea" :rows="2" placeholder="如：微信运动截图、运动 APP 记录" />
        </el-form-item>
        <el-form-item label="线下主题活动">
          <el-select
            v-model="subForm.themeActivity"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="输入后回车添加"
            style="width:100%"
          />
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
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../../api'

const modules = ref([])
const subcategories = ref([])
const loading = ref(false)
const subsLoading = ref(false)
const saving = ref(false)
const expandedId = ref(null)

const dimensionCodes = ['health', 'skill', 'growth', 'wisdom', 'duty', 'discipline']

const showModuleDialog = ref(false)
const editingModule = ref(null)
const moduleForm = reactive({
  name: '', icon: '', description: '', sortOrder: 0,
  dimensionCode: '', baseScore: 0, bonusCap: 0, cycle: '', coreModules: [], themeActivity: '', hasHardZero: false
})

const showSubDialog = ref(false)
const editingSub = ref(null)
const subModuleId = ref(null)
const subForm = reactive({
  name: '', description: '', points: 0, maxTimes: 0, requiresPhoto: true, sortOrder: 0,
  baseScore: 0, scoreRule: '', bonusRule: '', bonusCap: 0, themeActivity: [], evidenceRequired: ''
})

// 「Σ 子项基础分 = 维度基础分」这个不变量最容易在编辑基础分时被破坏，
// 而破坏之后一个季度都没人会发现（维度安静地变成 97 分满分）。
// 只在已有子项的模块上提示 —— 新建模块 subCount 为 0，提示只会是噪声。
const baseScoreMismatch = computed(() => {
  const mod = editingModule.value
  if (!mod || !mod.subCount) return null
  return mod.subBaseSum === moduleForm.baseScore ? null : mod.subBaseSum
})

onMounted(() => loadModules())

// silent = 保住当前列表，不闪一次整页 spinner（保存子项后的刷新走这条路）
async function loadModules(silent = false) {
  if (!silent) loading.value = true
  try {
    const data = await api.get('/admin/modules')
    modules.value = data.modules
  } finally { if (!silent) loading.value = false }
}

function resetModuleForm() {
  Object.assign(moduleForm, {
    name: '', icon: '', description: '', sortOrder: 0,
    dimensionCode: '', baseScore: 0, bonusCap: 0, cycle: '季度',
    coreModules: [], themeActivity: '', hasHardZero: false
  })
}

function openEditModule(mod) {
  editingModule.value = mod
  Object.assign(moduleForm, {
    name: mod.name,
    icon: mod.icon,
    description: mod.description,
    sortOrder: mod.sortOrder,
    dimensionCode: mod.dimensionCode || '',
    baseScore: mod.baseScore || 0,
    bonusCap: mod.bonusCap || 0,
    cycle: mod.cycle || '',
    coreModules: [...(mod.coreModules || [])],
    themeActivity: mod.themeActivity || '',
    hasHardZero: !!mod.hasHardZero
  })
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

// 删除是不可恢复的。子项跟着一起删，所以确认框里要说出来。
// 有历史记录的维度会被服务端 409 拒掉（那会让统计页把员工挣过的分算丢），
// 拒绝理由由 api 拦截器弹出。
async function deleteModule(mod) {
  try {
    await ElMessageBox.confirm(
      `将彻底删除「${mod.name}」维度及其下的全部积分子项。\n\n仅当该维度没有任何申请和积分流水时才能删除；有历史记录时会提示改用「禁用」—— 停用同样不出现在员工端，但历史分还在。此操作不可恢复。`,
      '删除评价维度',
      { type: 'error', confirmButtonText: '确认删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }
    )
    await api.delete(`/admin/modules/${mod.id}`)
    ElMessage.success(`已删除「${mod.name}」`)
    if (expandedId.value === mod.id) expandedId.value = null
    loadModules()
  } catch { /* cancelled 或已由拦截器提示 */ }
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

function resetSubForm() {
  Object.assign(subForm, {
    name: '', description: '', points: 0, maxTimes: 0, requiresPhoto: true, sortOrder: 0,
    baseScore: 0, scoreRule: '', bonusRule: '', bonusCap: 0, themeActivity: [], evidenceRequired: ''
  })
}

function openEditSub(sub) {
  editingSub.value = sub
  Object.assign(subForm, {
    name: sub.name,
    description: sub.description,
    points: sub.points,
    maxTimes: sub.maxTimes,
    requiresPhoto: sub.requiresPhoto,
    sortOrder: sub.sortOrder,
    baseScore: sub.baseScore || 0,
    scoreRule: sub.scoreRule || '',
    bonusRule: sub.bonusRule || '',
    bonusCap: sub.bonusCap || 0,
    themeActivity: [...(sub.themeActivity || [])],
    evidenceRequired: sub.evidenceRequired || ''
  })
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
    // 同时刷新模块列表：subBaseSum 变了，编辑模块时的「加总 100」警告要跟着更新，
    // 否则那个提示会拿旧的和值去比新的基础分。
    await loadModules(true)
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
.mc-meta { font-size: 11px; color: var(--text-placeholder); }
.mc-meta .bad { color: var(--status-pending); font-weight: 600; }
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

.form-row { display: grid; gap: 12px; }
.form-row.two { grid-template-columns: repeat(2, 1fr); }
.form-row.three { grid-template-columns: repeat(3, 1fr); }
.form-hint { font-size: 11px; color: var(--text-placeholder); line-height: 1.6; margin-top: 4px; }

@media (max-width: 768px) {
  .module-card { padding: 16px 18px; }
  .mc-header { flex-wrap: wrap; gap: 10px; }
  .mc-actions { width: 100%; justify-content: flex-end; }
  .sub-card { padding: 12px 14px; flex-wrap: wrap; gap: 8px; }
  .sc-info { flex: 1; min-width: 0; }
  .sc-name { font-size: 13px; }
}
</style>
