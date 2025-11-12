// components/providers/ClientOnly.tsx
// Client-only component wrapper untuk prevent hydration mismatch

"use client";

import React, { useState, useEffect, ReactNode } from "react";
import { Icon } from "@/components/common/Icon";

interface ClientOnlyProps {
  children: ReactNode;
  fallback?: ReactNode;
  showLoader?: boolean;
  loaderText?: string;
}

/**
 * ClientOnly component wrapper
 * Prevents hydration mismatch by only rendering children after client-side mount
 * Use this for components that use browser APIs (localStorage, WebSocket, Camera, etc)
 */
export function ClientOnly({ 
  children, 
  fallback, 
  showLoader = true,
  loaderText = "Memuat..."
}: ClientOnlyProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // During SSR and initial hydration
  if (!mounted) {
    // Return custom fallback if provided
    if (fallback) {
      return <>{fallback}</>;
    }
    
    // Return loader if enabled
    if (showLoader) {
      return (
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon name="Loader2" className="h-5 w-5 animate-spin" />
            <span>{loaderText}</span>
          </div>
        </div>
      );
    }
    
    // Return null (invisible)
    return null;
  }

  // After client-side mount
  return <>{children}</>;
}
