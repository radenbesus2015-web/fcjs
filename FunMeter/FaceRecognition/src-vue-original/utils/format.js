export function normalizeISOToWIB(iso) {
  if (!iso) return null;
  let s = String(iso).trim().replace(' ', 'T');
  if (!/[zZ]|[+\-]\d{2}:\d{2}$/.test(s)) s += '+07:00';
  return s;
}

export function fmtAttendanceWIB(iso) {
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
    const get = (t) => parts.find((p) => p.type === t)?.value || '';
    return `${get('hour')}.${get('minute')} - ${get('weekday')} ${get('day')}/${get('month')}/${get('year')}`;
  } catch (err) {
    return String(iso);
  }
}

export function fmtTimeLocal(iso) {
  try {
    if (!iso) return '-';
    const s = normalizeISOToWIB(iso);
    if (!s) return '-';
    const d = new Date(s);
    return d.toLocaleTimeString('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (err) {
    return String(iso);
  }
}

export function formatScore(score) {
  if (score == null || Number.isNaN(Number(score))) return '-';
  return Number(score).toFixed(3);
}
