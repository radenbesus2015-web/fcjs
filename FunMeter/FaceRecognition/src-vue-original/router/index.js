import { createRouter, createWebHistory } from "vue-router";
import HomePage from "../pages/default/HomePage.vue";
import AttendancePage from "../pages/default/AttendancePage.vue";
import FunMeterPage from "../pages/default/FunMeterPage.vue";
import AttendanceFunMeter from "../pages/default/AttendanceFunMeter.vue";
import RegisterFacePage from "../pages/default/RegisterFacePage.vue";

import AdminRegisterDbPage from "../pages/admin/AdminFaceDbPage.vue";
import AdminDashboardPage from "../pages/admin/AdminDashboardPage.vue";
import AdminAttendancePage from "../pages/admin/AdminAttendancePage.vue";
import AdminAttendanceSummaryPage from "../pages/admin/AdminAttendanceSummaryPage.vue";
import AdminSchedulePage from "../pages/admin/AdminSchedulePage.vue";
import AdminUsersPage from "../pages/admin/AdminUsersPage.vue";
import AdminConfigPage from "../pages/admin/AdminConfigPage.vue";
import { request } from "@/utils/api";
import { toast } from "@/utils/toast";

export const routes = [
  // ===== Public =====
  {
    path: "/",
    name: "home",
    component: AttendanceFunMeter,
    icon: "Home",
    meta: {
      titleKey: "pages.home.title",
      navKey: "nav.home",
      titleFallback: "Beranda",
      navFallback: "Beranda",
    },
  },
  {
    path: "/attendance",
    name: "attendance",
    component: AttendancePage,
    icon: "IdCard",
    meta: {
      titleKey: "pages.attendance.title",
      navKey: "nav.attendance",
      titleFallback: "Absensi",
      navFallback: "Absensi",
    },
  },
  {
    path: "/fun-meter",
    name: "funMeter",
    component: FunMeterPage,
    icon: "Smile",
    meta: {
      titleKey: "pages.funMeter.title",
      navKey: "nav.funMeter",
      titleFallback: "Fun Meter",
      navFallback: "Fun Meter",
    },
  },
  {
    path: "/absensi-fun-meter",
    name: "attendanceFunMeter",
    component: AttendanceFunMeter,
    icon: "Camera",
    meta: {
      titleKey: "pages.attendanceFunMeter.title",
      navKey: "nav.attendanceFunMeter",
      titleFallback: "Absensi Fun Meter",
      navFallback: "Absensi Fun Meter",
    },
  },
  {
    path: "/register-face",
    name: "registerFace",
    component: RegisterFacePage,
    icon: "UserPlus",
    meta: {
      titleKey: "pages.registerFace.title",
      navKey: "nav.registerFace",
      titleFallback: "Daftar Wajah",
      navFallback: "Daftar Wajah",
    },
  },

  // ===== Admin (shortcut) =====
  { path: "/admin", redirect: { name: "adminDashboard" } },

  // ===== Admin =====
  {
    path: "/admin/dashboard",
    name: "adminDashboard",
    component: AdminDashboardPage,
    icon: "LayoutDashboard",
    meta: {
      titleKey: "pages.adminDashboard.title",
      navKey: "nav.adminDashboard",
      titleFallback: "Dashboard Admin",
      navFallback: "Dashboard Admin",
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/list-members",
    name: "adminRegisterDb",
    component: AdminRegisterDbPage,
    icon: "Database",
    meta: {
      titleKey: "pages.adminRegisterDb.title",
      navKey: "nav.adminRegisterDb",
      titleFallback: "DB Wajah Admin",
      navFallback: "DB Wajah Admin",
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/schedule",
    name: "adminSchedule",
    component: AdminSchedulePage,
    icon: "Clock",
    meta: {
      titleKey: "pages.adminSchedule.title",
      navKey: "nav.adminSchedule",
      titleFallback: "Jadwal Admin",
      navFallback: "Jadwal Admin",
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/attendance",
    name: "adminAttendance",
    component: AdminAttendancePage,
    icon: "ClipboardList",
    meta: {
      titleKey: "pages.adminAttendance.title",
      navKey: "nav.adminAttendance",
      titleFallback: "Absensi Admin",
      navFallback: "Absensi Admin",
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/attendance-summary",
    name: "adminAttendanceSummary",
    component: AdminAttendanceSummaryPage,
    icon: "BarChart3",
    meta: {
      titleKey: "pages.adminAttendanceSummary.title",
      navKey: "nav.adminAttendanceSummary",
      titleFallback: "Ringkasan Absensi",
      navFallback: "Ringkasan Absensi",
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/users",
    name: "adminUsers",
    component: AdminUsersPage,
    icon: "Users",
    meta: {
      titleKey: "pages.adminUsers.title",
      navKey: "nav.adminUsers",
      titleFallback: "Manajemen Pengguna",
      navFallback: "Manajemen Pengguna",
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/config",
    name: "adminConfig",
    component: AdminConfigPage,
    icon: "Settings2",
    meta: {
      titleKey: "pages.adminConfig.title",
      navKey: "nav.adminConfig",
      titleFallback: "Konfigurasi Sistem",
      navFallback: "Konfigurasi Sistem",
      requiresOwner: true,
    },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

let cachedUser = null;
let pendingUser = null;

async function loadCurrentUser() {
  if (typeof window === "undefined") return null;

  const apiKey = localStorage.getItem("api_key");
  if (!apiKey) {
    cachedUser = null;
    return null;
  }

  if (cachedUser) return cachedUser;
  if (!pendingUser) {
    pendingUser = request("auth/me", { method: "GET" })
      .then((res) => res?.user || null)
      .catch((err) => {
        if (err?.status === 401 || err?.status === 403) {
          try {
            localStorage.removeItem("api_key");
          } catch {}
        }
        return null;
      })
      .finally(() => {
        pendingUser = null;
      });
  }

  cachedUser = await pendingUser;
  return cachedUser;
}

router.beforeEach(async (to) => {
  const needsOwner = to.matched.some((r) => r.meta?.requiresOwner);
  const needsAdmin = to.matched.some((r) => r.meta?.requiresAdmin);
  if (!needsOwner && !needsAdmin) return true;

  const user = await loadCurrentUser();
  if (needsOwner) {
    if (user?.is_owner) return true;
    if (typeof window !== "undefined") {
      cachedUser = null;
      toast.error("Hanya owner yang bisa mengakses halaman ini.");
    }
    return { path: "/", query: { redirect: to.fullPath } };
  }
  if (needsAdmin) {
    if (user?.is_admin) return true;
    if (typeof window !== "undefined") {
      cachedUser = null;
      toast.error("Masuk sebagai admin untuk mengakses halaman ini.");
    }
    return { path: "/", query: { redirect: to.fullPath } };
  }
  return true;
});

export function setRouterAuthUser(user) {
  cachedUser = user || null;
}

export default router;

