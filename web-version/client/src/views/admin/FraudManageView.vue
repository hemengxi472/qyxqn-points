<template>
  <div>
    <div class="page-header">
      <h3 class="page-title">作假管理</h3>
      <p class="page-sub">报告员工作假行为，该季度积分清零并取消季度奖励资格</p>
    </div>

    <!-- 报告作假表单 -->
    <div class="fraud-form-card">
      <h4>报告作假</h4>
      <el-form :inline="true" class="fraud-form">
        <el-form-item label="员工">
          <el-select v-model="form.userId" filterable placeholder="选择员工" size="large" style="width:220px">
            <el-option v-for="e in employees" :key="e.id" :label="`${e.name} (${e.employeeId})`" :value="e.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="季度">
          <el-select v-model="form.quarter" placeholder="选择季度" size="large" style="width:180px">
            <el-option v-for="q in quarterOptions" :key="q" :label="formatQuarter(q)" :value="q" />
          </el-select>
        </el-form-item>
        <el-form-item label="原因">
          <el-input v-model="form.reason" placeholder="作假原因说明" size="large" style="width:300px" />
        </el-form-item>
        <el-form-item>
          <el-button type="danger" size="large" :loading="submitting" @click="handleSubmit">
            提交作假记录
          </el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 作假记录列表 -->
    <div class="fraud-list-card" v-if="records.length">
      <h4>作假记录</h4>
      <el-table :data="records" stripe border style="width:100%">
        <el-table-column prop="employeeName" label="员工" width="100" />
        <el-table-column label="季度" width="140">
          <template #default="{ row }">{{ formatQuarter(row.quarter) }}</template>
        </el-table-column>
        <el-table-column prop="reason" label="原因" min-width="200" />
        <el-table-column prop="pointsReset" label="清零积分" width="90" align="center" />
        <el-table-column prop="reviewerName" label="操作人" width="100" />
        <el-table-column prop="createdAt" label="时间" width="160" />
        <el-table-column v-if="auth.isSuperAdmin" label="操作" width="80" align="center">
          <template #default="{ row }">
            <el-button type="danger" link size="small" @click="handleDelete(row)">删除恢复</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAuthStore } from '../../stores/auth'
import { quarterKey, recentQuarters, formatQuarter } from '../../utils/quarter'
import api from '../../api'

const auth = useAuthStore()
const employees = ref([])
const records = ref([])
const submitting = ref(false)
// 自由文本的 YYYY-MM 输入框换成下拉：季度是受控取值（YYYY-QN），
// 手输既可能打错，也没法保证它落在有数据的范围内。
const quarterOptions = recentQuarters(8)
const form = reactive({ userId: null, quarter: quarterKey(), reason: '' })

onMounted(async () => {
  try {
    const data = await api.get('/admin/employees', { params: { pageSize: 200 } })
    employees.value = data.items
  } catch { /* */ }
  loadRecords()
})

async function loadRecords() {
  try {
    const data = await api.get('/admin/fraud')
    records.value = data.records
  } catch { /* */ }
}

async function handleSubmit() {
  if (!form.userId || !form.quarter || !form.reason) return ElMessage.warning('请填写完整信息')

  const emp = employees.value.find(e => e.id === form.userId)
  try {
    // 后果比"清积分"重得多，确认框必须说全：六个维度归零 + 取消季度奖励资格。
    // 只说"积分清零"的话，管理员不会意识到这个人同时也失去了本季度的调休排名。
    await ElMessageBox.confirm(
      `确定记录 ${emp.name} 在 ${formatQuarter(form.quarter)} 弄虚作假吗？\n\n`
      + '将同时发生：\n'
      + '1. 扣减该季度获得的累计积分\n'
      + '2. 该季度六个评价维度全部分数归零\n'
      + '3. 取消该季度奖励（调休）资格\n\n'
      + `原因：${form.reason}`,
      '确认作假报告',
      { type: 'warning', confirmButtonText: '确定归零', whiteSpacePreWrap: true }
    )
  } catch { return }

  submitting.value = true
  try {
    const r = await api.post('/admin/fraud', { userId: form.userId, quarter: form.quarter, reason: form.reason })
    ElMessage.success(r.message || '作假记录已提交')
    form.reason = ''
    loadRecords()
  } catch { /* 409（本季度已有记录）等错误由 api 拦截器统一弹提示 */ }
  finally { submitting.value = false }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(
      `确定删除 ${row.employeeName} ${formatQuarter(row.quarter)} 的作假记录吗？\n\n`
      + `该季度六个维度的归零将解除，累计积分恢复 ${row.pointsReset} 分。`,
      '撤销作假记录', { type: 'warning', confirmButtonText: '确定撤销' }
    )
  } catch { return }

  try {
    const r = await api.delete(`/admin/fraud/${row.id}`)
    ElMessage.success(r.message || '已恢复积分')
    loadRecords()
  } catch { /* */ }
}
</script>

<style scoped>
.page-header { margin-bottom: 24px; }
.page-sub { font-size: 13px; color: var(--text-secondary); margin-left: 20px; margin-top: 6px; }

.fraud-form-card {
  background: var(--bg-card); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs); border: 1px solid var(--ink-100);
  padding: 24px; margin-bottom: 24px;
}
.fraud-form-card h4 { font-size: 16px; font-weight: 700; color: var(--text-primary); margin-bottom: 16px; }

.fraud-list-card {
  background: var(--bg-card); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs); border: 1px solid var(--ink-100);
  padding: 24px;
}
.fraud-list-card h4 { font-size: 16px; font-weight: 700; color: var(--text-primary); margin-bottom: 16px; }
</style>
