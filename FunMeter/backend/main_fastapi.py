#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FastAPI + python-socketio version of the attendance + fun-meter server (API key auth).
- Socket.IO events: connect/disconnect, fun_frame, att_cfg, att_frame
- Attendance rules: MIN_COSINE_ACCEPT, cooldown, same-day-lock (WIB aware)
- Config nested: face_engine/* dan attendance/*
- YuNet knobs live-set via /config (score/nms/top_k)
- AUTH: Authorization header with Bearer API key (is_admin flag for admin endpoints)
"""
from __future__ import annotations

# ======== Env priming (reduce OpenCV noise / DLL path on Windows) ========
import os as _os

_os.environ.setdefault("OPENCV_LOG_LEVEL", "SILENT")
for _p in (
    r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.0\bin",
    r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.0\bin\x64",
    r"C:\Program Files\NVIDIA\CUDNN\v9.12\bin\13.0",
):
    if _os.path.isdir(_p):
        _os.add_dll_directory(_p)

# ======== Standard Library ========
import asyncio
import base64
import copy
import csv
import json
import math
import os
import tempfile
import threading
import time
import uuid
import zipfile
from contextlib import asynccontextmanager, suppress
from functools import lru_cache, partial
from io import BytesIO, StringIO
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Set, Tuple, Union, cast

# ======== Third Party ========
import anyio
import cv2 as cv
import numpy as np
import socketio
from datetime import datetime, timedelta, timezone
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from math import ceil
from pydantic import BaseModel, Field, field_validator, model_validator
from werkzeug.utils import secure_filename
from schemas import (
    AdminBulk,
    AdminUpdate,
    ApiKeyReset,
    AttendanceClear,
    AttendanceDailyDelete,
    AttendanceEventCreate,
    AttendanceEventUpdate,
    AttendanceOverride,
    AttendanceRule,
    AttendanceSchedulePayload,
    AttendanceUpdate,
    ConfigReset,
    ConfigUpdate,
    EventsBulkDelete,
    FaceEngineUpdate,
    LoginPayload,
    Promote,
    RegisterPayload,
    SetPasswordPayload,
    _OVERRIDE_ID_RE,
    _UUID_RE,
    set_attendance_grace_defaults,
)

from utils.face_engine import FaceEngine, COSINE_SIM_THRESH, BACKENDS  # noqa: E402
from core.runtime import engine as _rt_engine, ENGINE_LOCK as _RT_ENGINE_LOCK, engine_async_call as _rt_engine_async_call, engine_sync_call as _rt_engine_sync_call
from utils.config_store import DEFAULT_CONFIG, load_config, merge_config_with_defaults, save_config
from helpers.http import json_error as _http_json_error , pretty_json as _http_pretty_json
from helpers.time_utils import (
    ID_DAYS,
    WIB as WIB_TZ,
    clamp_int as _time_clamp_int,
    ensure_int as _time_ensure_int,
    fmt_wib_full as _time_fmt_wib_full,
    hhmm_to_minutes as _time_hhmm_to_minutes,
    humanize_secs as _time_humanize_secs,
    is_valid_hhmm as _time_is_valid_hhmm,
    normalize_hhmm as _time_normalize_hhmm,
    now_iso as _time_now_iso,
    parse_att_ts as _time_parse_att_ts,
    to_wib_iso as _to_wib_iso
)
from services import attendance_service as att_service
from services.register_db import (
    _iter_face_files,
    _load_face_watch_index,
    _save_face_watch_index,
    _gen_person_id,
    _upsert_register_entry_from_image,
    crop_face_image,
    auto_register_faces_once,
    face_hot_watcher as _face_hot_watcher,
)

from auth.users_repo import (
    delete_user_account,
    find_user_by_token,
    list_users,
    register_user_account,
    rotate_user_api_key,
    promote_or_demote_user,
    read_users,
)
from auth.deps import _extract_token_from_request
from db.attendance_repo import (
    list_events as repo_list_events,
    bulk_delete as repo_bulk_delete,
    insert_event as repo_insert_event,
)

from db.supabase_client import get_client, get_default_org_id

# =========================
# App & Paths
# =========================
BASE_DIR = Path(__file__).resolve().parent
MAX_ATT_EVENTS = int(os.getenv("ATT_MAX_EVENTS", 5000))  # hard cap
_ATT_GRACE_IN = int(DEFAULT_CONFIG["attendance"].get("grace_in_min", 10))
_ATT_GRACE_OUT = int(DEFAULT_CONFIG["attendance"].get("grace_out_min", 5))
ATT_OVERRIDES: List[Dict[str, Any]] = []

set_attendance_grace_defaults(_ATT_GRACE_IN, _ATT_GRACE_OUT)

_ATT_DB_CACHE: Dict[str, Any] = {}
_ATT_DB_CACHE_TS: float = 0.0

_GROUP_MEMBERS_CACHE: Dict[str, Set[str]] = {}
_GROUP_META_CACHE: Dict[str, Dict[str, str]] = {}
_GROUP_MEMBERS_CACHE_TS: float = 0.0
_GROUP_MEMBERS_CACHE_TTL: float = 120.0

_REGISTER_PREVIEW_CACHE: Dict[str, Dict[str, Any]] = {}
_REGISTER_PREVIEW_LOCK = threading.RLock()
_REGISTER_PREVIEW_TTL = 600.0
_REGISTER_PREVIEW_MAX = 256

engine = _rt_engine
ENGINE_LOCK = _RT_ENGINE_LOCK
_LOCK = threading.RLock()

@lru_cache(maxsize=1)
def _load_reg_list_cached() -> List[dict]:
    """Load registered faces from database with caching for performance."""
    try:
        client = get_client()
        org_id = get_default_org_id()

        # kasih tahu Pylance kalau hasil execute() adalah object dengan attribute `.data`
        res = cast(Any, client.table("register_faces")
                            .select("id, org_id, person_id, label, embedding, photo_path, x, y, width, height, ts")
                            .eq("org_id", org_id)
                            .order("id")
                            .execute())

        # pastikan kita ambil data dengan aman
        rows = getattr(res, "data", None)
        if not rows:
            print("[WARNING] No data returned from register_faces table")
            return []

        from db.storage import get_face_public_url  # type: ignore[no-redef]

        out: List[dict] = []
        for it in rows:
            try:
                photo_path = it.get("photo_path")
                photo_url = None
                if photo_path:
                    version = None
                    try:
                        version = str(it.get("ts") or "") or None
                    except Exception:
                        version = None
                    try:
                        photo_url = get_face_public_url(photo_path, version)
                    except Exception as e:
                        print(f"[WARNING] Failed to generate photo_url for {photo_path}: {e}")
                        photo_url = None
                
                out.append({
                    "id": it.get("id"),
                    "person_id": it.get("person_id"),
                    "label": it.get("label"),
                    "embedding": it.get("embedding") or [],
                    "photo_path": photo_path,
                    "photo_url": photo_url,
                    "x": it.get("x"),
                    "y": it.get("y"),
                    "width": it.get("width"),
                    "height": it.get("height"),
                    "ts": it.get("ts"),
                })
            except Exception as e:
                print(f"[ERROR] Failed to process register entry: {e}")
                continue

        return out

    except Exception as e:
        print(f"[ERROR] Failed to load register list: {e}")
        return []

def _load_reg_list() -> List[dict]:
    """Load registered faces from database with proper error handling."""
    return _load_reg_list_cached()

def _invalidate_reg_list_cache():
    """Invalidate the register list cache."""
    _load_reg_list_cached.cache_clear()

def _parse_embedding_field(raw: Any) -> tuple[bool, list[float] | None, str]:
    """
    Parse embedding field from database with robust error handling.
    Supports: list/tuple, numpy array, JSON string, Postgres array string.
    Returns: (success, embedding_list, error_message)
    """
    try:
        if raw is None:
            return False, None, "empty(None)"

        vals: List[float] = []
        
        # Handle numpy arrays
        if isinstance(raw, np.ndarray):
            if raw.size == 0:
                return False, None, "empty numpy array"
            try:
                vals = raw.reshape(-1).astype(np.float32).tolist()
            except Exception as e:
                return False, None, f"numpy conversion error: {e}"
                
        # Handle lists/tuples
        elif isinstance(raw, (list, tuple)):
            if len(raw) == 0:
                return False, None, "empty list/tuple"
            for i, v in enumerate(raw):
                if v is None:
                    return False, None, f"None at index {i}"
                try:
                    vals.append(float(v))
                except (ValueError, TypeError) as e:
                    return False, None, f"non-numeric at index {i}: {type(v).__name__} ({e})"
                    
        # Handle string formats
        elif isinstance(raw, str):
            s = raw.strip()
            if not s:
                return False, None, "empty string"
                
            # JSON format: "[1,2,3]"
            if s.startswith('[') and s.endswith(']'):
                try:
                    arr = json.loads(s)
                    if not isinstance(arr, list):
                        return False, None, "JSON not a list"
                    if len(arr) == 0:
                        return False, None, "empty JSON array"
                    vals = [float(v) for v in arr]
                except json.JSONDecodeError as e:
                    return False, None, f"JSON parse error: {e}"
                except (ValueError, TypeError) as e:
                    return False, None, f"JSON numeric conversion error: {e}"
                    
            # Postgres array format: "{1,2,3}"
            elif s.startswith('{') and s.endswith('}'):
                inner = s[1:-1].strip()
                if not inner:
                    return False, None, "empty Postgres array"
                try:
                    parts = [p.strip().strip('"') for p in inner.split(',')]
                    vals = [float(p) for p in parts]
                except ValueError as e:
                    return False, None, f"Postgres array conversion error: {e}"
            else:
                return False, None, f"unsupported string format: {s[:20]}..."
        else:
            return False, None, f"unsupported type: {type(raw).__name__}"

        # Validate dimensions
        if len(vals) < 64:
            return False, None, f"dimension too small: {len(vals)} < {64}"
            
        # Check for invalid values
        invalid_count = sum(1 for v in vals if v is None or math.isinf(v) or math.isnan(v))
        if invalid_count > 0:
            return False, None, f"found {invalid_count} invalid values (None/inf/nan)"

        # Normalize to unit vector
        try:
            arr = np.asarray(vals, dtype=np.float32).reshape(-1)
            norm = float(np.linalg.norm(arr))
            if norm == 0.0:
                return False, None, "zero norm vector"
            arr /= norm
            vals = arr.tolist()
        except Exception as e:
            return False, None, f"normalization error: {e}"

        return True, vals, f"success: dim={len(vals)}, norm≈1.0"
        
    except Exception as e:
        return False, None, f"unexpected error: {e}"

def _engine_refresh_from_register(reason: str | None = None, aggressive_purge: bool = False) -> dict:
    """Refresh engine with registered faces using unified embedding flow."""
    # print(f"[DEBUG] Starting engine refresh: {reason or 'manual'}")

    try:
        entries = _load_reg_list()
        # print(f"[DEBUG] Loaded {len(entries)} entries from register_faces")
    except Exception as e:
        print(f"[ERROR] Failed to load register list: {e}")
        return {"labels": [], "errors": [f"Failed to load register list: {e}"], "skipped": []}

    refreshed: List[str] = []
    errors: List[str] = []
    skipped: List[str] = []
    entries_modified = False
    processed_count = 0

    with ENGINE_LOCK:
        try:
            current_before = set(getattr(engine, "db", {}).keys()) if hasattr(engine, "db") else set()
            redis_enabled = getattr(engine, "redis_db", None) is not None
            # print(f"[DEBUG] Initial state: mem_labels={len(current_before)}, redis={'on' if redis_enabled else 'off'}")

            seen_labels: Set[str] = set()

            for entry in entries:
                label = str(entry.get("label", "")).strip()
                if not label:
                    skipped.append("empty label")
                    continue

                seen_labels.add(label)
                processed_count += 1

                # Ensure embedding + register via unified helper (sync)
                try:
                    res = _ensure_entry_embedding_and_register_sync(entry, bgr=None, row=None, label=label, save_back=True)
                    if res.get("ok"):
                        refreshed.append(label)
                        # if helper persisted entry, we mark modified
                        if res.get("emb"):
                            entries_modified = True
                        continue
                    else:
                        errors.append(f"{label}: {res.get('msg')}")
                        continue
                except Exception as e:
                    errors.append(f"{label}: helper exception: {e}")
                    continue

            # Optional aggressive purge
            if aggressive_purge and seen_labels:
                try:
                    mem_labels = set(getattr(engine, "db", {}).keys()) if hasattr(engine, "db") else set()
                    to_delete = mem_labels - seen_labels
                    if to_delete:
                        # print(f"[DEBUG] Purging {len(to_delete)} orphaned labels")
                        for lab in to_delete:
                            try:
                                if engine.redis_db is not None:
                                    engine.redis_db.delete_label(lab)
                                if hasattr(engine, "db") and lab in engine.db:
                                    del engine.db[lab]
                                for method_name in ["forget_label", "remove_label"]:
                                    if hasattr(engine, method_name):
                                        try:
                                            getattr(engine, method_name)(lab)
                                            break
                                        except Exception:
                                            continue
                            except Exception as e:
                                errors.append(f"purge {lab}: {e}")
                except Exception as e:
                    errors.append(f"purge operation failed: {e}")

        except Exception as e:
            errors.append(f"engine refresh critical error: {e}")
            print(f"[ERROR] Critical error in engine refresh: {e}")

    # Persist modified entries back if any
    if entries_modified:
        try:
            _save_reg_list(entries)
            # print("[DEBUG] Persisted updated embeddings to register list")
        except Exception as e:
            print(f"[WARN] failed to persist updated embeddings: {e}")
            errors.append(f"persist_embeddings_failed: {e}")

    # Log results
    # print(f"[DEBUG] Refresh completed: processed={processed_count}, injected={len(refreshed)}, skipped={len(skipped)}, errors={len(errors)}")
    # if skipped:
        # print(f"[DEBUG] Skip reasons: {'; '.join(skipped[:3])}{'...' if len(skipped) > 3 else ''}")

    with ENGINE_LOCK:
        final_labels = len(getattr(engine, "db", {})) if hasattr(engine, "db") else 0
        redis_ready = getattr(engine, "redis_db", None) is not None

    print(f"[ENGINE] Final state: {final_labels} labels in memory, redis={'on' if redis_ready else 'off'}")
    print(f"[ENGINE] System ready for offline recognition: {final_labels > 0 or redis_ready}")
    if reason:
        print(f"[ENGINE] refresh ({reason}) labels={len(refreshed)} errors={len(errors)}")
    return {"labels": refreshed, "errors": errors, "skipped": skipped}

async def _engine_refresh_async(reason: str | None = None) -> dict:
    result = await asyncio.to_thread(_engine_refresh_from_register, reason)
    # print("[DEBUG] Engine refresh done:", reason)
    return result

# =========================
# Startup tasks
# =========================
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager with optimized startup and shutdown."""
    print("[STARTUP] Initializing application...")
    
    try:
        # Load users synchronously (fast operation)
        read_users()
        print("[STARTUP] Users loaded successfully")
    except Exception as e:
        print(f"[ERROR] Failed to load users: {e}")

    # Initialize face database with error handling
    try:
        print("[STARTUP] Initializing face database...")
        
        # Migrate register IDs if needed
        try:
            _migrate_register_ids()
            _ensure_register_person_ids(_load_reg_list())
            print("[STARTUP] Register ID migration completed")
        except Exception as e:
            print(f"[WARNING] Register ID migration failed: {e}")

        # Load and refresh engine
        reg_list = _load_reg_list()
        if reg_list:
            print(f"[STARTUP] Found {len(reg_list)} registered faces, refreshing engine...")
            
            # Check how many have embeddings for offline use
            embedding_count = sum(1 for entry in reg_list if entry.get("embedding"))
            print(f"[STARTUP] {embedding_count}/{len(reg_list)} faces have embeddings for offline recognition")
            
            await _engine_refresh_async("startup_load_register")
            print("[STARTUP] Engine refresh completed - ready for offline recognition")
        else:
            print("[STARTUP] No registered faces found")
            
    except Exception as e:
        print(f"[ERROR] Face database initialization failed: {e}")
    
    # === APPLICATION RUNNING ===
    yield

    # === SHUTDOWN ===
    print("[SHUTDOWN] Shutting down application...")
    
    # Cancel face watcher task
    task = getattr(app.state, "face_watch_task", None)
    if task and not task.done():
        print("[SHUTDOWN] Cancelling face watcher...")
        task.cancel()
        try:
            with suppress(asyncio.CancelledError):
                await asyncio.wait_for(task, timeout=5.0)
        except asyncio.TimeoutError:
            print("[WARNING] Face watcher did not shut down gracefully")
        except Exception as e:
            print(f"[WARNING] Error during face watcher shutdown: {e}")
    
    print("[SHUTDOWN] Application shutdown complete")

# FastAPI
app = FastAPI(
    title="Attendance + Fun Meter Server",
    description=(
        "Seluruh endpoint membutuhkan Authorization Bearer API key yang bisa didapat dari login."
    ),
    swagger_ui_parameters={"persistAuthorization": True, "defaultModelsExpandDepth": -1},
    lifespan=lifespan, 
)

app.add_middleware(
    CORSMiddleware,
    # allow_origins=["*"],  # dev only
    allow_origins=["http://127.0.0.1:5173", "http://localhost:3000", "http://127.0.0.1:3000", ""],  # dev only
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

bearer_security = HTTPBearer(
    auto_error=False,
    scheme_name="APIKeyAuth",
    bearerFormat="API_KEY",
    description="Masukkan header Authorization dengan format: Bearer <API_KEY>.",
)

templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
print("[ATT] BASE_DIR:", BASE_DIR)

# Routers
try:
    from routes import (
        orgs,
        billing,
        auth,
        public_api,
        admin_attendance,
        admin_system,
        admin_users,
        config,
        register_db,
        public_vision,
        ui_redirects,
    )
    app.include_router(orgs.router)
    app.include_router(billing.router)
    app.include_router(auth.router)
    app.include_router(public_api.router)
    app.include_router(admin_attendance.router)
    app.include_router(admin_system.router)
    app.include_router(admin_users.router)
    app.include_router(config.router)
    app.include_router(register_db.router)
    app.include_router(public_vision.router)
    try:
        from routes import advertisements
        app.include_router(advertisements.router)
    except Exception as _e:
        print("[ROUTER] advertisements router not loaded:", _e)
    # Redirect UI paths to Next.js app so backend has the same "tampilan" when accessed directly
    app.include_router(ui_redirects.router)
except Exception as _e:
    print("[ROUTER] optional routers not loaded:", _e)

# Socket.IO server (ASGI)
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*", max_http_buffer_size=5_000_000)
sio_app = socketio.ASGIApp(sio, other_asgi_app=app)

_processing: set[str] = set()
_last_proc: Dict[str, float] = {}
_att_processing: set[str] = set()
_att_last_proc: Dict[str, float] = {}
_att_cfg: Dict[str, Dict[str, Any]] = {}
_att_prev_set: Dict[str, set] = {}
_att_hold_frames: Dict[str, int] = {} 
_msg_delay_until: Dict[str, float] = {}
_LOGIN_MSG_DELAY_SEC = float(os.getenv("LOGIN_MSG_DELAY_SEC", "2"))

def _emotion_meta() -> Dict[str, Any]:
    labs = getattr(engine, "emotion_labels", [])
    emo = getattr(engine, "emotion", None)
    model = None
    if emo is not None:
        cname = emo.__class__.__name__
        model = str(cname)
    return {"labels": labs, "model": model, "count": len(labs)}

def _imdecode_upload_bytes(data: bytes) -> np.ndarray:
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv.imdecode(arr, cv.IMREAD_COLOR)
    if img is None:
        raise ValueError("Failed to decode image")
    return img

def _decode_ws_payload(data: Any) -> Optional[np.ndarray]:
    if isinstance(data, (bytes, bytearray)):
        try: return _imdecode_upload_bytes(data)
        except Exception: return None
    if isinstance(data, dict) and "b64" in data:
        s = data["b64"]
        if isinstance(s, str):
            if s.startswith("data:image"): s = s.split(",", 1)[1]
            try:
                raw = base64.b64decode(s)
                return _imdecode_upload_bytes(raw)
            except Exception:
                return None
    return None

def _clamp_threshold(value: float) -> float:
    """Clamp threshold to at least MIN_COSINE_ACCEPT and at most 1.0."""
    return max(MIN_COSINE_ACCEPT, min(1.0, float(value)))

def _resolve_threshold(raw: Optional[float] = None) -> float:
    """
    Resolve a cosine threshold ensuring it respects the configured minimum.
    Accepts None or <=0 values to fall back to engine/min configuration.
    """
    try:
        if raw is not None:
            value = float(raw)
            if value > 0:
                return _clamp_threshold(value)
    except (TypeError, ValueError):
        pass
    base = getattr(engine, "min_cosine_accept", MIN_COSINE_ACCEPT)
    try:
        base = float(base)
    except (TypeError, ValueError):
        base = MIN_COSINE_ACCEPT
    return _clamp_threshold(base)

def _labels_set(rec, th: float) -> set[str]:
    names = set()
    for _row, lab, sc in rec:
        if lab != "Unknown" and float(sc) >= th:
            names.add(lab)
    return names

def _jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b: return 1.0
    inter = len(a & b); union = len(a | b)
    return inter / union if union else 0.0

def _next_free_id(items: List[dict]) -> int:
    used: set[int] = set()
    for it in items:
        try:
            used.add(int(it.get("id", 0)))
        except Exception:
            pass
    i = 1
    while i in used:
        i += 1
    return i

# Map sanitized filename base back to original label if possible
def _restore_label_from_safe_base(safe_base: str) -> str:
    base = str(safe_base or "").strip()
    if not base:
        return base
    try:
        items = _load_reg_list()
        for it in items:
            lab = str(it.get("label", "") or "").strip()
            if not lab:
                continue
            if secure_filename(lab) == base:
                return lab
    except Exception:
        pass
    # Fallback: replace underscore with space for best effort
    return base.replace("_", " ")

# =========================
# Attendance helpers
# =========================
def _fetch_attendance_events(limit: int = MAX_ATT_EVENTS) -> List[Dict[str, Any]]:
    client = get_client()
    org_id = get_default_org_id()
    query = client.table("attendance_events").select(
        "id, label, person_id, score, ts"
    ).eq("org_id", org_id).order("ts", desc=True)
    if limit:
        query = query.limit(limit)
    res = query.execute()
    return getattr(res, "data", []) or []

def _get_attendance_cache() -> Optional[Dict[str, Any]]:
    """Get attendance cache with thread safety and memory optimization."""
    with _LOCK:
        if _ATT_DB_CACHE:
            # Use shallow copy for better performance, deep copy only when necessary
            return copy.deepcopy(_ATT_DB_CACHE)
    return None

def _set_attendance_cache(db: Dict[str, Any]) -> None:
    """Set attendance cache with memory management."""
    global _ATT_DB_CACHE, _ATT_DB_CACHE_TS
    with _LOCK:
        # Clear old cache to free memory
        if _ATT_DB_CACHE:
            _ATT_DB_CACHE.clear()
        _ATT_DB_CACHE = copy.deepcopy(db)
        _ATT_DB_CACHE_TS = time.time()

def invalidate_attendance_cache() -> None:
    """Invalidate attendance cache and free memory."""
    global _ATT_DB_CACHE, _ATT_DB_CACHE_TS
    with _LOCK:
        if _ATT_DB_CACHE:
            _ATT_DB_CACHE.clear()
        _ATT_DB_CACHE = {}
        _ATT_DB_CACHE_TS = 0.0

def load_attendance_db(force: bool = False) -> Dict[str, Any]:
    return att_service.load_attendance_db(force)

def save_attendance_db(db: Dict[str, Any]) -> None:
    att_service.save_attendance_db(db)

def _schedule_attendance_persist(db: Dict[str, Any]) -> None:
    att_service._schedule_attendance_persist(db)

def _ensure_register_person_ids(items: List[dict]) -> List[dict]:
    seen: set[str] = set()
    changed = False
    for it in items or []:
        pid = str(it.get("person_id", "") or "").strip()
        if pid and pid in seen:
            pid = ""
        if not pid:
            pid = _gen_person_id()
            it["person_id"] = pid
            changed = True
        seen.add(pid)
    if changed:
        try:
            _save_reg_list(items)
        except Exception:
            pass
    return items

def _label_to_person_id(label: Optional[str]) -> Optional[str]:
    if not label:
        return None
    try:
        items = _load_reg_list()
        try:
            _ensure_register_person_ids(items)
        except Exception:
            pass
        for it in items:
            if str(it.get("label", "")).strip() == str(label).strip():
                pid = str(it.get("person_id", "") or "").strip()
                return pid or None
    except Exception:
        return None
    return None

def _chunked(values: List[str], size: int) -> List[List[str]]:
    if size <= 0:
        size = 50
    return [values[i : i + size] for i in range(0, len(values), size)]

def _get_group_context(force_refresh: bool = False) -> Tuple[Dict[str, Set[str]], Dict[str, Dict[str, str]]]:
    global _GROUP_MEMBERS_CACHE, _GROUP_META_CACHE, _GROUP_MEMBERS_CACHE_TS
    now = time.time()
    if (
        not force_refresh
        and _GROUP_MEMBERS_CACHE
        and (now - _GROUP_MEMBERS_CACHE_TS) < _GROUP_MEMBERS_CACHE_TTL
    ):
        return _GROUP_MEMBERS_CACHE, _GROUP_META_CACHE
    try:
        client = get_client()
        org_id = get_default_org_id()
        groups_resp = client.table("groups").select("id,name,slug").eq("org_id", org_id).execute()
        groups_rows = getattr(groups_resp, "data", []) or []
        group_meta: Dict[str, Dict[str, str]] = {}
        group_ids: List[str] = []
        for row in groups_rows:
            gid = str(row.get("id") or "").strip()
            if not gid:
                continue
            group_ids.append(gid)
            group_meta[gid] = {
                "name": str(row.get("name") or "").strip(),
                "slug": str(row.get("slug") or "").strip(),
            }
        person_groups: Dict[str, Set[str]] = {}
        for chunk in _chunked(group_ids, 50):
            if not chunk:
                continue
            gm_resp = client.table("group_members").select("group_id,person_id").in_("group_id", chunk).execute()
            rows = getattr(gm_resp, "data", []) or []
            for row in rows:
                gid = str(row.get("group_id") or "").strip()
                pid = str(row.get("person_id") or "").strip()
                if not gid or not pid:
                    continue
                person_groups.setdefault(pid, set()).add(gid)
        _GROUP_MEMBERS_CACHE = person_groups
        _GROUP_META_CACHE = group_meta
        _GROUP_MEMBERS_CACHE_TS = now
    except Exception as exc:  # noqa: BLE001
        print("[WARN] failed to load group memberships:", exc)
    return _GROUP_MEMBERS_CACHE, _GROUP_META_CACHE

def _preview_cache_prune() -> None:
    now = time.time()
    with _REGISTER_PREVIEW_LOCK:
        expired = [token for token, entry in _REGISTER_PREVIEW_CACHE.items() if (now - entry["ts"]) > _REGISTER_PREVIEW_TTL]
        for token in expired:
            _REGISTER_PREVIEW_CACHE.pop(token, None)
        if len(_REGISTER_PREVIEW_CACHE) > _REGISTER_PREVIEW_MAX:
            tokens = sorted(_REGISTER_PREVIEW_CACHE.items(), key=lambda item: item[1]["ts"])
            for token, _ in tokens[: max(0, len(tokens) - _REGISTER_PREVIEW_MAX)]:
                _REGISTER_PREVIEW_CACHE.pop(token, None)

def _preview_cache_store(token: str, entry: Dict[str, Any]) -> None:
    entry["ts"] = time.time()
    with _REGISTER_PREVIEW_LOCK:
        _preview_cache_prune()
        _REGISTER_PREVIEW_CACHE[token] = entry

def _preview_cache_get(token: str) -> Optional[Dict[str, Any]]:
    with _REGISTER_PREVIEW_LOCK:
        entry = _REGISTER_PREVIEW_CACHE.get(token)
        if entry is None:
            return None
        if (time.time() - entry["ts"]) > _REGISTER_PREVIEW_TTL:
            _REGISTER_PREVIEW_CACHE.pop(token, None)
            return None
        return entry

def _preview_cache_consume(token: str) -> Optional[Dict[str, Any]]:
    with _REGISTER_PREVIEW_LOCK:
        return _REGISTER_PREVIEW_CACHE.pop(token, None)

def _check_mark_block(label: str):
    """
    Return (can_mark: bool, code: str, info: dict|None)
    code in {"ok","cooldown"}
    """
    db = att_service.load_attendance_db()
    ts = time.time()
    wib = timezone(timedelta(hours=7))
    now = datetime.now(wib)

    # Prefer person-id keyed gating if available
    pid = _label_to_person_id(label)
    if pid:
        last_ts = float(db.get("att_last_id", {}).get(pid, 0.0) or 0.0)
    else:
        last_ts = float(db.get("att_last", {}).get(label, 0.0) or 0.0)

    info_base = {
        "label": label,
        "person_id": pid,
        "now_iso": _to_wib_iso(now),
        "cooldown_sec": _COOLDOWN_SEC,
    }

    if not last_ts:
        return True, "ok", info_base

    last_dt = datetime.fromtimestamp(last_ts, wib)
    info_base |= {
        "last_ts": last_ts,
        "last_iso": _to_wib_iso(last_dt),  # ← ada +07:00
    }


    diff = ts - last_ts
    if diff < 0:
        # Treat future timestamps as cooled down (likely clock drift).
        diff = float(_COOLDOWN_SEC)

    remaining = _COOLDOWN_SEC - diff
    if remaining > 0:
        remaining_clamped = int(max(0, round(remaining)))
        until_ts = last_ts + _COOLDOWN_SEC
        until = datetime.fromtimestamp(until_ts, wib)
        info = {
            **info_base,
            "until_ts": until_ts,
            "until_iso": _to_wib_iso(until),
            "remaining_sec": remaining_clamped,
        }
        return False, "cooldown", info

    return True, "ok", info_base

def _mark_attendance(label: str, score: float) -> bool:
    ok = att_service.mark_attendance(label, score)
    if not ok:
        return False
    # mirror ke Supabase (biar /attendance-log kebagian event yang sama)
    try:
        pid = _label_to_person_id(label)
        repo_insert_event(label=label, score=float(score), ts_text=None, person_id=pid)
    except Exception as e:
        print(f"[WARN] failed to mirror attendance to Supabase: {e}")
    return True

def _time_ensure_int(value: Any, default: int = 0, minimum: int = 0, maximum: int = 240) -> int:
    try:
        n = int(value)
    except Exception:
        n = default
    return max(minimum, min(maximum, n))

def _normalize_override_targets(raw_targets: Any) -> Optional[List[Dict[str, str]]]:
    if not raw_targets:
        return []
    normalized: List[Dict[str, str]] = []

    def _infer_type(value: str, hinted: Optional[str]) -> str:
        if hinted in {"person", "person_id"}:
            return "person"
        if hinted in {"group", "group_id"}:
            return "group"
        if _OVERRIDE_ID_RE.match(value):
            return "person"
        if _UUID_RE.match(value):
            return "group"
        return "person"

    def _extract(obj: Any) -> Optional[Dict[str, str]]:
        if obj is None:
            return None
        if isinstance(obj, dict):
            hinted = str(obj.get("type") or obj.get("target_type") or "").strip().lower()
            value_sources = (
                "value",
                "person_id" if hinted in {"person", "person_id"} else None,
                "group_id" if hinted in {"group", "group_id"} else None,
                "target_value",
                "label",
            )
            val = ""
            for key in value_sources:
                if not key:
                    continue
                candidate = obj.get(key)
                if candidate not in (None, ""):
                    val = str(candidate).strip()
                    if val:
                        break
            if not val:
                return None
            return {"type": _infer_type(val, hinted), "value": val}
        if isinstance(obj, str):
            val = obj.strip()
            if not val:
                return None
            return {"type": _infer_type(val, None), "value": val}
        try:
            val = str(obj).strip()
        except Exception:
            return None
        if not val:
            return None
        return {"type": _infer_type(val, None), "value": val}

    for item in raw_targets:
        data = _extract(item)
        if not data:
            continue
        key = (data["type"], data["value"])
        if any(existing["type"] == key[0] and existing["value"] == key[1] for existing in normalized):
            continue
        normalized.append(data)
        if len(normalized) >= 64:
            break
    return normalized

def _normalize_override_entry(entry: Any) -> Dict[str, Any]:
    ov = dict(entry or {})
    start = str(ov.get("start_date") or ov.get("startDate") or "").strip()
    end = str(ov.get("end_date") or ov.get("endDate") or start or "").strip()
    if end and start and end < start:
        start, end = end, start
    ov["start_date"] = start
    ov["end_date"] = end or start
    ov["label"] = str(ov.get("label") or "").strip() or "Jadwal Khusus"
    ov["enabled"] = bool(ov.get("enabled", True))
    if ov["enabled"]:
        ov["check_in"] = str(ov.get("check_in") or "").strip()
        ov["check_out"] = str(ov.get("check_out") or "").strip()
        ov["grace_in_min"] = _time_clamp_int(ov.get("grace_in_min"), 0, 240, _ATT_GRACE_IN)
        ov["grace_out_min"] = _time_clamp_int(ov.get("grace_out_min"), 0, 240, _ATT_GRACE_OUT)
    else:
        ov["check_in"] = ""
        ov["check_out"] = ""
        ov["grace_in_min"] = 0
        ov["grace_out_min"] = 0
    ov["notes"] = str(ov.get("notes") or "").strip()
    targets = _normalize_override_targets(ov.get("targets") or ov.get("target_list") or [])
    ov["targets"] = targets if targets else []
    return ov

# ========================= #
# Config (nested)           #
# ========================= #
def _apply_yunet_from_cfg(cfg: Dict[str, Any]) -> None:
    fe = cfg.get("face_engine", {}) or {}
    def _apply():
        if hasattr(engine, "detector") and engine.detector is not None:
            if "yunet_score_threshold" in fe:
                engine.detector.setScoreThreshold(float(fe["yunet_score_threshold"]))
            if "yunet_nms_threshold" in fe:
                engine.detector.setNMSThreshold(float(fe["yunet_nms_threshold"]))
            if "yunet_top_k" in fe:
                engine.detector.setTopK(int(fe["yunet_top_k"]))

    try:
        _rt_engine_sync_call(_apply)
    except Exception as e:
        print("[WARN] apply YuNet cfg failed:", e)

def _apply_config_globals(cfg: Dict[str, Any]) -> Dict[str, Any]:
    global CFG, FE, ATT, MIN_COSINE_ACCEPT, _COOLDOWN_SEC, _DOUBLE_MARK_INTERVAL
    global _MIN_INTERVAL, _ATT_MIN_INTERVAL, _ATT_GRACE_IN, _ATT_GRACE_OUT, ATT_OVERRIDES

    CFG = cfg
    FE = CFG.get("face_engine", {}) or {}
    ATT = CFG.get("attendance", {}) or {}
    att_cfg_normalized = att_service.configure_attendance(ATT, DEFAULT_CONFIG["attendance"], override_id_re=_OVERRIDE_ID_RE, uuid_re=_UUID_RE)
    ATT = att_cfg_normalized
    ATT.pop("same_day_lock", None)

    MIN_COSINE_ACCEPT = float(FE.get("min_cosine_accept", DEFAULT_CONFIG["face_engine"]["min_cosine_accept"]))
    try:
        setattr(engine, "min_cosine_accept", MIN_COSINE_ACCEPT)
    except Exception:
        pass
    _MIN_INTERVAL = float(FE.get("fun_ws_min_interval", DEFAULT_CONFIG["face_engine"]["fun_ws_min_interval"]))
    _ATT_MIN_INTERVAL = float(FE.get("att_ws_min_interval", DEFAULT_CONFIG["face_engine"]["att_ws_min_interval"]))

    _COOLDOWN_SEC = int(ATT.get("cooldown_sec", DEFAULT_CONFIG["attendance"]["cooldown_sec"]))
    _DOUBLE_MARK_INTERVAL = int(ATT.get("double_mark_interval_sec", DEFAULT_CONFIG["attendance"].get("double_mark_interval_sec", 0)))
    _ATT_GRACE_IN = _time_clamp_int(ATT.get("grace_in_min"), 0, 240, DEFAULT_CONFIG["attendance"]["grace_in_min"])
    _ATT_GRACE_OUT = _time_clamp_int(ATT.get("grace_out_min"), 0, 240, DEFAULT_CONFIG["attendance"]["grace_out_min"])
    ATT["grace_in_min"] = _ATT_GRACE_IN
    ATT["grace_out_min"] = _ATT_GRACE_OUT
    ATT_OVERRIDES = [_normalize_override_entry(entry) for entry in (ATT.get("overrides") or [])]
    ATT["overrides"] = ATT_OVERRIDES

    set_attendance_grace_defaults(_ATT_GRACE_IN, _ATT_GRACE_OUT)

    _apply_yunet_from_cfg(CFG)

    return CFG

def _merge_config_patch(a: dict, b: dict) -> dict:
    out = dict(a)
    for k, v in (b or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge_config_patch(out[k], v)
        else:
            out[k] = v
    return out

async def _apply_save_broadcast_config(cfg: Dict[str, Any]) -> Dict[str, Any]:
    global CFG

    merged = merge_config_with_defaults(cfg)
    CFG = _apply_config_globals(merged)
    save_config(CFG)

    try:
        await sio.emit("att_cfg_update", {"config": CFG})
    except Exception:
        pass

    return CFG

# Load & apply
CFG = _apply_config_globals(load_config())
FE  = CFG.get("face_engine", {})
ATT = CFG.get("attendance", {})

# =========================
# Socket.IO state & events
# ========================= 
async def _engine_recognize(bgr: np.ndarray, th: Optional[float] = None):
    """Recognize faces using pre-loaded embeddings (offline mode)."""
    threshold = _resolve_threshold(th)
    
    return await _rt_engine_async_call(engine.recognize, bgr, threshold)  # type: ignore[arg-type]

async def _emit_att_log_snapshot(sid: str) -> None:
    try:
        await sio.emit("att_log", {"refresh": True}, to=sid)
    except Exception:
        pass

@sio.event
async def connect(sid: str, environ: dict):
    """Handle client connection with optimized initialization."""
    try:
        # Send emotion analysis metadata
        meta = _emotion_meta()
        await sio.emit("fun_ready", {"ok": True, **meta}, to=sid)

        # Initialize attendance configuration
        default_th = _clamp_threshold(float(ATT.get("min_cosine_accept", FE.get("min_cosine_accept", COSINE_SIM_THRESH))))
        if sid not in _att_cfg:
            _att_cfg[sid] = {"th": default_th, "mark": True}
            
        await sio.emit("att_ready", {"ok": True, **_att_cfg[sid], "config": CFG}, to=sid)
        await _emit_att_log_snapshot(sid)
        
        # Set message delay
        _msg_delay_until[sid] = time.time() + _LOGIN_MSG_DELAY_SEC
        
        print(f"[CONNECT] Client {sid} connected successfully")
        
    except Exception as e:
        print(f"[ERROR] Connection setup failed for {sid}: {e}")
        try:
            await sio.emit("error", {"message": "Connection setup failed"}, to=sid)
        except Exception:
            pass

@sio.event
async def disconnect(sid: str):
    """Handle client disconnection with proper cleanup."""
    try:
        # Clean up processing states
        _processing.discard(sid)
        _last_proc.pop(sid, None)
        _att_processing.discard(sid)
        _att_last_proc.pop(sid, None)
        
        # Clean up configuration and data
        _att_cfg.pop(sid, None)
        _att_prev_set.pop(sid, None)
        _att_hold_frames.pop(sid, None)
        _msg_delay_until.pop(sid, None)
        
        print(f"[DISCONNECT] Client {sid} disconnected and cleaned up")
        
    except Exception as e:
        print(f"[ERROR] Error during disconnect cleanup for {sid}: {e}")

@sio.on("fun_frame")  # type: ignore
async def fun_frame(sid: str, data: Any):
    """Process emotion analysis frame with rate limiting and error handling."""
    now = time.time()
    last = _last_proc.get(sid, 0.0)
    
    # Rate limiting
    if (now - last) < _MIN_INTERVAL:
        return
    if sid in _processing:
        return

    _processing.add(sid)
    _last_proc[sid] = now
    
    try:
        # Decode frame
        bgr = _decode_ws_payload(data)
        if bgr is None:
            await sio.emit("fun_error", {"message": "cannot decode frame"}, to=sid)
            return
            
        # Analyze emotions asynchronously
        emo_results = await _rt_engine_async_call(engine.analyze_emotions, bgr)
        
        # Process results
        out = []
        labels = getattr(engine, "emotion_labels", [])
        meta = _emotion_meta()
        
        for row, probs, top_label, top_prob, fun_score in emo_results:
            try:
                x, y, w, h = [int(v) for v in row[:4]]
                out.append({
                    "bbox": [x, y, w, h],
                    "top": {"label": top_label, "prob": float(top_prob)},
                    "fun": float(fun_score),
                    "probs": {lab: float(p) for lab, p in zip(labels, probs)},
                })
            except (ValueError, IndexError) as e:
                print(f"[WARNING] Invalid emotion result for {sid}: {e}")
                continue
                
        # Send results
        await sio.emit("fun_result", {
            "results": out, 
            "t": now, 
            "labels": labels,
            "model": meta["model"], 
            "label_count": len(labels)
        }, to=sid)
        
    except Exception as e:
        print(f"[ERROR] Emotion analysis failed for {sid}: {e}")
        try:
            await sio.emit("fun_error", {"message": str(e)}, to=sid)
        except Exception:
            pass
    finally:
        _processing.discard(sid)

@sio.on("att_cfg")  # type: ignore
async def att_cfg(sid: str, data: Any):
    """Handle attendance configuration updates with validation."""
    try:
        # Get current config or create default
        default_th = _clamp_threshold(float(ATT.get("min_cosine_accept", FE.get("min_cosine_accept", COSINE_SIM_THRESH))))
        cfg = _att_cfg.get(sid, {"th": default_th, "mark": True})
        
        # Update config with validation
        if isinstance(data, dict):
            if "th" in data:
                try:
                    cfg["th"] = _clamp_threshold(float(data["th"]))
                except (ValueError, TypeError) as e:
                    print(f"[WARNING] Invalid threshold for {sid}: {e}")
                    
            if "mark" in data:
                try:
                    cfg["mark"] = bool(data["mark"])
                except (ValueError, TypeError) as e:
                    print(f"[WARNING] Invalid mark value for {sid}: {e}")
        
        # Store updated config
        _att_cfg[sid] = cfg
        
        # Send confirmation
        await sio.emit("att_ready", {
            "ok": True, 
            "th": cfg["th"], 
            "mark": cfg["mark"]
        }, to=sid)
        
        print(f"[CONFIG] Updated attendance config for {sid}: th={cfg['th']}, mark={cfg['mark']}")
        
    except Exception as e:
        print(f"[ERROR] Attendance config update failed for {sid}: {e}")
        try:
            await sio.emit("error", {"message": "Configuration update failed"}, to=sid)
        except Exception:
            pass

@sio.on("att_frame")  # type: ignore
async def att_frame(sid: str, data: Any):
    now = time.time()
    last = _att_last_proc.get(sid, 0.0)
    if (now - last) < _ATT_MIN_INTERVAL: return
    if sid in _att_processing: return

    _att_processing.add(sid); _att_last_proc[sid] = now
    try:
        bgr = _decode_ws_payload(data)
        if bgr is None:
            await sio.emit("att_error", {"message": "cannot decode frame"}, to=sid); return

        cfg = _att_cfg.get(sid, {"th": COSINE_SIM_THRESH, "mark": True})
        th = _clamp_threshold(float(cfg.get("th", COSINE_SIM_THRESH)))
        do_mark = bool(cfg.get("mark", True))

        rec = await _engine_recognize(bgr, th)

        # Stabilizer: tahan marking kalau set label tidak banyak berubah
        cur_set = _labels_set(rec, th)
        prev_set = _att_prev_set.get(sid, set())
        hold_left = _att_hold_frames.get(sid, 0)

        if hold_left > 0:
            _att_hold_frames[sid] = hold_left - 1
            do_mark = False
        else:
            sim = _jaccard(cur_set, prev_set)
            do_mark = (sim < 0.7) and do_mark

        new_labels = cur_set - prev_set
        _att_prev_set[sid] = cur_set

        marked: List[str] = []
        marked_info: List[Dict[str, Any]] = []
        blocked_info: List[Dict[str, Any]] = []
        allow_msgs = (now >= _msg_delay_until.get(sid, 0.0))

        # Hitung blokir per label (cooldown/same-day)
        candidates: List[tuple] = []
        seen_labels: set[str] = set()

        for row, label, score in rec:
            if label == "Unknown" or float(score) < th:
                continue
            if label in seen_labels:
                continue
            seen_labels.add(label)

            can, code, info = _check_mark_block(label)
            if not can:
                blocked_info.append(_create_blocked_info(label, code, info, allow_msgs))

            else:
                candidates.append((row, label, score))

        # Mark attendance
        # Mark attendance (per-label logic):
        # - Tetap hormati stabilizer, tapi kalau cooldown label sudah habis
        #   atau label baru muncul, izinkan mark meski set tidak berubah.
        if cfg.get("mark", True):
            now_ts = time.time()
            db = att_service.load_attendance_db()
            att_last = db.get("att_last", {})

            def _cooldown_ready(lab: str) -> bool:
                last_ts = float(att_last.get(lab, 0.0) or 0.0)
                if last_ts <= 0:
                    return True
                if last_ts > now_ts:
                    return True
                return (now_ts - last_ts) >= max(0.0, float(_COOLDOWN_SEC) - 1e-3)

            for row, label, score in candidates:
                allow_this = False
                # 1) Jika frame “bergerak” (sim turun) → ikuti do_mark frame-level
                if do_mark:
                    allow_this = True
                # 2) Jika label baru nongol dibanding prev_set
                elif label in new_labels:
                    allow_this = True
                # 3) Jika cooldown label memang sudah selesai → override stabilizer 1x
                elif _cooldown_ready(label):
                    allow_this = True

                if not allow_this:
                    continue

                ok_mark = _mark_attendance(label, float(score))
                if ok_mark:
                    marked.append(label)
                    marked_info.append({
                        "label": label,
                        "score": float(score),
                        "ts": _time_now_iso()
                        # No message field - let frontend handle translation and formatting
                    })

        # Tahan satu frame hanya kalau ada toast yg tampil
        if marked or any(b.get("message") for b in blocked_info):
            _att_hold_frames[sid] = 1

        # Build results
        out: List[Dict[str, Any]] = []
        for row, label, score in rec:
            x, y, w, h = [int(v) for v in row[:4]]
            out.append({"bbox": [x, y, w, h], "label": label, "score": float(score)})

        await sio.emit("att_result", {
            "results": out,
            "marked": marked,
            "marked_info": marked_info,
            "blocked": blocked_info,
            "t": now
        }, to=sid)

        if marked:
            await _emit_att_log_snapshot(sid)

    except Exception as e:
        await sio.emit("att_error", {"message": str(e)}, to=sid)
    finally:
        _att_processing.discard(sid)

# =========================
# Unified Auth (session cookie)
# =========================
def _extract_bearer_token(request: Request) -> str:
    token = _extract_token_from_request(request)
    if not token:
        raise HTTPException(status_code=401, detail="Missing API token")
    return token

def _normalize_user_payload(entry: Dict[str, Any]) -> Dict[str, Any]:
    payload = {
        "id": entry.get("id"),
        "username": str(entry.get("username", "")).strip(),
        "is_admin": bool(entry.get("is_admin", False)),
        "is_owner": bool(entry.get("is_owner", False)),
        "api_key": entry.get("api_key"),
        "promoted_by": entry.get("promoted_by"),
        "promoted_at": entry.get("promoted_at"),
        "demoted_by": entry.get("demoted_by"),
        "demoted_at": entry.get("demoted_at"),
        "api_key_rotated_by": entry.get("api_key_rotated_by"),
        "api_key_rotated_at": entry.get("api_key_rotated_at"),
        "created_by": entry.get("created_by"),
        "created_at": entry.get("created_at"),
    }
    return payload

def _resolve_user_from_token(token: str) -> Dict[str, Any]:
    match = find_user_by_token(token)
    if not match:
        raise HTTPException(status_code=401, detail="API key invalid")
    username, info = match
    normalized = _normalize_user_payload({"username": username, **info})
    normalized["api_key"] = token
    return normalized

def require_user_token(credentials: HTTPAuthorizationCredentials = Depends(bearer_security)) -> dict:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    token = credentials.credentials.strip()
    if not token:
        raise HTTPException(status_code=401, detail="Invalid Authorization header")
    return _resolve_user_from_token(token)

def require_user_from_request(request: Request) -> dict:
    token = _extract_bearer_token(request)
    return _resolve_user_from_token(token)

def require_admin_token(user: dict = Depends(require_user_token)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="forbidden (admin only)")
    return user

def require_admin_from_request(request: Request) -> dict:
    user = require_user_from_request(request)
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="forbidden (admin only)")
    return user

def require_owner_token(user: dict = Depends(require_user_token)) -> dict:
    if not user.get("is_owner"):
        raise HTTPException(status_code=403, detail="forbidden (owner only)")
    return user

def require_owner_from_request(request: Request) -> dict:
    user = require_user_from_request(request)
    if not user.get("is_owner"):
        raise HTTPException(status_code=403, detail="forbidden (owner only)")
    return user

def _save_reg_list(data: List[dict]) -> None:
    """Save register list with optimized batch operations and error handling."""
    if not data:
        return
        
    try:
        from db.supabase_client import get_client, get_default_org_id
        client = get_client()
        org_id = get_default_org_id()
        
        # Prepare persons payload (batch operation)
        persons_payload = []
        for it in data:
            pid = (it.get("person_id") or "").strip()
            if pid:  # Only add if person_id exists
                persons_payload.append({
                    "person_id": pid,
                    "org_id": org_id,
                    "label": it.get("label"),
                    "photo_path": it.get("photo_path"),
                })
        
        # Batch upsert persons
        if persons_payload:
            client.table("persons").upsert(persons_payload, on_conflict="person_id").execute()
        
        # Clear existing register_faces for this org
        client.table("register_faces").delete().eq("org_id", org_id).execute()
        
        # Prepare register_faces payload (batch operation)
        rows = []
        for it in data:
            rows.append({
                "org_id": org_id,
                "id": it.get("id"),
                "person_id": it.get("person_id"),
                "label": it.get("label"),
                "embedding": it.get("embedding") or [],
                "photo_path": it.get("photo_path"),
                "x": it.get("x"),
                "y": it.get("y"),
                "width": it.get("width"),
                "height": it.get("height"),
                "ts": it.get("ts"),
            })
        
        # Batch insert register_faces
        if rows:
            client.table("register_faces").insert(rows).execute()
            
        print(f"[SAVE] Successfully saved {len(rows)} register entries")
        _invalidate_reg_list_cache()
        # Verify embedding storage for offline use
        embedding_count = sum(1 for row in rows if row.get("embedding"))
        print(f"[SAVE] {embedding_count}/{len(rows)} entries have embeddings for offline recognition")
        
    except Exception as e:
        print(f"[ERROR] Failed to save register list: {e}")
        raise

def _find_idx_by_id(data: List[dict], item_id: int) -> int:
    """Find index by ID with optimized search and error handling."""
    try:
        target_id = int(item_id)
        for i, it in enumerate(data):
            try:
                if int(it.get("id", 0)) == target_id:
                    return i
            except (ValueError, TypeError):
                continue
    except (ValueError, TypeError):
        pass
    return -1

def _migrate_register_ids() -> None:
    """Ensure every face entry in register-db has a unique integer id.

    For legacy datasets without 'id' or with non-integer/duplicate ids, assign new ids using
    the existing allocator. Saves back only when changes are made.
    """
    items = _load_reg_list()
    if not items:
        return
    seen: set[int] = set()
    changed = False
    # Collect valid existing ids
    for it in items:
        try:
            iid = int(it.get("id", 0) or 0)
            if iid > 0:
                if iid in seen:
                    # duplicate, mark to reassign
                    it["id"] = 0
                    changed = True
                else:
                    seen.add(iid)
            else:
                it["id"] = 0
        except Exception:
            it["id"] = 0
            changed = True

    # Assign for zero/invalid ids
    for it in items:
        try:
            if int(it.get("id", 0) or 0) <= 0:
                new_id = _alloc_new_id(items)
                # Avoid collision just in case
                while new_id in seen:
                    new_id = _alloc_new_id(items)
                it["id"] = new_id
                seen.add(new_id)
                changed = True
        except Exception:
            continue

    if changed:
        _save_reg_list(items)
        try:
            print(f"[MIGRATE] register-db: ensured ids for {len(items)} entries")
        except Exception:
            pass

def _engine_forget_label(label: str) -> bool:
    if not label:
        return False
    with ENGINE_LOCK:
        try:
            handled = False
            if hasattr(engine, "forget_label"):
                engine.forget_label(label)  # type: ignore[attr-defined]
                handled = True
            elif hasattr(engine, "remove_label"):
                engine.remove_label(label)  # type: ignore[attr-defined]
                handled = True

            if hasattr(engine, "db") and isinstance(engine.db, dict):
                engine.db.pop(label, None)
                handled = True

            if getattr(engine, "redis_db", None) is not None:
                try:
                    engine.redis_db.delete_label(label)  # type: ignore[union-attr]
                except Exception as e:
                    print("[ENGINE] redis delete failed:", e)

            return handled
        except Exception as e:
            print("[ENGINE] forget_label failed:", e)
            return False

def _create_blocked_info(label: str, code: str, info: dict | None, allow_msgs: bool) -> Dict[str, Any]:
    legacy_reason = "Tidak bisa absen sekarang"
    msg = None

    # Parse last/until pakai parser yang aware timezone
    last_txt = None
    if info and "last_iso" in info:
        dt = _time_parse_att_ts(str(info["last_iso"]))
        if dt:
            last_txt = _time_fmt_wib_full(dt)

    if allow_msgs:
        if code == "cooldown":
            sisa = info.get("remaining_sec", 0) if info else 0
            until_txt = None
            if info and "until_iso" in info:
                dt = _time_parse_att_ts(str(info["until_iso"]))
                if dt:
                    until_txt = _time_fmt_wib_full(dt)
                else:
                    until_txt = info.get("until_iso")
            # Don't format message here, let frontend handle i18n
            msg = None
        else:
            msg = legacy_reason

    return {
        "label": label,
        "reason": legacy_reason,
        "until": (info or {}).get("until_iso"),
        "until_formatted": until_txt if code == "cooldown" else None,
        "code": code,
        "message": msg,
        **(info or {}),
    }

def _resolve_entry_image_path(entry: dict, label: str) -> str | None:
    """Resolve image path for a face entry with optimized error handling."""
    try:
        # Try local file first (fastest)
        rel = (entry.get("photo_path") or entry.get("path") or "").strip()
        if rel:
            rel_norm = rel.replace("\\", "/").lstrip("/")
            local_candidate = os.path.join(BASE_DIR, rel_norm)
            if os.path.exists(local_candidate):
                return local_candidate
                
            # Try downloading from storage
            try:
                from db.storage import download_face_object
                data = download_face_object(rel_norm)
                if data:
                    _, ext = os.path.splitext(rel_norm)
                    tmp = tempfile.NamedTemporaryFile(
                        prefix=f"face_{label}_", 
                        suffix=(ext or ".jpg"), 
                        delete=False
                    )
                    tmp.write(data)
                    tmp.close()
                    return tmp.name
            except Exception as e:
                print(f"[WARNING] Failed to download {label} from storage: {e}")
                
        # Fallback to URL
        url = (entry.get("photo_url") or "").strip()
        if url.startswith("http"):
            try:
                from urllib.request import urlopen
                with urlopen(url, timeout=10) as resp:
                    if resp.status == 200:
                        content = resp.read()
                        if content:
                            tmp = tempfile.NamedTemporaryFile(
                                prefix=f"face_{label}_", 
                                suffix=".jpg", 
                                delete=False
                            )
                            tmp.write(content)
                            tmp.close()
                            return tmp.name
            except Exception as e:
                print(f"[WARNING] Failed to download {label} from URL: {e}")
                
    except Exception as e:
        print(f"[ERROR] Failed to resolve image path for {label}: {e}")
        
    return None

# -------------------------
# Unified embedding helper
# -------------------------
def _find_entry_in_reg_list(entries: List[dict], entry: dict) -> int:
    """Cari index berdasarkan id (prefer) lalu label sebagai fallback."""
    try:
        target_id = int(entry.get("id", 0) or 0)
    except Exception:
        target_id = 0
    if target_id:
        for i, it in enumerate(entries):
            try:
                if int(it.get("id", 0) or 0) == target_id:
                    return i
            except Exception:
                continue
    lab = str(entry.get("label", "") or "").strip()
    if lab:
        for i, it in enumerate(entries):
            try:
                if str(it.get("label", "") or "").strip() == lab:
                    return i
            except Exception:
                continue
    return -1

def _register_embedding_to_engine_sync(label: str, emb: List[float]) -> tuple[bool, str]:
    """Try to register embedding into engine (sync)."""
    try:
        ok, msg = engine.register_embedding(label, emb)  # type: ignore[arg-type]
        return bool(ok), str(msg or "")
    except Exception as e:
        return False, f"register_embedding exception: {e}"

def _compute_embedding_from_bgr_sync(bgr: np.ndarray, row: Optional[Union[List[float], np.ndarray]] = None) -> List[float]:
    """Sync helper: get embedding from engine and normalize (throws on failure)."""
    row_arg = None
    if row is not None:
        row_arg = np.asarray(row, dtype=np.float32)
    emb_raw = _rt_engine_sync_call(engine.get_embedding, bgr, row_arg)
    emb_norm = _normalize_emb_list(emb_raw)
    return emb_norm

def _ensure_entry_embedding_and_register_sync(entry: dict, *, bgr: Optional[np.ndarray] = None, row: Optional[Union[List[float], np.ndarray]] = None, label: Optional[str] = None, save_back: bool = True) -> dict:
    """
    Ensure entry has a valid embedding and is registered to engine.
    Returns dict: {"ok": bool, "label": str, "emb": Optional[List[float]], "msg": str}
    - Synchronous helper: uses _rt_engine_sync_call for engine ops.
    - If embedding missing/invalid, will try to resolve image path and compute embedding.
    - If save_back=True it will attempt to persist updated embedding into register_faces.
    """
    out = {"ok": False, "label": label or str(entry.get("label") or ""), "emb": None, "msg": ""}
    lab = str(label or entry.get("label") or "").strip()
    if not lab:
        out["msg"] = "no label"
        return out

    # 1) Try existing embedding
    raw_emb = entry.get("embedding")
    if raw_emb:
        ok, emb_vals, why = _parse_embedding_field(raw_emb)
        if ok and emb_vals:
            ok_reg, msg = _register_embedding_to_engine_sync(lab, emb_vals)
            if ok_reg:
                out.update({"ok": True, "emb": emb_vals, "msg": "loaded from existing embedding"})
                return out
            else:
                out["msg"] = f"existing embedding register failed: {msg}"
        else:
            out["msg"] = f"existing embedding invalid: {why}"

    # 2) Compute from provided bgr/row or resolve image path
    try:
        if bgr is not None:
            row_arg = row
            if row_arg is None:
                rec = _rt_engine_sync_call(engine.recognize, bgr, None)
                if not rec:
                    out["msg"] = "no face detected in provided image"
                    return out
                row_arg = rec[0][0]
            emb_list = _compute_embedding_from_bgr_sync(bgr, row_arg)
        else:
            img_path = _resolve_entry_image_path(entry, lab)
            if not img_path or not os.path.exists(img_path):
                out["msg"] = f"image not found ({img_path})"
                return out
            bgr_local = cv.imread(img_path)
            if bgr_local is None:
                out["msg"] = f"failed to load image ({img_path})"
                return out
            rec = _rt_engine_sync_call(engine.recognize, bgr_local, None)
            if not rec:
                out["msg"] = "no face detected in image"
                return out
            row_arg = rec[0][0]
            emb_list = _compute_embedding_from_bgr_sync(bgr_local, row_arg)

        # success computing embedding
        entry["embedding"] = emb_list
        out["emb"] = emb_list

        # persist back to register list (best-effort)
        if save_back:
            try:
                items = _load_reg_list()
                idx = _find_entry_in_reg_list(items, entry)
                if idx >= 0:
                    items[idx].update(entry)
                else:
                    items.append(entry)
                _save_reg_list(items)
            except Exception as e:
                out["msg"] = f"{out.get('msg','')} ; persist failed: {e}"

        ok_reg, msg = _register_embedding_to_engine_sync(lab, emb_list)
        if ok_reg:
            out.update({"ok": True, "msg": out.get("msg","") + " ; embedding computed & registered"})
        else:
            out.update({"ok": False, "msg": out.get("msg","") + f" ; register failed: {msg}"})
        return out

    except Exception as e:
        out["msg"] = f"exception: {e}"
        return out

def _engine_summary() -> Dict[str, Any]:
    with ENGINE_LOCK:
        backend_pair = (getattr(engine, "backend_id", None), getattr(engine, "target_id", None))
        backend_name = None
        for name, pair in BACKENDS.items():
            if pair == backend_pair:
                backend_name = name
                break

        emotion_model = None
        if getattr(engine, "emotion", None) is not None:
            emotion_model = engine.emotion.__class__.__name__

        labels = []
        if hasattr(engine, "db") and isinstance(engine.db, dict):
            labels = sorted(map(str, engine.db.keys()))

        return {
            "backend": backend_name or getattr(engine, "backend_name", "unknown"),
            "backend_id": backend_pair[0],
            "target_id": backend_pair[1],
            "label_count": len(labels),
            "labels": labels,
            "emotion_model": emotion_model,
            "emotion_labels": list(getattr(engine, "emotion_labels", [])),
        }

async def admin_attendance_clear(payload: AttendanceClear, _admin=Depends(require_admin_token)):
    label = (payload.label or "").strip()

    db = att_service.load_attendance_db()
    events = db.get("att_events", [])
    att_last = db.setdefault("att_last", {})
    att_count = db.setdefault("att_count", {})
    removed = 0

    if label:
        new_events = [ev for ev in events if str(ev.get("label", "")) != label]
        removed = len(events) - len(new_events)
        db["att_events"] = new_events
    else:
        removed = len(events)
        db["att_events"] = []
    # Recompute derived maps (label + person) sesuai DBML 
    att_last = {}
    att_count = {}
    att_last_id: Dict[str,float] = {} 
    att_count_id: Dict[str,int] = {}
    for ev in db.get("att_events", []):
        lab = str(ev.get("label",""))
        pid = str(ev.get("person_id") or _label_to_person_id(lab) or "")
        dt  = _time_parse_att_ts(str(ev.get("ts","")))
        if not lab or dt is None:
            continue
        ts = dt.timestamp()
        att_last[lab] = max(att_last.get(lab, 0.0), ts)
        att_count[lab] = att_count.get(lab, 0) + 1
        if pid:
            att_last_id[pid] = max(att_last_id.get(pid, 0.0), ts) 
            att_count_id[pid] = att_count_id.get(pid, 0) + 1
    db["att_last"] = att_last
    db["att_count"] = att_count
    db["att_last_id"] = att_last_id
    db["att_count_id"] = att_count_id

    save_attendance_db(db)

    try:
        await sio.emit("att_log", {"refresh": True})
    except Exception:
        pass

    return {"status": "ok", "removed": removed, "label": label or None}

def admin_attendance_export_csv(_admin=Depends(require_admin_token)):
    db = att_service.load_attendance_db()
    events = db.get("att_events", [])

    buf = StringIO()
    w = csv.writer(buf)
    w.writerow(["ts", "label", "score"])
    for ev in reversed(events):  # kronologis lama->baru opsional
        w.writerow([ev.get("ts",""), ev.get("label",""), ev.get("score","")])

    csv_data = buf.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="attendance_export.csv"'
        },
    )

# =========================
# Attendance daily aggregation (admin)
# =========================
def _override_matches_label(ov: dict, label: str, *, person_id: Optional[str] = None) -> bool:
    """Check whether the override targets the supplied label/person."""
    targets = ov.get("targets") or []
    if not targets:
        return True
    lab = str(label or "").strip()
    lab_cf = lab.casefold()
    pid = str(person_id or "").strip() or _label_to_person_id(lab) or ""
    face_id = ""
    try:
        # cari face_id dari register list (numeric id)
        data = _load_reg_list()
        for it in data:
            if str(it.get("label","")).strip() == lab:
                face_id = str(it.get("id") or "")
                break
    except Exception:
        pass
    groups_map: Dict[str, Set[str]] = {}
    groups_meta: Dict[str, Dict[str, str]] = {}
    groups_loaded = False

    for t in targets:
        if not isinstance(t, dict):
            # string legacy
            if str(t or "").strip().casefold() == lab_cf:
                return True
            continue
        raw_type = str(t.get("type") or "label").strip().lower()
        t_val  = str(t.get("value") or "").strip()
        if not t_val:
            continue
        if raw_type in {"person", "person_id"}:
            if pid and t_val == pid:
                return True
            continue
        if raw_type in {"group", "group_id"}:
            if not pid:
                continue
            if not groups_loaded:
                groups_map, groups_meta = _get_group_context()
                groups_loaded = True
            member_groups = groups_map.get(pid, set())
            if not member_groups:
                continue
            if t_val in member_groups:
                return True
            val_cf = t_val.casefold()
            for gid in member_groups:
                meta = groups_meta.get(gid) or {}
                if meta.get("slug", "").strip().casefold() == val_cf or meta.get("name", "").strip().casefold() == val_cf:
                    return True
            continue
        t_type = raw_type
        if t_type == "label" and t_val.casefold() == lab_cf:
            return True
        if t_type == "face_id" and face_id and t_val == face_id:
            return True
    return False

def _find_schedule_for_day(
    dt: datetime,
    label: Optional[str] = None,
    *,
    person_id: Optional[str] = None,
    overrides: Optional[List[Dict[str, Any]]] = None,
) -> dict:
    """Return schedule info for a given date, respecting overrides and weekly rules."""
    default = {
        "label": "Jam Kerja Normal",
        "enabled": True,
        "check_in": None,
        "check_out": None,
        "grace_in_min": _ATT_GRACE_IN,
        "grace_out_min": _ATT_GRACE_OUT,
        "notes": "",
        "source": "default",
        "override": None,
    }

    target = dt.strftime("%Y-%m-%d")

    # 1. Check overrides (exact date or range)
    try:
        best_override: Optional[Dict[str, Any]] = None
        best_span = None
        entries = overrides if overrides is not None else ATT_OVERRIDES
        for entry in entries:
            # targets kosong/null => global (berlaku untuk semua label)
            targets = entry.get("targets")
            if targets:
                if not _override_matches_label(entry, str(label), person_id=person_id):
                    continue
            start = entry.get("start_date")
            if not start:
                continue
            end = entry.get("end_date") or start
            if start <= target <= end:
                try:
                    start_dt = datetime.strptime(start, "%Y-%m-%d") 
                    end_dt = datetime.strptime(end, "%Y-%m-%d")
                    span = (end_dt - start_dt).days
                except Exception:
                    span = None
                if best_override is None:
                    best_override = entry
                    best_span = span
                else:
                    if span is None:
                        continue
                    if best_span is None or span < best_span:
                        best_override = entry
                        best_span = span
        if best_override:
            return {
                "label": best_override.get("label") or default["label"],
                "enabled": bool(best_override.get("enabled", True)),
                "check_in": best_override.get("check_in"),
                "check_out": best_override.get("check_out"),
                "grace_in_min": _time_clamp_int(best_override.get("grace_in_min"), 0, 240, _ATT_GRACE_IN),
                "grace_out_min": _time_clamp_int(best_override.get("grace_out_min"), 0, 240, _ATT_GRACE_OUT),
                "notes": str(best_override.get("notes") or "").strip(),
                "source": "override",
                "override": {
                    "id": best_override.get("id"),
                    "start_date": best_override.get("start_date"),
                    "end_date": best_override.get("end_date") or best_override.get("start_date"),
                    "targets": best_override.get("targets") or [],
                },
            }
    except Exception:
        pass

    # 2. Fallback to weekly rules
    try:
        rules = (CFG.get("attendance", {}) or {}).get("rules") or []
        if isinstance(rules, list):
            day_name = ID_DAYS[dt.weekday()]
            for r in rules:
                try:
                    if str(r.get("day", "")).strip() == day_name:
                        return {
                            "label": r.get("label") or default["label"],
                            "enabled": bool(r.get("enabled", True)),
                            "check_in": r.get("check_in"),
                            "check_out": r.get("check_out"),
                            "grace_in_min": _time_clamp_int(r.get("grace_in_min"), 0, 240, _ATT_GRACE_IN),
                            "grace_out_min": _time_clamp_int(r.get("grace_out_min"), 0, 240, _ATT_GRACE_OUT),
                            "notes": str(r.get("notes") or "").strip(),
                            "source": "weekly",
                            "override": None,
                        }
                except Exception:
                    continue
    except Exception:
        pass

    return default

def _build_daily_rows(q: Optional[str], start: Optional[str], end: Optional[str], order: Literal["asc","desc"]) -> List[Dict[str, Any]]:
    return att_service.build_daily_rows(q, start, end, order)

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
    rows_all = _build_daily_rows(q, start, end, order)
    if status and status != "all":
        if status == "late":
            rows_all = [r for r in rows_all if r.get("status_code") in {"late", "late_and_left_early"}]
        elif status == "left_early":
            rows_all = [r for r in rows_all if r.get("status_code") in {"left_early", "late_and_left_early"}]
        elif status == "off":
            rows_all = [r for r in rows_all if r.get("status_code") == "off"]
        elif status == "present":
            rows_all = [r for r in rows_all if r.get("status_code") == "present"]
        elif status == "mixed":
            rows_all = [r for r in rows_all if r.get("status_code") == "late_and_left_early"]
    total = len(rows_all)
    # handle per_page = 'all'
    use_all = isinstance(per_page, str) and per_page.lower() == "all"
    if use_all:
        out_items = rows_all
        total_pages = 1
        page = 1
        per_page_num = total or 1
    else:
        try:
            per_page_num = max(1, min(1000, int(per_page)))
        except Exception:
            per_page_num = 10
        total_pages = max(1, (total + per_page_num - 1) // per_page_num)
        page = max(1, min(page, total_pages))
        start_idx = (page - 1) * per_page_num
        end_idx = start_idx + per_page_num
        out_items = rows_all[start_idx:end_idx]

    meta = {
        "page": page,
        "per_page": (total if use_all else per_page_num),
        "total": total,
        "total_pages": total_pages,
        "order": order,
        "has_prev": page > 1,
        "has_next": page < total_pages,
    }
    return {"items": out_items, "meta": meta} 

def admin_attendance_summary(
    start: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    group: Literal["month", "week", "day"] = Query("month"),
    _admin=Depends(require_admin_token),
):
    return att_service.attendance_summary(start=start, end=end, group_by=group)

async def admin_attendance_daily_delete(payload: AttendanceDailyDelete, _admin=Depends(require_admin_token)):
    date = (payload.date or "").strip()
    label_filter = (payload.label or "").strip()
    person_id_filter = (payload.person_id or "").strip()
    if not date:
        raise HTTPException(status_code=400, detail="date required")

    try:
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid date format")

    def _to_wib(ts_text: str) -> Optional[datetime]:
        if not ts_text:
            return None
        dt = _time_parse_att_ts(ts_text)
        if dt is None:
            try:
                dt = datetime.fromisoformat(ts_text.replace("Z", "+00:00"))
            except Exception:
                return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=WIB_TZ)
        try:
            return dt.astimezone(WIB_TZ)
        except Exception:
            return None

    label_norm = label_filter.lower() if label_filter else None
    pid_norm = person_id_filter.lower() if person_id_filter else None
    db = att_service.load_attendance_db()
    events = db.get("att_events") or []
    target_ids: Set[int] = set()

    for ev in events:
        try:
            # Extract and validate label
            lab = str(ev.get("label", "") or "").strip()
            if label_norm and lab.lower() != label_norm:
                continue
                
            # Extract and validate person_id
            if pid_norm:
                ev_pid = str(ev.get("person_id") or "").strip().lower()
                if ev_pid != pid_norm:
                    continue
                    
            # Extract and validate timestamp
            ts_text = str(ev.get("ts", "")).strip()
            dt = _to_wib(ts_text)
            if dt is None or dt.date() != target_date:
                continue
                
            # Extract and validate event ID
            eid = int(ev.get("id", 0) or 0)
            if eid > 0:
                target_ids.add(eid)
                
        except (ValueError, TypeError) as e:
            print(f"[WARNING] Invalid event data: {e}")
            continue

    if not target_ids:
        # Fallback to direct repository query in case the cached view missed older rows
        items, _ = repo_list_events(
            label=label_filter or None,
            start_date=date,
            end_date=date,
            page=1,
            per_page=100000,
            order="asc",
        )
        for ev in items:
            try:
                # Extract and validate label
                lab = str(ev.get("label", "") or "").strip()
                if label_norm and lab.lower() != label_norm:
                    continue
                    
                # Extract and validate person_id
                if pid_norm:
                    ev_pid = str(ev.get("person_id") or "").strip().lower()
                    if ev_pid != pid_norm:
                        continue
                        
                # Extract and validate timestamp
                dt = _to_wib(str(ev.get("ts", "")).strip())
                if dt is None or dt.date() != target_date:
                    continue
                    
                # Extract and validate event ID
                eid = int(ev.get("id", 0) or 0)
                if eid > 0:
                    target_ids.add(eid)
                    
            except (ValueError, TypeError) as e:
                print(f"[WARNING] Invalid fallback event data: {e}")
                continue

    ids = sorted(target_ids)
    removed = 0
    if ids:
        removed = repo_bulk_delete(ids)
        if removed <= 0:
            # Verify by re-querying to provide accurate count even if the backend returns no payload
            remaining, _ = repo_list_events(
                label=label_filter or None,
                start_date=date,
                end_date=date,
                page=1,
                per_page=100000,
                order="asc",
            )
            remaining_ids = set()
            for ev in remaining:
                try:
                    eid = int(ev.get("id", 0) or 0)
                    if eid > 0:
                        remaining_ids.add(eid)
                except (ValueError, TypeError):
                    continue
            removed = sum(1 for eid in ids if eid not in remaining_ids)

        if removed > 0:
            invalidate_attendance_cache()
            try:
                att_service.load_attendance_db(force=True)
            except Exception:
                pass

    return {
        "status": "ok",
        "removed": int(removed),
        "date": date,
        "label": label_filter or None,
        "person_id": person_id_filter or None,
    }

def admin_attendance_log(
    person_id: Optional[str] = Query(None),
    date: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    order: Literal["asc", "desc"] = Query("asc"),
    _admin=Depends(require_admin_token),
):
    """Return raw events filtered by optional person_id and date (WIB)."""
    db = att_service.load_attendance_db()
    events = db.get("att_events", [])
    wib = timezone(timedelta(hours=7))
    date_obj = None
    if date:
        try:
            date_obj = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=wib).date()
        except Exception:
            raise HTTPException(status_code=400, detail="invalid date format")

    out: List[dict] = []
    for ev in events:
        try:
            # ambil dan validasi person_id
            pid = str(ev.get("person_id") or _label_to_person_id(ev.get("label", ""))).strip()
            if person_id and pid != person_id:
                continue

            # filter by date kalau ada
            if date_obj:
                dt = _time_parse_att_ts(str(ev.get("ts", "")))
                if dt is None or dt.date() != date_obj:
                    continue

            # bangun output entry
            out.append({
                "person_id": pid,
                "label": ev.get("label", ""),
                "ts": ev.get("ts", ""),
                "score": ev.get("score", 0)
            })

        except Exception as e:
            print(f"[WARNING] Invalid event in attendance log: {e}")
            continue

    out.sort(key=lambda x: x.get("ts", ""), reverse=(order == "desc"))
    return {"items": out, "count": len(out)}

# ===== Admin attendance event CRUD =====
def admin_attendance_events(
    label: Optional[str] = Query(None),
    start: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=500),
    order: Literal["asc","desc"] = Query("desc"),
    _admin=Depends(require_admin_token),
):
    db = att_service.load_attendance_db()
    events = db.get("att_events", [])
    wib = timezone(timedelta(hours=7))
    start_d = datetime.strptime(start, "%Y-%m-%d").replace(tzinfo=wib).date() if start else None
    end_d = datetime.strptime(end, "%Y-%m-%d").replace(tzinfo=wib).date() if end else None
    rows: List[dict] = []
    for ev in events:
        try:
            # Filter by label
            lab = str(ev.get("label", "")).strip()
            if label and lab != label:
                continue
                
            # Parse and validate timestamp
            dt = _time_parse_att_ts(str(ev.get("ts", "")))
            if dt is None:
                continue
                
            # Filter by date range
            if start_d and dt.date() < start_d:
                continue
            if end_d and dt.date() > end_d:
                continue
                
            # Build output entry
            rows.append({
                "id": ev.get("id"),
                "label": lab,
                "person_id": ev.get("person_id") or _label_to_person_id(lab),
                "ts": ev.get("ts", ""),
                "score": ev.get("score", 0)
            })
            
        except Exception as e:
            print(f"[WARNING] Invalid event in attendance events: {e}")
            continue
    rows.sort(key=lambda r: r.get("ts",""), reverse=(order=="desc"))
    total = len(rows)
    total_pages = max(1, (total + per_page - 1)//per_page)
    page = max(1, min(page, total_pages))
    s = (page-1)*per_page
    e = s + per_page
    return {"items": rows[s:e], "meta": {"page": page, "per_page": per_page, "total": total, "total_pages": total_pages, "order": order}}

def admin_attendance_event_create(payload: AttendanceEventCreate, _admin=Depends(require_admin_token)):
    db = att_service.load_attendance_db()
    seq = int(db.get("att_event_seq", 0) or 0) + 1
    db["att_event_seq"] = seq
    ts_text = payload.ts or _time_now_iso()
    # basic validate ts
    if _time_parse_att_ts(ts_text) is None:
        raise HTTPException(status_code=400, detail="invalid timestamp format")
    lab = payload.label.strip()
    pid = _label_to_person_id(lab) or ""
    ev = {"id": seq, "label": lab, "person_id": pid, "score": float(payload.score or 0.0), "ts": ts_text}
    db.setdefault("att_events", []).insert(0, ev)
    # update derived maps (label + person)
    dt = _time_parse_att_ts(ts_text)
    if dt is not None:
        ts = dt.timestamp()
        db.setdefault("att_last", {})[lab] = max(db.get("att_last",{}).get(lab,0.0), ts)
        if pid:
            db.setdefault("att_last_id", {})[pid] = max(db.get("att_last_id",{}).get(pid,0.0), ts)
    db.setdefault("att_count", {})[lab] = db.get("att_count",{}).get(lab,0) + 1
    if pid:
        db.setdefault("att_count_id", {})[pid] = db.get("att_count_id",{}).get(pid,0) + 1
    # Mirror this manual event to Supabase
    try:
        repo_insert_event(label=lab, score=float(payload.score or 0.0), ts_text=None, person_id=(pid or None))
    except Exception as e:
        print(f"[WARN] failed to mirror admin event to Supabase: {e}")
    # update last and counts
    dt = _time_parse_att_ts(ts_text)
    if dt is not None:
        db.setdefault("att_last", {})[payload.label] = max(db.get("att_last",{}).get(payload.label,0.0), dt.timestamp())
    db.setdefault("att_count", {})[payload.label] = db.get("att_count",{}).get(payload.label,0) + 1
    save_attendance_db(db)
    return {"ok": True, "event": ev}

def admin_attendance_event_update(event_id: int, payload: AttendanceEventUpdate, _admin=Depends(require_admin_token)):
    db = att_service.load_attendance_db()
    events = db.get("att_events", [])
    found = None
    for ev in events:
        if int(ev.get("id", 0) or 0) == int(event_id):
            found = ev
            break
    if not found:
        raise HTTPException(status_code=404, detail="event not found")
    if payload.label is not None:
        found["label"] = str(payload.label or "").strip()
        # sinkron person_id jika label berubah
        found["person_id"] = _label_to_person_id(found["label"]) or found.get("person_id")
    if payload.score is not None:
        try: found["score"] = float(payload.score)
        except Exception: pass
    if payload.ts is not None:
        if _time_parse_att_ts(payload.ts) is None:
            raise HTTPException(status_code=400, detail="invalid timestamp format")
        found["ts"] = payload.ts
    att_last: Dict[str,float] = {}
    att_count: Dict[str,int] = {}
    att_last_id: Dict[str,float] = {}
    att_count_id: Dict[str,int] = {}
    for ev in db.get("att_events", []):
        lab = str(ev.get("label",""))
        pid = str(ev.get("person_id") or _label_to_person_id(lab) or "")
        dt = _time_parse_att_ts(str(ev.get("ts","")))
        if not lab or dt is None:
            continue
        ts = dt.timestamp()
        att_last[lab] = max(att_last.get(lab, 0.0), ts)
        att_count[lab] = att_count.get(lab, 0) + 1
        if pid:
            att_last_id[pid] = max(att_last_id.get(pid, 0.0), ts)
            att_count_id[pid] = att_count_id.get(pid, 0) + 1
    db["att_last"] = att_last
    db["att_count"] = att_count
    db["att_last_id"] = att_last_id
    db["att_count_id"] = att_count_id
    save_attendance_db(db)
    return {"ok": True, "event": found}

def admin_attendance_event_delete(event_id: int, _admin=Depends(require_admin_token)):
    db = att_service.load_attendance_db()
    events = db.get("att_events", [])
    new_events: List[dict] = []
    removed = None
    for ev in events:
        if int(ev.get("id", 0) or 0) == int(event_id):
            removed = ev
            continue
        new_events.append(ev)
    if removed is None:
        raise HTTPException(status_code=404, detail="event not found")
    db["att_events"] = new_events
    # Recompute counts/last
    att_last: Dict[str,float] = {}
    att_count: Dict[str,int] = {}
    att_last_id: Dict[str,float] = {}
    att_count_id: Dict[str,int] = {}
    for ev in new_events:
        lab = str(ev.get("label",""))
        pid = str(ev.get("person_id","")) or (_label_to_person_id(lab) or "")
        dt = _time_parse_att_ts(str(ev.get("ts","")))
        if not lab or dt is None:
            continue
        ts = dt.timestamp()
        att_last[lab] = max(att_last.get(lab, 0.0), ts)
        att_count[lab] = att_count.get(lab, 0) + 1
        if pid:
            att_last_id[pid] = max(att_last_id.get(pid, 0.0), ts)
            att_count_id[pid] = att_count_id.get(pid, 0) + 1
    db["att_last"] = att_last
    db["att_count"] = att_count
    db["att_last_id"] = att_last_id
    db["att_count_id"] = att_count_id
    save_attendance_db(db)
    return {"ok": True, "deleted": int(event_id)}

def admin_attendance_daily_export(
    q: Optional[str] = Query(None),
    order: Literal["asc", "desc"] = Query("desc"),
    start: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    status: Optional[Literal["present","late","all"]] = Query(None),
    _admin=Depends(require_admin_token),
):
    rows = att_service._build_daily_rows(q, start, end, order)
    if status and status != "all":
        rows = [r for r in rows if str(r.get("status","present")).lower() == status]
    buf = StringIO()
    w = csv.writer(buf)
    w.writerow(["label", "date", "check_in", "check_out", "schedule", "status", "events"])
    for r in rows:
        w.writerow([r.get("label",""), r.get("date",""), r.get("check_in",""), r.get("check_out",""), r.get("schedule",""), r.get("status",""), r.get("events",0)])
    csv_data = buf.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="attendance_daily.csv"'
        },
    )

def admin_attendance_events_export(
    label: Optional[str] = Query(None),
    start: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    order: Literal["asc","desc"] = Query("desc"),
    _admin=Depends(require_admin_token),
):
    data = admin_attendance_events(label=label, start=start, end=end, page=1, per_page=100000, order=order, _admin=_admin)  # type: ignore[arg-type]
    rows = data.get("items", [])
    buf = StringIO()
    w = csv.writer(buf)
    w.writerow(["id","label","person_id","ts","score"])
    for r in rows:
        w.writerow([r.get("id",""), r.get("label",""), r.get("person_id",""), r.get("ts",""), r.get("score","")])
    csv_data = buf.getvalue()
    return Response(content=csv_data, media_type="text/csv; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="attendance_events.csv"'})

    scope: Literal["all", "face_engine", "attendance"] = "all"

def _attendance_schedule_snapshot(config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    source = config if config is not None else CFG
    attendance_cfg = copy.deepcopy((source or {}).get("attendance") or {})
    grace_in = _time_ensure_int(
        attendance_cfg.get("grace_in_min"),
        default=DEFAULT_CONFIG["attendance"]["grace_in_min"],
        minimum=0,
        maximum=240,
    )
    grace_out = _time_ensure_int(
        attendance_cfg.get("grace_out_min"),
        default=DEFAULT_CONFIG["attendance"]["grace_out_min"],
        minimum=0,
        maximum=240,
    )
    overrides = [_normalize_override_entry(ov) for ov in (attendance_cfg.get("overrides") or [])]
    attendance_cfg["overrides"] = overrides
    return {
        "grace_in_min": grace_in,
        "grace_out_min": grace_out,
        "rules": attendance_cfg.get("rules") or [],
        "overrides": overrides,
    }

# ===== Monotonic ID meta =====
def _alloc_new_id(existing: Optional[List[dict]] = None) -> int:
    with _LOCK:
        try:
            data_now = existing if existing is not None else _load_reg_list()
            last = max([int(x.get("id", 0) or 0) for x in (data_now or [])] + [0])
        except Exception:
            last = 0
        return last + 1

async def admin_reload_from_uploads(_admin=Depends(require_admin_token)):
    warnings: List[str] = []
    try:
        await auto_register_faces_once()
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"auto-register skipped: {exc}")
    try:
        refresh = await _engine_refresh_async("admin_reload_from_uploads")
    except Exception as exc:  # noqa: BLE001
        return _http_json_error(f"failed to refresh engine: {exc}", status_code=500)

    items = _load_reg_list()
    payload: Dict[str, Any] = {
        "status": "ok",
        "total": len(items),
        "refresh": refresh,
    }
    if warnings:
        payload["warnings"] = warnings
    return payload

async def admin_delete_item(
    item_id: int,
    delete_photo: int = 0,
    _admin=Depends(require_admin_token),
):
    entries = _load_reg_list()
    idx = _find_idx_by_id(entries, item_id)
    if idx < 0:
        return _http_json_error("item not found", status_code=404)

    entry = entries.pop(idx)
    label = str(entry.get("label", "")).strip()
    photo_path = str(entry.get("photo_path") or "").strip()

    if delete_photo and photo_path:
        from db.storage import delete_face_object  # type: ignore[no-redef]
        try:
            delete_face_object(photo_path)
        except Exception as exc:  # noqa: BLE001
            print("[REGISTER] delete photo failed:", exc)

    try:
        _save_reg_list(entries)
    except Exception as exc:  # noqa: BLE001
        return _http_json_error(f"failed to persist register list: {exc}", status_code=500)

    if label:
        try:
            _engine_forget_label(label)
        except Exception as exc:  # noqa: BLE001
            print("[REGISTER] forget label failed:", exc)

    await _engine_refresh_async("admin_delete_item")
    return {"status": "ok", "deleted": label or item_id, "remaining": len(entries)}

async def admin_update_item(item_id: int, payload: AdminUpdate, _admin=Depends(require_admin_token)):
    entries = _load_reg_list()
    idx = _find_idx_by_id(entries, item_id)
    if idx < 0:
        return _http_json_error("item not found", status_code=404)

    entry = dict(entries[idx])
    old_label = str(entry.get("label", "")).strip()
    new_label = str(payload.label or old_label).strip()
    if not new_label:
        return _http_json_error("label tidak boleh kosong", status_code=400)

    # Prevent duplicate labels on different entries.
    if new_label.lower() != old_label.lower():
        for it in entries:
            if int(it.get("id", 0) or 0) == int(item_id):
                continue
            if str(it.get("label", "")).strip().lower() == new_label.lower():
                return _http_json_error("label sudah dipakai", status_code=409)

    changed_photo = False
    if payload.move_photo:
        img_path = _resolve_entry_image_path(entry, new_label)
        if img_path and os.path.exists(img_path):
            bgr = cv.imread(img_path)
            if bgr is not None:
                from db.storage import upload_face_bgr  # type: ignore[no-redef]
                previous_path = str(entry.get("photo_path") or "").strip() or None
                person_id = str(entry.get("person_id") or "").strip() or _gen_person_id()
                try:
                    storage_path, public_url = upload_face_bgr(person_id, bgr, previous_path=previous_path)
                    entry["photo_path"] = storage_path
                    entry["photo_url"] = public_url
                    entry["person_id"] = person_id
                    changed_photo = True
                except Exception as exc:  # noqa: BLE001
                    print("[REGISTER] move_photo upload failed:", exc)

    if payload.reembed or changed_photo:
        img_path = _resolve_entry_image_path(entry, new_label)
        bgr = cv.imread(img_path) if img_path else None
        if bgr is not None:
            rec = await _engine_recognize(bgr)
            if rec:
                row, _, _ = rec[0]
                try:
                    emb = await _rt_engine_async_call(engine.get_embedding, bgr, row)  # type: ignore[arg-type]
                    emb_list = emb.tolist() if hasattr(emb, "tolist") else list(map(float, emb))
                    x, y, w, h = [int(v) for v in row[:4]]
                    entry.update({
                        "embedding": emb_list,
                        "x": x,
                        "y": y,
                        "width": w,
                        "height": h,
                    })
                except Exception as exc:  # noqa: BLE001
                    print("[REGISTER] reembed failed:", exc)

    entry["label"] = new_label
    entry["ts"] = _time_now_iso()
    entries[idx] = entry
    entries = _ensure_register_person_ids(entries)

    try:
        _save_reg_list(entries)
    except Exception as exc:  # noqa: BLE001
        return _http_json_error(f"failed to persist register list: {exc}", status_code=500)

    await _engine_refresh_async("admin_update_item")
    return {"status": "ok", "item": entry}

async def admin_bulk(payload: AdminBulk, _admin=Depends(require_admin_token)):
    ids = {int(i) for i in (payload.ids or []) if int(i) > 0}
    if not ids:
        return _http_json_error("tidak ada id yang dipilih", status_code=400)

    action = payload.action
    entries = _load_reg_list()

    if action == "delete":
        removed = []
        remaining = []
        for it in entries:
            try:
                ident = int(it.get("id", 0) or 0)
            except Exception:
                ident = 0
            if ident and ident in ids:
                removed.append(it)
            else:
                remaining.append(it)
        if not removed:
            return {"status": "ok", "deleted": 0}

        if payload.delete_photo:
            from db.storage import delete_face_object  # type: ignore[no-redef]
            for it in removed:
                photo_path = str(it.get("photo_path") or "").strip()
                if photo_path:
                    try:
                        delete_face_object(photo_path)
                    except Exception as exc:  # noqa: BLE001
                        print("[REGISTER] delete photo failed:", exc)

        labels_removed = [str(it.get("label", "")).strip() for it in removed if str(it.get("label", "")).strip()]
        try:
            _save_reg_list(remaining)
        except Exception as exc:  # noqa: BLE001
            return _http_json_error(f"failed to persist register list: {exc}", status_code=500)

        for lab in labels_removed:
            try:
                _engine_forget_label(lab)
            except Exception as exc:  # noqa: BLE001
                print("[REGISTER] forget label failed:", exc)
        await _engine_refresh_async("admin_bulk_delete")
        return {"status": "ok", "deleted": len(removed)}

    if action == "reembed":
        await _engine_refresh_async("admin_bulk_reembed")
        return {"status": "ok", "message": "engine refreshed"}

    if action == "export":
        buf = BytesIO()
        exported = 0
        now_txt = datetime.now(WIB_TZ).strftime("%Y%m%d_%H%M%S")
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for it in entries:
                try:
                    ident = int(it.get("id", 0) or 0)
                except Exception:
                    ident = 0
                if ident not in ids:
                    continue
                label = str(it.get("label", "")).strip() or f"id_{ident}"
                img_path = _resolve_entry_image_path(it, label)
                if not img_path or not os.path.exists(img_path):
                    continue
                ext = os.path.splitext(img_path)[1].lower() or ".jpg"
                arcname = secure_filename(f"{label}{ext}")
                if not arcname:
                    arcname = f"{ident}{ext}"
                try:
                    zf.write(img_path, arcname)
                    exported += 1
                except Exception as exc:  # noqa: BLE001
                    print("[REGISTER] export zip failed:", exc)
        buf.seek(0)
        headers = {
            "Content-Disposition": f'attachment; filename="register_export_{now_txt}.zip"',
        }
        return StreamingResponse(buf, media_type="application/zip", headers=headers)

    return _http_json_error("aksi bulk tidak dikenal", status_code=400)

async def admin_migrate_storage(_admin=Depends(require_admin_token)):
    files = list(_iter_face_files())
    if not files:
        return {"status": "ok", "migrated": 0, "message": "no local face files"}

    migrated = 0
    errors: List[str] = []
    for path in files:
        try:
            base = os.path.splitext(os.path.basename(path))[0]
            label = _restore_label_from_safe_base(base)
            info = await _upsert_register_entry_from_image(label, path)
            if info.get("ok"):
                migrated += 1
            else:
                errors.append(f"{label}: {info.get('reason')}")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{path}: {exc}")

    if migrated:
        await _engine_refresh_async("admin_migrate_storage")
    items = _load_reg_list()
    payload: Dict[str, Any] = {
        "status": "ok",
        "migrated": migrated,
        "total": len(items),
    }
    if errors:
        payload["errors"] = errors
    return payload

async def admin_export_csv(_admin=Depends(require_admin_token)):
    items = _load_reg_list()
    buf = StringIO()
    writer = csv.writer(buf)
    writer.writerow(["id", "label", "person_id", "photo_path", "ts"])
    for it in items:
        writer.writerow([
            it.get("id"),
            it.get("label"),
            it.get("person_id"),
            it.get("photo_path"),
            it.get("ts"),
        ])
    data = buf.getvalue().encode("utf-8")
    headers = {
        "Content-Disposition": f'attachment; filename="register_faces_{datetime.now(WIB_TZ).strftime("%Y%m%d_%H%M%S")}.csv"',
    }
    return Response(content=data, media_type="text/csv; charset=utf-8", headers=headers)

# =========================
# Public APIs 
# =========================
def _normalize_emb_list(vals: "List[float] | np.ndarray") -> List[float]:
    """Normalize embedding vector to unit vector format."""
    v = np.asarray(vals, dtype=np.float32).reshape(-1)
    n = float(np.linalg.norm(v))
    if n > 0:
        v = v / n
    return v.astype(np.float32).tolist()

async def _get_normalized_embedding(bgr: np.ndarray, row: np.ndarray) -> List[float]:
    """Get normalized embedding from image and face row with proper error handling."""
    try:
        emb = await _rt_engine_async_call(engine.get_embedding, bgr, row)
        if hasattr(emb, "tolist"):
            emb_list = emb.tolist()
        else:
            emb_list = list(map(float, emb))
        
        # Normalize to unit vector
        return _normalize_emb_list(emb_list)
    except Exception as e:
        print(f"[ERROR] Failed to get embedding: {e}")
        raise ValueError(f"embedding extraction failed: {e}")

async def register_db_data(
    page: int = Query(1, ge=1),
    per_page: str = Query("25", description="Jumlah per halaman atau 'all' untuk semua"), 
    order: Literal["asc", "desc"] = Query("desc"),
    q: Optional[str] = Query(None),
    _admin=Depends(require_admin_token),
) -> Dict[str, Any]:
    items = _load_reg_list()
    items = _ensure_register_person_ids(items)

    from db.storage import get_face_public_url  # type: ignore[no-redef]

    for it in items:
        path = str(it.get("photo_path") or "").strip()
        if path:
            version = None
            try:
                version = str(it.get("ts") or "") or None
            except Exception:
                version = None
            try:
                it["photo_url"] = get_face_public_url(path, version)
            except Exception:
                it.setdefault("photo_url", None)
        # Ensure person_id is available to clients
        if not it.get("person_id"):
            it["person_id"] = _gen_person_id()

    if q:
        qlow = q.lower()
        items = [it for it in items if str(it.get("label", "")).lower().find(qlow) >= 0]

    def _key(it: dict) -> tuple:
        ts_text = str(it.get("ts", "") or "").strip()
        ts_epoch = -1
        if ts_text:
            try:
                ts_epoch = int(datetime.strptime(ts_text, "%Y-%m-%d %H:%M:%S").timestamp())
            except Exception:
                ts_epoch = -1
        # As final fallback, use id
        try:
            ident = int(it.get("id") or 0)
        except Exception:
            ident = 0
        return (ts_epoch, ident)

    items = sorted(items, key=_key, reverse=(order == "desc"))

    total = len(items)
    use_all = isinstance(per_page, str) and per_page.lower() == "all"
    if use_all:
      page = 1
      page_items = items
      total_pages = 1
      per_page_num = total or 1
    else:
      try:
        per_page_num = max(1, min(1000, int(per_page)))
      except Exception:
        per_page_num = 25
      total_pages = max(1, ceil(total / per_page_num))
      page = min(page, total_pages)
      start = (page - 1) * per_page_num
      end = start + per_page_num
      page_items = items[start:end]

    return {
        "status": "ok",
        "items": page_items,
        "meta": {
            "page": page,
            "per_page": (total if use_all else per_page_num),
            "order": order,
            "total": total,
            "total_pages": total_pages,
            "has_prev": page > 1,
            "has_next": page < total_pages,
        },
    }

async def register_dataset(dataset: str = Form(...), _admin=Depends(require_admin_token)):
    if not dataset or not os.path.isdir(dataset):
        return _http_json_error("dataset folder not found")
    await _rt_engine_async_call(engine.build_from_dataset, dataset)
    summary = _engine_summary()
    return {"status": "ok", "labels": summary["labels"], "count": summary["label_count"]}

async def admin_upload_photo(
    item_id: int,
    file: UploadFile,
    force: int = 0,
    _admin=Depends(require_admin_token),
):
    data = await file.read()
    try:
        bgr = _imdecode_upload_bytes(data)
    except Exception:
        bgr = None
        
    if bgr is None:
        return _http_json_error("cannot read image")

    rec = await _engine_recognize(bgr)
    if not rec:
        return _http_json_error("no face detected")

    entries = _load_reg_list()
    idx = _find_idx_by_id(entries, item_id)
    if idx < 0:
        return _http_json_error("item not found", status_code=404)

    entry = dict(entries[idx])
    label = str(entry.get("label", "")).strip()
    if not label:
        return _http_json_error("label kosong pada item", status_code=400)

    row_primary, _, _ = rec[0]
    row_primary_list = [float(row_primary[i]) for i in range(4)]
    try:
        emb_list = await _get_normalized_embedding(bgr, row_primary)
    except Exception as exc:  # noqa: BLE001
        return _http_json_error(f"embedding failed: {exc}", status_code=500)

    from db.storage import upload_face_bgr

    previous_path = str(entry.get("photo_path") or "").strip() or None
    person_id = str(entry.get("person_id") or "").strip() or _gen_person_id()
    crop = crop_face_image(bgr, row_primary_list)
    storage_path, public_url = upload_face_bgr(person_id, crop, previous_path=previous_path)
    h_crop, w_crop = crop.shape[:2]

    entry.update({
        "id": entry.get("id") or item_id,
        "person_id": person_id,
        "x": 0,
        "y": 0,
        "width": w_crop,
        "height": h_crop,
        "photo_id": 1,
        "embedding": emb_list,
        "label": label,
        "ts": _time_now_iso(),
        "photo_path": storage_path,
        "photo_url": public_url,
    })
    entries[idx] = entry
    entries = _ensure_register_person_ids(entries)

    try:
        _save_reg_list(entries)        
    except Exception as exc:  # noqa: BLE001
        return _http_json_error(f"failed to persist register list: {exc}", status_code=500)

    # Register embedding ke engine untuk offline recognition
    try:
        ok_reg, msg = engine.register_embedding(label, emb_list)
        if ok_reg:
            print(f"[SUCCESS] {label}: embedding updated in engine for offline recognition")
        else:
            print(f"[WARNING] {label}: embedding update failed ({msg})")
    except Exception as e:
        print(f"[ERROR] {label}: failed to update embedding in engine: {e}")

    await _engine_refresh_async("admin_upload_photo")
    return {"status": "ok", "item": entry}

async def register_face(
    label: str = Form(""),
    force: int = Form(0),  # <-- baru: 0 atau 1
    file: Optional[UploadFile] = File(None),
    preview_token: Optional[str] = Form(None),
    embedding: Optional[List[float]] = None,
    detect_row: Optional[List[float]] = None,
    image_bytes_override: Optional[bytes] = None,
):
    label = (label or "").strip().replace("_", " ")
    if not label:
        return _http_json_error("Label kosong")

    cache_entry: Optional[Dict[str, Any]] = None
    image_bytes: Optional[bytes] = image_bytes_override
    if image_bytes is None and preview_token:
        cache_entry = _preview_cache_get(preview_token)
        if cache_entry is None:
            if not file:
                return _http_json_error("Preview sudah kadaluarsa. Silakan ambil foto lagi.", status_code=410)
            preview_token = None
        else:
            image_bytes = cache_entry.get("data")

    if image_bytes is None:
        if not file:
            return _http_json_error("Gambar wajib diunggah", status_code=400)
        image_bytes = await file.read()

    try:
        bgr = _imdecode_upload_bytes(image_bytes)
    except Exception:
        return _http_json_error("cannot read image")

    from db.storage import upload_face_bgr, delete_face_object  # type: ignore[no-redef]

    primary_row_list: Optional[List[float]] = None
    # PRIORITAS: pakai row dari cache (koordinat gambar asli, konsisten).
    if cache_entry and cache_entry.get("row"):
        primary_row_list = [float(v) for v in cache_entry["row"]]

    dets_primary = await _engine_recognize(bgr)
    if not dets_primary:
        return _http_json_error("no face detected")
    row_primary, _, _ = dets_primary[0]
    primary_row_list = [float(row_primary[i]) for i in range(4)]
    
    th_dup = max(MIN_COSINE_ACCEPT, min(1.0, float(os.getenv("REGISTER_DUP_THRESHOLD", COSINE_SIM_THRESH))))
    if cache_entry and cache_entry.get("faces"):
        faces_for_dup = cache_entry["faces"]
    else:
        dup_results = await _engine_recognize(bgr, th_dup)
        faces_for_dup = [
            {"label": lab, "score": float(sc)}
            for _, lab, sc in dup_results
        ]

    dup_hits = [
        (face.get("label", ""), float(face.get("score", 0.0)))
        for face in faces_for_dup
        if face.get("label") not in {None, "", "Unknown"}
        and float(face.get("score", 0.0)) >= th_dup
    ]

    entries = _load_reg_list()

    reuse_meta: Dict[str, Dict[str, Any]] = {}

    if dup_hits and not bool(force):
        lab_top, sc_top = max(dup_hits, key=lambda t: t[1])
        return _http_json_error(
            f"Wajah sudah terdaftar sebagai '{lab_top}'",
            status_code=409,
            score=round(sc_top, 3),
        )

    if dup_hits and bool(force):
        dup_labels = {lab.strip() for lab, _ in dup_hits if lab}
        if dup_labels:
            try:
                kept: List[dict] = []
                for e in entries:
                    lab = str(e.get("label", "")).strip()
                    if lab and lab in dup_labels:
                        meta = reuse_meta.setdefault(lab, {"person_id": None, "id": None})
                        reuse_pid_val = str(e.get("person_id") or "").strip()
                        if reuse_pid_val:
                            meta["person_id"] = reuse_pid_val
                        if meta.get("id") is None and e.get("id") is not None:
                            meta["id"] = e.get("id")
                        path_old = str(e.get("photo_path") or "").strip()
                        if path_old:
                            delete_face_object(path_old)
                        try:
                            _engine_forget_label(lab)
                        except Exception:
                            pass
                    else:
                        kept.append(e)
                entries = kept
                try:
                    _save_reg_list(entries)
                except Exception as exc:  # noqa: BLE001
                    return _http_json_error(f"failed to persist register list: {exc}", status_code=500)

                await _engine_refresh_async("register_face_force_replace")
            except Exception as exc:
                print("[WARN] force-replace cleanup failed:", exc)

    try:
        emb_list = await _get_normalized_embedding(bgr, row_primary)
        print(f"[REGISTER] {label}: embedding generated")

        existing_idx = next((i for i, e in enumerate(entries) if str(e.get("label", "")).strip() == label), -1)
        if existing_idx >= 0:
            entry = dict(entries.pop(existing_idx))
            person_id = entry.get("person_id") or _gen_person_id()
            entry_id = entry.get("id") or _alloc_new_id(entries)
            previous_path = str(entry.get("photo_path") or "").strip() or None
        else:
            entry = {}
            person_id = _gen_person_id()
            entry_id = _alloc_new_id(entries)
            reuse = reuse_meta.get(label)
            if reuse:
                reuse_pid = str(reuse.get("person_id") or "").strip()
                if reuse_pid:
                    person_id = reuse_pid
                reuse_id = reuse.get("id")
                if reuse_id:
                    entry_id = reuse_id
            previous_path = None

        crop = None
        if cache_entry and cache_entry.get("crop_bytes"):
            crop_buffer = np.frombuffer(cache_entry["crop_bytes"], dtype=np.uint8)
            crop = cv.imdecode(crop_buffer, cv.IMREAD_COLOR)
        if crop is None:
            crop = crop_face_image(bgr, primary_row_list)

        storage_path, public_url = upload_face_bgr(person_id, crop, previous_path=previous_path)
        h_crop, w_crop = crop.shape[:2]

        entry.update({
            "id": entry_id,
            "person_id": person_id,
            "x": 0,
            "y": 0,
            "width": w_crop,
            "height": h_crop,
            "photo_id": 1,
            "embedding": emb_list,
            "label": label,
            "ts": _time_now_iso(),
            "photo_path": storage_path,
            "photo_url": public_url,
        })
        
        entries.append(entry)
        entries = _ensure_register_person_ids(entries)
        _save_reg_list(entries)
        
        # Invalidate cache to ensure fresh data is loaded
        _invalidate_reg_list_cache()
        
        # Register embedding ke engine untuk offline recognition
        ok_reg, msg = engine.register_embedding(label, emb_list)
        if ok_reg:
            print(f"[SUCCESS] {label}: embedding registered in engine for offline recognition")
        else:
            print(f"[WARNING] {label}: embedding registration failed ({msg}), trying fallback")
            await _engine_refresh_async("register_face_fallback")
    except Exception as exc:
        return _http_json_error(f"failed to save metadata: {exc}", status_code=500)
    else:
        if preview_token:
            _preview_cache_consume(preview_token)

    return {"status": "ok", "message": "OK", "label": label, "photo_url": entry.get("photo_url")}

async def register_face_preview(file: UploadFile = File(...)):
    data = await file.read()
    try:
        bgr = _imdecode_upload_bytes(data)
    except Exception:
        return _http_json_error("cannot read image", status_code=400)

    preview_threshold = _resolve_threshold(None)
    results = await _engine_recognize(bgr, preview_threshold)
    if not results:
        return _http_json_error("no face detected", status_code=400)

    faces_payload: List[Dict[str, Any]] = []
    per_face_info: List[Tuple[np.ndarray, str, float, Optional[str]]] = []
    for row, label, score in results:
        bbox = [int(row[0]), int(row[1]), int(row[2]), int(row[3])]
        pid = _label_to_person_id(label)
        faces_payload.append({
            "label": label,
            "score": float(score),
            "bbox": bbox,
            "person_id": pid,
        })
        per_face_info.append((row, label, float(score), pid))

    row_primary, label_primary, primary_score = max(results, key=lambda item: float(item[2]))
    primary_row_list = [float(row_primary[i]) for i in range(4)]
    crop_margin = 0.3
    crop_target = 512

    def _compute_crop_bounds(row_vals: List[float]) -> Tuple[int, int, int, int]:
        x, y, w, h = row_vals
        h_img, w_img = bgr.shape[:2]
        cx = x + w / 2.0
        cy = y + h / 2.0
        pad_w = w * crop_margin
        pad_h = h * crop_margin
        x1_local = max(0, int(round(cx - w / 2.0 - pad_w)))
        y1_local = max(0, int(round(cy - h / 2.0 - pad_h)))
        x2_local = min(w_img, int(round(cx + w / 2.0 + pad_w)))
        y2_local = min(h_img, int(round(cy + h / 2.0 + pad_h)))
        if x2_local <= x1_local or y2_local <= y1_local:
            return 0, 0, w_img, h_img
        return x1_local, y1_local, x2_local, y2_local

    x1, y1, x2, y2 = _compute_crop_bounds(primary_row_list)
    crop_raw = bgr[y1:y2, x1:x2].copy()
    if crop_raw.size == 0:
        crop_raw = bgr.copy()
        x1, y1 = 0, 0
        y2, x2 = bgr.shape[0], bgr.shape[1]

    if crop_target > 0:
        crop = cv.resize(crop_raw, (crop_target, crop_target), interpolation=cv.INTER_CUBIC)
    else:
        crop = crop_raw

    ok_crop, crop_buffer = cv.imencode(".jpg", crop, [cv.IMWRITE_JPEG_QUALITY, 95])
    if not ok_crop:
        return _http_json_error("failed to encode image", status_code=500)

    crop_w = max(1.0, float(x2 - x1))
    crop_h = max(1.0, float(y2 - y1))
    scale_x = crop.shape[1] / crop_w
    scale_y = crop.shape[0] / crop_h

    faces_cropped_payload: List[Dict[str, Any]] = []
    for row, label, score, pid in per_face_info:
        x, y, w, h = [float(row[i]) for i in range(4)]
        left = x - x1
        top = y - y1
        right = left + w
        bottom = top + h
        if right <= 0 or bottom <= 0 or left >= crop_w or top >= crop_h:
            continue
        clamped_left = max(0.0, left)
        clamped_top = max(0.0, top)
        clamped_right = min(crop_w, right)
        clamped_bottom = min(crop_h, bottom)
        width_vis = clamped_right - clamped_left
        height_vis = clamped_bottom - clamped_top
        if width_vis <= 1e-2 or height_vis <= 1e-2:
            continue
        bbox_crop = [
            int(round(clamped_left * scale_x)),
            int(round(clamped_top * scale_y)),
            int(round(width_vis * scale_x)),
            int(round(height_vis * scale_y)),
        ]
        bbox_crop[0] = max(0, min(crop.shape[1] - 1, bbox_crop[0]))
        bbox_crop[1] = max(0, min(crop.shape[0] - 1, bbox_crop[1]))
        bbox_crop[2] = max(1, min(crop.shape[1] - bbox_crop[0], bbox_crop[2]))
        bbox_crop[3] = max(1, min(crop.shape[0] - bbox_crop[1], bbox_crop[3]))
        faces_cropped_payload.append({
            "label": label,
            "score": score,
            "bbox": bbox_crop,
            "person_id": pid,
        })

    embedding_list: Optional[List[float]] = None
    try:
        row_np = np.asarray(primary_row_list, dtype=np.float32)
        embedding_list = await _get_normalized_embedding(bgr, row_primary)
    except Exception as e:
        print(f"[WARNING] Failed to get embedding for preview: {e}")
        embedding_list = None

    token = uuid.uuid4().hex
    _preview_cache_store(token, {
        "data": data,
        "row": primary_row_list,
        "faces": faces_payload,
        "crop_bytes": crop_buffer.tobytes(),
        "label": label_primary,
        "score": float(primary_score),
        "embedding": embedding_list,
        "threshold": preview_threshold,
        "is_cropped": True,
        "preview_is_cropped": True,
        "faces_cropped": faces_cropped_payload,
    })

    preview_b64 = base64.b64encode(crop_buffer).decode("ascii")
    return {
        "status": "ok",
        "token": token,
        "preview": f"data:image/jpeg;base64,{preview_b64}",
        "faces": faces_payload,
        "faces_cropped": faces_cropped_payload,
        "detected": len(results),
        "preview_is_cropped": True,
    }

# =========================
# ROUTE HTTP Pages (public)
# =========================

# No longer serve legacy Vue dist assets or template-based public pages from backend.
# Frontend is served by Next.js app.
