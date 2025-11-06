// src/composables/useAuth.ts
import { reactive, ref, computed } from "vue"
import { api, setAuthHeader, setQueryToken } from "@/utils/api" // kamu sudah punya ini

export type AuthStatus = "idle" | "loading" | "authenticated" | "unauthenticated"

export interface AuthUser {
  id: string | number
  name: string
  email: string
  avatar?: string
  role?: string
}

export function createAuthStore() {
  const status = ref<AuthStatus>("idle")
  const user = ref<AuthUser | null>(null)
  const token = ref<string>("")
  const showModal = ref(false) // penting: ref, biar .value tetap works

  function openModal() { showModal.value = true }
  function closeModal() { showModal.value = false }

  function applyToken(t?: string) {
    token.value = t || ""
    if (token.value) {
      localStorage.setItem("fm_token", token.value)
      setAuthHeader(() => ({ Authorization: `Bearer ${token.value}` }))
      setQueryToken(() => token.value)
    } else {
      localStorage.removeItem("fm_token")
      setAuthHeader(null)
      setQueryToken(null)
    }
  }

  async function bootstrap() {
    // load token kalau ada
    const saved = localStorage.getItem("fm_token") || ""
    if (saved) applyToken(saved)

    status.value = "loading"
    try {
      const { data } = await api.get("/auth/me")
      user.value = data
      status.value = "authenticated"
    } catch {
      user.value = null
      status.value = "unauthenticated"
    }
  }

  async function login(payload: { email: string; password: string }) {
    status.value = "loading"
    try {
      const { data } = await api.post("/auth/login", payload)
      // asumsikan response { token, user }
      applyToken(data?.token)
      user.value = data?.user || null
      status.value = user.value ? "authenticated" : "unauthenticated"
      closeModal()
      return true
    } catch (err) {
      status.value = "unauthenticated"
      throw err
    }
  }

  async function logout() {
    try { await api.post("/auth/logout").catch(() => {}) } finally {
      applyToken("")
      user.value = null
      status.value = "unauthenticated"
    }
  }

  const isAuthed = computed(() => status.value === "authenticated")

  return {
    // state
    status, user, token, showModal, isAuthed,
    // actions
    openModal, closeModal, bootstrap, login, logout,
  }
}





