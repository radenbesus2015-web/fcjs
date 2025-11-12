// toast/utils.ts
// Utility functions untuk toast system

"use client";

import type { Language, ToastDict, ToastType } from './types';

// Import messages - menggunakan cara yang sama seperti I18nProvider
// Import langsung di top level (Next.js akan handle ini dengan baik untuk client components)
import idMessagesRaw from '@/locales/id.json';
import enMessagesRaw from '@/locales/en.json';

// Convert ke type yang benar (sama seperti I18nProvider)
const idMsgs = idMessagesRaw as unknown as Record<string, unknown>;
const enMsgs = enMessagesRaw as unknown as Record<string, unknown>;
const messages: Record<string, Record<string, unknown>> = {
  id: idMsgs,
  en: enMsgs,
};

const FALLBACK_LOCALE = 'en';

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
 * Membaca message dari i18n berdasarkan key
 */
function readMessage(locale: string, path: string): unknown {
  const bag = messages[locale];
  if (!bag) return undefined;
  return path.split('.').reduce((acc: Record<string, unknown> | unknown, part) => {
    if (acc && typeof acc === 'object' && acc !== null && Object.prototype.hasOwnProperty.call(acc, part)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, bag as Record<string, unknown> | unknown);
}

/**
 * Format message dengan values untuk interpolation
 */
function formatMessage(message: string, values?: Record<string, unknown>): string {
  if (!values || typeof values !== 'object') return message;
  const entries = Object.entries(values);
  if (!entries.length) return message;
  let output = String(message);
  for (const [token, value] of entries) {
    const pattern = new RegExp(`\\{${token}\\}`, 'g');
    output = output.replace(pattern, String(value));
  }
  return output;
}

/**
 * Translate i18n key ke string
 * @param key - Key i18n (contoh: "adminAds.toast.loaded")
 * @param fallback - Fallback string jika key tidak ditemukan
 * @param values - Values untuk interpolation (contoh: { count: 5 })
 * @returns Translated string
 */
export function translate(key: string, fallback?: string, values?: Record<string, unknown>): string {
  if (!key) return fallback ?? '';
  
  const locale = getCurrentLanguage();
  const current = readMessage(locale, key);
  if (current !== undefined) return formatMessage(String(current), values);
  
  if (locale !== FALLBACK_LOCALE) {
    const fallbackMsg = readMessage(FALLBACK_LOCALE, key);
    if (fallbackMsg !== undefined) return formatMessage(String(fallbackMsg), values);
  }
  
  // Fallback ke fallback string atau key
  const base = fallback ?? key;
  return formatMessage(base, values);
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

