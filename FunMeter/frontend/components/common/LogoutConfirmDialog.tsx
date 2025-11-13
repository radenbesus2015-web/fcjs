// components/common/LogoutConfirmDialog.tsx
// Modal konfirmasi logout dengan fitur multilingual, dark/light theme, ESC handler

"use client";

import React, { useEffect } from "react";
import { useI18n } from "@/components/providers/I18nProvider";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Icon } from "@/components/common/Icon";

interface LogoutConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function LogoutConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
}: LogoutConfirmDialogProps) {
  const { t } = useI18n();

  // ESC key handler
  useEffect(() => {
    if (!open) return;

    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onOpenChange(false);
      }
    };

    // Tambahkan listener dengan capture phase untuk prioritas tinggi
    document.addEventListener("keydown", handleEsc, { capture: true });

    return () => {
      document.removeEventListener("keydown", handleEsc, { capture: true });
    };
  }, [open, onOpenChange]);

  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-md">
        {/* Close button (X) di pojok kanan atas */}
        <button
          onClick={handleCancel}
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
          aria-label={t("common.close", "Close")}
        >
          <Icon name="X" className="h-4 w-4" />
        </button>

        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Icon name="LogOut" className="h-5 w-5 text-destructive" />
            {t("avatar.logout.title", "Confirm Logout")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("avatar.logout.description", "Are you sure you want to log out of your account?")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>
            {t("avatar.logout.cancel", "Cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            <Icon name="LogOut" className="h-4 w-4 mr-2" />
            {t("avatar.logout.confirm", "Yes, Logout")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
