from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import ValidationError

from auth.deps import require_admin_token

router = APIRouter()


def _load_main_module():
    import main_fastapi as main  # noqa: WPS433

    return main


def _validate_payload(model_name: str, payload: Dict[str, Any]):
    main = _load_main_module()
    model_cls = getattr(main, model_name, None)
    if model_cls is None:
        raise HTTPException(status_code=500, detail=f"{model_name} model is unavailable")
    try:
        return model_cls.model_validate(payload)
    except ValidationError as exc:  # pragma: no cover
        raise HTTPException(status_code=422, detail=exc.errors()) from exc


@router.post("/admin/reload-from-uploads", tags=["admin"])
async def admin_reload_from_uploads(_admin=Depends(require_admin_token)):
    main = _load_main_module()
    return await main.admin_reload_from_uploads(_admin)


@router.post("/admin/register-db/upload-photo/{item_id}", tags=["admin"])
async def admin_upload_photo(
    item_id: int,
    file: UploadFile = File(...),
    force: int = Form(0),
    _admin=Depends(require_admin_token),
):
    main = _load_main_module()
    return await main.admin_upload_photo(item_id, file, force, _admin)


@router.delete("/admin/register-db/item/{item_id}", tags=["admin"])
async def admin_delete_item(item_id: int, delete_photo: int = Query(0), _admin=Depends(require_admin_token)):
    main = _load_main_module()
    return await main.admin_delete_item(item_id, delete_photo, _admin)


@router.put("/admin/register-db/item/{item_id}", tags=["admin"])
async def admin_update_item(item_id: int, payload: Dict[str, Any], _admin=Depends(require_admin_token)):
    model = _validate_payload("AdminUpdate", payload)
    main = _load_main_module()
    return await main.admin_update_item(item_id, model, _admin)


@router.post("/admin/register-db/bulk", tags=["admin"])
async def admin_bulk(payload: Dict[str, Any], _admin=Depends(require_admin_token)):
    model = _validate_payload("AdminBulk", payload)
    main = _load_main_module()
    return await main.admin_bulk(model, _admin)


@router.post("/admin/register-db/migrate-storage", tags=["admin"])
async def admin_migrate_storage(_admin=Depends(require_admin_token)):
    main = _load_main_module()
    return await main.admin_migrate_storage(_admin)


@router.get("/admin/register-db/export.csv", tags=["admin"])
async def admin_export_csv(_admin=Depends(require_admin_token)):
    main = _load_main_module()
    return await main.admin_export_csv(_admin)


@router.get("/register-db-data", tags=["admin"])
async def register_db_data(
    page: int = Query(1, ge=1),
    per_page: str = Query("25", description="Jumlah per halaman atau 'all' untuk semua"),
    order: Literal["asc", "desc"] = Query("desc"),
    q: Optional[str] = Query(None),
    _admin=Depends(require_admin_token),
):
    main = _load_main_module()
    return await main.register_db_data(
        page=page,
        per_page=per_page,
        order=order,
        q=q,
        _admin=_admin,
    )


@router.post("/register-dataset", tags=["admin"])
async def register_dataset(dataset: str = Form(...), _admin=Depends(require_admin_token)):
    main = _load_main_module()
    return await main.register_dataset(dataset, _admin)


