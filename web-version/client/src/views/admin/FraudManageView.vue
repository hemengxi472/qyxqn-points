<template>
  <div>
    <div class="page-header">
      <h3 class="page-title">作假管理</h3>
      <p class="page-sub">报告员工作假行为，相关月份积分清零</p>
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
        <el-form-item label="月份">
          <el-input v-model="form.monthYear" placeholder="YYYY-MM" size="large" style="width:140px" />
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
        <el-table-column prop="monthYear" label="月份" width="100" />
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
import api from '../../api'

const auth = useAuthStore()
const employees = ref([])
const records = ref([])
const submitting = ref(false)
const form = reactive({ userId: null, monthYear: new Date().toISOString().substring(0, 7), reason: '' })

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
  if (!form.userId || !form.monthYear || !form.reason) return ElMessage.warning('请填写完整信息')

  const emp = employees.value.find(e => e.id === form.userId)
  try {
    await ElMessageBox.confirm(
      `确定将 ${emp.name} ${form.monthYear} 月份积分清零吗？原因：${form.reason}`,
      '确认作假报告', { type: 'warning', confirmButtonText: '确定清零' }
    )
  } catch { return }

  submitting.value = true
  try {
    await api.post('/admin/fraud', { userId: form.userId, monthYear: form.monthYear, reason: form.reason })
    ElMessage.success('作假记录已提交，积分已清零')
    form.reason = ''
    loadRecords()
  } finally { submitting.value = false }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除 ${row.employeeName} ${row.monthYear} 的作假记录并恢复积分吗？`, '恢复积分', { type: 'warning' })
  } catch { return }

  try {
    await api.delete(`/admin/fraud/${row.id}`)
    ElMessage.success('已恢复积分')
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
