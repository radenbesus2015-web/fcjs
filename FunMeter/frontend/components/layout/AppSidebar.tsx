// components/layout/AppSidebar.tsx
// Port dari src-vue-original/components/AppSidebar.vue

"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { useI18n } from "@/components/providers/I18nProvider";
import { useSettings } from "@/components/providers/SettingsProvider";
import { Icon } from "@/components/common/Icon";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar";
import { LogoutConfirmDialog } from "@/components/common/LogoutConfirmDialog";

interface NavItem {
  name: string;
  to: string;
  icon: string;
  labelKey?: string;
  labelFallback: string;
}

interface AppSidebarProps {
  navItems: NavItem[];
}

function getInitials(name?: string): string {
  const cleanName = String(name || "")
    .replace(/_/g, " ") // underscore -> spasi
    .replace(/\s+/g, " ") // rapihin spasi ganda
    .trim();

  if (!cleanName) return "??";

  const parts = cleanName.split(" ").filter(Boolean);
  const first = (s: string) => s.charAt(0)?.toUpperCase() || "";

  // kalau ada >= 2 kata, ambil 2 huruf awal dari dua kata pertama
  if (parts.length >= 2) return first(parts[0]) + first(parts[1]);

  // kalau 1 kata, ambil 1 huruf awal
  return first(parts[0]);
}

function isExternalLink(url: string): boolean {
  return /^https?:\/\//.test(url);
}

export function AppSidebar({ navItems }: AppSidebarProps) {
  const pathname = usePathname();
  const { user, openModal, logout } = useAuth();
  const { t } = useI18n();
  const { openModal: openSettingsModal } = useSettings();
  const { isOpen, setIsOpen, isMobile } = useSidebar();
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);

  const ft = (path: string, fallback: string, values?: Record<string, unknown>) => 
    t(`aside.${path}`, fallback, values);

  const isAdmin = (item: NavItem) => item.to.startsWith("/admin");
  const baseNav = navItems.filter((item) => !isAdmin(item));
  const adminNav = navItems.filter(isAdmin);

  const displayName = user?.username || user?.name || "";
  const initials = getInitials(displayName);

  const handleLogoutClick = () => {
    setShowLogoutDialog(true);
  };

  const handleLogoutConfirm = () => {
    logout();
  };

  return (
    <>
      {/* Overlay untuk mobile */}
      {isMobile && isOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/50 lg:hidden animate-in fade-in duration-300"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}
      
      {/* Sidebar */}
      <div className={cn(
        "flex h-svh flex-col border-r bg-sidebar text-sidebar-foreground overflow-hidden transition-all duration-300 ease-in-out will-change-[width,transform]",
        // Mobile: fixed position with slide animation
        isMobile ? [
          "fixed top-0 left-0 z-50",
          isOpen ? "translate-x-0 w-64" : "-translate-x-full w-64"
        ] : [
          // Desktop: sticky position with width animation
          "sticky top-0 pl-0.5",
          isOpen ? "w-64" : "w-18"
        ]
      )}>
      {/* Header */}
      <div className={cn(
        "flex h-16 items-center border-b transition-all duration-300 ease-in-out",
        isOpen ? "px-4" : "justify-center px-0"
      )}>
        <div className={cn(
          "flex items-center transition-all duration-300 ease-in-out",
          isOpen ? "gap-2" : "gap-0"
        )}>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Icon name="Smile" className={cn("transition-all", isOpen ? "h-4 w-4" : "h-6 w-6")} />
          </div>
          <span
            className={cn(
              "font-semibold truncate transition-all duration-300 ease-in-out will-change-[opacity,width]",
              isOpen ? "opacity-100 w-auto" : "opacity-0 w-0 overflow-hidden"
            )}
            aria-hidden={!isOpen}
          >
            {ft("brand.title", "Absensi Wajah")}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {/* Main Navigation */}
        {baseNav.length > 0 && (
          <div className="mb-6">
            <h3
              className={cn(
                "px-2 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/70 transition-all duration-300 ease-in-out will-change-[opacity,height]",
                isOpen ? "mb-2 opacity-100 h-auto" : "mb-0 opacity-0 h-0 overflow-hidden"
              )}
              aria-hidden={!isOpen}
            >
              {ft("groups.main", "Menu Utama")}
            </h3>
            <nav className="space-y-1">
              {baseNav.map((item) => (
                <NavLink
                  key={item.to}
                  item={item}
                  isActive={pathname === item.to}
                  t={t}
                  collapsed={!isOpen}
                />
              ))}
            </nav>
          </div>
        )}

        {/* Admin Navigation */}
        {adminNav.length > 0 && (
          <>
            {/* Separator antara menu public dan admin */}
            <div className={cn(
              "transition-all duration-300 ease-in-out",
              isOpen ? "mb-6" : "mb-4"
            )}>
              <Separator className="bg-sidebar-border" />
            </div>
            
            <div className="mb-6">
              <h3
                className={cn(
                  "px-2 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/70 transition-all duration-300 ease-in-out will-change-[opacity,height]",
                  isOpen ? "mb-2 opacity-100 h-auto" : "mb-0 opacity-0 h-0 overflow-hidden"
                )}
                aria-hidden={!isOpen}
              >
                {ft("groups.admin", "Admin")}
              </h3>
              <nav className="space-y-1">
                {adminNav.map((item) => (
                  <NavLink
                    key={item.to}
                    item={item}
                    isActive={pathname === item.to}
                    t={t}
                    collapsed={!isOpen}
                  />
                ))}
              </nav>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className={cn(
        "border-t transition-all duration-300 ease-in-out space-y-3",
        isOpen ? "p-4" : "p-2"
      )}>
        <Button
          variant="ghost"
          className={cn(
            "w-full transition-all duration-300 ease-in-out flex",
            isOpen ? "justify-start" : "justify-center items-center px-0"
          )}
          onClick={openSettingsModal}
          aria-label={ft("actions.openSettings", "Buka Pengaturan")}
          title={ft("actions.openSettings", "Buka Pengaturan")}
        >
          {isOpen ? (
            <>
              <Icon name="Settings" className="h-4 w-4 mr-2 transition-all duration-300 ease-in-out" />
              <span className="truncate transition-all duration-300 ease-in-out will-change-[opacity,width]">
                {ft("actions.openSettings", "Buka Pengaturan")}
              </span>
            </>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center">
              <Icon name="Settings" className="h-6 w-6 transition-all duration-300 ease-in-out" />
            </div>
          )}
        </Button>

        {user ? (
          <>
            {isOpen ? (
              <div className="flex items-center gap-2 rounded-lg bg-sidebar-accent p-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm">
                  {initials}
                </div>
                <div className="flex-1 text-sm">
                  <div className="font-semibold truncate">{displayName}</div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground text-base font-semibold">
                  {initials}
                </div>
              </div>
            )}
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "w-full transition-all duration-300 ease-in-out flex",
              isOpen ? "justify-start" : "justify-center items-center px-0"
            )}
            onClick={() => openModal()}
            aria-label={t("avatar.menu.login", "Sign in")}
            title={t("avatar.menu.login", "Sign in")}
          >
            {isOpen ? (
              <>
                <Icon name="LogIn" className="h-4 w-4 mr-2 transition-all duration-300 ease-in-out flex-shrink-0" />
                <span className="truncate transition-all duration-300 ease-in-out will-change-[opacity,width]">
                  {t("avatar.menu.login", "Sign in")}
                </span>
              </>
            ) : (
              <div className="flex h-10 w-10 items-center justify-center">
                <Icon name="LogIn" className="h-6 w-6 transition-all duration-300 ease-in-out flex-shrink-0" />
              </div>
            )}
          </Button>
        )}
      </div>

      {/* Logout Confirmation Dialog */}
      <LogoutConfirmDialog
        open={showLogoutDialog}
        onOpenChange={setShowLogoutDialog}
        onConfirm={handleLogoutConfirm}
      />
    </div>
    </>
  );
}

interface NavLinkProps {
  item: NavItem;
  isActive: boolean;
  t: (key: string, fallback?: string, values?: Record<string, unknown>) => string;
  collapsed: boolean;
}

function NavLink({ item, isActive, t, collapsed }: NavLinkProps) {
  const { setIsOpen, isMobile } = useSidebar();
  const label = t(item.labelKey || "", item.labelFallback || item.name);
  
  // Auto-close sidebar on mobile when clicking a link
  const handleClick = () => {
    if (isMobile) {
      setIsOpen(false);
    }
  };

  if (isExternalLink(item.to)) {
    return (
      <a
        href={item.to}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        className={cn(
          "group flex items-center rounded-lg px-2 py-2 text-sm transition-all duration-300 ease-in-out",
          isActive 
            ? "bg-sidebar-accent text-sidebar-accent-foreground" 
            : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          collapsed ? "justify-center px-0 gap-0" : "gap-2"
        )}
      >
        <div className={cn(
          "flex items-center justify-center rounded-lg transition-all duration-300 ease-in-out flex-shrink-0",
          collapsed ? "h-10 w-10" : "h-8 w-8",
          isActive 
            ? "bg-orange-500 text-white" 
            : "bg-transparent group-hover:bg-orange-500 group-hover:text-white"
        )}>
          <Icon name={item.icon} className={cn("transition-all flex-shrink-0", collapsed ? "h-5 w-5" : "h-4 w-4") } />
        </div>
        <span
          className={cn(
            "truncate transition-all duration-300 ease-in-out will-change-[opacity,width]",
            collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100 w-auto"
          )}
          aria-hidden={collapsed}
        >
          {label}
        </span>
      </a>
    );
  }

  return (
    <Link
      href={item.to}
      onClick={handleClick}
      className={cn(
        "group flex items-center rounded-lg px-2 py-2 text-sm transition-all duration-300 ease-in-out",
        isActive 
          ? "bg-sidebar-accent text-sidebar-accent-foreground" 
          : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        collapsed ? "justify-center px-0 gap-0" : "gap-2"
      )}
    >
      <div className={cn(
        "flex items-center justify-center rounded-lg transition-all duration-300 ease-in-out flex-shrink-0",
        collapsed ? "h-10 w-10" : "h-8 w-8",
        isActive 
          ? "bg-orange-500 text-white" 
          : "bg-transparent group-hover:bg-orange-500 group-hover:text-white"
      )}>
        <Icon name={item.icon} className={cn("transition-all flex-shrink-0", collapsed ? "h-5 w-5" : "h-4 w-4") } />
      </div>
      <span
        className={cn(
          "truncate transition-all duration-300 ease-in-out will-change-[opacity,width]",
          collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100 w-auto"
        )}
        aria-hidden={collapsed}
      >
        {label}
      </span>
    </Link>
  );
}
