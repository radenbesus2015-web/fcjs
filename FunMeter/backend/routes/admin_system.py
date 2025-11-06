from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends

from auth.deps import require_admin_token
from auth.users_repo import list_users
from services.engine_ops import engine_summary
from db.supabase_client import get_client, get_default_org_id

try:
    import backend.main_fastapi as main  # type: ignore
except ModuleNotFoundError:
    import main_fastapi as main  # type: ignore

_engine_refresh_async = getattr(main, "_engine_refresh_async")
from utils.config_store import DEFAULT_CONFIG, load_config
from helpers.http import pretty_json

def _normalize_user_payload(entry: Dict[str, Any]) -> Dict[str, Any]:
    payload = {
        "id": entry.get("id"),
        "username": str(entry.get("username", "")).strip(),
        "is_admin": bool(entry.get("is_admin", False)),
        "is_owner": bool(entry.get("is_owner", False)),
        "api_key": entry.get("api_key"),
        "promoted_by": entry.get("promoted_by"),
        "promoted_at": entry.get("promoted_at"),
        "demoted_by": entry.get("demoted_by"),
        "demoted_at": entry.get("demoted_at"),
        "api_key_rotated_by": entry.get("api_key_rotated_by"),
        "api_key_rotated_at": entry.get("api_key_rotated_at"),
        "created_by": entry.get("created_by"),
        "created_at": entry.get("created_at"),
    }
    return payload

router = APIRouter(prefix="/admin", tags=["admin"])

@router.get("/token-check")
def token_check(_admin=Depends(require_admin_token)):
    return {"status": "ok"}

@router.get("/dashboard-data")
async def dashboard_data(admin=Depends(require_admin_token)):
    users_entries = list_users()
    users_list: list[Dict[str, Any]] = []
    current_username = admin.get("username", "")
    current_entry: Dict[str, Any] | None = None

    for entry in users_entries:
        normalized = _normalize_user_payload(entry)
        is_current = normalized["username"] == current_username
        if is_current:
            current_entry = normalized
        users_list.append({**normalized, "is_current": is_current})

    summary = engine_summary()
    CFG = load_config()
    config_json = pretty_json(CFG)
    model_json = pretty_json(summary)

    # Keep attendance preview empty to avoid coupling here
    preview: list[dict] = []
    attendance_json = pretty_json(preview)

    # Count total attendance events from database
    attendance_events_count = 0
    try:
        client = get_client()
        org_id = get_default_org_id()
        res = client.table("attendance_events").select("id", count="exact").eq("org_id", org_id).execute()
        attendance_events_count = getattr(res, "count", 0) or 0
    except Exception as e:
        print(f"[WARNING] Failed to count attendance events: {e}")
        attendance_events_count = 0

    stats = {
        "users": len(users_entries),
        "labels": summary.get("label_count", 0),
        "attendance_events": attendance_events_count,
    }

    current_user = current_entry or _normalize_user_payload(admin)
    if admin.get("api_key"):
        current_user["api_key"] = admin.get("api_key")
    current_user["is_current"] = True

    return {
        "current_user": current_user,
        "users": users_list,
        "model_summary": summary,
        "config": CFG,
        "config_defaults": DEFAULT_CONFIG,
        "config_json": config_json,
        "config_defaults_json": pretty_json(DEFAULT_CONFIG),
        "model_json": model_json,
        "attendance_preview": preview,
        "attendance_json": attendance_json,
        "attendance_counts": {},
        "stats": stats,
        "generated_at": "",
    }

@router.post("/actions/reload-server")
async def reload_server(_admin=Depends(require_admin_token)):
    refreshed = await _engine_refresh_async("admin_reload_server")
    return {"ok": True, "refreshed": refreshed}

@router.post("/actions/reload-model")
async def reload_model(_admin=Depends(require_admin_token)):
    refreshed = await _engine_refresh_async("admin_reload_model")
    return {"ok": True, "refreshed": refreshed}
