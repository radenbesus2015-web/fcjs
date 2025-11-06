from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException

from db.supabase_client import get_client
from auth.deps import require_admin_token


router = APIRouter(prefix="/billing", tags=["billing"])


@router.get("/customers")
def list_customers(_admin=Depends(require_admin_token)):
    client = get_client()
    res = client.table("billing_customers").select("id, org_id, provider, customer_id, plan, status, current_period_end, created_at").order("created_at", desc=True).execute()
    return {"items": getattr(res, "data", []) or []}


@router.post("/customers")
def upsert_customer(payload: Dict[str, Any], _admin=Depends(require_admin_token)):
    org_id = str(payload.get("org_id", "")).strip()
    customer_id = str(payload.get("customer_id", "")).strip()
    provider = str(payload.get("provider", "stripe")).strip() or "stripe"
    plan = payload.get("plan")
    status = payload.get("status")
    if not org_id or not customer_id:
        raise HTTPException(status_code=400, detail="org_id and customer_id required")
    client = get_client()
    # upsert by provider+customer_id
    res = client.table("billing_customers").upsert({
        "org_id": org_id,
        "provider": provider,
        "customer_id": customer_id,
        "plan": plan,
        "status": status,
    }, on_conflict="provider,customer_id").execute()
    return getattr(res, "data", [{}])[0]


@router.get("/invoices")
def list_invoices(_admin=Depends(require_admin_token)):
    client = get_client()
    res = client.table("billing_invoices").select("id, org_id, provider, invoice_id, amount, currency, status, due_date, paid_at, created_at").order("created_at", desc=True).execute()
    return {"items": getattr(res, "data", []) or []}


@router.post("/invoices")
def create_invoice(payload: Dict[str, Any], _admin=Depends(require_admin_token)):
    org_id = str(payload.get("org_id", "")).strip()
    invoice_id = str(payload.get("invoice_id", "")).strip()
    amount = int(payload.get("amount", 0) or 0)
    currency = str(payload.get("currency", "usd")).strip() or "usd"
    status = str(payload.get("status", "open")).strip() or "open"
    if not org_id or not invoice_id or amount <= 0:
        raise HTTPException(status_code=400, detail="org_id, invoice_id, amount required")
    client = get_client()
    ins = client.table("billing_invoices").insert({
        "org_id": org_id,
        "provider": str(payload.get("provider", "stripe") or "stripe"),
        "invoice_id": invoice_id,
        "amount": amount,
        "currency": currency,
        "status": status,
        "due_date": payload.get("due_date"),
        "paid_at": payload.get("paid_at"),
    }).execute()
    return getattr(ins, "data", [{}])[0]
