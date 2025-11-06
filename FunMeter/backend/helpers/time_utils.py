from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any, Optional


WIB = timezone(timedelta(hours=7))
ID_DAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]


def clamp_int(value: Any, minimum: int, maximum: int, default: int = 0) -> int:
    try:
        n = int(value)
    except Exception:
        n = default
    return max(minimum, min(maximum, n))


def ensure_int(value: Any, default: int = 0, minimum: int = 0, maximum: int = 240) -> int:
    try:
        n = int(value)
    except Exception:
        n = default
    return max(minimum, min(maximum, n))


def normalize_hhmm(value: str | None) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    try:
        hh, mm = s.split(":", 1)
        h = max(0, min(23, int(hh)))
        m = max(0, min(59, int(mm)))
        return f"{h:02d}:{m:02d}"
    except Exception:
        return None


def is_valid_hhmm(value: str | None) -> bool:
    return normalize_hhmm(value) is not None


def hhmm_to_minutes(value: str) -> int:
    hh, mm = value.split(":", 1)
    return int(hh) * 60 + int(mm)

def now_iso() -> str:
    # Selalu ISO 8601 +07:00 (detik presisi)
    return datetime.now(WIB).isoformat(timespec="seconds")

def to_wib_iso(dt: datetime | None) -> str:
    if dt is None:
        return ""
    return dt.astimezone(WIB).isoformat(timespec="seconds")


def fmt_wib_full(dt: datetime) -> str:
    return f"{ID_DAYS[dt.weekday()]} {dt.strftime('%d/%m/%Y %H:%M')} WIB"


def humanize_secs(sec: int) -> str:
    s = max(0, int(sec))
    h, r = divmod(s, 3600)
    m, d = divmod(r, 60)
    parts = []
    if h:
        parts.append(f"{h} jam")
    if m:
        parts.append(f"{m} menit")
    if d or not parts:
        parts.append(f"{d} detik")
    return " ".join(parts)


def parse_att_ts(ts: str) -> Optional[datetime]:
    if not ts:
        return None

    raw = str(ts).strip()
    if not raw:
        return None

    # --- normalize ke ISO 8601 ---
    # ubah spasi jadi 'T', tambahkan offset kalau hilang
    iso_candidate = raw.replace(" ", "T")

    # handle trailing Z (UTC)
    if iso_candidate.endswith("Z"):
        iso_candidate = iso_candidate[:-1] + "+00:00"

    # kalau nggak ada timezone info, anggap WIB
    try:
        dt = datetime.fromisoformat(iso_candidate)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=WIB)
        return dt.astimezone(WIB)
    except Exception:
        pass

    # fallback format lama
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S%z"):
        try:
            dt = datetime.strptime(raw, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=WIB)
            return dt.astimezone(WIB)
        except Exception:
            continue

    return None
