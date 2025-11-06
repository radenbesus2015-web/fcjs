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
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <AlertDialogTitle>{options.title}</AlertDialogTitle>
              {options.description && (
                <AlertDialogDescription>{options.description}</AlertDialogDescription>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleCancel}
              aria-label="Close"
            >
              <Icon name="X" className="h-4 w-4" />
            </Button>
          </div>
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
