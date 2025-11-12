// lib/toast/utils.ts
// Utility functions untuk toast system

import { Language, ToastDict, ToastType } from './types';

/**
 * Mengambil bahasa saat ini dari localStorage
 */
export function getCurrentLanguage(): Language {
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

/**
 * Mendapatkan fallback title berdasarkan tipe dan bahasa
 */
export function fallbackTitle(type: ToastType): string {
  const lang = getCurrentLanguage();
  const dict: ToastDict = lang === 'en'
    ? { success: 'Success', error: 'Error', warn: 'Warning', info: 'Info' }
    : { success: 'Berhasil', error: 'Gagal', warn: 'Perhatian', info: 'Info' };
  return dict[type] || dict.info;
}
