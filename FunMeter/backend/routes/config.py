from __future__ import annotations

import copy
from typing import Any, Dict

from fastapi import APIRouter, Depends

from auth.deps import require_admin_token, require_owner_token
from utils.config_store import DEFAULT_CONFIG


router = APIRouter()


@router.get("/config", tags=["config"])
async def get_config(_owner=Depends(require_owner_token)):
    import main_fastapi as main

    return {"status": "ok", "config": main.CFG}


@router.put("/config", tags=["config"])
async def put_config(payload: Dict[str, Any], _owner=Depends(require_owner_token)):
    import main_fastapi as main

    model = main.ConfigUpdate.model_validate(payload)
    raw = model.model_dump(exclude_none=True)
    if not raw:
        return {"status": "ok", "config": main.CFG}

    merged = main._merge_config_patch(main.CFG, raw)
    updated = await main._apply_save_broadcast_config(merged)
    return {"status": "ok", "config": updated}


@router.post("/config/reset", tags=["config"])
async def reset_config(payload: Dict[str, Any], _owner=Depends(require_owner_token)):
    import main_fastapi as main

    model = main.ConfigReset.model_validate(payload)
    scope = model.scope
    cfg_copy = copy.deepcopy(main.CFG)

    if scope == "all":
        cfg_copy = copy.deepcopy(DEFAULT_CONFIG)
    elif scope == "face_engine":
        cfg_copy["face_engine"] = copy.deepcopy(DEFAULT_CONFIG.get("face_engine", {}))
    elif scope == "attendance":
        cfg_copy["attendance"] = copy.deepcopy(DEFAULT_CONFIG.get("attendance", {}))

    updated = await main._apply_save_broadcast_config(cfg_copy)
    return {"status": "ok", "config": updated, "scope": scope}


@router.get("/admin/attendance/schedule", tags=["admin"])
async def admin_attendance_schedule_get(_admin=Depends(require_admin_token)):
    import main_fastapi as main

    return {"status": "ok", "attendance": main._attendance_schedule_snapshot()}


@router.put("/admin/attendance/schedule", tags=["admin"])
async def admin_attendance_schedule_put(payload: Dict[str, Any], _admin=Depends(require_admin_token)):
    import main_fastapi as main

    model = main.AttendanceSchedulePayload.model_validate(payload)
    cfg_current = copy.deepcopy(main.CFG)
    attendance_cfg = copy.deepcopy((cfg_current or {}).get("attendance") or {})

    if model.grace_in_min is not None:
        attendance_cfg["grace_in_min"] = int(model.grace_in_min)
    if model.grace_out_min is not None:
        attendance_cfg["grace_out_min"] = int(model.grace_out_min)
    if model.rules is not None:
        attendance_cfg["rules"] = [rule.model_dump() for rule in (model.rules or [])]
    if model.overrides is not None:
        attendance_cfg["overrides"] = [ov.model_dump() for ov in (model.overrides or [])]

    cfg_current["attendance"] = attendance_cfg
    updated = await main._apply_save_broadcast_config(cfg_current)
    return {"status": "ok", "attendance": main._attendance_schedule_snapshot(updated)}
