from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import ValidationError

from auth.deps import require_admin_token

router = APIRouter(prefix="/admin/attendance", tags=["admin"])


def _load_main_module():
    import main_fastapi as main  # noqa: WPS433 (runtime import to avoid circular)

    return main


def _validate_payload(model_name: str, payload: Dict[str, Any]):
    main = _load_main_module()
    model_cls = getattr(main, model_name, None)
    if model_cls is None:
        raise HTTPException(status_code=500, detail=f"{model_name} model is unavailable")
    try:
        return model_cls.model_validate(payload)
    except ValidationError as exc:  # pragma: no cover - FastAPI converts to 422
        raise HTTPException(status_code=422, detail=exc.errors()) from exc


@router.post("/clear")
async def admin_attendance_clear(payload: Dict[str, Any], _admin=Depends(require_admin_token)):
    main = _load_main_module()
    model = _validate_payload("AttendanceClear", payload)
    return await main.admin_attendance_clear(model, _admin)


@router.get("/export.csv")
def admin_attendance_export_csv(_admin=Depends(require_admin_token)):
    main = _load_main_module()
    return main.admin_attendance_export_csv(_admin)


@router.get("/daily")
def admin_attendance_daily(
    q: Optional[str] = Query(None, description="Cari nama/label (contains, case-insensitive)"),
    page: int = Query(1, ge=1),
    per_page: str = Query("10", description="Jumlah per halaman atau 'all' untuk semua"),
    order: Literal["asc", "desc"] = Query("desc"),
    start: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    status: Optional[Literal["present", "late", "left_early", "off", "mixed", "all"]] = Query(None),
    _admin=Depends(require_admin_token),
):
    main = _load_main_module()
    return main.admin_attendance_daily(
        q=q,
        page=page,
        per_page=per_page,
        order=order,
        start=start,
        end=end,
        status=status,
        _admin=_admin,
    )


@router.post("/daily/delete")
async def admin_attendance_daily_delete(payload: Dict[str, Any], _admin=Depends(require_admin_token)):
    main = _load_main_module()
    model = _validate_payload("AttendanceDailyDelete", payload)
    return await main.admin_attendance_daily_delete(model, _admin)


@router.get("/summary")
def admin_attendance_summary(
    start: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    group: Literal["month", "week", "day"] = Query("month"),
    _admin=Depends(require_admin_token),
):
    main = _load_main_module()
    return main.admin_attendance_summary(start=start, end=end, group=group, _admin=_admin)


@router.get("/log")
def admin_attendance_log(
    person_id: Optional[str] = Query(None),
    date: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    order: Literal["asc", "desc"] = Query("desc"),
    _admin=Depends(require_admin_token),
):
    main = _load_main_module()
    return main.admin_attendance_log(
        person_id=person_id,
        date=date,
        order=order,
        _admin=_admin,
    )

@router.get("/events")
def admin_attendance_events(
    label: Optional[str] = Query(None),
    start: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=500),
    order: Literal["asc", "desc"] = Query("desc"),
    _admin=Depends(require_admin_token),
):
    main = _load_main_module()
    return main.admin_attendance_events(
        label=label,
        start=start,
        end=end,
        page=page,
        per_page=per_page,
        order=order,
        _admin=_admin,
    )


@router.post("/events")
def admin_attendance_event_create(payload: Dict[str, Any], _admin=Depends(require_admin_token)):
    main = _load_main_module()
    model = _validate_payload("AttendanceEventCreate", payload)
    return main.admin_attendance_event_create(model, _admin)


@router.put("/events/{event_id}")
def admin_attendance_event_update(event_id: int, payload: Dict[str, Any], _admin=Depends(require_admin_token)):
    main = _load_main_module()
    model = _validate_payload("AttendanceEventUpdate", payload)
    return main.admin_attendance_event_update(event_id, model, _admin)


@router.delete("/events/{event_id}")
def admin_attendance_event_delete(event_id: int, _admin=Depends(require_admin_token)):
    main = _load_main_module()
    return main.admin_attendance_event_delete(event_id, _admin)


@router.get("/daily/export.csv")
def admin_attendance_daily_export(
    q: Optional[str] = Query(None),
    order: Literal["asc", "desc"] = Query("desc"),
    start: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    status: Optional[Literal["present", "late", "all"]] = Query(None),
    _admin=Depends(require_admin_token),
):
    main = _load_main_module()
    return main.admin_attendance_daily_export(
        q=q,
        order=order,
        start=start,
        end=end,
        status=status,
        _admin=_admin,
    )


@router.get("/events/export.csv")
def admin_attendance_events_export(
    label: Optional[str] = Query(None),
    start: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    order: Literal["asc", "desc"] = Query("desc"),
    _admin=Depends(require_admin_token),
):
    main = _load_main_module()
    return main.admin_attendance_events_export(
        label=label,
        start=start,
        end=end,
        order=order,
        _admin=_admin,
    )


@router.post("/events/bulk-delete")
def admin_attendance_events_bulk_delete(payload: Dict[str, Any], _admin=Depends(require_admin_token)):
    main = _load_main_module()
    model = _validate_payload("EventsBulkDelete", payload)
    return main.admin_attendance_event_delete(model, _admin)