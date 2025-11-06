from __future__ import annotations

from typing import Optional

from db.supabase_client import get_client, get_default_org_id
from services.register_db import load_register_list


def label_to_person_id(label: Optional[str]) -> Optional[str]:
    lab = (label or "").strip()
    if not lab:
        return None
    try:
        items = load_register_list()
        for it in items:
            if str(it.get("label", "")).strip() == lab:
                pid = str(it.get("person_id") or "").strip()
                return pid or None
    except Exception:
        return None

    try:
        client = get_client()
        org_id = get_default_org_id()
        res = (
            client.table("persons")
            .select("person_id")
            .eq("org_id", org_id)
            .eq("label", lab)
            .limit(1)
            .execute()
        )
        rows = getattr(res, "data", []) or []
        if rows and rows[0].get("person_id"):
            return str(rows[0]["person_id"]).strip() or None
    except Exception:
        return None
    return None


def person_id_to_label(pid: Optional[str]) -> Optional[str]:
    if not pid:
        return None
    try:
        items = load_register_list()
        for it in items:
            if str(it.get("person_id", "")).strip() == str(pid).strip():
                lab = str(it.get("label", "")).strip()
                return lab or None
    except Exception:
        return None

    try:
        client = get_client()
        org_id = get_default_org_id()
        res = (
            client.table("persons")
            .select("label")
            .eq("org_id", org_id)
            .eq("person_id", str(pid).strip())
            .limit(1)
            .execute()
        )
        rows = getattr(res, "data", []) or []
        if rows and rows[0].get("label"):
            lab = str(rows[0]["label"]).strip()
            return lab or None
    except Exception:
        return None
    return None
