from __future__ import annotations

import copy
import os
import re
from functools import lru_cache
from typing import Any, Dict, Optional, List, Set, Tuple

from db.supabase_client import get_client, get_default_org_id


def _env_float(name: str, fallback: str) -> float:
    try:
        return float(os.getenv(name, fallback))
    except (TypeError, ValueError):
        return float(fallback)


def _env_int(name: str, fallback: str) -> int:
    try:
        return int(os.getenv(name, fallback))
    except (TypeError, ValueError):
        return int(float(fallback))


ID_DAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]


def _ensure_int(value: Any, default: int = 0, minimum: int = 0, maximum: int = 240) -> int:
    try:
        n = int(value)
    except Exception:
        n = default
    return max(minimum, min(maximum, n))


DEFAULT_ATT_GRACE_IN = _ensure_int(os.getenv("ATT_GRACE_IN_MIN"), default=10, minimum=0, maximum=240)
DEFAULT_ATT_GRACE_OUT = _ensure_int(os.getenv("ATT_GRACE_OUT_MIN"), default=5, minimum=0, maximum=240)

_TARGET_ID_RE = re.compile(r"^p-[a-z0-9]{4}-[a-z0-9]{3}-[a-z0-9]{3}$", re.IGNORECASE)
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _normalize_target_entry(raw: Any) -> Optional[Dict[str, str]]:
    if raw is None:
        return None
    if isinstance(raw, dict):
        hinted = str(raw.get("type") or raw.get("target_type") or "").strip().lower()
        if hinted in {"person", "person_id"}:
            source_keys = ("value", "person_id", "target_value", "label")
        elif hinted in {"group", "group_id"}:
            source_keys = ("value", "group_id", "target_value", "label")
        else:
            source_keys = ("value", "target_value", "label", "person_id", "group_id")
        value = ""
        for key in source_keys:
            candidate = raw.get(key)
            if candidate not in (None, ""):
                value = str(candidate).strip()
                if value:
                    break
        hinted = hinted.lower()
    else:
        value = str(raw).strip()
        hinted = ""
    target_type: Optional[str]
    if hinted in {"person", "person_id"}:
        target_type = "person"
    elif hinted in {"group", "group_id"}:
        target_type = "group"
    else:
        target_type = None
    if not value:
        return None
    if target_type == "person" or (
        target_type is None and (_TARGET_ID_RE.match(value) or hinted == "label")
    ):
        target_type = "person"
    elif target_type == "group" or (
        target_type is None and _UUID_RE.match(value)
    ):
        target_type = "group"
    else:
        target_type = "person"
    return {"type": target_type, "value": value}


def _normalize_targets(raw: Any) -> List[Dict[str, str]]:
    if not raw:
        return []
    normalized: List[Dict[str, str]] = []
    for item in (raw or []):
        entry = _normalize_target_entry(item)
        if not entry:
            continue
        if any(existing["type"] == entry["type"] and existing["value"] == entry["value"] for existing in normalized):
            continue
        normalized.append(entry)
        if len(normalized) >= 64:
            break
    return normalized


def _default_schedule_rule(day: str, grace_in: int = DEFAULT_ATT_GRACE_IN, grace_out: int = DEFAULT_ATT_GRACE_OUT) -> Dict[str, Any]:
    return {
        "day": day,
        "label": "Jam Kerja Normal" if day not in {"Sabtu", "Minggu"} else "Hari Libur",
        "enabled": day not in {"Sabtu", "Minggu"},
        "check_in": "08:30" if day not in {"Sabtu", "Minggu"} else None,
        "check_out": "17:00" if day not in {"Sabtu", "Minggu"} else None,
        "grace_in_min": _ensure_int(grace_in, default=DEFAULT_ATT_GRACE_IN, minimum=0, maximum=240),
        "grace_out_min": _ensure_int(grace_out, default=DEFAULT_ATT_GRACE_OUT, minimum=0, maximum=240),
        "notes": "",
    }


DEFAULT_CONFIG: Dict[str, Any] = {
    "face_engine": {
        "min_cosine_accept": _env_float("MIN_COSINE_ACCEPT", "0.6"),
        "fun_ws_min_interval": _env_float("FUN_WS_MIN_INTERVAL", "0.10"),
        "att_ws_min_interval": _env_float("ATT_WS_MIN_INTERVAL", "0.15"),
        "yunet_score_threshold": _env_float("YUNET_SCORE_THRESHOLD", "0.75"),
        "yunet_nms_threshold": _env_float("YUNET_NMS_THRESHOLD", "0.30"),
        "yunet_top_k": _env_int("YUNET_TOP_K", "5000"),
    },
    "attendance": {
        "cooldown_sec": _env_int("ATTEND_COOLDOWN", "4860"),
        "same_day_lock": (os.getenv("ATT_SAME_DAY_LOCK", "1") == "1"),
        "min_cosine_accept": _env_float("ATT_MIN_COSINE_ACCEPT", "0.6"),
        "double_mark_interval_sec": _env_int("ATT_DOUBLE_MARK_INTERVAL", "0"),
        "grace_in_min": DEFAULT_ATT_GRACE_IN,
        "grace_out_min": DEFAULT_ATT_GRACE_OUT,
        "rules": copy.deepcopy([_default_schedule_rule(day, DEFAULT_ATT_GRACE_IN, DEFAULT_ATT_GRACE_OUT) for day in ID_DAYS]),
        "overrides": [],
    },
}


def _deep_merge(a: Dict[str, Any], b: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(a)
    for k, v in (b or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _migrate_flat_cfg_to_nested(cfg: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(cfg, dict):
        return {"face_engine": {}, "attendance": {}}
    fe = dict(cfg.get("face_engine") or {})
    att = dict(cfg.get("attendance") or {})
    for k in (
        "min_cosine_accept",
        "fun_ws_min_interval",
        "att_ws_min_interval",
        "yunet_score_threshold",
        "yunet_nms_threshold",
        "yunet_top_k",
    ):
        if k in cfg and k not in fe:
            fe[k] = cfg[k]
    for k in ("cooldown_sec", "same_day_lock", "min_cosine_accept", "double_mark_interval_sec"):
        if k in cfg and k not in att:
            att[k] = cfg[k]
    return {"face_engine": fe, "attendance": att}


def merge_config_with_defaults(cfg: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    merged = _deep_merge(DEFAULT_CONFIG, cfg or {})
    att = dict(merged.get("attendance") or {})
    att["grace_in_min"] = _ensure_int(att.get("grace_in_min"), default=DEFAULT_CONFIG["attendance"]["grace_in_min"], minimum=0, maximum=240)
    att["grace_out_min"] = _ensure_int(att.get("grace_out_min"), default=DEFAULT_CONFIG["attendance"]["grace_out_min"], minimum=0, maximum=240)
    merged["attendance"] = att
    return merged


@lru_cache(maxsize=1)
def load_config_cached() -> Dict[str, Any]:
    """Load configuration with caching for better performance."""
    client = get_client()
    org_id = get_default_org_id()
    # Load main config row
    res = client.table("app_config_main").select("*").eq("org_id", org_id).limit(1).execute()
    row = (res.data[0] if getattr(res, "data", None) else None) or {}
    face = {
        "min_cosine_accept": float(row.get("fe_min_cosine_accept", DEFAULT_CONFIG["face_engine"]["min_cosine_accept"])),
        "fun_ws_min_interval": float(row.get("fe_fun_ws_min_interval", DEFAULT_CONFIG["face_engine"]["fun_ws_min_interval"])),
        "att_ws_min_interval": float(row.get("fe_att_ws_min_interval", DEFAULT_CONFIG["face_engine"]["att_ws_min_interval"])),
        "yunet_score_threshold": float(row.get("fe_yunet_score_threshold", DEFAULT_CONFIG["face_engine"]["yunet_score_threshold"])),
        "yunet_nms_threshold": float(row.get("fe_yunet_nms_threshold", DEFAULT_CONFIG["face_engine"]["yunet_nms_threshold"])),
        "yunet_top_k": int(row.get("fe_yunet_top_k", DEFAULT_CONFIG["face_engine"]["yunet_top_k"])),
    }
    att = {
        "cooldown_sec": int(row.get("att_cooldown_sec", DEFAULT_CONFIG["attendance"]["cooldown_sec"])),
        "same_day_lock": bool(row.get("att_same_day_lock", DEFAULT_CONFIG["attendance"]["same_day_lock"])),
        "min_cosine_accept": float(row.get("att_min_cosine_accept", DEFAULT_CONFIG["attendance"]["min_cosine_accept"])),
        "double_mark_interval_sec": int(row.get("att_double_mark_interval_sec", DEFAULT_CONFIG["attendance"]["double_mark_interval_sec"])),
        "grace_in_min": _ensure_int(row.get("att_grace_in_min"), default=DEFAULT_CONFIG["attendance"]["grace_in_min"], minimum=0, maximum=240),
        "grace_out_min": _ensure_int(row.get("att_grace_out_min"), default=DEFAULT_CONFIG["attendance"]["grace_out_min"], minimum=0, maximum=240),
    }
    # Load rules
    res_rules = client.table("attendance_rules").select("day,label,enabled,check_in,check_out,grace_in_min,grace_out_min,notes").eq("org_id", org_id).order("day").execute()
    rules = getattr(res_rules, "data", []) or []
    if not rules:
        rules = copy.deepcopy([_default_schedule_rule(day, att["grace_in_min"], att["grace_out_min"]) for day in ID_DAYS])
    att["rules"] = rules
    # Load overrides + targets
    persons_res = client.table("persons").select("person_id,label").eq("org_id", org_id).execute()
    persons_rows = getattr(persons_res, "data", []) or []
    persons_by_id = {str(row.get("person_id")): row.get("label") for row in persons_rows if row and row.get("person_id")}

    groups_res = client.table("groups").select("id,name,slug").eq("org_id", org_id).execute()
    groups_rows = getattr(groups_res, "data", []) or []
    groups_by_id = {
        str(row.get("id")): {"name": row.get("name"), "slug": row.get("slug")}
        for row in groups_rows
        if row and row.get("id")
    }

    res_ov = client.table("attendance_overrides").select("id,start_date,end_date,label,enabled,check_in,check_out,grace_in_min,grace_out_min,notes").eq("org_id", org_id).order("start_date").execute()
    overrides_raw = getattr(res_ov, "data", []) or []
    overrides = []
    for ov in overrides_raw:
        if ov is None:
            continue
        entry = dict(ov)
        rid = entry.get("id")
        t_res = client.table("attendance_override_targets").select("target_type,person_id,group_id").eq("override_id", rid).execute()
        raw_targets = getattr(t_res, "data", []) or []
        prepared_targets: List[Dict[str, Any]] = []
        for target in raw_targets:
            if not target:
                continue
            t_type = str(target.get("target_type") or "").strip().lower()
            if t_type == "person":
                pid = str(target.get("person_id") or "").strip()
                if not pid:
                    continue
                prepared_targets.append(
                    {
                        "type": "person",
                        "value": pid,
                        "label": persons_by_id.get(pid),
                    }
                )
            elif t_type == "group":
                gid = str(target.get("group_id") or "").strip()
                if not gid:
                    continue
                meta = groups_by_id.get(gid, {})
                prepared_targets.append(
                    {
                        "type": "group",
                        "value": gid,
                        "label": meta.get("name") or meta.get("slug"),
                    }
                )
        entry["targets"] = _normalize_targets(prepared_targets) or None
        overrides.append(entry)
    att["overrides"] = overrides
    return {"face_engine": face, "attendance": att}

def load_config() -> Dict[str, Any]:
    """Load configuration with caching."""
    return load_config_cached()

def invalidate_config_cache():
    """Invalidate the configuration cache."""
    load_config_cached.cache_clear()


def save_config(cfg: Dict[str, Any]) -> None:
    client = get_client()
    org_id = get_default_org_id()
    merged = merge_config_with_defaults(cfg)
    fe = merged.get("face_engine", {}) or {}
    att = merged.get("attendance", {}) or {}
    # Upsert main
    client.table("app_config_main").upsert({
        "org_id": org_id,
        "fe_min_cosine_accept": fe.get("min_cosine_accept"),
        "fe_fun_ws_min_interval": fe.get("fun_ws_min_interval"),
        "fe_att_ws_min_interval": fe.get("att_ws_min_interval"),
        "fe_yunet_score_threshold": fe.get("yunet_score_threshold"),
        "fe_yunet_nms_threshold": fe.get("yunet_nms_threshold"),
        "fe_yunet_top_k": fe.get("yunet_top_k") if fe.get("yunet_top_k") is not None else att.get("yunet_top_k", DEFAULT_CONFIG["face_engine"]["yunet_top_k"]) or DEFAULT_CONFIG["face_engine"]["yunet_top_k"],
        "att_cooldown_sec": att.get("cooldown_sec"),
        "att_same_day_lock": att.get("same_day_lock"),
        "att_min_cosine_accept": att.get("min_cosine_accept"),
        "att_double_mark_interval_sec": att.get("double_mark_interval_sec"),
        "att_grace_in_min": att.get("grace_in_min"),
        "att_grace_out_min": att.get("grace_out_min"),
    }, on_conflict="org_id").execute()
    # Rewrite rules
    rules = att.get("rules") or []
    client.table("attendance_rules").delete().eq("org_id", org_id).execute()
    rows_rules: List[Dict[str, Any]] = []
    for r in rules:
        if r is None:
            continue
        if hasattr(r, "model_dump"):
            item = r.model_dump()
        elif hasattr(r, "dict"):
            item = r.dict()
        else:
            item = dict(r)
        day = item.get("day")
        if not day:
            continue
        rows_rules.append({
            "org_id": org_id,
            "day": day,
            "label": item.get("label"),
            "enabled": bool(item.get("enabled", True)),
            "check_in": item.get("check_in"),
            "check_out": item.get("check_out"),
            "grace_in_min": _ensure_int(item.get("grace_in_min"), default=att.get("grace_in_min", DEFAULT_CONFIG["attendance"]["grace_in_min"])),
            "grace_out_min": _ensure_int(item.get("grace_out_min"), default=att.get("grace_out_min", DEFAULT_CONFIG["attendance"]["grace_out_min"])),
            "notes": item.get("notes"),
        })
    if rows_rules:
        client.table("attendance_rules").insert(rows_rules).execute()
    # Rewrite overrides
    overrides = att.get("overrides") or []
    # Clean all related rows first
    try:
        # fetch ids to delete targets
        ids_resp = client.table("attendance_overrides").select("id").eq("org_id", org_id).execute()
        ids = [row.get("id") for row in (getattr(ids_resp, "data", []) or []) if row.get("id")]
        if ids:
            client.table("attendance_override_targets").delete().in_("override_id", ids).execute()
    except Exception:
        pass
    client.table("attendance_overrides").delete().eq("org_id", org_id).execute()

    persons_resp = client.table("persons").select("person_id,label").eq("org_id", org_id).execute()
    persons_data = getattr(persons_resp, "data", []) or []
    persons_by_id = {
        str(row.get("person_id")): str(row.get("label") or "").strip()
        for row in persons_data
        if row and row.get("person_id")
    }
    persons_by_label: Dict[str, Set[str]] = {}
    for pid, label in persons_by_id.items():
        if not label:
            continue
        persons_by_label.setdefault(label.lower(), set()).add(pid)

    groups_resp = client.table("groups").select("id,name,slug").eq("org_id", org_id).execute()
    groups_data = getattr(groups_resp, "data", []) or []
    groups_by_id = {
        str(row.get("id")): {
            "name": str(row.get("name") or "").strip(),
            "slug": str(row.get("slug") or "").strip(),
        }
        for row in groups_data
        if row and row.get("id")
    }
    groups_lookup: Dict[str, Set[str]] = {}
    for gid, meta in groups_by_id.items():
        for key in (meta.get("slug"), meta.get("name")):
            if not key:
                continue
            groups_lookup.setdefault(key.lower(), set()).add(gid)

    def _resolve_override_target_rows(override_id: str, targets: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        seen: Set[Tuple[str, str]] = set()
        for tgt in targets:
            if tgt is None:
                continue
            t_type = str(tgt.get("type") or "").strip().lower()
            value = str(tgt.get("value") or "").strip()
            if not value:
                continue
            if t_type in {"person", "person_id", "label", "face_id"}:
                candidate_ids: Set[str] = set()
                if value in persons_by_id:
                    candidate_ids.add(value)
                val_lower = value.lower()
                candidate_ids.update(persons_by_label.get(val_lower, set()))
                if not candidate_ids and _TARGET_ID_RE.match(value):
                    candidate_ids.add(value)
                for pid in candidate_ids:
                    key = ("person", pid)
                    if key in seen:
                        continue
                    seen.add(key)
                    rows.append(
                        {
                            "override_id": override_id,
                            "target_type": "person",
                            "person_id": pid,
                            "group_id": None,
                        }
                    )
            elif t_type in {"group", "group_id"}:
                candidate_ids2: Set[str] = set()
                if value in groups_by_id:
                    candidate_ids2.add(value)
                val_lower = value.lower()
                candidate_ids2.update(groups_lookup.get(val_lower, set()))
                if not candidate_ids2 and _UUID_RE.match(value):
                    candidate_ids2.add(value)
                for gid in candidate_ids2:
                    key = ("group", gid)
                    if key in seen:
                        continue
                    seen.add(key)
                    rows.append(
                        {
                            "override_id": override_id,
                            "target_type": "group",
                            "person_id": None,
                            "group_id": gid,
                        }
                    )
        return rows

    for ov in overrides:
        if ov is None:
            continue
        if hasattr(ov, "model_dump"):
            item = ov.model_dump()
        elif hasattr(ov, "dict"):
            item = ov.dict()
        else:
            item = dict(ov)
        start_date = item.get("start_date")
        if not start_date:
            continue
        normalized_targets = _normalize_targets(item.get("targets") or [])
        ins = client.table("attendance_overrides").insert({
            "org_id": org_id,
            "start_date": start_date,
            "end_date": item.get("end_date"),
            "label": item.get("label"),
            "enabled": bool(item.get("enabled", True)),
            "check_in": item.get("check_in"),
            "check_out": item.get("check_out"),
            "grace_in_min": _ensure_int(item.get("grace_in_min"), default=att.get("grace_in_min", DEFAULT_CONFIG["attendance"]["grace_in_min"])),
            "grace_out_min": _ensure_int(item.get("grace_out_min"), default=att.get("grace_out_min", DEFAULT_CONFIG["attendance"]["grace_out_min"])),
            "notes": item.get("notes"),
        }).execute()
        new_id = (getattr(ins, "data", [{}]) or [{}])[0].get("id")
        if new_id and normalized_targets:
            rows_targets = _resolve_override_target_rows(str(new_id), normalized_targets)
            if rows_targets:
                client.table("attendance_override_targets").insert(rows_targets).execute()
    
    # Invalidate cache after saving
    invalidate_config_cache()
