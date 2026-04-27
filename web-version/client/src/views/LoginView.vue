<template>
  <div class="login-page">
    <!-- 左侧品牌区 — 糖果软萌主题 -->
    <div class="brand-panel">
      <!-- 装饰软萌元素 -->
      <div class="candy-bg">
        <div class="blob blob-1" />
        <div class="blob blob-2" />
        <div class="blob blob-3" />
        <div class="blob blob-4" />
        <div class="blob blob-5" />
      </div>
      <!-- 浮动小点 -->
      <div class="float-dots">
        <span v-for="n in 12" :key="n" class="fdot" :style="dotStyle(n)" />
      </div>

      <div class="brand-content">
        <!-- 小精灵装饰 -->
        <div class="mascot-area">
          <span class="mascot m1">🌟</span>
          <span class="mascot m2">💫</span>
          <span class="mascot m3">✨</span>
        </div>
        <!-- 软萌 Logo -->
        <div class="logo-mark">
          <span class="logo-char">青</span>
        </div>
        <h1 class="brand-title">青羊新青年</h1>
        <div class="title-deco">
          <span class="deco-dot" />
          <span class="deco-line" />
          <span class="deco-dot" />
        </div>
        <p class="brand-desc">🌟 青年员工能力积分系统</p>
        <p class="brand-motto">以积分记录成长，用能力书写未来</p>
      </div>

      <div class="brand-footer">
        <span>中国移动 · 青羊分公司</span>
      </div>
    </div>

    <!-- 右侧表单区 -->
    <div class="form-panel">
      <div class="form-card">
        <div class="form-header">
          <h2>{{ isLogin ? '欢迎回来' : '创建账号' }}</h2>
          <p>{{ isLogin ? '登录您的账号继续使用系统' : '填写以下信息完成注册' }}</p>
        </div>

        <template v-if="isLogin">
          <el-form :model="loginForm" label-position="top" @submit.prevent="handleLogin">
            <el-form-item label="用户名">
              <el-input v-model="loginForm.username" placeholder="请输入用户名" size="large" />
            </el-form-item>
            <el-form-item label="密码">
              <el-input v-model="loginForm.password" type="password" placeholder="请输入密码" show-password size="large" @keyup.enter="handleLogin" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" block :loading="loading" size="large" @click="handleLogin">
                登 录
              </el-button>
            </el-form-item>
          </el-form>
          <p class="toggle">还没有账号？<el-link type="primary" @click="isLogin = false">立即注册</el-link></p>
        </template>

        <template v-else>
          <el-form :model="registerForm" label-position="top" @submit.prevent="handleRegister">
            <el-form-item label="用户名">
              <el-input v-model="registerForm.username" placeholder="字母、数字组成" />
            </el-form-item>
            <el-form-item label="密码">
              <el-input v-model="registerForm.password" type="password" placeholder="至少6位" show-password />
            </el-form-item>
            <el-form-item label="姓名">
              <el-input v-model="registerForm.name" placeholder="请输入真实姓名" />
            </el-form-item>
            <el-form-item label="工号">
              <el-input v-model="registerForm.employeeId" placeholder="请输入员工工号" />
            </el-form-item>
            <el-form-item label="部门">
              <el-input v-model="registerForm.department" placeholder="请输入所在部门" />
            </el-form-item>
            <el-form-item label="头像">
              <div class="avatar-upload" @click="triggerAvatar">
                <img v-if="avatarPreview" :src="avatarPreview" class="avatar-preview" />
                <div v-else class="avatar-placeholder">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span>点击上传头像</span>
                </div>
              </div>
              <input ref="avatarInput" type="file" accept="image/*" style="display:none" @change="onAvatarChange" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" block :loading="loading" size="large" @click="handleRegister">注 册</el-button>
            </el-form-item>
          </el-form>
          <p class="toggle">已有账号？<el-link type="primary" @click="isLogin = true">返回登录</el-link></p>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()
const isLogin = ref(true)
const loading = ref(false)

const loginForm = reactive({ username: '', password: '' })
const registerForm = reactive({ username: '', password: '', name: '', employeeId: '', department: '' })
const avatarInput = ref(null)
const avatarFile = ref(null)
const avatarPreview = ref('')

function triggerAvatar() {
  avatarInput.value?.click()
}

function onAvatarChange(e) {
  const file = e.target.files[0]
  if (!file) return
  avatarFile.value = file
  const reader = new FileReader()
  reader.onload = () => { avatarPreview.value = reader.result }
  reader.readAsDataURL(file)
}

function dotStyle(n) {
  const left = 10 + (n * 37) % 80
  const top = 8 + (n * 53) % 84
  const size = 4 + (n % 3) * 3
  const delay = (n * 0.7) % 6
  return {
    left: `${left}%`,
    top: `${top}%`,
    width: `${size}px`,
    height: `${size}px`,
    animationDelay: `${delay}s`
  }
}

async function handleLogin() {
  const { username, password } = loginForm
  if (!username || !password) return ElMessage.warning('请输入用户名和密码')
  loading.value = true
  try {
    await auth.login(username, password)
    router.push(auth.isAdmin ? '/admin/stats' : '/dashboard')
  } finally { loading.value = false }
}

async function handleRegister() {
  const { username, password, name, employeeId, department } = registerForm
  if (!username || !password || !name || !employeeId || !department) return ElMessage.warning('请填写完整信息')
  if (password.length < 6) return ElMessage.warning('密码至少6位')
  loading.value = true
  try {
    const fd = new FormData()
    fd.append('username', username)
    fd.append('password', password)
    fd.append('name', name)
    fd.append('employeeId', employeeId)
    fd.append('department', department)
    if (avatarFile.value) fd.append('avatar', avatarFile.value)
    const res = await auth.register(fd)
    ElMessage.success(res.message || '注册成功，请等待管理员审核')
    registerForm.username = ''
    registerForm.password = ''
    registerForm.name = ''
    registerForm.employeeId = ''
    registerForm.department = ''
    avatarFile.value = null
    avatarPreview.value = ''
    isLogin.value = true
  } finally { loading.value = false }
}
</script>

<style scoped>
.login-page {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* ===== 左侧品牌区 — 糖果软萌 ===== */
.brand-panel {
  flex: 0 0 42%;
  background: linear-gradient(160deg, #FFE4E8 0%, #FFD0D8 25%, #FDD5E0 50%, #FFE8EC 75%, #FFD4D0 100%);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

/* 软萌晕染 */
.candy-bg { position: absolute; inset: 0; }
.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(70px);
  animation: float 8s ease-in-out infinite;
}
.blob-1 {
  width: 380px; height: 380px;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.5), transparent 70%);
  top: -80px; right: -60px;
  animation-delay: 0s;
}
.blob-2 {
  width: 280px; height: 280px;
  background: radial-gradient(circle, rgba(255, 179, 191, 0.45), transparent 70%);
  bottom: -40px; left: -40px;
  animation-delay: 2s;
}
.blob-3 {
  width: 200px; height: 200px;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.4), transparent 70%);
  top: 40%; right: 10%;
  animation-delay: 4s;
}
.blob-4 {
  width: 160px; height: 160px;
  background: radial-gradient(circle, rgba(255, 159, 67, 0.2), transparent 70%);
  top: 55%; left: 25%;
  animation-delay: 6s;
}
.blob-5 {
  width: 120px; height: 120px;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.35), transparent 70%);
  top: 18%; left: 35%;
  animation-delay: 3s;
}

/* 浮动小点 */
.float-dots { position: absolute; inset: 0; pointer-events: none; }
.fdot {
  position: absolute;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 50%;
  animation: float 5s ease-in-out infinite;
}

/* 品牌内容 */
.brand-content {
  position: relative;
  z-index: 2;
  text-align: center;
}

/* 小精灵 */
.mascot-area { margin-bottom: 8px; }
.mascot {
  display: inline-block;
  font-size: 22px;
  animation: float 3s ease-in-out infinite;
  margin: 0 6px;
}
.m1 { animation-delay: 0s; }
.m2 { animation-delay: 0.6s; font-size: 18px; }
.m3 { animation-delay: 1.2s; }

/* Logo — 软萌糖果 */
.logo-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 96px; height: 96px;
  background: rgba(255, 255, 255, 0.7);
  border: 3px solid rgba(255, 255, 255, 0.9);
  border-radius: 28px;
  margin-bottom: 28px;
  backdrop-filter: blur(8px);
  box-shadow: 0 12px 40px rgba(255, 123, 138, 0.2), inset 0 2px 0 rgba(255,255,255,0.8);
  animation: float 3s ease-in-out infinite;
}
.logo-char {
  font-size: 46px;
  font-weight: 900;
  background: linear-gradient(135deg, #FF7B8A, #FF9F43);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.brand-title {
  font-size: 40px;
  font-weight: 900;
  letter-spacing: 8px;
  margin-bottom: 16px;
  color: #4D2D33;
  line-height: 1.2;
}
.title-deco {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-bottom: 22px;
}
.deco-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: rgba(255, 123, 138, 0.5);
}
.deco-line {
  width: 48px; height: 3px;
  background: linear-gradient(90deg, transparent, rgba(255, 123, 138, 0.4), transparent);
  border-radius: 2px;
}

.brand-desc {
  font-size: 17px;
  color: rgba(77, 45, 51, 0.65);
  margin-bottom: 8px;
  letter-spacing: 3px;
  font-weight: 500;
}

.brand-motto {
  font-size: 13px;
  color: rgba(77, 45, 51, 0.4);
  letter-spacing: 2px;
  margin-top: 6px;
}

.brand-footer {
  position: absolute;
  bottom: 28px;
  left: 0; right: 0;
  text-align: center;
  z-index: 2;
  font-size: 11px;
  color: rgba(77, 45, 51, 0.3);
  letter-spacing: 1px;
}

/* ===== 右侧表单区 ===== */
.form-panel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #FFFBF9;
}

.form-card {
  width: 420px;
  max-width: 90%;
  animation: fadeInUp 0.6s var(--transition-bounce);
}

.form-header {
  text-align: center;
  margin-bottom: 36px;
}
.form-header h2 {
  font-size: 28px;
  font-weight: 800;
  color: var(--ink-900);
  margin-bottom: 8px;
  letter-spacing: 0.03em;
}
.form-header p {
  color: var(--text-secondary);
  font-size: 14px;
}

.toggle {
  text-align: center;
  margin-top: 20px;
  color: var(--text-secondary);
  font-size: 13px;
}

.avatar-upload {
  width: 92px; height: 92px;
  border: 2.5px dashed var(--primary-light);
  border-radius: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
  transition: all var(--transition-bounce);
}
.avatar-upload:hover { border-color: var(--primary); background: var(--primary-bg); transform: scale(1.04); }
.avatar-preview { width: 100%; height: 100%; object-fit: cover; }
.avatar-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  color: var(--primary-light);
  font-size: 10px;
  font-weight: 500;
}

/* ===== 响应式 ===== */
@media (max-width: 768px) {
  .login-page { flex-direction: column; }
  .brand-panel { flex: 0 0 32%; }
  .logo-mark { width: 60px; height: 60px; border-radius: 18px; margin-bottom: 16px; }
  .logo-char { font-size: 28px; }
  .brand-title { font-size: 26px; letter-spacing: 4px; }
  .brand-desc { font-size: 14px; letter-spacing: 2px; }
  .brand-motto { font-size: 12px; }
  .brand-footer { display: none; }
  .form-panel { padding: 20px 0; }
  .form-card { width: 360px; }
  .form-header { margin-bottom: 24px; }
  .form-header h2 { font-size: 22px; }
}
</style>
