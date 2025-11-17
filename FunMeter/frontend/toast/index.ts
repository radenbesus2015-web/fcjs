// toast/index.ts
// Main toast module - unified toast system untuk frontend dan backend
// Adaptor dari src-vue-original/utils/toast.js ke sonner (React)
// Mendukung multilingual dengan i18n
// Updated: Moved from lib/toast to toast folder

"use client";

import { toast as sonner } from 'sonner';
import type { ToastOptions } from './types';
import { TYPE_METHOD, DEFAULTS } from './constants';
import { fallbackTitle, translate } from './utils';

const TOAST_AUDIO_MAP: Record<string, string> = {
  success: "/assets/audio/success.mp3",
  error: "/assets/audio/error.mp3",
};

const audioCache: Record<string, HTMLAudioElement> = {};

const playToastAudio = (type: string) => {
  if (typeof window === "undefined") return;
  const src = TOAST_AUDIO_MAP[type];
  if (!src) return;
  try {
    if (!audioCache[src]) {
      audioCache[src] = new Audio(src);
    }
    const audio = audioCache[src];
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  } catch {
    // ignore audio errors
  }
};

/**
 * Menampilkan toast notification
 * @param options - String message atau object ToastOptions
 * @returns Toast ID atau object dengan id dan cancel function
 */
export function show(
  options: ToastOptions | string = {}
): string | { id: string | null; cancel: () => void } {
  // Pastikan hanya dijalankan di client side
  if (typeof window === 'undefined') {
    // Return dummy ID untuk SSR
    return 'ssr-dummy';
  }
  
  const opts = typeof options === 'string' ? { message: options } : options;
  const o = { ...DEFAULTS, ...opts };

  // Translate i18n keys jika ada
  let finalTitle = o.title;
  if (o.i18nTitleKey) {
    finalTitle = translate(o.i18nTitleKey, o.title, o.i18nValues);
  } else if (!finalTitle) {
    finalTitle = fallbackTitle(o.type);
  }

  let finalMessage = o.message || '';
  if (o.i18nKey) {
    finalMessage = translate(o.i18nKey, o.message, o.i18nValues);
  }

  let finalActionText = o.actionText;
  if (o.i18nActionTextKey) {
    finalActionText = translate(o.i18nActionTextKey, o.actionText, o.i18nValues);
  }

  const fnName = TYPE_METHOD[o.type] || 'info';
  const run = () => {
    const toastFn = sonner[fnName] || sonner;
    const id = toastFn(finalTitle, {
      description: finalMessage,
      duration: o.duration, // Infinity untuk persistent
      // action button
      ...(finalActionText && o.onAction
        ? { action: { label: finalActionText, onClick: () => o.onAction?.() } }
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
   * @param message - String message (akan digunakan sebagai fallback jika i18nKey ada)
   * @param extra - Options tambahan (bisa include i18nKey, i18nValues, dll)
   * 
   * @example
   * // Menggunakan string biasa (backward compatible)
   * toast.success("Data berhasil disimpan");
   * 
   * @example
   * // Menggunakan i18n key
   * toast.success("", { i18nKey: "adminAds.toast.saved" });
   * 
   * @example
   * // Menggunakan i18n key dengan values
   * toast.success("", { i18nKey: "adminAds.toast.loaded", i18nValues: { count: 5 } });
   */
  success(message: string, extra: Partial<ToastOptions> = {}) {
    const opts: ToastOptions = { 
      type: 'success', 
      message, 
      ...extra 
    };
    playToastAudio('success');
    return show(opts);
  },

  /**
   * Menampilkan error toast
   * @param message - String message (akan digunakan sebagai fallback jika i18nKey ada)
   * @param extra - Options tambahan (bisa include i18nKey, i18nValues, dll)
   * 
   * @example
   * // Menggunakan string biasa
   * toast.error("Terjadi kesalahan");
   * 
   * @example
   * // Menggunakan i18n key
   * toast.error("", { i18nKey: "adminAds.toast.loadError", i18nValues: { error: "Network error" } });
   */
  error(message: string, extra: Partial<ToastOptions> = {}) {
    const opts: ToastOptions = { 
      type: 'error', 
      message, 
      ...extra 
    };
    playToastAudio('error');
    return show(opts);
  },

  /**
   * Menampilkan warning toast
   * @param message - String message (akan digunakan sebagai fallback jika i18nKey ada)
   * @param extra - Options tambahan (bisa include i18nKey, i18nValues, dll)
   */
  warn(message: string, extra: Partial<ToastOptions> = {}) {
    const opts: ToastOptions = { 
      type: 'warn', 
      message, 
      ...extra 
    };
    return show(opts);
  },

  /**
   * Alias untuk warn (untuk backward compatibility)
   * @param message - String message (akan digunakan sebagai fallback jika i18nKey ada)
   * @param extra - Options tambahan (bisa include i18nKey, i18nValues, dll)
   */
  warning(message: string, extra: Partial<ToastOptions> = {}) {
    const opts: ToastOptions = { 
      type: 'warn', 
      message, 
      ...extra 
    };
    return show(opts);
  },

  /**
   * Menampilkan info toast
   * @param message - String message (akan digunakan sebagai fallback jika i18nKey ada)
   * @param extra - Options tambahan (bisa include i18nKey, i18nValues, dll)
   */
  info(message: string, extra: Partial<ToastOptions> = {}) {
    const opts: ToastOptions = { 
      type: 'info', 
      message, 
      ...extra 
    };
    return show(opts);
  },

  /**
   * Menampilkan loading toast
   * @param message - String message (akan digunakan sebagai fallback jika i18nKey ada)
   * @param extra - Options tambahan (bisa include i18nKey, i18nValues, dll)
   */
  loading(message: string, extra: Partial<ToastOptions> = {}) {
    const opts: ToastOptions = { 
      type: 'info', 
      message, 
      title: 'Loading...',
      ...extra 
    };
    return show(opts);
  },

  /**
   * Menutup toast berdasarkan ID atau menutup semua toast
   */
  dismiss(id?: string | number) {
    if (typeof window === 'undefined') return;
    return sonner.dismiss(id);
  },
};

// Export semua types dan utilities
export * from './types';
export * from './constants';
export * from './utils';

