"use client";

import React, { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { useI18n } from "@/components/providers/I18nProvider";
import { toast } from "@/lib/toast";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
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

  // While determining auth or redirecting, render nothing to prevent flash
  if (status === "idle" || status === "loading") return null;
  if (!user || !(user.is_admin || user.is_owner)) return null;

  return <>{children}</>;
}
