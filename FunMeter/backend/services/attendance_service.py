from __future__ import annotations

import asyncio
import copy
import os
import threading
import time
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Literal, Optional, Set, Tuple
from collections import Counter, defaultdict

from db.supabase_client import get_client, get_default_org_id
from helpers.time_utils import (
    WIB as WIB_TZ,
    clamp_int as _clamp_int,
    ensure_int as _ensure_int,
    humanize_secs as _humanize_secs,
    now_iso as _now_iso,
    parse_att_ts as _parse_att_ts,
)
from services.people import (
    label_to_person_id as _resolve_person_id,
    person_id_to_label as _resolve_label,
)


MAX_ATT_EVENTS = int(os.getenv("ATT_MAX_EVENTS", 5000))

_ATT_DB_CACHE: Dict[str, Any] = {}
_ATT_DB_CACHE_TS: float = 0.0
_LOCK = threading.RLock()

_OVERRIDE_ID_RE = None  # placeholder; populated by configure_attendance
_UUID_RE = None

ATT_OVERRIDES: List[Dict[str, Any]] = []
ATT_CONFIG: Dict[str, Any] = {}

_COOLDOWN_SEC: int = 4860
_DOUBLE_MARK_INTERVAL: int = 0
_ATT_GRACE_IN: int = 10
_ATT_GRACE_OUT: int = 5

_GROUP_MEMBERS_CACHE: Dict[str, Set[str]] = {}
_GROUP_META_CACHE: Dict[str, Dict[str, str]] = {}
_GROUP_MEMBERS_CACHE_TS: float = 0.0
_GROUP_MEMBERS_CACHE_TTL: float = 120.0

_PERSON_LABEL_CACHE: Dict[str, str] = {}
_PERSON_LABEL_CACHE_TS: Dict[str, float] = {}
_PERSON_LABEL_CACHE_TTL: float = 120.0

ID_DAYS = [
    "Senin",
    "Selasa",
    "Rabu",
    "Kamis",
    "Jumat",
    "Sabtu",
    "Minggu",
]

def configure_attendance(att_cfg: Dict[str, Any], default_cfg: Dict[str, Any], *, override_id_re, uuid_re) -> Dict[str, Any]:
    """Apply attendance configuration and expose normalized overrides."""
    global ATT_CONFIG, ATT_OVERRIDES
    global _COOLDOWN_SEC, _DOUBLE_MARK_INTERVAL, _ATT_GRACE_IN, _ATT_GRACE_OUT
    global _OVERRIDE_ID_RE, _UUID_RE

    _OVERRIDE_ID_RE = override_id_re
    _UUID_RE = uuid_re

    cfg = copy.deepcopy(default_cfg or {})
    for key, value in (att_cfg or {}).items():
        cfg[key] = value

    _COOLDOWN_SEC = int(cfg.get("cooldown_sec", default_cfg.get("cooldown_sec", 4860)))
    _DOUBLE_MARK_INTERVAL = int(cfg.get("double_mark_interval_sec", default_cfg.get("double_mark_interval_sec", 0)))
    _ATT_GRACE_IN = _clamp_int(cfg.get("grace_in_min"), 0, 240, default_cfg.get("grace_in_min", 10))
    _ATT_GRACE_OUT = _clamp_int(cfg.get("grace_out_min"), 0, 240, default_cfg.get("grace_out_min", 5))

    cfg["grace_in_min"] = _ATT_GRACE_IN
    cfg["grace_out_min"] = _ATT_GRACE_OUT

    overrides = [_normalize_override_entry(entry) for entry in (cfg.get("overrides") or [])]
    ATT_OVERRIDES = overrides
    cfg["overrides"] = overrides

    ATT_CONFIG = cfg
    return cfg


def _fetch_attendance_events(limit: int = MAX_ATT_EVENTS) -> List[Dict[str, Any]]:
    client = get_client()
    org_id = get_default_org_id()
    # Optimize query with better indexing and pagination
    query = client.table("attendance_events").select(
        "id, label, person_id, score, ts"
    ).eq("org_id", org_id).order("ts", desc=True)
    if limit:
        query = query.limit(limit)
    try:
        res = query.execute()
        return getattr(res, "data", []) or []
    except Exception as e:
        print(f"[ERROR] Failed to fetch attendance events: {e}")
        return []


def _fetch_attendance_events_by_range(
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: Optional[int] = None
) -> List[Dict[str, Any]]:
    """
    Fetch attendance events from database filtered by date range.
    This is used when we need all events within a specific date range,
    not just the latest N events.
    Uses pagination to fetch all data when no limit is specified.
    """
    client = get_client()
    org_id = get_default_org_id()
    
    all_events: List[Dict[str, Any]] = []
    page_size = 1000  # Process in batches to avoid memory issues
    offset = 0
    
    while True:
        query = client.table("attendance_events").select(
            "id, label, person_id, score, ts"
        ).eq("org_id", org_id)
        
        # Apply date range filters
        if start:
            try:
                # Start of day in WIB timezone
                start_dt = datetime.strptime(start, "%Y-%m-%d").replace(tzinfo=WIB_TZ)
                start_iso = start_dt.isoformat()
                query = query.gte("ts", start_iso)
            except Exception:
                pass
        
        if end:
            try:
                # End of day in WIB timezone
                end_dt = datetime.strptime(end, "%Y-%m-%d").replace(tzinfo=WIB_TZ)
                # Add 1 day and subtract 1 second to get end of day
                end_dt = end_dt + timedelta(days=1) - timedelta(seconds=1)
                end_iso = end_dt.isoformat()
                query = query.lte("ts", end_iso)
            except Exception:
                pass
        
        query = query.order("ts", desc=True)
        
        # Apply pagination
        if limit:
            # If limit is specified, use it and break after first batch
            query = query.limit(limit)
            try:
                res = query.execute()
                batch = getattr(res, "data", []) or []
                all_events.extend(batch)
                break
            except Exception as e:
                print(f"[ERROR] Failed to fetch attendance events by range: {e}")
                break
        else:
            # No limit: fetch all data using pagination
            query = query.range(offset, offset + page_size - 1)
            try:
                res = query.execute()
                batch = getattr(res, "data", []) or []
                if not batch:
                    # No more data
                    break
                all_events.extend(batch)
                if len(batch) < page_size:
                    # Last page
                    break
                offset += page_size
            except Exception as e:
                print(f"[ERROR] Failed to fetch attendance events by range (offset {offset}): {e}")
                break
    
    return all_events


def _get_attendance_cache() -> Optional[Dict[str, Any]]:
    with _LOCK:
        if _ATT_DB_CACHE:
            return copy.deepcopy(_ATT_DB_CACHE)
    return None


def _set_attendance_cache(db: Dict[str, Any]) -> None:
    global _ATT_DB_CACHE, _ATT_DB_CACHE_TS
    with _LOCK:
        _ATT_DB_CACHE = copy.deepcopy(db)
        _ATT_DB_CACHE_TS = time.time()


def invalidate_attendance_cache() -> None:
    global _ATT_DB_CACHE, _ATT_DB_CACHE_TS
    with _LOCK:
        _ATT_DB_CACHE = {}
        _ATT_DB_CACHE_TS = 0.0


def load_attendance_db(force: bool = False) -> Dict[str, Any]:
    if not force:
        cached = _get_attendance_cache()
        if cached is not None:
            return cached

    rows = _fetch_attendance_events(MAX_ATT_EVENTS)
    events: List[Dict[str, Any]] = []
    att_last: Dict[str, float] = {}
    att_last_id: Dict[str, float] = {}
    att_count: Dict[str, int] = {}
    att_count_id: Dict[str, int] = {}
    max_seq = 0

    for row in rows:
        try:
            eid = int(row.get("id") or 0)
        except Exception:
            eid = 0
        label = str(row.get("label") or "").strip()
        person_id = str(row.get("person_id") or "").strip() or None
        ts_text = str(row.get("ts") or "").strip()
        score = float(row.get("score") or 0.0)

        event = {
            "id": eid,
            "label": label,
            "score": round(score, 3),
            "ts": ts_text,
        }
        if person_id:
            event["person_id"] = person_id
        events.append(event)
        max_seq = max(max_seq, eid)

        dt = _parse_att_ts(ts_text)
        if dt is None:
            try:
                dt = datetime.strptime(ts_text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=WIB_TZ)
            except Exception:
                dt = None
        if dt:
            ts_epoch = dt.timestamp()
            if label:
                att_last[label] = max(att_last.get(label, 0.0), ts_epoch)
                att_count[label] = att_count.get(label, 0) + 1
            if person_id:
                att_last_id[person_id] = max(att_last_id.get(person_id, 0.0), ts_epoch)
                att_count_id[person_id] = att_count_id.get(person_id, 0) + 1

    db = {
        "att_events": events,
        "att_last": att_last,
        "att_last_id": att_last_id,
        "att_count": att_count,
        "att_count_id": att_count_id,
        "att_event_seq": max_seq,
    }
    _set_attendance_cache(db)
    return copy.deepcopy(db)


def save_attendance_db(db: Dict[str, Any]) -> None:
    client = get_client()
    org_id = get_default_org_id()
    desired_events = []
    for ev in (db.get("att_events") or [])[:MAX_ATT_EVENTS]:
        try:
            eid = int(ev.get("id") or 0)
        except Exception:
            continue
        if eid <= 0:
            continue
        label = str(ev.get("label") or "").strip()
        ts_text = str(ev.get("ts") or "").strip() or _now_iso()
        try:
            score = round(float(ev.get("score") or 0.0), 3)
        except Exception:
            score = 0.0
        payload = {
            "id": eid,
            "org_id": org_id,
            "label": label,
            "person_id": (ev.get("person_id") or None),
            "score": score,
            "ts": ts_text,
        }
        desired_events.append(payload)

    desired_ids = {item["id"] for item in desired_events}

    existing_rows = _fetch_attendance_events(MAX_ATT_EVENTS)
    existing = { int(row["id"]): row for row in existing_rows if row.get("id") is not None }

    # Batch delete operations
    ids_to_delete = [eid for eid in existing if eid not in desired_ids]
    if ids_to_delete:
        # Process deletions in batches of 100
        for i in range(0, len(ids_to_delete), 100):
            batch = ids_to_delete[i:i+100]
            try:
                client.table("attendance_events").delete().eq("org_id", org_id).in_("id", batch).execute()
            except Exception as e:
                print(f"[ERROR] Failed to delete batch {i//100 + 1}: {e}")

    # Batch insert/update operations
    events_to_insert = []
    events_to_update = []
    
    for event in desired_events:
        eid = event["id"]
        base_update = {
            "label": event["label"],
            "person_id": event.get("person_id"),
            "score": event["score"],
            "ts": event["ts"],
        }
        if eid in existing:
            row = existing[eid]
            if (
                row.get("label") != base_update["label"]
                or (row.get("person_id") or None) != base_update["person_id"]
                or float(row.get("score") or 0.0) != base_update["score"]
                or str(row.get("ts") or "").strip() != base_update["ts"]
            ):
                events_to_update.append({
                    **base_update,
                    "id": eid,
                    "org_id": org_id, 
                })
        else:
            events_to_insert.append(event)

    # Batch insert new events
    if events_to_insert:
        try:
            client.table("attendance_events").insert(events_to_insert).execute()
        except Exception as e:
            print(f"[ERROR] Failed to batch insert events: {e}")

    # Batch update existing events
    if events_to_update:
        try:
            client.table("attendance_events").upsert(events_to_update).execute()
        except Exception as e:
            print(f"[ERROR] Failed to batch update events: {e}")

    _set_attendance_cache(db)


def _schedule_attendance_persist(db: Dict[str, Any]) -> None:
    snapshot = copy.deepcopy(db)
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        save_attendance_db(snapshot)
        return
    future = loop.run_in_executor(None, save_attendance_db, snapshot)
    future.add_done_callback(lambda _fut: None)


def _label_to_person_id(label: Optional[str]) -> Optional[str]:
    pid = _resolve_person_id(label)
    if pid:
        return pid
    if not label:
        return None
    lab = str(label).strip()
    if not lab:
        return None
    client = get_client()
    org_id = get_default_org_id()
    res = client.table("persons").select("person_id, label").eq("org_id", org_id).eq("label", lab).limit(1).execute()
    rows = getattr(res, "data", []) or []
    if rows and rows[0].get("person_id"):
        return str(rows[0]["person_id"])
    return None


def _person_id_to_label(person_id: Optional[str]) -> Optional[str]:
    if not person_id:
        return None
    pid = str(person_id).strip()
    if not pid:
        return None
    resolved = _resolve_label(pid)
    if resolved:
        return resolved
    now = time.time()
    cached = _PERSON_LABEL_CACHE.get(pid)
    ts = _PERSON_LABEL_CACHE_TS.get(pid, 0.0)
    if cached is not None and (now - ts) < _PERSON_LABEL_CACHE_TTL:
        return cached or None
    client = get_client()
    org_id = get_default_org_id()
    res = client.table("persons").select("label").eq("org_id", org_id).eq("person_id", pid).limit(1).execute()
    rows = getattr(res, "data", []) or []
    label = str(rows[0].get("label") or "").strip() if rows else ""
    _PERSON_LABEL_CACHE[pid] = label
    _PERSON_LABEL_CACHE_TS[pid] = now
    return label or None


def _chunked(values: Iterable[str], size: int) -> List[List[str]]:
    chunk: List[str] = []
    out: List[List[str]] = []
    for item in values:
        chunk.append(item)
        if len(chunk) >= size:
            out.append(chunk)
            chunk = []
    if chunk:
        out.append(chunk)
    return out


def _get_group_context(force_refresh: bool = False) -> Tuple[Dict[str, Set[str]], Dict[str, Dict[str, str]]]:
    global _GROUP_MEMBERS_CACHE, _GROUP_MEMBERS_CACHE_TS, _GROUP_META_CACHE
    now_ts = time.time()
    if not force_refresh and _GROUP_MEMBERS_CACHE and (now_ts - _GROUP_MEMBERS_CACHE_TS) < _GROUP_MEMBERS_CACHE_TTL:
        return _GROUP_MEMBERS_CACHE, _GROUP_META_CACHE

    client = get_client()
    org_id = get_default_org_id()
    res = client.table("groups").select("id, name, slug").eq("org_id", org_id).execute()
    groups = getattr(res, "data", []) or []
    meta: Dict[str, Dict[str, str]] = {}
    for g in groups:
        gid = str(g.get("id") or "").strip()
        if not gid:
            continue
        label = str(g.get("slug") or "").strip()
        meta[gid] = {
            "id": gid,
            "name": str(g.get("name") or "") or label,
            "label": label,
        }

    members: Dict[str, Set[str]] = {}
    if meta:
        group_ids = list(meta.keys())
        for chunk in _chunked(group_ids, 50):
            res_members = client.table("group_members").select("group_id, person_id").eq("org_id", org_id).in_("group_id", chunk).execute()
            rows = getattr(res_members, "data", []) or []
            for row in rows:
                gid = str(row.get("group_id") or "").strip()
                pid = str(row.get("person_id") or "").strip()
                if not gid or not pid:
                    continue
                members.setdefault(gid, set()).add(pid)

    _GROUP_MEMBERS_CACHE = members
    _GROUP_META_CACHE = meta
    _GROUP_MEMBERS_CACHE_TS = now_ts
    return members, meta


def _check_mark_block(label: str) -> Tuple[bool, str, Dict[str, Any]]:
    db = load_attendance_db()
    pid = _label_to_person_id(label)
    wib = WIB_TZ

    last_ts = 0.0
    if pid:
        try:
            last_ts = float(db.get("att_last_id", {}).get(pid, 0.0) or 0.0)
        except Exception:
            last_ts = 0.0
    else:
        last_ts = float(db.get("att_last", {}).get(label, 0.0) or 0.0)

    now_ts = time.time()
    info_base = {
        "label": label,
        "person_id": pid,
        "last_ts": last_ts or None,
        "last_iso": datetime.fromtimestamp(last_ts, wib).strftime("%Y-%m-%d %H:%M:%S") if last_ts else None,
    }

    if not last_ts:
        return True, "ok", info_base

    elapsed = now_ts - last_ts
    if elapsed < 0:
        # Allow immediate re-mark if stored timestamp is ahead of current clock.
        elapsed = float(_COOLDOWN_SEC)
    remaining = int(_COOLDOWN_SEC - elapsed)
    if remaining > 0:
        until = datetime.fromtimestamp(last_ts + _COOLDOWN_SEC, wib)
        info = {
            **info_base,
            "until_ts": until.timestamp(),
            "until_iso": until.strftime("%Y-%m-%d %H:%M:%S"),
            "cooldown_sec": _COOLDOWN_SEC,
            "remaining_sec": remaining,
            "message": f"Cooldown {remaining}s ({_humanize_secs(remaining)})",
        }
        return False, "cooldown", info

    return True, "ok", info_base


def mark_attendance(label: str, score: float) -> bool:
    db = load_attendance_db()
    ts = time.time()
    now = datetime.now(WIB_TZ)
    pid = _label_to_person_id(label)

    last_ts = 0.0
    if pid:
        try:
            last_ts = float(db.get("att_last_id", {}).get(pid, 0.0) or 0.0)
        except Exception:
            last_ts = 0.0
    else:
        last_ts = float(db.get("att_last", {}).get(label, 0.0) or 0.0)
    last_dt = datetime.fromtimestamp(last_ts, WIB_TZ) if last_ts else None

    if last_ts:
        elapsed = ts - last_ts
        if elapsed < 0:
            # Allow mark if stored timestamp is ahead (clock skew).
            elapsed = float(_COOLDOWN_SEC)
        if elapsed < _COOLDOWN_SEC:
            return False

    db.setdefault("att_last", {})[label] = ts
    if pid:
        db.setdefault("att_last_id", {})[pid] = ts

    seq = int(db.get("att_event_seq", 0) or 0) + 1
    db["att_event_seq"] = seq
    event = {"id": seq, "label": label, "score": round(float(score), 3), "ts": _now_iso()}
    if pid:
        event["person_id"] = pid
    db["att_events"].insert(0, event)
    if len(db["att_events"]) > MAX_ATT_EVENTS:
        db["att_events"] = db["att_events"][:MAX_ATT_EVENTS]
    db.setdefault("att_count", {})[label] = db.get("att_count", {}).get(label, 0) + 1
    if pid:
        db.setdefault("att_count_id", {})[pid] = db.get("att_count_id", {}).get(pid, 0) + 1
    _set_attendance_cache(db)
    _schedule_attendance_persist(db)
    return True


def _normalize_override_targets(raw_targets: Any) -> Optional[List[Dict[str, str]]]:
    if not raw_targets:
        return []
    normalized: List[Dict[str, str]] = []

    def _infer_type(value: str, hinted: Optional[str]) -> str:
        if hinted in {"person", "person_id"}:
            return "person"
        if hinted in {"group", "group_id"}:
            return "group"
        if hinted in {"label", "name"}:
            return "label"
        if _OVERRIDE_ID_RE and _OVERRIDE_ID_RE.match(value):
            return "person"
        if _UUID_RE and _UUID_RE.match(value):
            return "group"
        return "label"

    def _extract(obj: Any) -> Optional[Dict[str, str]]:
        if obj is None:
            return None
        if isinstance(obj, dict):
            hinted = str(obj.get("type") or obj.get("target_type") or "").strip().lower()
            value_sources = (
                "value",
                "person_id" if hinted in {"person", "person_id"} else None,
                "group_id" if hinted in {"group", "group_id"} else None,
                "target_value",
                "label",
            )
            val = ""
            for key in value_sources:
                if not key:
                    continue
                candidate = obj.get(key)
                if candidate not in (None, ""):
                    val = str(candidate).strip()
                    if val:
                        break
            if not val:
                return None
            label_text = str(obj.get("label") or obj.get("name") or obj.get("display") or "").strip()
            inferred_type = _infer_type(val, hinted)
            result = {"type": inferred_type, "value": val}
            if inferred_type == "person" and not label_text:
                label_text = _person_id_to_label(val) or ""
            if label_text:
                result["label"] = label_text
            return result
        if isinstance(obj, str):
            val = obj.strip()
            if not val:
                return None
            return {
                "type": _infer_type(val, None),
                "value": val,
                "label": val,
            }
        try:
            val = str(obj).strip()
        except Exception:
            return None
        if not val:
            return None
        return {
            "type": _infer_type(val, None),
            "value": val,
            "label": val,
        }

    for item in raw_targets:
        data = _extract(item)
        if not data:
            continue
        key = (data["type"], data["value"])
        if any(existing["type"] == key[0] and existing["value"] == key[1] for existing in normalized):
            continue
        normalized.append(data)
        if len(normalized) >= 64:
            break
    return normalized


def _normalize_override_entry(entry: Any) -> Dict[str, Any]:
    ov = dict(entry or {})
    start = str(ov.get("start_date") or ov.get("startDate") or "").strip()
    end = str(ov.get("end_date") or ov.get("endDate") or start or "").strip()
    if end and start and end < start:
        start, end = end, start
    ov["start_date"] = start
    ov["end_date"] = end or start
    ov["label"] = str(ov.get("label") or "").strip() or "Jadwal Khusus"
    ov["enabled"] = bool(ov.get("enabled", True))
    if ov["enabled"]:
        ov["check_in"] = str(ov.get("check_in") or "").strip()
        ov["check_out"] = str(ov.get("check_out") or "").strip()
        ov["grace_in_min"] = _clamp_int(ov.get("grace_in_min"), 0, 240, _ATT_GRACE_IN)
        ov["grace_out_min"] = _clamp_int(ov.get("grace_out_min"), 0, 240, _ATT_GRACE_OUT)
    else:
        ov["check_in"] = ""
        ov["check_out"] = ""
        ov["grace_in_min"] = 0
        ov["grace_out_min"] = 0
    ov["notes"] = str(ov.get("notes") or "").strip()
    targets = _normalize_override_targets(ov.get("targets") or ov.get("target_list") or [])
    ov["targets"] = targets if targets else []
    return ov


def _override_matches_label(ov: Dict[str, Any], label: str, *, person_id: Optional[str] = None) -> bool:
    targets = ov.get("targets") or []
    if not targets:
        return True
    pid = (person_id or "").strip()
    if not pid:
        pid = _label_to_person_id(label) or ""
    group_members, group_meta = _get_group_context()
    for target in targets:
        ttype = str(target.get("type") or "").lower()
        value = str(target.get("value") or "").strip()
        if not value:
            continue
        target_label = str(target.get("label") or "").strip()
        if ttype in {"person", "person_id"}:
            if pid:
                if value == pid:
                    return True
                # When a person_id is known, do not fall back to label matching.
                continue
            if value.lower() == label.lower():
                return True
            if not target_label:
                target_label = _person_id_to_label(value) or ""
            if target_label and target_label.lower() == label.lower():
                return True
        if ttype in {"label"}:
            if value.lower() == label.lower():
                return True
            if target_label and target_label.lower() == label.lower():
                return True
        if ttype in {"group", "group_id"}:
            candidates = []
            if value in group_members:
                candidates.append(value)
            for gid, info in group_meta.items():
                label_low = str(info.get("label") or "").strip().lower()
                name_low = str(info.get("name") or "").strip().lower()
                if value.lower() in {label_low, name_low}:
                    candidates.append(gid)
            for gid in candidates:
                members = group_members.get(gid)
                if members and pid and pid in members:
                    return True
            if target_label:
                target_label_low = target_label.lower()
                for gid, info in group_meta.items():
                    label_low = str(info.get("label") or "").strip().lower()
                    name_low = str(info.get("name") or "").strip().lower()
                    if target_label_low in {label_low, name_low}:
                        members = group_members.get(gid)
                        if members and pid and pid in members:
                            return True
    return False


def _find_schedule_for_day(dt: datetime, *, label: str, person_id: Optional[str], overrides: List[Dict[str, Any]]) -> Dict[str, Any]:
    matches = []
    for ov in overrides or []:
        start = ov.get("start_date")
        end = ov.get("end_date") or start
        try:
            if start and dt.date() < datetime.strptime(start, "%Y-%m-%d").date():
                continue
            if end and dt.date() > datetime.strptime(end, "%Y-%m-%d").date():
                continue
        except Exception:
            continue
        if not _override_matches_label(ov, label, person_id=person_id):
            continue
        matches.append(ov)

    if matches:
        best_override = matches[-1]
        enabled = bool(best_override.get("enabled", True))
        return {
            "label": best_override.get("label") or "Jadwal Khusus",
            "enabled": enabled,
            "check_in": best_override.get("check_in") or "",
            "check_out": best_override.get("check_out") or "",
            "grace_in_min": _clamp_int(best_override.get("grace_in_min"), 0, 240, _ATT_GRACE_IN if enabled else 0),
            "grace_out_min": _clamp_int(best_override.get("grace_out_min"), 0, 240, _ATT_GRACE_OUT if enabled else 0),
            "notes": best_override.get("notes") or "",
            "source": "override",
            "override": best_override,
        }

    attendance_cfg = ATT_CONFIG or {}
    schedule = attendance_cfg.get("weekly") or attendance_cfg.get("rules") or []
    weekday = dt.weekday()
    if isinstance(schedule, list) and schedule:
        day_entry = None
        day_name = ID_DAYS[weekday]
        if weekday < len(schedule):
            candidate = schedule[weekday]
            day_field = str((candidate or {}).get("day", "")).strip().lower()
            if day_field and day_field.lower() == day_name.lower():
                day_entry = candidate
        if not day_entry:
            for candidate in schedule:
                try:
                    if str((candidate or {}).get("day", "")).strip().lower() == day_name.lower():
                        day_entry = candidate
                        break
                except Exception:
                    continue
        if day_entry:
            day_cfg = day_entry or {}
            enabled = bool(day_cfg.get("enabled", True))
            return {
                "label": str(day_cfg.get("label") or day_cfg.get("name") or "Jam Kerja Normal").strip() or "Jam Kerja Normal",
                "enabled": enabled,
                "check_in": day_cfg.get("check_in") or "",
                "check_out": day_cfg.get("check_out") or "",
                "grace_in_min": _clamp_int(day_cfg.get("grace_in_min"), 0, 240, _ATT_GRACE_IN if enabled else 0),
                "grace_out_min": _clamp_int(day_cfg.get("grace_out_min"), 0, 240, _ATT_GRACE_OUT if enabled else 0),
                "notes": day_cfg.get("notes") or "",
                "source": "weekly",
                "override": None,
                "day": day_cfg.get("name") or day_cfg.get("day") or "",
            }

    enabled = bool(attendance_cfg.get("enabled", True))
    return {
        "label": attendance_cfg.get("label") or "Jam Kerja Normal",
        "enabled": enabled,
        "check_in": attendance_cfg.get("check_in") or "",
        "check_out": attendance_cfg.get("check_out") or "",
        "grace_in_min": _ATT_GRACE_IN if enabled else 0,
        "grace_out_min": _ATT_GRACE_OUT if enabled else 0,
        "notes": attendance_cfg.get("notes") or "",
        "source": "default",
        "override": None,
    }


def build_daily_rows(q: Optional[str], start: Optional[str], end: Optional[str], order: Literal["asc", "desc"]) -> List[Dict[str, Any]]:
    # Always fetch directly from database to avoid cache limit (5000 events max)
    # This ensures we get all data in the specified date range, not just the latest N from cache
    rows = _fetch_attendance_events_by_range(start=start, end=end)
    events: List[Dict[str, Any]] = []
    for row in rows:
        events.append({
            "id": row.get("id"),
            "label": row.get("label"),
            "person_id": row.get("person_id"),
            "score": row.get("score"),
            "ts": row.get("ts"),
        })
    
    qnorm = (q or "").strip().lower()
    current_cfg = attendance_schedule_snapshot()
    current_overrides = current_cfg.get("overrides") or []

    start_dt = None
    end_dt = None
    try:
        if start:
            start_dt = datetime.strptime(start, "%Y-%m-%d").replace(tzinfo=WIB_TZ)
        if end:
            end_dt = datetime.strptime(end, "%Y-%m-%d").replace(tzinfo=WIB_TZ)
    except Exception:
        start_dt = start_dt
        end_dt = end_dt

    agg: Dict[tuple, dict] = {}
    for ev in events:
        try:
            label = str(ev.get("label", "")).strip()
            if not label:
                continue
            if qnorm and qnorm not in label.lower():
                continue
            dt = _parse_att_ts(str(ev.get("ts", "")))
            if dt is None:
                continue
            if start_dt and dt.date() < (start_dt.date()):
                continue
            if end_dt and dt.date() > (end_dt.date()):
                continue
            date_key = dt.strftime("%Y-%m-%d")
            raw_pid = str(ev.get("person_id") or "").strip()
            pid = raw_pid or _label_to_person_id(label) or ""
            identity_key = pid or f"label::{label.lower()}"
            k = (identity_key, date_key)
            item = agg.get(k)
            if not item:
                item = {
                    "label": label,
                    "date": date_key,
                    "first": dt,
                    "last": dt,
                    "count": 1,
                    "person_id": pid,
                }
                agg[k] = item
            else:
                item["count"] = int(item.get("count", 0) or 0) + 1
                if dt < item["first"]:
                    item["first"] = dt
                if dt > item["last"]:
                    item["last"] = dt
                if not item.get("person_id") and pid:
                    item["person_id"] = pid
        except Exception:
            continue

    rows = list(agg.values())
    rows.sort(key=lambda r: (r["last"], r.get("label", "")), reverse=(order == "desc"))

    out_items: List[Dict[str, Any]] = []
    for it in rows:
        first: datetime = it["first"]
        last: datetime = it["last"]
        pid = str(it.get("person_id") or "").strip()
        if not pid:
            pid = _label_to_person_id(it.get("label")) or ""
        pid_for_match = pid or None
        sched = _find_schedule_for_day(first, label=str(it.get("label")), person_id=pid_for_match, overrides=current_overrides)

        check_in_txt = first.strftime("%H:%M")
        check_out_txt = last.strftime("%H:%M")

        status_tags: List[str] = []
        status_code = "present"
        schedule_label = sched.get("label") or "Jam Kerja Normal"
        schedule_enabled = bool(sched.get("enabled", True))

        late = False
        left_early = False
        late_minutes = 0
        left_early_minutes = 0
        try:
            if schedule_enabled and sched.get("check_in"):
                hh, mm = str(sched["check_in"]).split(":", 1)
                gate = first.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
                grace_in = _clamp_int(sched.get("grace_in_min"), 0, 240, default=0)
                if grace_in:
                    gate = gate + timedelta(minutes=grace_in)
                if first > gate:
                    late = True
                    late_minutes = max(0, int((first - gate).total_seconds() // 60))
            if schedule_enabled and sched.get("check_out"):
                hh, mm = str(sched["check_out"]).split(":", 1)
                gate_out = first.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
                grace_out = _clamp_int(sched.get("grace_out_min"), 0, 240, default=0)
                if grace_out:
                    gate_out = gate_out - timedelta(minutes=grace_out)
                if last < gate_out:
                    left_early = True
                    left_early_minutes = max(0, int((gate_out - last).total_seconds() // 60))
        except Exception:
            late_minutes = max(late_minutes, 0)
            left_early_minutes = max(left_early_minutes, 0)

        if not schedule_enabled:
            status_code = "off"
            status_tags.append("Off Day")
            if int(it.get("count", 0)) > 0:
                status_tags.append("Present")
        else:
            if late and left_early:
                status_code = "late_and_left_early"
                status_tags.extend(["Late", "Left Early"])
            elif late:
                status_code = "late"
                status_tags.append("Late")
            elif left_early:
                status_code = "left_early"
                status_tags.append("Left Early")
            else:
                status_code = "present"
                status_tags.append("Present")

        if not status_tags:
            status_tags.append("Present")
            status_code = status_code or "present"

        status_text = " & ".join(status_tags) if len(status_tags) > 1 else status_tags[0]

        work_minutes = max(0, int((last - first).total_seconds() // 60))

        out_items.append({
            "label": it["label"],
            "person_id": pid_for_match,
            "date": it["date"],
            "check_in": check_in_txt,
            "check_out": check_out_txt,
            "schedule": schedule_label,
            "schedule_source": sched.get("source", "default"),
            "schedule_override": sched.get("override"),
            "schedule_detail": {
                "day": sched.get("day"),
                "label": schedule_label,
                "enabled": schedule_enabled,
                "check_in": sched.get("check_in"),
                "check_out": sched.get("check_out"),
                "grace_in_min": _clamp_int(sched.get("grace_in_min"), 0, 240, default=0),
                "grace_out_min": _clamp_int(sched.get("grace_out_min"), 0, 240, default=0),
                "notes": sched.get("notes") or "",
                "source": sched.get("source", "default"),
                "override": sched.get("override"),
            },
            "status": status_text,
            "status_code": status_code,
            "status_tags": status_tags,
            "events": int(it.get("count", 0)),
            "late_minutes": late_minutes,
            "left_early_minutes": left_early_minutes,
            "work_minutes": work_minutes,
        })
    return out_items


def attendance_schedule_snapshot(config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    source = config or ATT_CONFIG or {}
    attendance_cfg = copy.deepcopy(source)
    attendance_cfg["grace_in_min"] = _clamp_int(attendance_cfg.get("grace_in_min"), 0, 240, default=_ATT_GRACE_IN)
    attendance_cfg["grace_out_min"] = _clamp_int(attendance_cfg.get("grace_out_min"), 0, 240, default=_ATT_GRACE_OUT)
    overrides = [_normalize_override_entry(ov) for ov in (attendance_cfg.get("overrides") or [])]
    attendance_cfg["overrides"] = overrides
    return {
        **attendance_cfg,
        "overrides": overrides,
        "grace_in_min": attendance_cfg["grace_in_min"],
        "grace_out_min": attendance_cfg["grace_out_min"],
    }


def attendance_summary(start: Optional[str]=None, end: Optional[str]=None, *, group_by: Literal["month","week","day"]="month") -> Dict[str, Any]:
    today = datetime.now(WIB_TZ).date()
    no_range = start is None and end is None

    if end:
        try:
            end_date = datetime.strptime(end, "%Y-%m-%d").date()
        except Exception:
            end_date = today
    else:
        end_date = today

    if start:
        try:
            start_date = datetime.strptime(start, "%Y-%m-%d").date()
        except Exception:
            start_date = end_date - timedelta(days=29)
    else:
        start_date = end_date - timedelta(days=29)

    # kalau user nggak kasih rentang, jangan batasi
    start_str = None if no_range else start_date.strftime("%Y-%m-%d")
    end_str   = None if no_range else end_date.strftime("%Y-%m-%d")

    rows = build_daily_rows(None, start_str, end_str, "asc")

    # supaya "range" di response tetap akurat
    if no_range:
        dates = [
            datetime.strptime(str(r["date"]), "%Y-%m-%d").date()
            for r in rows if r.get("date")
        ]
        if dates:
            start_str = min(dates).strftime("%Y-%m-%d")
            end_str   = max(dates).strftime("%Y-%m-%d")
        else:
            start_str = end_str = today.strftime("%Y-%m-%d")

    status_counts: Counter[str] = Counter()
    totals: Dict[str, int] = Counter()
    totals.update({
        "total_days": 0,
        "active_days": 0,
        "present_days": 0,
        "late_days": 0,
        "left_early_days": 0,
        "off_days": 0,
        "total_events": 0,
        "late_minutes": 0,
        "left_early_minutes": 0,
    })

    monthly = defaultdict(lambda: Counter())
    weekly = defaultdict(lambda: Counter())
    persons: Dict[str, Dict[str, Any]] = {}
    unique_people: Set[str] = set()

    def _bucket_key(date_text: str, mode: str) -> str:
        try:
            dt = datetime.strptime(date_text, "%Y-%m-%d")
        except Exception:
            return date_text
        if mode == "week":
            year, week, _ = dt.isocalendar()
            return f"{year}-W{week:02d}"
        if mode == "day":
            return dt.strftime("%Y-%m-%d")
        return dt.strftime("%Y-%m")

    for row in rows:
        status = (row.get("status_code") or "present").lower()
        status_counts[status] += 1
        totals["total_days"] += 1
        totals["total_events"] += int(row.get("events") or 0)

        person_key = row.get("person_id") or f"label::{row.get('label', '').strip()}"
        unique_people.add(person_key)

        is_present_status = status in {"present", "late", "late_and_left_early", "left_early"}
        if is_present_status:
            totals["active_days"] += 1
            totals["present_days"] += 1
        if status in {"late", "late_and_left_early"}:
            totals["late_days"] += 1
            totals["late_minutes"] += int(row.get("late_minutes") or 0)
        if status in {"left_early", "late_and_left_early"}:
            totals["left_early_days"] += 1
            totals["left_early_minutes"] += int(row.get("left_early_minutes") or 0)
        if status == "off":
            totals["off_days"] += 1

        month_key = _bucket_key(str(row.get("date")), "month")
        monthly_entry = monthly[month_key]
        monthly_entry[status] += 1
        if is_present_status:
            monthly_entry["present_days"] += 1
        if status in {"late", "late_and_left_early"}:
            monthly_entry["late_days"] += 1
            monthly_entry["late_minutes"] += int(row.get("late_minutes") or 0)
        if status in {"left_early", "late_and_left_early"}:
            monthly_entry["left_early_days"] += 1

        week_key = _bucket_key(str(row.get("date")), "week")
        weekly_entry = weekly[week_key]
        weekly_entry[status] += 1
        if is_present_status:
            weekly_entry["present_days"] += 1

        person_entry = persons.setdefault(person_key, {
            "person_id": row.get("person_id"),
            "label": row.get("label"),
            "present_days": 0,
            "late_days": 0,
            "late_minutes": 0,
            "left_early_days": 0,
            "left_early_minutes": 0,
            "off_days": 0,
            "total_events": 0,
        })
        if is_present_status:
            person_entry["present_days"] += 1
        if status in {"late", "late_and_left_early"}:
            person_entry["late_days"] += 1
            person_entry["late_minutes"] += int(row.get("late_minutes") or 0)
        if status in {"left_early", "late_and_left_early"}:
            person_entry["left_early_days"] += 1
            person_entry["left_early_minutes"] += int(row.get("left_early_minutes") or 0)
        if status == "off":
            person_entry["off_days"] += 1
        person_entry["total_events"] += int(row.get("events") or 0)

    totals["unique_people"] = len(unique_people)

    status_labels = {
        "present": "Present",
        "late": "Late",
        "left_early": "Left Early",
        "late_and_left_early": "Late & Left Early",
        "off": "Off Day",
    }

    status_summary = [
        {
            "code": code,
            "label": status_labels.get(code, code.title()),
            "count": count,
        }
        for code, count in status_counts.most_common()
    ]

    monthly_summary = [
        {
            "period": month,
            "present_days": entry.get("present_days", 0),
            "late_days": entry.get("late_days", 0),
            "late_minutes": entry.get("late_minutes", 0),
            "left_early_days": entry.get("left_early_days", 0),
            "off_days": entry.get("off", 0),
            "raw": dict(entry),
        }
        for month, entry in sorted(monthly.items())
    ]

    weekly_summary = [
        {
            "period": week,
            "present_days": entry.get("present_days", 0),
            "late_days": entry.get("late", 0) + entry.get("late_and_left_early", 0),
            "off_days": entry.get("off", 0),
            "raw": dict(entry),
        }
        for week, entry in sorted(weekly.items())
    ]

    person_list = list(persons.values())
    person_list.sort(key=lambda item: (item["late_minutes"], item["late_days"], item["present_days"]), reverse=True)

    leaders = {
        "mostLateMinutes": person_list[:10],
        "mostPresent": sorted(person_list, key=lambda item: item["present_days"], reverse=True)[:10],
        "mostLeftEarly": sorted(person_list, key=lambda item: item["left_early_days"], reverse=True)[:10],
    }

    return {
        "status": "ok",
        "range": {
            "start": start_str,
            "end": end_str,
        },
        "totals": dict(totals),
        "statuses": status_summary,
        "monthly": monthly_summary,
        "weekly": weekly_summary,
        "leaders": leaders,
    }

_mark_attendance = mark_attendance
_build_daily_rows = build_daily_rows

__all__ = [
    "ATT_OVERRIDES",
    "ATT_CONFIG",
    "MAX_ATT_EVENTS",
    "configure_attendance",
    "invalidate_attendance_cache",
    "load_attendance_db",
    "save_attendance_db",
    "mark_attendance",
    "build_daily_rows",
    "attendance_schedule_snapshot",
    "attendance_summary",
    "_normalize_override_entry",
    "_mark_attendance",
    "_build_daily_rows",
]