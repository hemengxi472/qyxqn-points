<template>
  <div>
    <div class="page-header">
      <h3 class="page-title">季度评分</h3>
      <div class="header-actions">
        <el-select v-model="quarter" style="width:150px" @change="load">
          <el-option v-for="q in quarterOptions" :key="q" :label="formatQuarter(q)" :value="q" />
        </el-select>
        <el-select v-model="deptFilter" clearable placeholder="全部部门" style="width:140px">
          <el-option v-for="d in departments" :key="d" :label="d" :value="d" />
        </el-select>
        <el-tag v-if="locked" type="info" effect="dark">已锁定</el-tag>
        <el-tag v-else type="success" effect="plain">实时</el-tag>
        <el-button
          v-if="auth.isSuperAdmin"
          type="primary"
          :disabled="locked || loading"
          @click="lockQuarter"
        >锁定本季度</el-button>
      </div>
    </div>

    <el-alert
      v-if="locked"
      type="info"
      show-icon
      :closable="false"
      style="margin-bottom:16px"
      :title="`本季度排名已于 ${lockedAt} 由 ${lockedBy} 锁定`"
      description="锁定后的排名不再随扣分录入变化。下方「奖励排名」展示的是冻结快照，主表仍是实时分 —— 两者不一致是正常的。"
    />

    <div v-if="loading" class="loading-state">
      <div class="loader" />
      <p>加载中...</p>
    </div>

    <template v-else>
      <!-- 实时评分主表 -->
      <el-card shadow="never" class="panel">
        <template #header>
          <div class="panel-head">
            <span class="panel-title">{{ formatQuarter(quarter) }} 评价维度得分</span>
            <!-- 锁定后这里是实时分、下方奖励排名是冻结快照，同一人两张表会给出
                 不同的总分。以前只差几分不容易察觉，作假归零会把它放大成
                 760 → 0，所以必须在表头写明以哪张为准。 -->
            <span v-if="locked" class="panel-sub live-warn">实时分，仅供参考，以快照为准</span>
            <span v-else class="panel-sub">每个维度满分 100 基础分 + 附加加分，季度总分满分 {{ maxScore }}</span>
          </div>
        </template>

        <el-table :data="filteredRows" stripe style="width:100%" :row-class-name="rowClass">
          <el-table-column label="姓名" fixed width="150">
            <template #default="{ row }">
              <div class="emp-cell">
                <span class="emp-name" :class="{ warn: row.rewardIneligible }">{{ row.name }}</span>
                <span class="emp-dept">{{ row.department }}</span>
              </div>
            </template>
          </el-table-column>

          <el-table-column
            v-for="col in dimensionColumns"
            :key="col.code"
            :label="`${col.icon} ${col.name}`"
            width="132"
            align="center"
          >
            <template #default="{ row }">
              <div
                class="dim-cell"
                :class="{ zero: cellOf(row, col.code)?.hardZero }"
                @click="openDrawer(row, cellOf(row, col.code))"
              >
                <div class="dim-score">{{ cellOf(row, col.code)?.score ?? '-' }}</div>
                <div class="dim-bar">
                  <div
                    class="dim-bar-fill"
                    :class="`fill-${col.code}`"
                    :style="{ width: barWidth(cellOf(row, col.code)) }"
                  />
                </div>
                <div class="dim-bonus" v-if="cellOf(row, col.code)">
                  加分 {{ cellOf(row, col.code).bonusTotal }}/{{ cellOf(row, col.code).bonusCap }}
                </div>
                <el-tag v-if="cellOf(row, col.code)?.hardZero" size="small" type="danger" effect="dark">
                  已归零
                </el-tag>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="季度总分" width="110" align="center" fixed="right">
            <template #default="{ row }">
              <span class="total-score">{{ row.totalScore }}</span>
              <span class="total-max">/{{ maxScore }}</span>
            </template>
          </el-table-column>
          <el-table-column label="排名" width="80" align="center" fixed="right">
            <template #default="{ row }">
              <el-tag v-if="row.rank" :type="rankTagType(row.rank)" effect="light">第 {{ row.rank }} 名</el-tag>
              <el-tag v-else type="danger" effect="plain">不计入</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="70" align="center">
            <template #default="{ row }">
              <el-button size="small" text type="primary" @click="openDrawer(row, null)">明细</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div v-if="filteredRows.length === 0" class="empty-hint">该部门在本季度没有参与评分的员工</div>
      </el-card>

      <!-- 不计入排名 -->
      <el-card v-if="ineligible.length" shadow="never" class="panel">
        <template #header>
          <div class="panel-head">
            <span class="panel-title">不计入排名</span>
            <span class="panel-sub">刚性归零或弄虚作假会取消季度奖励资格，这些人从排名中整行剔除</span>
          </div>
        </template>
        <el-table :data="ineligible" style="width:100%">
          <el-table-column prop="name" label="姓名" width="150">
            <template #default="{ row }">
              <div class="emp-cell">
                <span class="emp-name warn">{{ row.name }}</span>
                <span class="emp-dept">{{ row.department }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="归零维度" min-width="200">
            <template #default="{ row }">
              <!-- 作假是**一次季度级事件**，把六个维度归一了，不是六次人工刚性归零。
                   所以走单独分支，不要让它渲染成「有健康、有本领、…」六个标签。 -->
              <el-tag
                v-if="row.fraudZero"
                size="small"
                type="warning"
                effect="dark"
              >弄虚作假（全部维度）</el-tag>
              <el-tag
                v-for="d in zeroedDimensions(row)"
                v-else
                :key="d.dimensionId"
                size="small"
                type="danger"
                effect="plain"
                style="margin-right:6px"
              >{{ d.name }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="totalScore" label="季度总分" width="110" align="center" />
          <el-table-column label="原因" min-width="220">
            <template #default="{ row }">
              <span class="reason-text">{{ zeroReason(row) || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="70" align="center">
            <template #default="{ row }">
              <el-button size="small" text type="primary" @click="openDrawer(row, null)">明细</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- 奖励排名 -->
      <el-card shadow="never" class="panel">
        <template #header>
          <div class="panel-head">
            <span class="panel-title">🏅 季度奖励排名（调休假期）</span>
            <el-button size="small" @click="exportCsv">导出 CSV</el-button>
          </div>
        </template>

        <el-table :data="rankingRows" style="width:100%">
          <el-table-column prop="rank" label="排名" width="80" align="center">
            <template #default="{ row }">
              <el-tag :type="rankTagType(row.rank)" effect="light">{{ row.rank }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="姓名" width="140" />
          <el-table-column prop="department" label="部门" width="140" />
          <el-table-column prop="totalScore" label="季度总分" width="120" align="center" />
          <el-table-column label="调休假期" width="130" align="center">
            <template #default="{ row }">
              <span class="leave-days">{{ row.leaveDays }} 天</span>
            </template>
          </el-table-column>
          <el-table-column label="标记" min-width="180">
            <template #default="{ row }">
              <el-tag v-if="row.hardZeroCount" size="small" type="danger" effect="plain" style="margin-right:6px">
                刚性归零 {{ row.hardZeroCount }} 项
              </el-tag>
              <!-- 作假的人本来就不该出现在这张表里（资格已取消），兜个底 -->
              <el-tag v-if="row.fraudZero" size="small" type="warning" effect="plain">
                ⚠️ 本季度有作假记录
              </el-tag>
            </template>
          </el-table-column>
        </el-table>

        <el-alert
          v-if="!locked"
          type="warning"
          show-icon
          :closable="false"
          style="margin-top:12px"
          title="当前为实时排名，尚未锁定"
          description="实时排名会随扣分录入变化，不能作为最终发放依据。确认无误后请点「锁定本季度」冻结快照。"
        />

        <!-- 统一使用说明 -->
        <el-alert
          v-if="reward"
          type="info"
          show-icon
          :closable="false"
          style="margin-top:16px"
          title="统一使用说明"
          :description="reward.usageNote"
        />

        <!-- 完整发放流程 -->
        <el-collapse v-if="reward?.process?.length" style="margin-top:12px">
          <el-collapse-item :title="`奖励兑现完整流程（${reward.process.length} 步）`">
            <ol class="process-list">
              <li v-for="(step, i) in reward.process" :key="i">{{ step }}</li>
            </ol>
          </el-collapse-item>
        </el-collapse>

        <!-- 重要说明 -->
        <el-alert
          v-if="reward"
          type="warning"
          show-icon
          :closable="false"
          style="margin-top:12px"
          title="重要说明"
          :description="reward.importantNote"
        />
      </el-card>
    </template>

    <!-- 维度明细抽屉 -->
    <el-drawer v-model="drawerOpen" :title="drawerTitle" size="620px" direction="rtl" destroy-on-close>
      <div v-if="drawerRow && drawerDim" class="drawer-body">
        <div class="drawer-head">
          <div class="dh-left">
            <span class="dh-name">{{ drawerRow.name }}</span>
            <span class="dh-dept">{{ drawerRow.department }} · {{ formatQuarter(quarter) }}</span>
          </div>
          <div class="dh-score" :class="{ zero: drawerDim.hardZero }">
            {{ drawerDim.score }}
            <span class="dh-max">/{{ drawerDim.baseTotal + drawerDim.bonusCap }}</span>
          </div>
        </div>

        <el-table :data="drawerDim.modules" size="small" style="width:100%">
          <el-table-column prop="moduleName" label="模块" min-width="130" />
          <el-table-column label="基础分" width="80" align="center">
            <template #default="{ row }">{{ row.baseScore }}</template>
          </el-table-column>
          <el-table-column label="扣分" width="120" align="center">
            <template #default="{ row }">
              <!-- 作假归零期间服务端会拒收扣分（409）：录进去也看不见，
                   等作假撤销时才突然生效。直接禁用，理由在上面的 alert 里。 -->
              <el-input-number
                v-model="deductionDraft[row.moduleId]"
                size="small"
                :min="0"
                :max="row.baseScore"
                :disabled="!!drawerRow?.fraudZero"
                controls-position="right"
                style="width:100px"
              />
            </template>
          </el-table-column>
          <el-table-column label="本模块得分" width="100" align="center">
            <template #default="{ row }">
              <span class="mod-score">
                {{ Math.max(0, row.baseScore - (deductionDraft[row.moduleId] ?? row.deduction)) }}
              </span>
            </template>
          </el-table-column>
        </el-table>

        <div class="drawer-summary">
          <div class="ds-row">
            <span>模块得分小计</span>
            <strong>{{ draftModuleBaseTotal }}</strong>
          </div>
          <div class="ds-row">
            <span>附加加分</span>
            <strong :class="{ capped: drawerDim.bonusTotal > drawerDim.bonusCap }">
              {{ drawerDim.bonusTotal }} / {{ drawerDim.bonusCap }}
              <span v-if="drawerDim.bonusTotal > drawerDim.bonusCap" class="cap-note">（已封顶）</span>
            </strong>
          </div>
          <div class="ds-row total">
            <span>维度得分</span>
            <strong>{{ draftDimensionScore }}</strong>
          </div>
        </div>

        <el-alert
          v-if="drawerDim.bonusTotal > drawerDim.bonusCap"
          type="warning"
          show-icon
          :closable="false"
          style="margin-top:10px"
          :title="`本维度附加加分 ${drawerDim.bonusTotal} 分已超出上限 ${drawerDim.bonusCap} 分，只按上限计入`"
          description="不会扣回已发放的加分。超出部分在审核环节本应被拒绝，出现这种情况通常是上限后来被调低了。"
        />

        <!-- 该季度被弄虚作假归零：六个维度全是 0，人工归零开关与扣分都不可用
             （服务端返回 409）。这里给出原因，而不是让管理员对着一个必然失败的
             按钮点下去。 -->
        <el-alert
          v-if="drawerRow?.fraudZero"
          type="error"
          show-icon
          :closable="false"
          style="margin-top:12px"
          title="该员工本季度因弄虚作假被归零"
          :description="`原因：${drawerRow.fraudReason || '未填写'}。六个评价维度均为 0 分，本季度奖励资格已取消。如需调整，请先在「作假管理」中撤销该记录。`"
        />

        <!-- 刚性归零：仅该维度在后台配了 has_hard_zero 时出现 -->
        <div v-else-if="drawerDim.hasHardZero" class="hardzero-block">
          <div class="hz-head">
            <span class="hz-title">刚性归零</span>
            <el-tag v-if="drawerDim.hardZero" type="danger" effect="dark" size="small">已归零</el-tag>
          </div>
          <p class="hz-desc">
            触发后该维度直接 0 分，并取消本人本季度的奖励资格（从排名中剔除）。
            已入账的加分不会删除，解除归零后自动恢复。
          </p>
          <el-form label-position="top">
            <el-form-item label="原因（必填，申诉时需要答复）">
              <el-input
                v-model="hardZeroReason"
                type="textarea"
                :rows="2"
                :disabled="drawerDim.hardZero && !auth.isSuperAdmin"
                placeholder="如：本季度发生严重违规事件，经团支部核实……"
              />
            </el-form-item>
          </el-form>
          <el-tooltip
            v-if="drawerDim.hardZero && !auth.isSuperAdmin"
            content="解除刚性归零仅超级管理员可操作"
            placement="top"
          >
            <span>
              <el-button disabled>解除归零</el-button>
            </span>
          </el-tooltip>
          <el-button
            v-else
            :type="drawerDim.hardZero ? 'success' : 'danger'"
            plain
            @click="toggleHardZero"
          >{{ drawerDim.hardZero ? '解除归零' : '设为刚性归零' }}</el-button>
        </div>
      </div>

      <template #footer>
        <el-button @click="drawerOpen = false">关闭</el-button>
        <el-button
          type="primary"
          :loading="saving"
          :disabled="!!drawerRow?.fraudZero"
          @click="saveDeductions"
        >保存扣分</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../../api'
import { useAuthStore } from '../../stores/auth'
import { recentQuarters, quarterKey, formatQuarter } from '../../utils/quarter'

const auth = useAuthStore()

const quarter = ref(quarterKey())
const quarterOptions = ref(recentQuarters(8))
const deptFilter = ref('')
const loading = ref(false)
const saving = ref(false)

const rows = ref([])
const ineligible = ref([])
const maxScore = ref(760)
const locked = ref(false)
const lockedAt = ref('')
const lockedBy = ref('')
const reward = ref(null)
const rankingRows = ref([])

const drawerOpen = ref(false)
const drawerRow = ref(null)
const drawerDim = ref(null)
const deductionDraft = reactive({})
const hardZeroReason = ref('')

const dimensionColumns = computed(() => {
  const first = rows.value[0] || ineligible.value[0]
  if (!first) return []
  return first.dimensions.map(d => ({ code: d.dimensionCode, name: d.name, icon: d.icon }))
})

const departments = computed(() => {
  const set = new Set()
  for (const r of [...rows.value, ...ineligible.value]) if (r.department) set.add(r.department)
  return [...set].sort()
})

const filteredRows = computed(() =>
  deptFilter.value ? rows.value.filter(r => r.department === deptFilter.value) : rows.value
)

const drawerTitle = computed(() =>
  drawerDim.value ? `${drawerDim.value.icon} ${drawerDim.value.name} · 模块明细` : '模块明细'
)

// 抽屉里改过的扣分，实时重算维度分（保存前不落库）
const draftModuleBaseTotal = computed(() => {
  if (!drawerDim.value) return 0
  return drawerDim.value.modules.reduce((sum, m) => {
    const d = deductionDraft[m.moduleId] ?? m.deduction
    return sum + Math.max(0, m.baseScore - d)
  }, 0)
})

const draftDimensionScore = computed(() => {
  if (!drawerDim.value) return 0
  if (drawerDim.value.hardZero) return 0
  return draftModuleBaseTotal.value + Math.min(drawerDim.value.bonusTotal, drawerDim.value.bonusCap)
})

function cellOf(row, code) {
  return row.dimensions.find(d => d.dimensionCode === code)
}

function barWidth(dim) {
  if (!dim) return '0%'
  const max = dim.baseTotal + dim.bonusCap
  if (!max) return '0%'
  return Math.min(100, Math.round((dim.score / max) * 100)) + '%'
}

function rowClass({ row }) {
  return row.rewardIneligible ? 'row-warn' : ''
}

function rankTagType(rank) {
  if (rank === 1) return 'danger'
  if (rank <= 3) return 'warning'
  if (rank <= 10) return 'success'
  return 'info'
}

function zeroedDimensions(row) {
  return row.dimensions.filter(d => d.hardZero)
}

function zeroReason(row) {
  const d = row.dimensions.find(x => x.hardZero && x.hardZeroReason)
  return d ? d.hardZeroReason : ''
}

async function load() {
  loading.value = true
  try {
    const data = await api.get('/admin/quarterly', { params: { quarter: quarter.value } })
    rows.value = data.rows
    ineligible.value = data.ineligible
    maxScore.value = data.maxScore
    locked.value = data.locked
    lockedAt.value = data.lockedAt || ''
    lockedBy.value = data.lockedBy || ''
    reward.value = data.reward
    await loadRanking()
  } finally { loading.value = false }
}

async function loadRanking() {
  const data = await api.get('/admin/quarterly/ranking', { params: { quarter: quarter.value } })
  rankingRows.value = data.rows
}

function openDrawer(row, dim) {
  drawerRow.value = row
  // 点维度格进去就定位到那个维度，点"明细"进去默认第一个
  drawerDim.value = dim || row.dimensions[0]
  drawerOpen.value = true
  hardZeroReason.value = drawerDim.value?.hardZeroReason || ''
  for (const k of Object.keys(deductionDraft)) delete deductionDraft[k]
  for (const m of drawerDim.value?.modules || []) deductionDraft[m.moduleId] = m.deduction
}

async function saveDeductions() {
  if (!drawerRow.value || !drawerDim.value) return
  const changed = drawerDim.value.modules.filter(
    m => (deductionDraft[m.moduleId] ?? m.deduction) !== m.deduction
  )
  if (changed.length === 0) {
    ElMessage.info('没有改动')
    return
  }

  saving.value = true
  try {
    // 逐模块保存：服务端 PUT 是单模块粒度。中途失败时前面已成功的会留下，
    // 所以提示语要说清"部分保存"，不要谎报全部成功。
    let done = 0
    for (const m of changed) {
      await api.put('/admin/quarterly/score', {
        userId: drawerRow.value.userId,
        quarter: quarter.value,
        moduleId: m.moduleId,
        deduction: deductionDraft[m.moduleId] ?? m.deduction
      })
      done++
    }
    ElMessage.success(`已保存 ${done} 个模块的扣分`)
    drawerOpen.value = false
    await load()
  } catch {
    // 逐模块循环中途失败时，前面成功的已经落库了。刷新并明说"部分保存"，
    // 不要谎报全部成功，也不要谎报全部失败 —— 审核人需要据此核对。
    await load()
    ElMessage.warning('部分扣分可能未保存，请核对后重试')
  } finally { saving.value = false }
}

async function toggleHardZero() {
  if (!drawerRow.value || !drawerDim.value) return
  const dim = drawerDim.value
  const turningOn = !dim.hardZero

  if (turningOn && !hardZeroReason.value.trim()) {
    ElMessage.warning('请填写刚性归零原因')
    return
  }

  try {
    await ElMessageBox.confirm(
      turningOn
        ? `确认将「${drawerRow.value.name}」的「${dim.name}」设为刚性归零？该维度将直接 0 分，并从本季度奖励排名中剔除。`
        : `确认解除「${drawerRow.value.name}」的「${dim.name}」刚性归零？解除后该维度得分恢复，并重新参与排名。`,
      turningOn ? '确认刚性归零' : '确认解除归零',
      { type: turningOn ? 'warning' : 'info', confirmButtonText: '确认', cancelButtonText: '取消' }
    )
  } catch { return }

  saving.value = true
  try {
    await api.put('/admin/quarterly/status', {
      userId: drawerRow.value.userId,
      quarter: quarter.value,
      dimensionId: dim.dimensionId,
      hardZero: turningOn,
      reason: hardZeroReason.value.trim()
    })
    ElMessage.success(turningOn ? '已设为刚性归零' : '已解除刚性归零')
    drawerOpen.value = false
    await load()
  } finally { saving.value = false }
}

async function lockQuarter() {
  try {
    await ElMessageBox.confirm(
      `锁定 ${formatQuarter(quarter.value)} 排名后，将生成一份冻结快照用于公示、申诉和备案。`
      + '后续的扣分录入只影响实时分，不再改变这份排名。锁定不可撤销，请确认当前排名已经核对无误。',
      '确认锁定本季度排名',
      { type: 'warning', confirmButtonText: '确认锁定', cancelButtonText: '取消' }
    )
  } catch { return }

  loading.value = true
  try {
    const res = await api.post('/admin/quarterly/lock', { quarter: quarter.value })
    ElMessage.success(res.message)
    await load()
  } finally { loading.value = false }
}

function exportCsv() {
  const head = ['排名', '姓名', '部门', '季度总分', '调休天数', '归零项数']
  const lines = [head.join(',')]
  for (const r of rankingRows.value) {
    lines.push([r.rank, r.name, r.department, r.totalScore, r.leaveDays, r.hardZeroCount || 0].join(','))
  }
  // BOM 让 Excel 认出 UTF-8，否则中文列名是乱码
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${quarter.value}-奖励排名.csv`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(load)
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 12px; }
.page-title { margin-bottom: 0; }
.header-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

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

.panel { margin-bottom: 20px; border-radius: var(--radius-lg); }
.panel-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.panel-title { font-size: 15px; font-weight: 700; color: var(--text-primary); }
.panel-sub { font-size: 12px; color: var(--text-placeholder); }
/* 锁定后主表是实时分，与上方快照排名不一致 —— 用警示色，别让它读起来像普通说明 */
.live-warn { color: var(--el-color-warning); font-weight: 600; }
.empty-hint { text-align: center; padding: 24px; color: var(--text-placeholder); font-size: 13px; }

.emp-cell { display: flex; flex-direction: column; gap: 2px; }
.emp-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.emp-name.warn { color: var(--status-rejected); }
.emp-dept { font-size: 11px; color: var(--text-placeholder); }

.dim-cell { cursor: pointer; padding: 6px 4px; border-radius: var(--radius-sm); transition: background var(--transition-smooth); }
.dim-cell:hover { background: var(--ink-50); }
.dim-cell.zero { background: var(--status-rejected-bg); }
.dim-score { font-size: 18px; font-weight: 700; color: var(--text-primary); line-height: 1.2; }
.dim-bar { height: 4px; border-radius: 2px; background: var(--ink-100); margin: 5px 0 4px; overflow: hidden; }
.dim-bar-fill { height: 100%; border-radius: 2px; transition: width var(--transition-smooth); }
.fill-health { background: var(--module-health); }
.fill-skill { background: var(--module-skill); }
.fill-growth { background: var(--module-growth); }
.fill-wisdom { background: var(--module-wisdom); }
.fill-duty { background: var(--module-duty); }
.fill-discipline { background: var(--module-discipline); }
.dim-bonus { font-size: 10px; color: var(--text-placeholder); }

.total-score { font-size: 18px; font-weight: 700; color: var(--primary); }
.total-max { font-size: 11px; color: var(--text-placeholder); }

.reason-text { font-size: 12px; color: var(--text-secondary); }
.leave-days { font-size: 15px; font-weight: 700; color: var(--accent-gold); }

.process-list { margin: 0; padding-left: 22px; font-size: 13px; color: var(--text-secondary); line-height: 1.9; }

:deep(.row-warn) { background: var(--status-rejected-bg) !important; }

.drawer-body { display: flex; flex-direction: column; gap: 16px; }
.drawer-head { display: flex; justify-content: space-between; align-items: center; }
.dh-left { display: flex; flex-direction: column; gap: 2px; }
.dh-name { font-size: 16px; font-weight: 700; color: var(--text-primary); }
.dh-dept { font-size: 12px; color: var(--text-placeholder); }
.dh-score { font-size: 28px; font-weight: 800; color: var(--primary); }
.dh-score.zero { color: var(--status-rejected); }
.dh-max { font-size: 13px; color: var(--text-placeholder); font-weight: 400; }

.mod-score { font-weight: 600; color: var(--text-primary); }

.drawer-summary {
  background: var(--ink-50); border-radius: var(--radius-md);
  padding: 14px 16px; display: flex; flex-direction: column; gap: 8px;
}
.ds-row { display: flex; justify-content: space-between; font-size: 13px; color: var(--text-secondary); }
.ds-row strong { color: var(--text-primary); }
.ds-row.total { border-top: 1px solid var(--ink-100); padding-top: 8px; font-size: 15px; }
.ds-row.total strong { color: var(--primary); font-size: 18px; }
.cap-note { font-size: 11px; color: var(--status-pending); font-weight: 400; }

.hardzero-block {
  margin-top: 8px; padding: 16px;
  border: 1px solid var(--module-discipline-border);
  border-radius: var(--radius-md);
  background: var(--module-discipline-light);
}
.hz-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.hz-title { font-size: 14px; font-weight: 700; color: var(--text-primary); }
.hz-desc { font-size: 12px; color: var(--text-secondary); line-height: 1.7; margin: 0 0 10px; }

@media (max-width: 768px) {
  .header-actions { width: 100%; }
}
</style>
