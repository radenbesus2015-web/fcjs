// components/layout/HeaderBar.tsx
// Port dari src-vue-original/components/HeaderBar.vue

"use client";

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/components/providers/I18nProvider";
import { Icon } from "@/components/common/Icon";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/providers/ThemeProvider";

interface HeaderBarProps {
  hidden?: boolean;
  onHeightChange?: (height: number) => void;
}

// Route metadata untuk title dan breadcrumb
const routeMetadata: Record<string, { titleKey?: string; titleFallback?: string; navKey?: string; navFallback?: string }> = {
  "/home": {
    titleKey: "pages.attendanceFunMeter.title",
    titleFallback: "Face Recognition",
    navKey: "nav.attendanceFunMeter",
    navFallback: "Absensi Fun Meter",
  },
  "/attendance": {
    titleKey: "pages.attendance.title",
    titleFallback: "Absensi",
    navKey: "nav.attendance",
    navFallback: "Absensi",
  },
  "/fun-meter": {
    titleKey: "pages.funMeter.title",
    titleFallback: "Fun Meter",
    navKey: "nav.funMeter",
    navFallback: "Fun Meter",
  },
  "/absensi-fun-meter": {
    titleKey: "pages.attendanceFunMeter.title",
    titleFallback: "Absensi Fun Meter",
    navKey: "nav.attendanceFunMeter",
    navFallback: "Absensi Fun Meter",
  },
  "/register-face": {
    titleKey: "pages.registerFace.title",
    titleFallback: "Daftar Wajah",
    navKey: "nav.registerFace",
    navFallback: "Daftar Wajah",
  },
  "/admin/dashboard": {
    titleKey: "pages.adminDashboard.title",
    titleFallback: "Dashboard Admin",
    navKey: "nav.adminDashboard",
    navFallback: "Dashboard Admin",
  },
  "/admin/list-members": {
    titleKey: "pages.adminRegisterDb.title",
    titleFallback: "DB Wajah Admin",
    navKey: "nav.adminRegisterDb",
    navFallback: "DB Wajah Admin",
  },
  "/admin/schedule": {
    titleKey: "pages.adminSchedule.title",
    titleFallback: "Jadwal Admin",
    navKey: "nav.adminSchedule",
    navFallback: "Jadwal Admin",
  },
  "/admin/attendance": {
    titleKey: "pages.adminAttendance.title",
    titleFallback: "Absensi Admin",
    navKey: "nav.adminAttendance",
    navFallback: "Absensi Admin",
  },
  "/admin/attendance-summary": {
    titleKey: "pages.adminAttendanceSummary.title",
    titleFallback: "Ringkasan Absensi",
    navKey: "nav.adminAttendanceSummary",
    navFallback: "Ringkasan Absensi",
  },
  "/admin/users": {
    titleKey: "pages.adminUsers.title",
    titleFallback: "Manajemen Pengguna",
    navKey: "nav.adminUsers",
    navFallback: "Manajemen Pengguna",
  },
  "/admin/config": {
    titleKey: "pages.adminConfig.title",
    titleFallback: "Konfigurasi Sistem",
    navKey: "nav.adminConfig",
    navFallback: "Konfigurasi Sistem",
  },
};

export function HeaderBar({ hidden = false, onHeightChange }: HeaderBarProps) {
  const pathname = usePathname();
  const { t } = useI18n();
  const headerRef = useRef<HTMLDivElement>(null);
  const { isDark, toggleTheme } = useTheme();

  // Measure header height
  useEffect(() => {
    const measure = () => {
      const height = headerRef.current?.getBoundingClientRect()?.height;
      if (height && onHeightChange) {
        onHeightChange(Math.round(height));
      }
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [onHeightChange]);

  // Get breadcrumb
  const crumb = pathname.startsWith("/admin") 
    ? t("header.breadcrumb.admin", "Admin")
    : t("header.breadcrumb.website", "Website");

  // Get page title
  const meta = routeMetadata[pathname] || {};
  const titleKey = meta.titleKey || meta.navKey;
  const titleFallback = meta.titleFallback || meta.navFallback || t("header.title.default", "Pengenalan Wajah");
  const title = titleKey ? t(titleKey, titleFallback) : titleFallback;

  const headerClass = cn(
    "sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 transition-all",
    hidden ? "-translate-y-full opacity-0" : "translate-y-0 opacity-100"
  );

  return (
    <div ref={headerRef} className={headerClass}>
      <div className="flex h-14 items-center gap-2 px-3 sm:h-16 sm:px-4">
        {/* Mobile trigger */}
        <SidebarTrigger 
          className="inline-flex lg:hidden"
          aria-label={t("header.actions.openNavigation", "Buka navigasi")}
        />

        {/* Desktop trigger */}
        <div className="hidden items-center lg:flex">
          <SidebarTrigger />
        </div>

        {/* Breadcrumb + Title */}
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
            {crumb}
          </p>
          <h1 className="truncate text-base font-semibold sm:text-lg">
            {title}
          </h1>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/"
            className="hidden sm:inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
          >
            <Icon name="Radio" className="h-4 w-4" />
            <span>{t("header.actions.live", "Langsung")}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
