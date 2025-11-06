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
