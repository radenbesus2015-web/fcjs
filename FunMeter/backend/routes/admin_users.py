from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from auth.deps import require_admin_token
from auth.users_repo import rotate_user_api_key, delete_user_account
from schemas import ApiKeyReset

router = APIRouter(prefix="/admin/users", tags=["admin"])

@router.post("/{identifier}/api-key")
def rotate_api_key(identifier: str, payload: ApiKeyReset, _admin=Depends(require_admin_token)):
    ident = (identifier or "").strip()
    if not ident:
        raise HTTPException(status_code=400, detail="user identifier invalid")
    try:
        entry = rotate_user_api_key(_admin.get("username", ""), ident, payload.new_api_key)
    except KeyError:
        raise HTTPException(status_code=404, detail="user not found")
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    return {"ok": True, "user": {"id": entry.get("id"), "username": entry.get("username"), "api_key": entry.get("api_key")}}

@router.delete("/{identifier}")
async def delete_user(identifier: str, _admin=Depends(require_admin_token)):
    actor = _admin.get("username", "")
    try:
        result = delete_user_account(actor, identifier)
    except KeyError:
        raise HTTPException(status_code=404, detail="user not found")
    except PermissionError as exc:
        message = str(exc)
        status = 403 if "mempromosikan" in message or "hapus" in message else 400
        raise HTTPException(status_code=status, detail=message)
    return {"ok": True, "deleted": result.get("username")}
