// lib/toast/types.ts
// Type definitions untuk toast system

export interface ToastOptions {
  type?: 'success' | 'error' | 'warn' | 'info';
  title?: string;
  message?: string;
  delay?: number;
  duration?: number;
  dismissible?: boolean;
  actionText?: string;
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
