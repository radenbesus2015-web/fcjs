// toast/types.ts
// Type definitions untuk toast system

export interface ToastOptions {
  type?: 'success' | 'error' | 'warn' | 'info';
  title?: string;
  message?: string;
  // i18n support: bisa menggunakan key i18n untuk message dan title
  i18nKey?: string; // Key i18n untuk message (contoh: "adminAds.toast.loaded")
  i18nTitleKey?: string; // Key i18n untuk title
  i18nValues?: Record<string, unknown>; // Values untuk interpolation (contoh: { count: 5 })
  delay?: number;
  duration?: number;
  dismissible?: boolean;
  actionText?: string;
  i18nActionTextKey?: string; // Key i18n untuk actionText
  onAction?: () => void;
}

export type ToastType = 'success' | 'error' | 'warn' | 'info';

export type Language = 'en' | 'id';

export interface ToastDict {
  success: string;
  error: string;
  warn: string;
  info: string;
}

