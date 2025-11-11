// lib/toast.ts
// Adaptor dari src-vue-original/utils/toast.js ke sonner (React)

import { toast as sonner } from 'sonner';

// mapping tipe lama -> metode sonner
const TYPE_METHOD = {
  success: 'success',
  error: 'error',
  warn: 'warning', // sonner pakai "warning"
  info: 'info',
} as const;

interface ToastOptions {
  type?: keyof typeof TYPE_METHOD;
  title?: string;
  message?: string;
  delay?: number;
  duration?: number;
  dismissible?: boolean;
  actionText?: string;
  onAction?: () => void;
}

const DEFAULTS: Required<ToastOptions> = {
  type: 'info',
  title: '',
  message: '',
  delay: 0,
  duration: 3200,
  dismissible: true,
  actionText: '',
  onAction: () => {},
};

/**
 * show(options | string)
 * - string => message
 * - options: { type, title, message, delay, duration, dismissible, actionText, onAction }
 */
export function show(options: ToastOptions | string = {}): string | { id: string | null; cancel: () => void } {
  const opts = typeof options === 'string' ? { message: options } : options;
  const o = { ...DEFAULTS, ...opts };

  const fnName = TYPE_METHOD[o.type] || 'info';
  const run = () => {
    const toastFn = sonner[fnName] || sonner;
    const id = toastFn(o.title || fallbackTitle(o.type), {
      description: o.message || '',
      duration: o.duration, // Infinity utk persistent
      // action button
      ...(o.actionText && o.onAction
        ? { action: { label: o.actionText, onClick: () => o.onAction?.() } }
        : {}),
      // callback kalau auto close/di-dismiss
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

function getCurrentLanguage(): 'en' | 'id' {
  try {
    if (typeof window === 'undefined') return 'en';
    const raw = localStorage.getItem('settings');
    if (!raw) return 'en';
    const s = JSON.parse(raw);
    const code = String(s?.language || '').toLowerCase();
    return code === 'id' ? 'id' : 'en';
  } catch {
    return 'en';
  }
}

type ToastDict = {
  success: string;
  error: string;
  warn: string;
  info: string;
};

function fallbackTitle(type: keyof typeof TYPE_METHOD): string {
  const lang = getCurrentLanguage();
  const dict: ToastDict = lang === 'en'
    ? { success: 'Success', error: 'Error', warn: 'Warning', info: 'Info' }
    : { success: 'Berhasil', error: 'Gagal', warn: 'Perhatian', info: 'Info' };
  return dict[type] || dict.info;
}

export const toast = {
  show,
  success(message: string, extra: Partial<ToastOptions> = {}) {
    return show({ type: 'success', message, ...(extra || {}) });
  },
  error(message: string, extra: Partial<ToastOptions> = {}) {
    return show({ type: 'error', message, ...(extra || {}) });
  },
  warn(message: string, extra: Partial<ToastOptions> = {}) {
    return show({ type: 'warn', message, ...(extra || {}) });
  },
  info(message: string, extra: Partial<ToastOptions> = {}) {
    return show({ type: 'info', message, ...(extra || {}) });
  },
  // optional: dismiss by id / all
  dismiss(id?: string | number) {
    return sonner.dismiss(id);
  },
};
