// components/modals/GlobalConfirm.tsx
// Port dari src-vue-original/components/GlobalConfirm.vue

"use client";

import React, { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/common/Icon";
import { useConfirmDialogState } from "@/components/providers/ConfirmDialogProvider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function GlobalConfirm() {
  const { currentConfirm, resolveCurrentConfirm } = useConfirmDialogState();

  if (!currentConfirm) return null;

  const { options } = currentConfirm;

  const handleConfirm = () => {
    resolveCurrentConfirm(true);
  };

  const handleCancel = () => {
    resolveCurrentConfirm(false);
  };

  // ESC key handler
  useEffect(() => {
    if (!currentConfirm) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [currentConfirm]);

  return (
    <AlertDialog open={!!currentConfirm} onOpenChange={(open) => { if (!open) resolveCurrentConfirm(false); }}>
      <AlertDialogContent className="w-[calc(100%-2rem)] max-w-lg mx-4 sm:mx-0">
        {/* Close button (X) di pojok kanan atas */}
        <button
          onClick={handleCancel}
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
          aria-label="Close"
        >
          <Icon name="X" className="h-4 w-4" />
        </button>

        <AlertDialogHeader>
          <AlertDialogTitle>{options.title}</AlertDialogTitle>
          {options.description && (
            <AlertDialogDescription>{options.description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>
            {options.cancelText}
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>
            {options.confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
