"""
Routes untuk pengelolaan iklan (advertisements)
Menggunakan Supabase Storage dan Database
"""

from __future__ import annotations

import os
from typing import List, Optional
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, Query
from pydantic import BaseModel

from db.supabase_client import get_client, SupabaseNotConfigured
from auth.deps import require_admin_token

router = APIRouter(prefix="/admin/advertisements", tags=["admin", "advertisements"])


# =========================
# Request/Response Models
# =========================

class AdvertisementResponse(BaseModel):
    id: str
    src: str
    type: str
    enabled: bool
    display_order: int
    file_name: Optional[str] = None
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class AdvertisementUpdate(BaseModel):
    enabled: Optional[bool] = None
    display_order: Optional[int] = None
    title: Optional[str] = None
    description: Optional[str] = None


class ReorderRequest(BaseModel):
    orders: List[dict]  # [{"id": "...", "display_order": 1}, ...]


# =========================
# Helper Functions
# =========================

def get_public_url(file_path: str) -> str:
    """Build public URL untuk file di Supabase Storage"""
    try:
        client = get_client()
        bucket = client.storage.from_("advertisements")
        url = bucket.get_public_url(file_path)
        # get_public_url returns string directly
        if isinstance(url, str):
            return url
    except Exception as e:
        print(f"[WARN] Failed to get public URL from Supabase client: {e}")
    
    # Fallback: build URL manual
    supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    if supabase_url:
        return f"{supabase_url}/storage/v1/object/public/advertisements/{file_path}"
    return f"/storage/v1/object/public/advertisements/{file_path}"


# =========================
# API Endpoints
# =========================

@router.get("", response_model=List[AdvertisementResponse])
async def list_advertisements(
    enabled_only: bool = Query(False, description="Hanya ambil iklan yang enabled"),
    current_user = Depends(require_admin_token),
):
    """
    List semua iklan (admin only)
    Jika enabled_only=True, hanya return iklan yang enabled
    """
    try:
        client = get_client()
        
        query = client.table("advertisements").select("*")
        
        if enabled_only:
            query = query.eq("enabled", True)
        
        query = query.order("display_order", desc=False).order("created_at", desc=False)
        
        result = query.execute()
        data = getattr(result, "data", []) or []
        
        # Convert src path ke full public URL
        for item in data:
            if item.get("src"):
                item["src"] = get_public_url(item["src"])
        
        return data
    except SupabaseNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        print(f"[ERROR] Failed to list advertisements: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list advertisements: {str(e)}")


@router.get("/active", response_model=List[AdvertisementResponse])
async def list_active_advertisements():
    """
    List iklan aktif (public endpoint, tidak perlu auth)
    Query langsung ke table advertisements dengan filter enabled=True
    """
    try:
        client = get_client()
        
        # Query langsung ke table dengan filter enabled=True
        result = client.table("advertisements").select("*").eq("enabled", True).order("display_order", desc=False).execute()
        data = getattr(result, "data", []) or []
        
        # Convert src path ke full public URL
        for item in data:
            if item.get("src"):
                item["src"] = get_public_url(item["src"])
        
        return data
    except SupabaseNotConfigured:
        # Return empty list jika Supabase tidak dikonfigurasi
        return []
    except Exception as e:
        print(f"[ERROR] Failed to list active advertisements: {e}")
        # Return empty list untuk public endpoint (jangan expose error)
        return []


@router.post("", response_model=AdvertisementResponse, status_code=201)
async def upload_advertisement(
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    enabled: bool = Form(True),
    display_order: int = Form(0),
    current_user = Depends(require_admin_token),
):
    """
    Upload iklan baru (admin only)
    """
    try:
        client = get_client()
        
        # Validate file type
        if not file.content_type:
            raise HTTPException(status_code=400, detail="File type tidak diketahui")
        
        is_image = file.content_type.startswith("image/")
        is_video = file.content_type.startswith("video/")
        
        if not (is_image or is_video):
            raise HTTPException(status_code=400, detail="File harus berupa gambar atau video")
        
        # Generate unique filename
        file_ext = file.filename.split(".")[-1] if "." in file.filename else ""
        import time
        import random
        import string
        random_str = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
        file_name = f"{int(time.time())}-{random_str}.{file_ext}"
        file_path = file_name  # Path relatif di dalam bucket
        
        # Read file content
        file_content = await file.read()
        
        # Upload ke Supabase Storage
        bucket = client.storage.from_("advertisements")
        upload_result = bucket.upload(
            file_path,
            file_content,
            file_options={
                "content-type": file.content_type,
                "cache-control": "3600",
            }
        )
        
        # Check upload error (supabase-py v2 returns dict with error key)
        if isinstance(upload_result, dict) and upload_result.get("error"):
            raise HTTPException(status_code=500, detail=f"Failed to upload file: {upload_result.get('error')}")
        # Check if result has error attribute
        if hasattr(upload_result, "error") and upload_result.error:
            raise HTTPException(status_code=500, detail=f"Failed to upload file: {upload_result.error}")
        
        # Create record di database
        db_record = {
            "src": file_path,
            "type": "image" if is_image else "video",
            "enabled": enabled,
            "display_order": display_order,
            "file_name": file.filename,
            "file_size": len(file_content),
            "mime_type": file.content_type,
            "title": title,
            "description": description,
        }
        
        # Insert record
        insert_result = client.table("advertisements").insert(db_record).execute()
        insert_data = getattr(insert_result, "data", []) or []
        
        if not insert_data:
            # Rollback: delete file dari storage
            try:
                bucket = client.storage.from_("advertisements")
                bucket.remove([file_path])
            except Exception:
                pass
            raise HTTPException(status_code=500, detail="Failed to create advertisement record")
        
        # Get the inserted record with all fields
        ad_id = insert_data[0].get("id")
        if not ad_id:
            # Rollback: delete file dari storage
            try:
                bucket = client.storage.from_("advertisements")
                bucket.remove([file_path])
            except Exception:
                pass
            raise HTTPException(status_code=500, detail="Failed to get advertisement ID after insert")
        
        # Query the full record
        get_result = client.table("advertisements").select("*").eq("id", ad_id).execute()
        get_data = getattr(get_result, "data", []) or []
        
        if not get_data:
            # Use insert_data as fallback
            advertisement = insert_data[0]
        else:
            advertisement = get_data[0]
        
        advertisement["src"] = get_public_url(advertisement["src"])
        
        return advertisement
        
    except HTTPException:
        raise
    except SupabaseNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        print(f"[ERROR] Failed to upload advertisement: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to upload advertisement: {str(e)}")


@router.put("/{ad_id}", response_model=AdvertisementResponse)
async def update_advertisement(
    ad_id: str,
    updates: AdvertisementUpdate,
    current_user = Depends(require_admin_token),
):
    """
    Update iklan (metadata saja, bukan file) (admin only)
    """
    try:
        client = get_client()
        
        # Build update dict (hanya field yang tidak None)
        update_dict = {}
        if updates.enabled is not None:
            update_dict["enabled"] = updates.enabled
        if updates.display_order is not None:
            update_dict["display_order"] = updates.display_order
        if updates.title is not None:
            update_dict["title"] = updates.title
        if updates.description is not None:
            update_dict["description"] = updates.description
        
        if not update_dict:
            raise HTTPException(status_code=400, detail="Tidak ada field yang di-update")
        
        # Update di database
        update_result = client.table("advertisements").update(update_dict).eq("id", ad_id).execute()
        update_data = getattr(update_result, "data", []) or []
        
        if not update_data:
            raise HTTPException(status_code=404, detail="Advertisement not found")
        
        # Get the updated record with all fields
        get_result = client.table("advertisements").select("*").eq("id", ad_id).execute()
        get_data = getattr(get_result, "data", []) or []
        
        if not get_data:
            # Use update_data as fallback
            advertisement = update_data[0]
        else:
            advertisement = get_data[0]
        
        advertisement["src"] = get_public_url(advertisement["src"])
        
        return advertisement
        
    except HTTPException:
        raise
    except SupabaseNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        print(f"[ERROR] Failed to update advertisement: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update advertisement: {str(e)}")


@router.delete("/{ad_id}", status_code=204)
async def delete_advertisement(
    ad_id: str,
    current_user = Depends(require_admin_token),
):
    """
    Delete iklan (hapus file dan record) (admin only)
    """
    try:
        client = get_client()
        
        # 1. Get file path dari database
        get_result = client.table("advertisements").select("src").eq("id", ad_id).execute()
        get_data = getattr(get_result, "data", []) or []
        
        if not get_data:
            raise HTTPException(status_code=404, detail="Advertisement not found")
        
        file_path = get_data[0].get("src")
        
        # 2. Delete file dari storage (jika ada)
        if file_path:
            try:
                bucket = client.storage.from_("advertisements")
                bucket.remove([file_path])
            except Exception as e:
                # Continue even if file delete fails (might already be deleted)
                print(f"[WARN] Failed to delete file from storage: {e}")
        
        # 3. Delete record dari database
        delete_result = client.table("advertisements").delete().eq("id", ad_id).execute()
        
        return None
        
    except HTTPException:
        raise
    except SupabaseNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        print(f"[ERROR] Failed to delete advertisement: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete advertisement: {str(e)}")


@router.patch("/reorder", status_code=200)
async def reorder_advertisements(
    request: ReorderRequest,
    current_user = Depends(require_admin_token),
):
    """
    Reorder iklan (update display_order untuk multiple iklan) (admin only)
    """
    try:
        client = get_client()
        
        # Update semua dalam batch
        for order_item in request.orders:
            ad_id = order_item.get("id")
            display_order = order_item.get("display_order")
            
            if ad_id and display_order is not None:
                client.table("advertisements").update({"display_order": display_order}).eq("id", ad_id).execute()
        
        return {"status": "ok", "message": "Reorder successful"}
        
    except SupabaseNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        print(f"[ERROR] Failed to reorder advertisements: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to reorder advertisements: {str(e)}")

