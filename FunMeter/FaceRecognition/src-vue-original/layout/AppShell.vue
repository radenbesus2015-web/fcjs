<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from "vue";
import { useDark } from "@vueuse/core";
import { useRoute, useRouter } from "vue-router";
import { request, jsonPost, HttpError, setAuthHeader, setQueryToken } from "../utils/api";
import { routes as appRoutes, setRouterAuthUser } from "../router";
import { toast } from "../utils/toast";
import { createI18nState, LANGUAGE_OPTIONS } from "../i18n";

const LANGUAGE_CODES = LANGUAGE_OPTIONS.map((opt) => opt.code);
const isDark = useDark({
  selector: "html",
  attribute: "class",
  valueDark: "dark",
  valueLight: "light",
  storageKey: "app-theme",
});

import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import AppSidebar from "../components/AppSidebar.vue";
import HeaderBar from "../components/HeaderBar.vue";
import AuthModal from "../components/modals/AuthModal.vue";
import SettingsModal from "../components/modals/SettingsModal.vue";

const route = useRoute();
const router = useRouter();


/* =========================
 * NAV ITEMS (from routes)
 * ========================= */
const authState = reactive({ user: null, loading: true });

function routeToNavItem(route) {
  return {
    name: route.name,
    to: route.path,
    icon: route.icon,
    labelKey: route.meta?.navKey,
    labelFallback: route.meta?.navFallback ?? route.meta?.titleFallback ?? route.name,
  };
}

const baseNavItems = computed(() =>
  appRoutes.filter((r) => r.icon && !r.path.startsWith("/admin")).map((r) => routeToNavItem(r))
);

const adminNavItems = computed(() =>
  appRoutes.filter((r) => r.icon && r.path.startsWith("/admin")).map((r) => routeToNavItem(r))
);

const navItems = computed(() => {
  const items = [...baseNavItems.value];
  if (authState.user?.is_admin) {
    adminNavItems.value.forEach((a) => {
      const route = appRoutes.find((r) => r.path === a.to);
      if (route?.meta?.requiresOwner && !authState.user?.is_owner) return; // hide owner-only menu
      if (!items.some((it) => it.to === a.to)) items.push(a);
    });
  }
  return items;
});

/* =========================
 * AUTH HEADER (localStorage token)
 * ========================= */
setAuthHeader(() => {
  try {
    const t = typeof window !== "undefined" ? localStorage.getItem("api_key") : null;
    if (t) {
      setQueryToken(() => t);
      return { Authorization: `Bearer ${t}` };
    }
    setQueryToken(null);
    return null;
  } catch (e) {
    setQueryToken(null);
    return null;
  }
});

const hideChrome = computed(() => route.path.startsWith("/absensi-fun-meter"));

/* =========================
 * SETTINGS & THEME
 * ========================= */
const SETTINGS_KEY = "appSettings";
const DEFAULT_SETTINGS = Object.freeze({
  theme: "light",
  baseInterval: 200,
  language: "id",
  attendance: {
    sendWidth: 480,
    jpegQuality: 1,
  },
  funMeter: {
    sendWidth: 480,
    jpegQuality: 1,
  },
});

function cloneDefaultSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function normalizeSettings(raw) {
  const base = cloneDefaultSettings();
  if (!raw || typeof raw !== "object") return base;

  // theme
  const theme = String(raw.theme ?? base.theme).toLowerCase();
  base.theme = theme === "dark" ? "dark" : "light";

  const rawLanguage = String(raw.language ?? base.language).toLowerCase();
  base.language = LANGUAGE_CODES.includes(rawLanguage) ? rawLanguage : base.language;

  // attendance
  const att = raw.attendance ?? {};
  const attSendWidth = Number(att.sendWidth);
  if (Number.isFinite(attSendWidth) && attSendWidth > 0) {
    base.attendance.sendWidth = Math.round(attSendWidth);
  }
  const attJpeg = Number(att.jpegQuality);
  if (Number.isFinite(attJpeg)) {
    base.attendance.jpegQuality = Math.min(1, Math.max(0.1, attJpeg));
  }

  // funMeter
  const fun = raw.funMeter ?? {};
  const funSendWidth = Number(fun.sendWidth);
  if (Number.isFinite(funSendWidth) && funSendWidth > 0) {
    base.funMeter.sendWidth = Math.round(funSendWidth);
  }
  const funJpeg = Number(fun.jpegQuality);
  if (Number.isFinite(funJpeg)) {
    base.funMeter.jpegQuality = Math.min(1, Math.max(0.1, funJpeg));
  }

  // FIX: baseInterval harusnya baca dari raw.baseInterval, lalu clamp 200–20000
  const rawBaseInv = Number(raw.baseInterval);
  if (Number.isFinite(rawBaseInv)) {
    base.baseInterval = Math.round(Math.max(0, Math.min(20000, rawBaseInv)));
  }

  return base;
}

function loadSettings() {
  const defaults = cloneDefaultSettings();
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    return normalizeSettings(JSON.parse(raw));
  } catch (err) {
    // Keep internal warnings non-localized (dev-focused)
    console.warn("Failed to load settings, using defaults", err);
    return defaults;
  }
}

const settingsState = reactive(loadSettings());
const i18n = createI18nState(settingsState.language);

watch(
  () => settingsState.language,
  (lang) => {
    const next = LANGUAGE_CODES.includes(lang) ? lang : DEFAULT_SETTINGS.language;
    i18n.setLocale(next);
  },
  { immediate: true }
);

function plainSettings() {
  return {
    theme: settingsState.theme,
    language: settingsState.language,
    baseInterval: settingsState.baseInterval,
    attendance: {
      sendWidth: settingsState.attendance.sendWidth,
      jpegQuality: settingsState.attendance.jpegQuality,
    },
    funMeter: {
      sendWidth: settingsState.funMeter.sendWidth,
      jpegQuality: settingsState.funMeter.jpegQuality,
    },
  };
}

function saveSettings() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(plainSettings()));
  } catch (err) {
    console.warn("Failed to persist settings", err);
  }
}

watch(
  () => settingsState.theme,
  (theme) => {
    const shouldBeDark = theme === "dark";
    if (isDark.value !== shouldBeDark) isDark.value = shouldBeDark;
  },
  { immediate: true }
);

watch(
  isDark,
  (value) => {
    const nextTheme = value ? "dark" : "light";
    if (settingsState.theme !== nextTheme) settingsState.theme = nextTheme;
  }
);

watch(settingsState, saveSettings, { deep: true });

// Settings modal + form
const settingsModalOpen = ref(false);
const settingsForm = reactive({
  theme: settingsState.theme,
  language: settingsState.language,
  baseInterval: settingsState.baseInterval,
  attendanceSendWidth: settingsState.attendance.sendWidth,
  attendanceJpegQuality: settingsState.attendance.jpegQuality,
  funSendWidth: settingsState.funMeter.sendWidth,
  funJpegQuality: settingsState.funMeter.jpegQuality,
});

function syncSettingsForm() {
  settingsForm.theme = settingsState.theme;
  settingsForm.language = settingsState.language;
  settingsForm.baseInterval = settingsState.baseInterval;
  settingsForm.attendanceSendWidth = settingsState.attendance.sendWidth;
  settingsForm.attendanceJpegQuality = settingsState.attendance.jpegQuality;
  settingsForm.funSendWidth = settingsState.funMeter.sendWidth;
  settingsForm.funJpegQuality = settingsState.funMeter.jpegQuality;
}

function parseNumber(value, fallback, { min, max, round } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  let out = num;
  if (round) out = Math.round(out);
  if (typeof min === "number") out = Math.max(min, out);
  if (typeof max === "number") out = Math.min(max, out);
  return out;
}

function openSettings() {
  syncSettingsForm();
  settingsModalOpen.value = true;
}
function closeSettings() {
  settingsModalOpen.value = false;
}
function submitSettings() {
  const attSendWidth = parseNumber(settingsForm.attendanceSendWidth, settingsState.attendance.sendWidth, {
    min: 120,
    max: 1920,
    round: true,
  });
  const attJpeg = parseNumber(settingsForm.attendanceJpegQuality, settingsState.attendance.jpegQuality, {
    min: 0.1,
    max: 1,
  });
  const funSendWidth = parseNumber(settingsForm.funSendWidth, settingsState.funMeter.sendWidth, {
    min: 160,
    max: 1920,
    round: true,
  });
  const funJpeg = parseNumber(settingsForm.funJpegQuality, settingsState.funMeter.jpegQuality, { min: 0.1, max: 1 });
  const baseInv = parseNumber(settingsForm.baseInterval, settingsState.baseInterval, {
    min: 0,
    max: 5000,
    round: true,
  });

  const nextLanguage = LANGUAGE_CODES.includes(settingsForm.language) ? settingsForm.language : settingsState.language;
  settingsState.theme = settingsForm.theme === "dark" ? "dark" : "light";
  settingsState.language = nextLanguage;
  settingsState.baseInterval = Number(baseInv.toFixed(3));
  Object.assign(settingsState.attendance, { sendWidth: attSendWidth, jpegQuality: Number(attJpeg.toFixed(3)) });
  Object.assign(settingsState.funMeter, {
    sendWidth: funSendWidth,
    jpegQuality: Number(funJpeg.toFixed(3)),
  });

  toast.success(i18n.t("settings.toast.saved", "Pengaturan tersimpan."));
  closeSettings();
}

function resetSettings() {
  const defaults = cloneDefaultSettings();
  settingsState.theme = defaults.theme;
  settingsState.baseInterval = defaults.baseInterval;
  settingsState.language = defaults.language;
  Object.assign(settingsState.attendance, defaults.attendance);
  Object.assign(settingsState.funMeter, defaults.funMeter);
  syncSettingsForm();
  toast.success(i18n.t("settings.toast.reset", "Pengaturan dikembalikan ke bawaan."));
}

// =========================
// AUTH & MODAL (JS-only)
// =========================
const showAuthModal = ref(false);
const authTab = ref("login");

const loginLoading = ref(false);
const registerLoading = ref(false);

const loginForm = reactive({ username: "", password: "" });
const registerForm = reactive({ username: "", password: "", confirmPassword: "" });

const loginError = ref("");
const loginSuccess = ref("");
const registerError = ref("");
const registerSuccess = ref("");

async function fetchCurrentUser() {
  try {
    const data = await request("auth/me", { method: "GET" });
    authState.user = data?.user || null;
  } catch {
    authState.user = null;
  } finally {
    setRouterAuthUser(authState.user);
    authState.loading = false;
  }
}

function clearAuthMessages() {
  loginError.value = "";
  loginSuccess.value = "";
  registerError.value = "";
  registerSuccess.value = "";
}

function resetAuthForms() {
  loginForm.username = "";
  loginForm.password = "";
  registerForm.username = "";
  registerForm.password = "";
  registerForm.confirmPassword = "";
}

function openAuth(tab = "login") {
  authTab.value = tab;
  showAuthModal.value = true;
  clearAuthMessages();
  nextTick(() => {
    const selector = tab === "register" ? "#regUser" : "#loginUser";
    const el = document.querySelector(selector);
    if (el && typeof el.focus === "function") el.focus();
  });
}
function closeAuth() {
  showAuthModal.value = false;
  clearAuthMessages();
  resetAuthForms();
}

async function submitLogin() {
  if (loginLoading.value) return;
  clearAuthMessages();
  if (!loginForm.username.trim() || !loginForm.password) {
    // fallback is English so `en.json` can replace it
    loginError.value = i18n.t("auth.error.fillFields", "Isi username dan password.");
    return;
  }
  loginLoading.value = true;
  try {
    const data = await jsonPost("auth/login", {
      username: loginForm.username.trim(),
      password: loginForm.password,
    });
    const apiKey = data?.user?.api_key;
    if (apiKey) {
      localStorage.setItem("api_key", apiKey);
      setAuthHeader(() => ({ Authorization: `Bearer ${apiKey}` }));
      setQueryToken(() => apiKey);
    }
    loginSuccess.value = i18n.t("auth.toast.loginSuccess", "Selamat datang, {username}!", {
      username: loginForm.username.trim(),
    });
    toast.success(loginSuccess.value);
    await fetchCurrentUser();
    const redirectTarget = typeof route.query.redirect === "string" ? route.query.redirect : null;
    if (redirectTarget) {
      router.replace(redirectTarget).catch(() => {});
    } else if (route.query.redirect) {
      const cleanedQuery = { ...route.query };
      delete cleanedQuery.redirect;
      router.replace({ path: route.path, query: cleanedQuery }).catch(() => {});
    }
    setTimeout(() => closeAuth(), 450);
  } catch (err) {
    const msg =
      (err && (err.detail || err.data?.detail || err.response?.data?.detail || err.message)) ??
      i18n.t("auth.error.loginFailed", "Login gagal");
    toast.error(msg);
    loginError.value = err instanceof HttpError ? err.message : i18n.t("auth.error.loginFailed", "Login gagal");
  } finally {
    loginLoading.value = false;
  }
}

async function submitRegister() {
  if (registerLoading.value) return;
  clearAuthMessages();
  if (!registerForm.username.trim() || registerForm.password.length < 6) {
    registerError.value = i18n.t(
      "auth.error.registerShortPassword",
      "Username wajib diisi dan password minimal 6 karakter."
    );
    return;
  }
  if (registerForm.password !== registerForm.confirmPassword) {
    registerError.value = i18n.t(
      "auth.error.registerMismatch",
      "Konfirmasi password tidak cocok."
    );
    return;
  }
  registerLoading.value = true;
  try {
    await jsonPost("auth/register", {
      username: registerForm.username.trim(),
      password: registerForm.password,
    });
    registerSuccess.value = i18n.t("auth.toast.registerSuccess", "Akun berhasil dibuat. Silakan login.");
    toast.success(registerSuccess.value);
    loginForm.username = registerForm.username.trim();
    registerForm.password = "";
    registerForm.confirmPassword = "";
    authTab.value = "login";
    nextTick(() => {
      const el = document.querySelector("#loginUser");
      if (el && typeof el.focus === "function") el.focus();
    });
  } catch (err) {
    registerError.value =
      err instanceof HttpError ? err.message : i18n.t("auth.error.registerFailed", "Gagal membuat akun");
  } finally {
    registerLoading.value = false;
  }
}

async function logout() {
  try {
    await request("auth/logout", { method: "POST" });
  } catch (e) {
    console.warn("logout request failed:", e);
  }
  try {
    localStorage.removeItem("api_key");
  } catch (e) {
    console.warn("failed clearing api_key", e);
  }
  toast.success(i18n.t("auth.toast.logoutSuccess", "Berhasil keluar"));
  router.replace("/");
  setAuthHeader(() => null);
  setQueryToken(null);
  authState.user = null;
  setRouterAuthUser(null);
}

/* =========================
 * ASIDE + HEADER COLLAPSE
 * ========================= */
const isAsideCollapsed = ref(false);
function loadAsideState() {
  try {
    isAsideCollapsed.value = localStorage.getItem("asideCollapsed") === "1";
  } catch {}
}

const headerHeight = ref(64);

const isLg = ref(typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
function onResize() {
  isLg.value = window.matchMedia("(min-width: 1024px)").matches;
}

const ASIDE_W_COLLAPSED = 64;
const ASIDE_W_EXPANDED = 288;
const headerLeft = computed(() => (isLg.value ? (isAsideCollapsed.value ? ASIDE_W_COLLAPSED : ASIDE_W_EXPANDED) : 0));

const ASIDE_MS = 250,
  ASIDE_EASE = "ease";
const HDR_MS = 250,
  HDR_EASE = "ease";

const headerTransStyle = computed(() => ({
  transition: [
    `transform ${HDR_MS}ms ${HDR_EASE}`,
    `opacity ${HDR_MS}ms ${HDR_EASE}`,
    `left ${ASIDE_MS}ms ${ASIDE_EASE}`,
  ].join(", "),
  willChange: "transform, opacity, left",
}));

/* =========================
 * LIFECYCLE
 * ========================= */
onMounted(async () => {
  loadAsideState();
  window.addEventListener("resize", onResize);
  await fetchCurrentUser();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", onResize);
});

/* =========================
 * PROVIDE contexts
 * ========================= */
provide("settings", {
  state: settingsState,
  modalOpen: settingsModalOpen,
  form: settingsForm,
  openModal: openSettings,
  closeModal: closeSettings,
  reset: resetSettings,
  submit: submitSettings,
  languageOptions: LANGUAGE_OPTIONS,
});

provide("auth", {
  state: authState,
  showModal: showAuthModal,
  tab: authTab,
  openModal: openAuth,
  closeModal: closeAuth,
  // form & status
  loginForm,
  registerForm,
  loginError,
  loginSuccess,
  registerError,
  registerSuccess,
  loginLoading,
  registerLoading,
  // actions
  login: submitLogin,
  register: submitRegister,
  refresh: fetchCurrentUser,
  logout,
});

provide("i18n", i18n);
</script>

<template>
  <div class="min-h-svh bg-background text-foreground">
    <div v-if="hideChrome" class="h-full">
      <router-view />
    </div>

    <div v-else class="flex min-h-svh">
      <SidebarProvider>
        <AppSidebar :nav-items="navItems" />

        <div class="flex min-h-svh flex-1 min-w-0 flex-col">
          <HeaderBar
            :hidden="false"
            :left="headerLeft"
            :trans-style="headerTransStyle"
            @height="(h) => (headerHeight = h)">
            <template #left>
              <SidebarTrigger />
            </template>
          </HeaderBar>

          <main class="flex-1 w-full overflow-auto">
            <div class="w-full px-4 py-4 sm:px-6 lg:px-10">
              <router-view />
            </div>
          </main>
        </div>
      </SidebarProvider>
    </div>

    <AuthModal />
    <SettingsModal />
  </div>
</template>





