from __future__ import annotations

from math import ceil
from typing import Literal

from fastapi import APIRouter, Query

from db.attendance_repo import list_events


router = APIRouter(tags=["public"])  # absolute paths


@router.get("/attendance-log")
async def attendance_log(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    order: Literal["asc", "desc"] = Query("desc"),
):
    items, total = list_events(page=page, per_page=per_page, order=order)
    if total <= 0:
        return {
            "status": "ok",
            "items": [],
            "meta": {
                "page": 1, "per_page": per_page, "order": order,
                "total": 0, "total_pages": 1, "has_prev": False, "has_next": False,
            },
        }
    total_pages = max(1, ceil(total / per_page))
    page = min(page, total_pages)
    return {
        "status": "ok",
        "items": items,
        "meta": {
            "page": page, "per_page": per_page, "order": order,
            "total": total, "total_pages": total_pages,
            "has_prev": page > 1, "has_next": page < total_pages,
        },
    }
