from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from auth.users_repo import find_user_by_token


bearer_security = HTTPBearer(auto_error=False, description="Authorization: Bearer <API_KEY>")


def _strip_bearer(token: str) -> str:
    if not token:
        return token
    token = token.strip()
    if token.lower().startswith("bearer "):
        return token[7:].strip()
    return token


def _extract_token_from_request(request: Request) -> Optional[str]:
    if request is None:
        return None
    token = request.query_params.get("token") or request.query_params.get("api_key")
    if token:
        return _strip_bearer(token)
    auth = request.headers.get("Authorization", "").strip()
    if auth:
        scheme, _, value = auth.partition(" ")
        if scheme.lower() == "bearer" and value:
            return value.strip()
    return None


def _normalize_user_payload(entry: Dict[str, Any]) -> Dict[str, Any]:
    return {
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


def require_user_token(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_security),
    request: Request = None, # type: ignore
) -> dict:
    token = None
    if credentials is not None and credentials.credentials:
        token = _strip_bearer(credentials.credentials)
    if not token and request is not None:
        token = _extract_token_from_request(request)
    if not token:
        raise HTTPException(status_code=401, detail="Missing API token")
    match = find_user_by_token(token)
    if not match:
        raise HTTPException(status_code=401, detail="API key invalid")
    username, info = match
    normalized = _normalize_user_payload({"username": username, **info})
    normalized["api_key"] = token
    return normalized


def require_admin_token(user: dict = Depends(require_user_token)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="forbidden (admin only)")
    return user


def require_admin_from_request(request: Request) -> dict:
    # Extract bearer token from request headers and reuse require_user_token
    token = _extract_token_from_request(request)
    if not token:
        raise HTTPException(status_code=401, detail="Missing API token")
    match = find_user_by_token(token)
    if not match:
        raise HTTPException(status_code=401, detail="API key invalid")
    username, info = match
    payload = _normalize_user_payload({"username": username, **info})
    payload["api_key"] = token
    if not payload.get("is_admin"):
        raise HTTPException(status_code=403, detail="forbidden (admin only)")
    return payload


def require_owner_token(user: dict = Depends(require_user_token)) -> dict:
    if not user.get("is_owner"):
        raise HTTPException(status_code=403, detail="forbidden (owner only)")
    return user

