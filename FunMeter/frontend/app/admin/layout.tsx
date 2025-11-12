"use client";

import React, { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { useI18n } from "@/components/providers/I18nProvider";
import { toast } from "@/lib/toast";
import { Icon } from "@/components/common/Icon";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, user } = useAuth();
  const { t } = useI18n();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (status === "idle" || status === "loading") return;
    const allowed = !!user && (user.is_admin || user.is_owner);
    if (!allowed) {
      // Avoid redirect loop if already on home
      if (pathname && pathname.startsWith("/admin")) {
        toast.error(t("admin.error.accessRequired", "Akses admin diperlukan"));
        router.replace("/");
      }
    }
  }, [mounted, status, user, router, pathname, t]);

  // Wait for client-side mount
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
