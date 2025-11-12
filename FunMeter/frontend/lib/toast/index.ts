// lib/toast/index.ts
// Main toast module - unified toast system untuk frontend dan backend
// Adaptor dari src-vue-original/utils/toast.js ke sonner (React)

"use client";

import { toast as sonner } from 'sonner';
import type { ToastOptions } from './types';
import { TYPE_METHOD, DEFAULTS } from './constants';
import { fallbackTitle } from './utils';

/**
 * Menampilkan toast notification
 * @param options - String message atau object ToastOptions
 * @returns Toast ID atau object dengan id dan cancel function
 */
export function show(
  options: ToastOptions | string = {}
): string | { id: string | null; cancel: () => void } {
  const opts = typeof options === 'string' ? { message: options } : options;
  const o = { ...DEFAULTS, ...opts };

  const fnName = TYPE_METHOD[o.type] || 'info';
  const run = () => {
    const toastFn = sonner[fnName] || sonner;
    const id = toastFn(o.title || fallbackTitle(o.type), {
      description: o.message || '',
      duration: o.duration, // Infinity untuk persistent
      // action button
      ...(o.actionText && o.onAction
        ? { action: { label: o.actionText, onClick: () => o.onAction?.() } }
        : {}),
      // callback untuk auto close/dismiss
      onDismiss: () => {},
      onAutoClose: () => {},
    });

    return String(id);
  };

  if (o.delay > 0) {
    const t = setTimeout(run, o.delay);
    return { id: null, cancel: () => clearTimeout(t) };
  }
  return run();
}

/**
 * Toast API - unified interface untuk semua toast notifications
 */
export const toast = {
  /**
   * Menampilkan toast dengan options custom
   */
  show,

  /**
   * Menampilkan success toast
   */
  success(message: string, extra: Partial<ToastOptions> = {}) {
    return show({ type: 'success', message, ...(extra || {}) });
  },

  /**
   * Menampilkan error toast
   */
  error(message: string, extra: Partial<ToastOptions> = {}) {
    return show({ type: 'error', message, ...(extra || {}) });
  },

  /**
   * Menampilkan warning toast
   */
  warn(message: string, extra: Partial<ToastOptions> = {}) {
    return show({ type: 'warn', message, ...(extra || {}) });
  },

  /**
   * Alias untuk warn (untuk backward compatibility)
   */
  warning(message: string, extra: Partial<ToastOptions> = {}) {
    return show({ type: 'warn', message, ...(extra || {}) });
  },

  /**
   * Menampilkan info toast
   */
  info(message: string, extra: Partial<ToastOptions> = {}) {
    return show({ type: 'info', message, ...(extra || {}) });
  },

  /**
   * Menampilkan loading toast
   */
  loading(message: string, extra: Partial<ToastOptions> = {}) {
    return show({ type: 'info', message, title: 'Loading...', ...(extra || {}) });
  },

  /**
   * Menutup toast berdasarkan ID atau menutup semua toast
   */
  dismiss(id?: string | number) {
    return sonner.dismiss(id);
  },
};

// Export semua types dan utilities
export * from './types';
export * from './constants';
export * from './utils';
