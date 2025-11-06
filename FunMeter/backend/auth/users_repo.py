from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from db.supabase_client import get_client, get_default_org_id

def _normalize_user_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    data = dict(entry or {})
    data.setdefault("is_admin", False)
    data.setdefault("is_owner", False)
    return data

def list_users() -> List[Dict[str, Any]]:
    client = get_client()
    org_id = get_default_org_id()
    res = client.table("users").select(
        "id, username, api_key, is_admin, is_owner, promoted_by, promoted_at, "
        "demoted_by, demoted_at, api_key_rotated_by, api_key_rotated_at, created_by, created_at"
    ).eq("org_id", org_id).order("created_at", desc=False).execute()
    rows = getattr(res, "data", []) or []
    return [
        {
            "id": it.get("id"),
            "username": it.get("username"),
            "api_key": it.get("api_key"),
            "is_admin": bool(it.get("is_admin")),
            "is_owner": bool(it.get("is_owner")),
            "promoted_by": it.get("promoted_by"),
            "promoted_at": it.get("promoted_at"),
            "demoted_by": it.get("demoted_by"),
            "demoted_at": it.get("demoted_at"),
            "api_key_rotated_by": it.get("api_key_rotated_by"),
            "api_key_rotated_at": it.get("api_key_rotated_at"),
            "created_by": it.get("created_by"),
            "created_at": it.get("created_at"),
        }
        for it in rows
    ]

def read_users() -> Dict[str, Any]:
    # Back-compat: emulate previous JSON shape
    users = list_users()
    return {"users": {u.get("username"): u for u in users}}

def _resolve_user_identifier(users: Dict[str, Dict[str, Any]], identifier: str) -> Tuple[str, Dict[str, Any]]:
    ident = str(identifier or "").strip()
    if not ident:
        raise KeyError("empty identifier")
    if ident in users:
        return ident, users[ident]
    # by id
    for uname, entry in users.items():
        if str(entry.get("id")) == ident:
            return uname, entry
    raise KeyError("user not found")

def find_user_by_token(token: str) -> Optional[Tuple[str, Dict[str, Any]]]:
    client = get_client()
    org_id = get_default_org_id()
    res = client.table("users").select(
        "username, id, is_admin, is_owner, promoted_by, promoted_at, demoted_by, demoted_at, created_by, created_at"
    ).eq("org_id", org_id).eq("api_key", token).limit(1).execute()
    row = res.data[0] if getattr(res, "data", None) else None
    if not row:
        return None
    entry = _normalize_user_entry(row)
    return row.get("username"), entry

def register_user_account(username: str, requested_admin: bool = False, actor: Optional[str] = None) -> Dict[str, Any]:
    import secrets

    uname = (username or "").strip()
    if not uname:
        raise ValueError("username invalid")
    client = get_client()
    org_id = get_default_org_id()
    # Check exist
    ex = client.table("users").select("id").eq("org_id", org_id).eq("username", uname).limit(1).execute()
    if getattr(ex, "data", None):
        # return existing
        found = client.table("users").select(
            "id, username, api_key, is_admin, is_owner, promoted_by, promoted_at, created_by, created_at"
        ).eq("org_id", org_id).eq("username", uname).limit(1).execute()
        return _normalize_user_entry(found.data[0]) if getattr(found, "data", None) else {"username": uname}

    # Determine if this is the first user for the organization
    try:
        count_resp = client.table("users").select("id", count="exact").eq("org_id", org_id).limit(1).execute()
        existing_count = int(getattr(count_resp, "count", 0) or 0)
    except Exception:
        existing_count = 0

    is_first_user = existing_count == 0

    payload = {
        "org_id": org_id,
        "username": uname,
        "api_key": secrets.token_urlsafe(48),
        "is_admin": bool(requested_admin) or is_first_user,
        "is_owner": is_first_user,
        "created_by": actor,
    }
    ins = client.table("users").insert(payload).execute()
    return _normalize_user_entry(ins.data[0]) if getattr(ins, "data", None) else {"username": uname, **payload}

def promote_or_demote_user(actor: str, username: str, is_admin: bool) -> Dict[str, Any]:
    client = get_client()
    org_id = get_default_org_id()
    now = datetime.now(timezone.utc).isoformat()
    updates = {
        "is_admin": bool(is_admin),
        ("promoted_by" if is_admin else "demoted_by"): actor,
        ("promoted_at" if is_admin else "demoted_at"): now,
    }
    upd = client.table("users").update(updates).eq("org_id", org_id).eq("username", username).execute()
    return _normalize_user_entry(upd.data[0]) if getattr(upd, "data", None) else {"username": username, **updates}

def rotate_user_api_key(actor: str, identifier: str, new_api_key: Optional[str] = None) -> Dict[str, Any]:
    import secrets

    data = read_users()
    users = data.get("users", {})
    uname, _entry = _resolve_user_identifier(users, identifier)
    key = (new_api_key or "").strip() or secrets.token_urlsafe(48)
    client = get_client()
    org_id = get_default_org_id()
    upd = client.table("users").update({
        "api_key": key,
        "api_key_rotated_by": actor,
        "api_key_rotated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("org_id", org_id).eq("username", uname).execute()
    return _normalize_user_entry(upd.data[0]) if getattr(upd, "data", None) else {"username": uname, "api_key": key}

def delete_user_account(actor: str, identifier: str) -> Dict[str, Any]:
    data = read_users()
    users = data.get("users", {})
    uname, entry = _resolve_user_identifier(users, identifier)
    # Basic guard: don't let user delete themselves here (keep parity with legacy expectations)
    if uname == actor:
        raise PermissionError("Tidak boleh menghapus akun Anda sendiri")
    client = get_client()
    org_id = get_default_org_id()
    # fetch id for response
    sel = client.table("users").select("id, username").eq("org_id", org_id).eq("username", uname).limit(1).execute()
    row = sel.data[0] if getattr(sel, "data", None) else {"username": uname}
    client.table("users").delete().eq("org_id", org_id).eq("username", uname).execute()
    return row
