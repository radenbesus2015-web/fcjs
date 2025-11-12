// components/layout/AppShell.tsx
// Port dari src-vue-original/layout/AppShell.vue

"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { AppSidebar } from "./AppSidebar";
import { HeaderBar } from "./HeaderBar";
import { SidebarProvider } from "@/components/ui/sidebar";

// Route definitions sesuai dengan Vue router
const routes = [
  // Public routes
  
  {
    path: "/home",
    name: "home",
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
    icon: "Smile",
    meta: {
      titleKey: "pages.funMeter.title",
      navKey: "nav.funMeter",
      titleFallback: "Fun Meter",
      navFallback: "Fun Meter",
    },
  },
  {
    path: "/attendance-fun-meter",
    name: "attendanceFunMeter",
    icon: "Camera",
    meta: {
      titleKey: "pages.attendanceFunMeter.title",
      navKey: "nav.attendanceFunMeter",
      titleFallback: "Attendance Fun Meter",
      navFallback: "Attendance Fun Meter",
    },
  },
  {
    path: "/register-face",
    name: "registerFace",
    icon: "UserPlus",
    meta: {
      titleKey: "pages.registerFace.title",
      navKey: "nav.registerFace",
      titleFallback: "Daftar Wajah",
      navFallback: "Daftar Wajah",
    },
  },
  // Admin routes
  {
    path: "/admin/dashboard",
    name: "adminDashboard",
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
    path: "/admin/advertisement",
    name: "adminAdvertisement",
    icon: "Megaphone",
    meta: {
      titleKey: "pages.adminAdvertisement.title",
      navKey: "nav.adminAdvertisement",
      titleFallback: "Kelola Iklan",
      navFallback: "Kelola Iklan",
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/list-members",
    name: "adminRegisterDb",
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

interface NavItem {
  name: string;
  to: string;
  icon: string;
  labelKey?: string;
  labelFallback: string;
}

function routeToNavItem(route: typeof routes[0]): NavItem {
  return {
    name: route.name,
    to: route.path,
    icon: route.icon,
    labelKey: route.meta?.navKey,
    labelFallback: route.meta?.navFallback ?? route.meta?.titleFallback ?? route.name,
  };
}

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  

  // Hide chrome untuk halaman root dan attendance-fun-meter
  const hideChrome = pathname === "/" || pathname.startsWith("/attendance-fun-meter");

  // Generate nav items berdasarkan user permissions
  const navItems: NavItem[] = React.useMemo(() => {
    const baseNavItems = routes
      .filter((r) => r.icon && !r.path.startsWith("/admin"))
      .map(routeToNavItem);

    const adminNavItems = routes
      .filter((r) => r.icon && r.path.startsWith("/admin"))
      .map(routeToNavItem);

    const items = [...baseNavItems];
    
    if (user?.is_admin) {
      adminNavItems.forEach((a) => {
        const route = routes.find((r) => r.path === a.to);
        if (route?.meta?.requiresOwner && !user?.is_owner) return; // hide owner-only menu
        if (!items.some((it) => it.to === a.to)) items.push(a);
      });
    }
    
    return items;
  }, [user]);

  if (hideChrome) {
    return (
      <div className="min-h-svh bg-background text-foreground">
        <div className="h-full">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <div className="flex min-h-svh">
        <SidebarProvider>
          <AppSidebar navItems={navItems} />
          
          <div className="flex min-h-svh flex-1 min-w-0 flex-col">
            <HeaderBar />
            
            <main className="flex-1 w-full overflow-auto">
              <div className="w-full px-4 py-4 sm:px-6 lg:px-10">
                {children}
              </div>
            </main>
          </div>
        </SidebarProvider>
      </div>
    </div>
  );
}
