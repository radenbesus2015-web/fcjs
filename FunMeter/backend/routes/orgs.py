from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException

from db.supabase_client import get_client
from auth.deps import require_admin_token


router = APIRouter(prefix="/orgs", tags=["orgs"])


@router.get("")
def list_organizations(_admin=Depends(require_admin_token)):
    client = get_client()
    res = client.table("organizations").select("id, name, slug, created_at").order("created_at").execute()
    return {"items": getattr(res, "data", []) or []}


@router.post("")
def create_organization(payload: Dict[str, Any], _admin=Depends(require_admin_token)):
    name = str(payload.get("name", "")).strip()
    slug = str(payload.get("slug", "")).strip() or name.lower().replace(" ", "-")
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    client = get_client()
    ins = client.table("organizations").insert({"name": name, "slug": slug}).execute()
    return getattr(ins, "data", [{}])[0]


@router.get("/{org_id}/groups")
def list_groups(org_id: str, _admin=Depends(require_admin_token)):
    client = get_client()
    res = client.table("groups").select("id, org_id, name, slug, created_at").eq("org_id", org_id).order("created_at").execute()
    return {"items": getattr(res, "data", []) or []}


@router.post("/{org_id}/groups")
def create_group(org_id: str, payload: Dict[str, Any], _admin=Depends(require_admin_token)):
    name = str(payload.get("name", "")).strip()
    slug = str(payload.get("slug", "")).strip() or name.lower().replace(" ", "-")
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    client = get_client()
    ins = client.table("groups").insert({"org_id": org_id, "name": name, "slug": slug}).execute()
    return getattr(ins, "data", [{}])[0]
