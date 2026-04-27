import { createRouter, createWebHistory } from 'vue-router'
import { ElMessage } from 'element-plus'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/LoginView.vue'),
    meta: { guest: true }
  },
  {
    path: '/',
    component: () => import('../layouts/AppLayout.vue'),
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', name: 'Dashboard', component: () => import('../views/DashboardView.vue'), meta: { title: '工作台' } },
      { path: 'modules', name: 'Modules', component: () => import('../views/ModulesView.vue'), meta: { title: '积分申请' } },
      { path: 'subcategories/:moduleId', name: 'Subcategories', component: () => import('../views/SubcategoriesView.vue'), meta: { title: '积分子项' } },
      { path: 'submit', name: 'Submit', component: () => import('../views/SubmitView.vue'), meta: { title: '提交申请' } },
      { path: 'submission/:id', name: 'SubmissionDetail', component: () => import('../views/SubmissionDetailView.vue'), meta: { title: '申请详情' } },
      { path: 'history', name: 'History', component: () => import('../views/HistoryView.vue'), meta: { title: '积分记录' } },
      { path: 'group', name: 'Group', component: () => import('../views/GroupView.vue'), meta: { title: '团队任务' } },
      { path: 'profile', name: 'Profile', component: () => import('../views/ProfileView.vue'), meta: { title: '个人中心' } },
      { path: 'admin/review', name: 'Review', component: () => import('../views/admin/ReviewView.vue'), meta: { admin: true, title: '审核管理' } },
      { path: 'admin/review/:id', name: 'ReviewDetail', component: () => import('../views/admin/ReviewDetailView.vue'), meta: { admin: true, title: '审核详情' } },
      { path: 'admin/stats', name: 'Stats', component: () => import('../views/admin/StatsView.vue'), meta: { admin: true, title: '数据统计' } },
      { path: 'admin/employees', name: 'Employees', component: () => import('../views/admin/EmployeesView.vue'), meta: { admin: true, title: '员工管理' } },
      { path: 'admin/groups', name: 'GroupManage', component: () => import('../views/admin/GroupManageView.vue'), meta: { admin: true, title: '团队管理' } },
      { path: 'admin/fraud', name: 'FraudManage', component: () => import('../views/admin/FraudManageView.vue'), meta: { admin: true, title: '作假管理' } },
      { path: 'admin/modules', name: 'ModuleManage', component: () => import('../views/admin/ModuleManageView.vue'), meta: { admin: true, title: '模块管理' } },
      { path: 'admin/registrations', name: 'RegistrationManage', component: () => import('../views/admin/RegistrationManageView.vue'), meta: { admin: true, title: '注册审批' } }
    ]
  }
]

const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach(async (to) => {
  const token = localStorage.getItem('token')

  if (to.meta.guest && token) {
    // After login, redirect based on role
    try {
      const { useAuthStore } = await import('../stores/auth')
      const auth = useAuthStore()
      if (!auth.user) await auth.fetchUser()
      return auth.isAdmin ? '/admin/stats' : '/dashboard'
    } catch {
      return '/dashboard'
    }
  }

  if (!to.meta.guest && !token) {
    return '/login'
  }

  // Admin redirect: admin users viewing employee-only paths go to admin stats
  const employeeOnly = ['/dashboard']
  if (employeeOnly.includes(to.path) && token) {
    try {
      const { useAuthStore } = await import('../stores/auth')
      const auth = useAuthStore()
      if (!auth.user) await auth.fetchUser()
      if (auth.isAdmin) return '/admin/stats'
    } catch { /* fall through */ }
  }

  if (to.meta.admin && token) {
    try {
      const { useAuthStore } = await import('../stores/auth')
      const auth = useAuthStore()
      if (!auth.user) {
        await auth.fetchUser()
      }
      if (!auth.isAdmin) {
        ElMessage.error('无管理员权限')
        return '/dashboard'
      }
    } catch {
      return '/login'
    }
  }

  return true
})

export default router
