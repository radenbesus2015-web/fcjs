"use client";

import React, { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { useI18n } from "@/components/providers/I18nProvider";
import { toast } from "@/toast";
import { Icon } from "@/components/common/Icon";

function AdminLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, user } = useAuth();
  const { t } = useI18n();

  useEffect(() => {
    if (status === "idle" || status === "loading") return;
    const allowed = !!user && (user.is_admin || user.is_owner);
    if (!allowed) {
      // Avoid redirect loop if already on home
      if (pathname && pathname.startsWith("/admin")) {
        toast.error(t("admin.error.accessRequired", "Akses admin diperlukan"));
        router.replace("/");
      }
    }
  }, [status, user, router, pathname, t]);

  // While determining auth or redirecting, render loading
  if (status === "idle" || status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon name="Loader2" className="h-5 w-5 animate-spin" />
          <span>{t("common.loading", "Loading...")}</span>
        </div>
      </div>
    );
  }
  
  if (!user || !(user.is_admin || user.is_owner)) return null;

  return <>{children}</>;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Wait for client-side mount before rendering anything that uses hooks
  if (!mounted) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon name="Loader2" className="h-5 w-5 animate-spin" />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  return <AdminLayoutContent>{children}</AdminLayoutContent>;
}
