from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Tuple
from datetime import datetime

from fastapi import HTTPException

from db.supabase_client import get_client, get_default_org_id


from datetime import datetime, timezone, timedelta
 

def _normalize_ts(ts_text: Optional[str] = None) -> str:
    """
    Normalisasi timestamp → ISO-8601 UTC (akhiran 'Z').
    Terima None / string ISO / epoch detik/ms.
    """
    if not ts_text:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    s = str(ts_text).strip()
    try:
        if s.endswith("Z"):
            dt = datetime.fromisoformat(s[:-1]).replace(tzinfo=timezone.utc)
        else:
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        try:
            iv = int(float(s))
            if iv > 10_000_000_000:  # epoch ms → detik
                iv = iv // 1000
            dt = datetime.fromtimestamp(iv, tz=timezone.utc)
            return dt.isoformat().replace("+00:00", "Z")
        except Exception:
            return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def insert_event(label: str, score: float, ts_text: Optional[str], person_id: Optional[str]) -> Dict[str, Any]:
    client = get_client()
    org_id = get_default_org_id()
    payload = {
        "org_id": org_id,
        "label": label,
        "person_id": person_id or None,
        "score": float(score),
        "ts": _normalize_ts(ts_text),
    }
    res = client.table("attendance_events").insert(payload).execute()
    return (getattr(res, "data", [{}]) or [{}])[0]


def clear_events(label: Optional[str] = None) -> int:
    client = get_client()
    org_id = get_default_org_id()
    q = client.table("attendance_events").delete().eq("org_id", org_id)
    if label:
        q = q.eq("label", label)
    res = q.execute()
    # Supabase returns deleted rows if RLS allows; if not available, return 0 or best-effort
    data = getattr(res, "data", []) or []
    return len(data)


def delete_event(event_id: int) -> bool:
    client = get_client()
    org_id = get_default_org_id()
    res = client.table("attendance_events").delete().eq("org_id", org_id).eq("id", int(event_id)).execute()
    return bool(getattr(res, "data", []) or [])


def bulk_delete(ids: List[int]) -> int:
    if not ids:
        return 0
    client = get_client()
    org_id = get_default_org_id()
    res = client.table("attendance_events").delete().eq("org_id", org_id).in_("id", [int(i) for i in ids]).execute()
    return len(getattr(res, "data", []) or [])

def list_events(
    *,
    label: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    page: int = 1,
    per_page: int = 25,
    order: Literal["asc", "desc"] = "desc",
) -> Tuple[List[Dict[str, Any]], int]:
    client = get_client()
    org_id = get_default_org_id()

    # Base query tanpa cache
    q = client.table("attendance_events") \
        .select("id, org_id, label, person_id, score, ts", count="exact") \
        .eq("org_id", org_id)

    # Filter label
    if label:
        q = q.eq("label", label)

    # Filter tanggal
    if start_date:
        q = q.gte("ts", f"{start_date} 00:00:00")
    if end_date:
        q = q.lte("ts", f"{end_date} 23:59:59")

    # Sorting
    q = q.order("ts", desc=(order == "desc"))

    # Pagination (0-based range)
    s = max(0, (page - 1) * per_page)
    e = s + per_page - 1
    q = q.range(s, e)

    res = q.execute()
    items = getattr(res, "data", []) or []
    total = getattr(res, "count", 0) or len(items)

    # Output rapi seperti admin_attendance_log
    out = []
    for ev in items:
        lab = str(ev.get("label", "")).strip()
        out.append({
            "label": lab,
            "person_id": ev.get("person_id"),
            "ts": ev.get("ts", ""),
            "score": ev.get("score", 0),
        })

    return out, total
