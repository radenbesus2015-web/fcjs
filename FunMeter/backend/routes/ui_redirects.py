from __future__ import annotations

import os
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse, JSONResponse

router = APIRouter(tags=["ui"], include_in_schema=False)

NEXT_UI_BASE = os.getenv("NEXT_UI_BASE", "http://localhost:3000").rstrip("/")


@router.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


def _to_next(path: str) -> str:
    p = "/" + path.lstrip("/")
    return f"{NEXT_UI_BASE}{p}"


# Public pages
@router.get("/")
async def home(_: Request):
    return RedirectResponse(_to_next("/home"))


@router.get("/register-face")
async def register_page(_: Request):
    return RedirectResponse(_to_next("/register-face"))


@router.get("/attendance-fun-meter")
async def fun_page(_: Request):
    return RedirectResponse(_to_next("/attendance-fun-meter"))


@router.get("/attendance")
async def attendance_page(_: Request):
    return RedirectResponse(_to_next("/attendance"))


@router.get("/fun-meter")
async def fun_meter_page(_: Request):
    return RedirectResponse(_to_next("/fun-meter"))


# Admin pages
@router.get("/admin")
async def admin_home(_: Request):
    return RedirectResponse(_to_next("/admin"))


@router.get("/admin/{rest:path}")
async def admin_any(_: Request, rest: str):
    return RedirectResponse(_to_next(f"/admin/{rest}"))


