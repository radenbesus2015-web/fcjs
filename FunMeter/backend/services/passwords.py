from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone
from typing import Optional

from db.supabase_client import get_client, get_default_org_id


def _hash_pw(pw: str, salt: bytes) -> str:
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, 200_000, dklen=32)
    return dk.hex()


def set_password(username: str, password: str, *, set_by: Optional[str] = None) -> None:
    client = get_client()
    org_id = get_default_org_id()
    salt = secrets.token_bytes(16)
    rec = {
        "org_id": org_id,
        "username": username,
        "salt": salt.hex(),
        "hash": _hash_pw(password, salt),
        "set_at": datetime.now(timezone.utc).isoformat(),
        "set_by": set_by,
    }
    client.table("user_passwords").upsert(rec, on_conflict="org_id,username").execute()


def verify_password(username: str, password: str) -> bool:
    client = get_client()
    org_id = get_default_org_id()
    res = client.table("user_passwords").select("salt, hash").eq("org_id", org_id).eq("username", username).limit(1).execute()
    row = res.data[0] if getattr(res, "data", None) else None
    if not row:
        return False
    try:
        salt = bytes.fromhex(row["salt"])
        return _hash_pw(password, salt) == row.get("hash")
    except Exception:
        return False
