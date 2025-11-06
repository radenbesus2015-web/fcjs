"use client";

import React, { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { toast } from "@/lib/toast";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === "idle" || status === "loading") return;
    const allowed = !!user && (user.is_admin || user.is_owner);
    if (!allowed) {
      // Avoid redirect loop if already on home
      if (pathname && pathname.startsWith("/admin")) {
        toast.error("Admin access required");
        router.replace("/");
      }
    }
  }, [status, user, router, pathname]);

  // While determining auth or redirecting, render nothing to prevent flash
  if (status === "idle" || status === "loading") return null;
  if (!user || !(user.is_admin || user.is_owner)) return null;

  return <>{children}</>;
}
