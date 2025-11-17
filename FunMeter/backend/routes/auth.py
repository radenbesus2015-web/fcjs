from __future__ import annotations

from typing import Any, Dict, Optional
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from auth.deps import require_user_token, require_admin_token, require_owner_token
from auth.users_repo import (
    register_user_account,
    list_users,
    promote_or_demote_user,
)
from services.passwords import set_password, verify_password
from schemas import (
    LoginPayload,
    Promote,
    RegisterPayload,
    SetPasswordPayload,
)


router = APIRouter(prefix="/auth", tags=["auth"])


def _public_user_payload(entry: Dict[str, Any], include_api_key: bool = False) -> Dict[str, Any]:
    return {
        "id": entry.get("id"),
        "username": entry.get("username"),
        "is_admin": bool(entry.get("is_admin", False)),
        "is_owner": bool(entry.get("is_owner", False)),
        **({"api_key": entry.get("api_key")} if include_api_key else {}),
    }


@router.post("/promote")
def auth_promote(payload: Promote, _owner=Depends(require_owner_token)):
    actor = _owner["username"]
    identifier = None
    target_username = None

    user_id = (payload.user_id or "").strip() if payload.user_id else ""
    username = (payload.username or "").strip() if payload.username else ""

    if user_id:
        for entry in list_users():
            if str(entry.get("id")) == user_id:
                target_username = str(entry.get("username") or "").strip()
                break
        if not target_username:
            raise HTTPException(status_code=404, detail="user not found")
    elif username:
        target_username = username
    else:
        raise HTTPException(status_code=400, detail="user identifier invalid")

    identifier = target_username

    try:
        entry = promote_or_demote_user(actor, identifier, bool(payload.is_admin))
    except KeyError:
        raise HTTPException(status_code=404, detail="user not found")
    except PermissionError as exc:
        message = str(exc)
        status = 403 if "Tidak boleh" in message else 400
        raise HTTPException(status_code=status, detail=message)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "user": _public_user_payload(entry)}


ALLOW_PUBLIC_REGISTER = (os.getenv("ALLOW_PUBLIC_REGISTER", "1") == "1")
@router.post("/register")
def auth_register(payload: RegisterPayload, request: Request):
    username = payload.username.strip()
    want_admin = bool(payload.is_admin)
    try:
        entry = register_user_account(username, requested_admin=want_admin, actor=None)
    except PermissionError:
        if ALLOW_PUBLIC_REGISTER and not want_admin:
            entry = register_user_account(username, requested_admin=False, actor="public")
        else:
            from auth.deps import require_admin_from_request  # lazy import
            admin = require_admin_from_request(request)
            try:
                entry = register_user_account(
                    username,
                    requested_admin=want_admin,
                    actor=admin.get("username"),
                )
            except KeyError:
                raise HTTPException(status_code=409, detail="Username sudah dipakai")
            except PermissionError as exc:
                raise HTTPException(status_code=403, detail=str(exc))
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
    except KeyError:
        raise HTTPException(status_code=409, detail="Username sudah dipakai")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if (payload.password or "").strip():
        actor = entry.get("created_by") or ("public" if ALLOW_PUBLIC_REGISTER and not want_admin else None)
        set_password(username, payload.password.strip(), set_by=actor)
    return {"ok": True, "user": _public_user_payload(entry, include_api_key=True)}


@router.post("/set-password")
def auth_set_password(payload: SetPasswordPayload, _admin=Depends(require_admin_token)):
    p = (payload.password or "").strip()
    if not p:
        raise HTTPException(status_code=400, detail="password invalid")
    target_username: Optional[str] = None
    if payload.user_id:
        try:
            for entry in list_users():
                if str(entry.get("id", "")) == payload.user_id:
                    target_username = str(entry.get("username", ""))
                    break
        except Exception:
            target_username = None
        if not target_username:
            raise HTTPException(status_code=404, detail="user not found")
    else:
        u = (payload.username or "").strip()
        if not u:
            raise HTTPException(status_code=400, detail="user identifier invalid")
        names = [str(e.get("username", "")) for e in list_users()]
        if u not in names:
            raise HTTPException(status_code=404, detail="user not found")
        target_username = u
    set_password(target_username, p, set_by=_admin["username"])  # type: ignore[arg-type]
    return {"ok": True}


_bearer_security = HTTPBearer(auto_error=False)


@router.post("/login")
def auth_login(
    request: Request,
    payload: Optional[LoginPayload] = None,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_security),
):
    if payload and payload.username and payload.password:
        username = payload.username.strip()
        password = payload.password.strip()
        
        if not verify_password(username, password):
            raise HTTPException(status_code=401, detail="invalid username/password")
        
        # Cari user di semua org_id (konsisten dengan verify_password)
        from db.supabase_client import get_client
        client = get_client()
        res = client.table("users").select(
            "id, username, api_key, is_admin, is_owner, promoted_by, promoted_at, "
            "demoted_by, demoted_at, api_key_rotated_by, api_key_rotated_at, created_by, created_at"
        ).eq("username", username).limit(1).execute()
        rows = getattr(res, "data", []) or []
        
        if rows:
            entry = {
                "id": rows[0].get("id"),
                "username": rows[0].get("username"),
                "api_key": rows[0].get("api_key"),
                "is_admin": bool(rows[0].get("is_admin")),
                "is_owner": bool(rows[0].get("is_owner")),
                "promoted_by": rows[0].get("promoted_by"),
                "promoted_at": rows[0].get("promoted_at"),
                "demoted_by": rows[0].get("demoted_by"),
                "demoted_at": rows[0].get("demoted_at"),
                "api_key_rotated_by": rows[0].get("api_key_rotated_by"),
                "api_key_rotated_at": rows[0].get("api_key_rotated_at"),
                "created_by": rows[0].get("created_by"),
                "created_at": rows[0].get("created_at"),
            }
            return {"ok": True, "user": _public_user_payload(entry, include_api_key=True)}
        
        raise HTTPException(status_code=404, detail="user not found")
    raise HTTPException(status_code=401, detail="Missing Authorization header")


@router.post("/logout")
def auth_logout():
    return {"ok": True}


@router.get("/me")
def auth_me(user=Depends(require_user_token)):
    return {"ok": True, "user": _public_user_payload(user, include_api_key=False)}
