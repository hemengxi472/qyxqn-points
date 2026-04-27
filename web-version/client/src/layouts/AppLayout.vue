<template>
  <div class="app-layout">
    <el-container>
      <!-- 侧边栏 — 糖果软萌主题 -->
      <el-aside :width="isCollapse ? '64px' : '230px'" class="aside">
        <!-- 品牌 Logo -->
        <div class="aside-brand" @click="$router.push(auth.isAdmin ? '/admin/stats' : '/dashboard')">
          <div class="brand-mark">
            <span class="mark-char">青</span>
          </div>
          <div v-show="!isCollapse" class="brand-text-wrap">
            <span class="brand-title">青羊新青年</span>
            <span class="brand-sub">能力积分系统</span>
          </div>
        </div>

        <!-- 菜单 -->
        <el-menu
          :default-active="activeMenu"
          router
          :collapse="isCollapse"
          background-color="transparent"
          text-color="#8D7C80"
          active-text-color="#FF7B8A"
        >
          <!-- 员工菜单：仅非管理员 -->
          <template v-if="!auth.isAdmin">
            <el-menu-item index="/dashboard">
              <span class="menu-emoji">🏠</span>
              <span>工作台</span>
            </el-menu-item>
            <el-menu-item index="/modules">
              <span class="menu-emoji">🌟</span>
              <span>积分申请</span>
            </el-menu-item>
            <el-menu-item index="/history">
              <span class="menu-emoji">📋</span>
              <span>积分记录</span>
            </el-menu-item>
            <el-menu-item index="/group">
              <span class="menu-emoji">🤝</span>
              <span>团队任务</span>
            </el-menu-item>
          </template>

          <!-- 管理菜单：仅管理员 -->
          <template v-if="auth.isAdmin">
            <el-menu-item index="/admin/stats">
              <span class="menu-emoji">🏠</span>
              <span>管理首页</span>
            </el-menu-item>
            <el-menu-item index="/admin/review">
              <span class="menu-emoji">✅</span>
              <span>审核管理</span>
            </el-menu-item>
            <el-menu-item index="/admin/registrations">
              <span class="menu-emoji">📝</span>
              <span>注册审批</span>
            </el-menu-item>
            <el-menu-item index="/admin/stats">
              <span class="menu-emoji">📊</span>
              <span>数据统计</span>
            </el-menu-item>
            <el-menu-item index="/admin/employees">
              <span class="menu-emoji">👤</span>
              <span>员工管理</span>
            </el-menu-item>
            <el-menu-item index="/admin/groups">
              <span class="menu-emoji">🏢</span>
              <span>团队管理</span>
            </el-menu-item>
            <el-menu-item index="/admin/modules">
              <span class="menu-emoji">🛠️</span>
              <span>模块管理</span>
            </el-menu-item>
            <el-menu-item index="/admin/fraud">
              <span class="menu-emoji">⚠️</span>
              <span>作假管理</span>
            </el-menu-item>
          </template>
        </el-menu>

        <!-- 底部用户区 -->
        <div class="aside-user" @click="$router.push(auth.isAdmin ? '/admin/stats' : '/profile')">
          <el-avatar :size="40" class="user-avatar" :src="auth.user?.avatarUrl || undefined">
            {{ auth.user?.avatarUrl ? '' : auth.user?.name?.charAt(0) }}
          </el-avatar>
          <div v-show="!isCollapse" class="user-info">
            <div class="user-name">{{ auth.user?.name }}</div>
            <div class="user-dept">{{ auth.user?.department }}</div>
          </div>
          <div v-show="!isCollapse" class="user-arrow">
            <el-icon><ArrowRight /></el-icon>
          </div>
        </div>
      </el-aside>

      <!-- 右侧主体 -->
      <el-container>
        <el-header class="header">
          <div class="header-left">
            <button class="collapse-btn" @click="isCollapse = !isCollapse">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="15" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <div class="header-divider" />
            <span class="header-title">{{ pageTitle }}</span>
          </div>
          <div class="header-right">
            <span v-if="auth.isAdmin" class="admin-badge">{{ auth.isSuperAdmin ? '超管' : '管理员' }}</span>
            <el-avatar :size="36" class="header-avatar" :src="auth.user?.avatarUrl || undefined">
              {{ auth.user?.avatarUrl ? '' : auth.user?.name?.charAt(0) }}
            </el-avatar>
            <span class="header-user-name">{{ auth.user?.name }}</span>
            <button class="logout-btn" @click="auth.logout(); $router.push('/login')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </el-header>
        <el-main class="main">
          <router-view />
        </el-main>
      </el-container>
    </el-container>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowRight } from '@element-plus/icons-vue'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const route = useRoute()
const isCollapse = ref(false)

onMounted(async () => {
  if (auth.token && !auth.user) {
    await auth.fetchUser()
  }
})

const activeMenu = computed(() => route.path)
const pageTitle = computed(() => route.meta.title || '工作台')
</script>

<style scoped>
.app-layout { height: 100vh; }

/* ===== 侧边栏 — 糖果软萌 ===== */
.aside {
  background: var(--sidebar-bg);
  display: flex;
  flex-direction: column;
  transition: width var(--transition-smooth);
  overflow: hidden;
  border-right: 1.5px solid #F5E8EB;
}

/* 品牌区 */
.aside-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 22px 18px;
  cursor: pointer;
  border-bottom: 1.5px solid #F5E8EB;
  transition: all var(--transition-smooth);
}
.brand-mark {
  width: 42px; height: 42px;
  background: linear-gradient(135deg, #FF7B8A, #FFB3BF);
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 21px;
  font-weight: 800;
  flex-shrink: 0;
  box-shadow: 0 6px 18px rgba(255, 123, 138, 0.35);
  animation: float 3s ease-in-out infinite;
}
.brand-text-wrap {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.brand-title {
  font-size: 15px;
  font-weight: 800;
  color: var(--text-primary);
  white-space: nowrap;
  letter-spacing: 2px;
  line-height: 1.2;
}
.brand-sub {
  font-size: 10px;
  color: var(--text-placeholder);
  white-space: nowrap;
  letter-spacing: 1px;
  font-weight: 500;
}

/* 菜单可爱图标 */
.menu-emoji {
  font-size: 18px;
  width: 24px;
  text-align: center;
  flex-shrink: 0;
  transition: all var(--transition-bounce);
}
.el-menu-item:hover .menu-emoji {
  transform: scale(1.25);
}

/* 菜单 */
.aside :deep(.el-menu) {
  flex: 1;
  border-right: none;
  padding: 10px 0;
}
.aside :deep(.el-menu-item) {
  margin: 3px 12px;
  border-radius: 16px;
  height: 44px;
  line-height: 44px;
  font-size: 14px;
  font-weight: 500;
  transition: all var(--transition-bounce);
}
.aside :deep(.el-menu-item:hover) {
  background: var(--sidebar-hover) !important;
  border-radius: 16px;
}
.aside :deep(.el-menu-item.is-active) {
  background: var(--sidebar-active) !important;
  font-weight: 700;
  border-radius: 16px;
  box-shadow: 0 4px 14px rgba(255, 123, 138, 0.12);
}

/* 底部用户区 */
.aside-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-top: 1.5px solid #F5E8EB;
  cursor: pointer;
  transition: all var(--transition-smooth);
}
.aside-user:hover { background: var(--sidebar-hover); }
.user-avatar {
  flex-shrink: 0;
  background: linear-gradient(135deg, #FF7B8A, #FFB3BF);
  color: #fff;
  font-weight: 700;
  box-shadow: 0 4px 14px rgba(255, 123, 138, 0.25);
}
.user-info { flex: 1; overflow: hidden; }
.user-name {
  font-size: 13px; color: var(--text-primary); font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.user-dept {
  font-size: 11px; color: var(--text-placeholder);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.user-arrow { color: var(--text-placeholder); font-size: 12px; }

/* ===== 顶部 Header ===== */
.header {
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  border-bottom: 1.5px solid #F5E8EB;
  height: var(--header-height);
}
.header-left { display: flex; align-items: center; gap: 14px; }
.collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px; height: 36px;
  border: none;
  background: transparent;
  border-radius: 12px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all var(--transition-bounce);
}
.collapse-btn:hover { background: var(--primary-bg); color: var(--primary); }
.header-divider { width: 1.5px; height: 22px; background: #F5E8EB; border-radius: 1px; }
.header-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.03em;
}
.header-right { display: flex; align-items: center; gap: 12px; }
.admin-badge {
  font-size: 11px;
  font-weight: 700;
  background: linear-gradient(135deg, #FF7B8A, #FF9F8E);
  color: #fff;
  padding: 5px 14px;
  border-radius: 16px;
  letter-spacing: 0.5px;
  box-shadow: 0 4px 14px rgba(255, 123, 138, 0.3);
}
.header-avatar {
  background: linear-gradient(135deg, #FF7B8A, #FFB3BF);
  color: #fff;
  font-weight: 700;
}
.header-user-name { font-size: 13px; color: var(--text-regular); font-weight: 600; }
.logout-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px; height: 34px;
  border: none;
  background: transparent;
  border-radius: 12px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all var(--transition-bounce);
}
.logout-btn:hover { background: var(--status-rejected-bg); color: var(--status-rejected); }

/* ===== 主内容区 ===== */
.main {
  background: var(--bg-page);
  padding: 28px;
  min-height: calc(100vh - var(--header-height));
  overflow-y: auto;
}
@media (max-width: 768px) {
  .main { padding: 16px; }
}
</style>
