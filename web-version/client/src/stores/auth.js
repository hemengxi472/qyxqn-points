import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '../api'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const token = ref(localStorage.getItem('token') || '')

  const isLoggedIn = computed(() => !!token.value && !!user.value)
  const isAdmin = computed(() => user.value?.role === 'admin' || user.value?.role === 'superadmin')
  const isSuperAdmin = computed(() => user.value?.role === 'superadmin')

  async function login(username, password) {
    const res = await api.post('/auth/login', { username, password })
    token.value = res.token
    user.value = res.user
    localStorage.setItem('token', res.token)
    return res
  }

  async function register(formData) {
    const res = await api.post('/auth/register', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    return res
  }

  async function fetchUser() {
    try {
      const res = await api.get('/auth/me')
      user.value = res.user
    } catch {
      token.value = ''
      user.value = null
      localStorage.removeItem('token')
    }
  }

  function logout() {
    token.value = ''
    user.value = null
    localStorage.removeItem('token')
  }

  return { user, token, isLoggedIn, isAdmin, isSuperAdmin, login, register, fetchUser, logout }
})
