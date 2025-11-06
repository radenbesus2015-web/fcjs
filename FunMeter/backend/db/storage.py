from __future__ import annotations

import os
import time
from typing import Optional, Tuple
from uuid import uuid4

import cv2 as cv
import numpy as np

from .supabase_client import get_client, get_default_org_id


FACES_BUCKET = "faces"


def _face_object_path(ext: str = "jpg") -> str:
    org_id = get_default_org_id()
    suffix = ext.lstrip(".").lower()
    return f"{org_id}/{uuid4().hex}.{suffix}"


def upload_face_bgr(person_id: str, bgr: np.ndarray, *, previous_path: Optional[str] = None) -> Tuple[str, str]:
    """Upload a face image (BGR) to Supabase Storage.

    Returns (storage_path, public_url_with_version_param)
    """
    ok, buf = cv.imencode(".jpg", bgr, [cv.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        raise RuntimeError("failed to encode image")
    data = buf.tobytes()
    client = get_client()
    bucket = client.storage.from_(FACES_BUCKET)
    path = _face_object_path("jpg")
    bucket.upload(
        path,
        data,
        file_options={"content-type": "image/jpeg", "upsert": "true"},
    )
    # Clean up previous object if provided (skip legacy local paths)
    if previous_path and not previous_path.startswith("uploads/") and not os.path.isabs(previous_path):
        try:
            bucket.remove(previous_path)
        except Exception:
            pass
    public_url = bucket.get_public_url(path)
    v = str(int(time.time()))
    url = f"{public_url}&v={v}" if "?" in public_url else f"{public_url}?v={v}"
    return path, url


def get_face_public_url(path: str, version: Optional[str] = None) -> str:
    client = get_client()
    url = client.storage.from_(FACES_BUCKET).get_public_url(path)
    if version:
        sep = "&" if "?" in url else "?"
        return f"{url}{sep}v={version}"
    return url


def delete_face_object(path: str) -> None:
    client = get_client()
    bucket = client.storage.from_(FACES_BUCKET)
    try:
        if path and not path.startswith("uploads/") and not os.path.isabs(path):
            bucket.remove(path)
    except Exception:
        pass


def download_face_object(path: str) -> bytes:
    client = get_client()
    bucket = client.storage.from_(FACES_BUCKET)
    return bucket.download(path)
