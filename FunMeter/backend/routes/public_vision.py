from __future__ import annotations

from typing import Optional, List
import numpy as np

import cv2 as cv
from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from core.runtime import engine_async_call
from helpers.http import json_error
from helpers.time_utils import now_iso
from db.attendance_repo import insert_event as repo_insert_event
from services.people import label_to_person_id

def _load_main_module():
    import main_fastapi as main  # noqa: WPS433

    return main

def _mark_attendance(label: str, score: float) -> bool:
    """Mark attendance with cooldown check (delegates to main module)."""
    main = _load_main_module()
    # Use main module's _mark_attendance which has cooldown logic
    return main._mark_attendance(label, score)

router = APIRouter(tags=["public-api"])  # absolute paths

@router.post("/recognize-image")
async def recognize_image(
    file: UploadFile = File(...),
    th: Optional[float] = Query(None),
    mark: Optional[int] = Query(0),
):
    main = _load_main_module()
    data = await file.read()
    arr = np.frombuffer(data, dtype=np.uint8)
    bgr = cv.imdecode(arr, cv.IMREAD_COLOR)
    if bgr is None:
        return json_error("cannot read image")

    # Detect + recognize
    threshold = main._resolve_threshold(th)
    rec = await main._engine_recognize(bgr, threshold)

    # Optional: mark attendance
    marked: List[str] = []
    if bool(mark == 1):
        for row, label, score in rec:
            if label != "Unknown" and float(score) >= threshold:
                if _mark_attendance(label, float(score)):
                    marked.append(label)

    out = []
    for row, label, score in rec:
        x, y, w, h = [int(v) for v in row[:4]]
        out.append({"bbox": [x, y, w, h], "label": label, "score": float(score)})
    return {"status": "ok", "results": out, "marked": marked}

@router.post("/register-face")
async def register_face(
    label: str = Form(""),
    file: UploadFile = File(...),
    force: int = Form(0),
    preview_token: Optional[str] = Form(None),
):
    main = _load_main_module()
    return await main.register_face(label=label, file=file, force=force, preview_token=preview_token)

@router.post("/register-face/preview")
async def register_face_preview(file: UploadFile = File(...)):
    main = _load_main_module()
    return await main.register_face_preview(file=file)
