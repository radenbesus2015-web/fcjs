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
    username = username.strip()
    
    # Cari password di semua org_id berdasarkan username
    # Ini lebih aman karena username mungkin ada di org_id yang berbeda
    try:
        res = client.table("user_passwords").select("salt, hash, org_id").eq("username", username).execute()
        rows = getattr(res, "data", []) or []
        
        if not rows:
            # Jika tidak ada password sama sekali, return False
            return False
        
        # Coba verifikasi dengan setiap password yang ditemukan
        # (untuk handle case dimana username sama di multiple org)
        for row in rows:
            try:
                salt_hex = row.get("salt", "")
                hash_stored = row.get("hash", "")
                
                if not salt_hex or not hash_stored:
                    continue
                
                salt = bytes.fromhex(salt_hex)
                hash_calculated = _hash_pw(password, salt)
                
                if hash_calculated == hash_stored:
                    return True
            except (ValueError, TypeError, AttributeError):
                # Skip jika ada error parsing salt/hash
                continue
        
        return False
    except Exception as e:
        # Log error untuk debugging (jika diperlukan)
        print(f"[WARN] verify_password error for {username}: {e}")
        return False
