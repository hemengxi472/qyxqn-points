<template>
  <div class="profile">
    <!-- 头像卡片 -->
    <div class="hero-card">
      <div class="hero-bg-shape" />
      <div class="hero-avatar">
        <el-avatar :size="88" :src="auth.user?.avatarUrl || undefined" class="avatar">
          {{ auth.user?.avatarUrl ? '' : auth.user?.name?.charAt(0) }}
        </el-avatar>
      </div>
      <h2 class="hero-name">{{ auth.user?.name }}</h2>
      <p class="hero-dept">{{ auth.user?.department }}</p>
      <div class="hero-meta">
        <span class="meta-item">工号 {{ auth.user?.employeeId }}</span>
        <span class="meta-divider" />
        <span class="meta-item">{{ roleLabel }}</span>
      </div>
      <div v-if="auth.isAdmin" class="hero-chip">
        <span>{{ auth.isSuperAdmin ? '超级管理员' : '管理员' }}</span>
      </div>
    </div>

    <!-- 信息卡片 -->
    <div class="info-card">
      <div class="info-row">
        <span class="info-label">系统角色</span>
        <span class="info-value">
          <span class="role-tag" :class="`role-${auth.user?.role}`">{{ roleLabel }}</span>
        </span>
      </div>
      <div class="info-row">
        <span class="info-label">登录账号</span>
        <span class="info-value">{{ auth.user?.username || auth.user?.employeeId }}</span>
      </div>
    </div>

    <!-- 退出 -->
    <el-button type="danger" class="logout-btn" @click="handleLogout">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px">
        <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
      退出登录
    </el-button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()

const roleLabel = computed(() => {
  const map = { employee: '普通员工', admin: '管理员', superadmin: '超级管理员' }
  return map[auth.user?.role] || '未知'
})

async function handleLogout() {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', { type: 'warning' })
    auth.logout()
    router.push('/login')
  } catch { /* cancelled */ }
}
</script>

<style scoped>
.profile { max-width: 480px; margin: 0 auto; }

/* ===== 头像卡片 ===== */
.hero-card {
  background: linear-gradient(160deg, #FF9F8E 0%, #FF7B8A 40%, #FFB08C 80%, #FFC77D 100%);
  border-radius: var(--radius-2xl);
  padding: 44px 28px 36px;
  text-align: center;
  color: #fff;
  box-shadow: 0 20px 56px rgba(255, 123, 138, 0.3);
  position: relative;
  overflow: hidden;
  animation: scaleInSpring 0.7s var(--transition-spring);
}
.hero-bg-shape {
  position: absolute;
  width: 300px; height: 300px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255,255,255,0.12), transparent 65%);
  top: -90px; left: 50%;
  transform: translateX(-50%);
}
.hero-avatar { position: relative; z-index: 1; margin-bottom: 18px; }
.avatar {
  background: linear-gradient(135deg, rgba(255,255,255,0.3), rgba(255,255,255,0.15));
  color: #fff; font-size: 36px; font-weight: 800;
  box-shadow: 0 10px 32px rgba(0,0,0,0.15);
  border: 3px solid rgba(255,255,255,0.4);
}
.hero-name {
  font-size: 26px; font-weight: 900; margin-bottom: 4px;
  position: relative; z-index: 1; letter-spacing: 0.04em;
}
.hero-dept { font-size: 14px; opacity: 0.85; position: relative; z-index: 1; }
.hero-meta {
  display: flex; align-items: center; justify-content: center;
  gap: 10px; margin-top: 12px; position: relative; z-index: 1;
}
.meta-item { font-size: 12px; opacity: 0.65; }
.meta-divider { width: 4px; height: 4px; border-radius: 50%; background: rgba(255,255,255,0.3); }
.hero-chip { margin-top: 16px; position: relative; z-index: 1; }
.hero-chip span {
  display: inline-block;
  background: rgba(255,255,255,0.25);
  backdrop-filter: blur(4px);
  color: #fff;
  font-size: 12px; font-weight: 700;
  padding: 6px 18px;
  border-radius: 24px;
  letter-spacing: 1px;
  border: 1.5px solid rgba(255,255,255,0.3);
}

/* ===== 信息卡 ===== */
.info-card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  border: 1.5px solid var(--ink-100);
  margin-top: 16px;
  overflow: hidden;
  animation: fadeInUp 0.5s 0.1s var(--transition-bounce) both;
}
.info-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 18px 20px;
  border-bottom: 1.5px solid var(--ink-50);
}
.info-row:last-child { border-bottom: none; }
.info-label { font-size: 14px; color: var(--text-secondary); font-weight: 500; }
.info-value { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.role-tag {
  font-size: 12px; font-weight: 700;
  padding: 4px 14px; border-radius: 16px;
}
.role-employee { background: var(--ink-50); color: var(--text-secondary); }
.role-admin { background: var(--module-morality-light); color: var(--module-morality); }
.role-superadmin { background: var(--status-rejected-bg); color: var(--status-rejected); }

.logout-btn {
  width: 100%;
  margin-top: 24px;
  height: 50px; font-size: 15px; font-weight: 700;
  border-radius: 16px;
  animation: fadeInUp 0.5s 0.15s var(--transition-bounce) both;
}
</style>
