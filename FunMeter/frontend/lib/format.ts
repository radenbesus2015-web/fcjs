// lib/format.ts
// Port dari src-vue-original/utils/format.js

export function normalizeISOToWIB(iso: string | null | undefined): string | null {
  if (!iso) return null;
  let s = String(iso).trim().replace(' ', 'T');
  if (!/[zZ]|[+\-]\d{2}:\d{2}$/.test(s)) s += '+07:00';
  return s;
}

export function fmtAttendanceWIB(iso: string | null | undefined): string {
  try {
    const s = normalizeISOToWIB(iso);
    if (!s) return '-';
    const d = new Date(s);
    const parts = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value || '';
    return `${get('hour')}.${get('minute')} - ${get('weekday')} ${get('day')}/${get('month')}/${get('year')}`;
  } catch (err) {
    return String(iso);
  }
}

export function fmtTimeLocal(iso: string | null | undefined): string {
  if (!iso) return "-";
  try {
    let s = String(iso).trim().replace(" ", "T");
    if (!/[zZ]|[+\-]\d{2}:\d{2}$/.test(s)) s += "+07:00";
    return new Date(s).toLocaleTimeString("id-ID", {
      timeZone: "Asia/Jakarta",
      weekday: "long",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return String(iso);
  }
}

export function formatScore(score: number | string | null | undefined): string {
  if (score == null || Number.isNaN(Number(score))) return '-';
  return Number(score).toFixed(3);
}

// Multilingual date formatter with format: Weekday, dd/mmm/yyyy HH:mm
export function fmtAttendanceMultilingual(iso: string | null | undefined, locale: string = 'id-ID'): string {
  try {
    const s = normalizeISOToWIB(iso);
    if (!s) return '-';
    const d = new Date(s);
    
    // Format: Weekday, dd/mmm/yyyy HH:mm (e.g., "Senin, 10/Nov/2025 08.45" or "Mon, 10/Nov/2025 08.45")
    const dateOptions: Intl.DateTimeFormatOptions = {
      timeZone: 'Asia/Jakarta',
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    };
    
    const formatter = new Intl.DateTimeFormat(locale, dateOptions);
    const parts = formatter.formatToParts(d);
    const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value || '';
    
    return `${get('weekday')}, ${get('day')}/${get('month')}/${get('year')} ${get('hour')}.${get('minute')}`;
  } catch (err) {
    return String(iso);
  }
}

/**
 * Format duration in seconds to human-readable format with i18n support
 * @param seconds - Duration in seconds
 * @param locale - Language locale ('id' or 'en')
 * @returns Formatted duration string (e.g., "4 seconds" or "4 detik")
 */
export function formatDuration(seconds: number, locale: string = 'id'): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const d = s % 60;
  
  const parts: string[] = [];
  
  if (locale === 'en') {
    if (h > 0) parts.push(`${h} hour${h > 1 ? 's' : ''}`);
    if (m > 0) parts.push(`${m} minute${m > 1 ? 's' : ''}`);
    if (d > 0 || parts.length === 0) parts.push(`${d} second${d !== 1 ? 's' : ''}`);
  } else {
    // Indonesian
    if (h > 0) parts.push(`${h} jam`);
    if (m > 0) parts.push(`${m} menit`);
    if (d > 0 || parts.length === 0) parts.push(`${d} detik`);
  }
  
  return parts.join(' ');
}
