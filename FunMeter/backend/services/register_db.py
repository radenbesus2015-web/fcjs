from __future__ import annotations

import asyncio
import json
import os
import time
import copy
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import anyio
import cv2 as cv
import numpy as np
from werkzeug.utils import secure_filename

from db.supabase_client import get_client, get_default_org_id
from db.storage import get_face_public_url, upload_face_bgr, delete_face_object
from core.runtime import engine, ENGINE_LOCK, engine_async_call as _engine_async_call, engine_sync_call as _engine_sync_call
from helpers.time_utils import now_iso as _now_iso

_CACHE_TTL = 2.0  # seconds
_REGISTER_CACHE: Dict[str, Any] = {"data": None, "ts": 0.0}

BASE_DIR = Path(__file__).resolve().parents[1]
UPLOAD_DIR = str(BASE_DIR / "uploads")
FACE_WATCH_DIR = os.path.join(UPLOAD_DIR, "face")
FACE_WATCH_INDEX = os.path.join(BASE_DIR, "database", "face_watch_index.json")
FACE_WATCH_INTERVAL = int(os.getenv("FACE_WATCH_INTERVAL", "3"))
ENABLE_FACE_WATCH = os.getenv("ENABLE_FACE_WATCH", "0") == "1"

_sio = None

def set_socket_server(server) -> None:
    global _sio
    _sio = server

_P_BASE36 = "abcdefghijklmnopqrstuvwxyz0123456789"

def _gen_person_id() -> str:
    import secrets
    def seg(n: int) -> str:
        return "".join(_P_BASE36[secrets.randbelow(len(_P_BASE36))] for _ in range(n))
    return f"p-{seg(4)}-{seg(3)}-{seg(3)}"

def crop_face_image(
    bgr: np.ndarray,
    row: List[float],
    *,
    margin: float = 0.3,
    target_size: int = 512,
) -> np.ndarray:
    """
    Auto-crop a face region from an image using the detector bounding box.

    Args:
        bgr: Original image in BGR color space.
        row: Bounding box row (x, y, w, h, ...).
        margin: Extra margin ratio around the face box.
        target_size: Output square size (pixels) after resizing.
    """
    x, y, w, h = [float(row[i]) for i in range(4)]
    h_img, w_img = bgr.shape[:2]
    if w <= 0 or h <= 0 or h_img <= 0 or w_img <= 0:
        return bgr.copy()

    cx = x + w / 2.0
    cy = y + h / 2.0
    pad_w = w * margin
    pad_h = h * margin

    x1 = max(0, int(round(cx - w / 2.0 - pad_w)))
    y1 = max(0, int(round(cy - h / 2.0 - pad_h)))
    x2 = min(w_img, int(round(cx + w / 2.0 + pad_w)))
    y2 = min(h_img, int(round(cy + h / 2.0 + pad_h)))

    if x2 <= x1 or y2 <= y1:
        return bgr.copy()

    cropped = bgr[y1:y2, x1:x2].copy()
    if cropped.size == 0:
        return bgr.copy()
    if target_size > 0:
        cropped = cv.resize(cropped, (target_size, target_size), interpolation=cv.INTER_CUBIC)
    return cropped

def _alloc_new_id(existing: Optional[List[dict]] = None) -> int:
    used = {int(it.get("id", 0) or 0) for it in (existing or []) if int(it.get("id", 0) or 0) > 0}
    next_id = 1
    while next_id in used:
        next_id += 1
    return next_id

def load_register_list() -> List[dict]:
    global _REGISTER_CACHE
    now = time.time()
    cached = _REGISTER_CACHE.get("data")
    ts = _REGISTER_CACHE.get("ts", 0.0)
    if cached is not None and (now - ts) < _CACHE_TTL:
        return copy.deepcopy(cached)

    client = get_client()
    org_id = get_default_org_id()
    res = client.table("register_faces").select(
        "id, org_id, person_id, label, embedding, photo_path, x, y, width, height, ts"
    ).eq("org_id", org_id).order("id").execute()
    rows = getattr(res, "data", []) or []
    out: List[dict] = []
    for it in rows:
        version = None
        try:
            version = str(it.get("ts") or "") or None
        except Exception:
            version = None
        photo_path = it.get("photo_path")
        item = {
            "id": it.get("id"),
            "person_id": it.get("person_id"),
            "label": it.get("label"),
            "embedding": it.get("embedding") or [],
            "photo_path": photo_path,
            "photo_url": (get_face_public_url(photo_path, version) if photo_path else None),
            "x": it.get("x"),
            "y": it.get("y"),
            "width": it.get("width"),
            "height": it.get("height"),
            "ts": it.get("ts"),
            }
        out.append(item)
    _REGISTER_CACHE["data"] = copy.deepcopy(out)
    _REGISTER_CACHE["ts"] = now
    return out

def save_register_list(data: List[dict]) -> None:
    client = get_client()
    org_id = get_default_org_id()
    # Ensure persons exist for each entry (person_id foreign key)
    persons_payload = []
    for it in (data or []):
        pid = (it.get("person_id") or "").strip()
        if not pid:
            continue
        persons_payload.append({
            "person_id": pid,
            "org_id": org_id,
            "label": it.get("label"),
            "photo_path": it.get("photo_path"),
        })
    existing_rows = []
    try:
        res_existing = client.table("persons").select("person_id, label").eq("org_id", org_id).execute()
        existing_rows = getattr(res_existing, "data", []) or []
    except Exception:
        existing_rows = []

    if persons_payload:
        client.table("persons").upsert(persons_payload, on_conflict="person_id").execute()

    if existing_rows:
        new_person_ids = {str(item["person_id"]).strip() for item in persons_payload if item.get("person_id")}
        label_map: Dict[str, set[str]] = {}
        for item in persons_payload:
            lab = str(item.get("label") or "").strip().lower()
            pid = str(item.get("person_id") or "").strip()
            if not lab or not pid:
                continue
            label_map.setdefault(lab, set()).add(pid)

        stale_ids: List[str] = []
        for row in existing_rows:
            pid = str(row.get("person_id") or "").strip()
            if not pid:
                continue
            lab = str(row.get("label") or "").strip().lower()
            if pid in new_person_ids:
                continue
            if lab and lab in label_map and pid not in label_map[lab]:
                stale_ids.append(pid)
                continue
            if not lab or lab not in label_map:
                stale_ids.append(pid)

        if stale_ids:
            for idx in range(0, len(stale_ids), 100):
                chunk = stale_ids[idx: idx + 100]
                try:
                    client.table("persons").delete().eq("org_id", org_id).in_("person_id", chunk).execute()
                except Exception:
                    break

    # Replace register_faces list
    client.table("register_faces").delete().eq("org_id", org_id).execute()
    rows = []
    for it in (data or []):
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
    if rows:
        client.table("register_faces").insert(rows).execute()

    _REGISTER_CACHE["data"] = copy.deepcopy(data or [])
    _REGISTER_CACHE["ts"] = time.time()

def ensure_register_person_ids(items: List[dict]) -> List[dict]:
    seen: set[str] = set()
    changed = False
    from secrets import randbelow
    _BASE36 = "abcdefghijklmnopqrstuvwxyz0123456789"
    def _gen_person_id() -> str:
        def seg(n: int) -> str:
            return "".join(_BASE36[randbelow(len(_BASE36))] for _ in range(n))
        return f"p-{seg(4)}-{seg(3)}-{seg(3)}"
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
            save_register_list(items)
        except Exception:
            pass
    return items

def _rel_from_abs(abs_path: str) -> str:
    try:
        rel = os.path.relpath(abs_path, BASE_DIR)
    except Exception:
        rel = abs_path
    rel = rel.replace("\\", "/").lstrip("/")
    if not rel.startswith(("uploads/", "static/", "images/", "assets/")) and os.path.exists(abs_path):
        if FACE_WATCH_DIR.replace("\\", "/") in abs_path.replace("\\", "/"):
            rel = "uploads/face/" + os.path.basename(abs_path)
    return rel

async def _engine_recognize(bgr, th: float):
    return await _engine_async_call(engine.recognize, bgr, th)  # type: ignore[arg-type]

async def _upsert_register_entry_from_image(label: str, img_abs: str, bgr: np.ndarray | None = None) -> dict:
    label = str(label or "").strip()
    if not label:
        return {"ok": False, "reason": "label empty"}

    if bgr is None:
        bgr = cv.imread(img_abs)
    if bgr is None:
        return {"ok": False, "reason": "cannot read image"}

    dets = await _engine_recognize(bgr, 0.0)
    if not dets:
        return {"ok": False, "reason": "no face"}
    row, _, _ = dets[0]
    try:
        emb = await _engine_async_call(engine.get_embedding, bgr, row)  # type: ignore[arg-type]
        emb_list = emb.tolist() if hasattr(emb, "tolist") else list(map(float, emb))
    except Exception as e:
        return {"ok": False, "reason": f"embed fail: {e}"}

    x, y, w, h = [int(v) for v in row[:4]]
    rel = _rel_from_abs(img_abs)

    items = load_register_list()
    now_iso = _now_iso()
    idx_found = -1
    for i, it in enumerate(items):
        if str(it.get("label", "")).strip() == label:
            idx_found = i
            break

    if idx_found >= 0:
        it = items[idx_found]
        it.update({
            "x": x,
            "y": y,
            "width": w,
            "height": h,
            "embedding": emb_list,
            "photo_path": rel,
            "photo_url": "/" + rel.lstrip("/"),
            "ts": now_iso,
        })
        items[idx_found] = it
        created = False
    else:
        items.append({
            "id": None,
            "label": label,
            "person_id": None,
            "embedding": emb_list,
            "photo_path": rel,
            "photo_url": "/" + rel.lstrip("/"),
            "x": x,
            "y": y,
            "width": w,
            "height": h,
            "ts": now_iso,
        })
        created = True

    items = ensure_register_person_ids(items)
    save_register_list(items)
    return {"ok": True, "created": created, "label": label, "items": items}

async def auto_register_faces_once():
    if not ENABLE_FACE_WATCH:
        return
    face_dir = os.path.join(UPLOAD_DIR, "face")
    if not os.path.isdir(face_dir):
        return
    existing_items = load_register_list()
    ensure_register_person_ids(existing_items)
    existing = {str(it.get("label", "")) for it in existing_items}
    try:
        items_now = load_register_list()
        safe_to_orig = {
            secure_filename(str(it.get("label", "")).strip()): str(it.get("label", "")).strip()
            for it in items_now
            if str(it.get("label", "")).strip()
        }
    except Exception:
        safe_to_orig = {}
    for fname in sorted(os.listdir(face_dir)):
        path = os.path.join(face_dir, fname)
        if not os.path.isfile(path):
            continue
        base, _ = os.path.splitext(fname)
        label = safe_to_orig.get(base) or _restore_label_from_safe_base(base)
        if label in existing:
            try:
                idx_map = _load_face_watch_index()
                idx_map[path] = os.path.getmtime(path)
                _save_face_watch_index(idx_map)
            except Exception:
                pass
            continue
        bgr = cv.imread(path)
        if bgr is None:
            continue
        try:
            ok_reg, _msg = _engine_sync_call(engine.register_from_image, label, bgr)
            if ok_reg:
                await _upsert_register_entry_from_image(label, path, bgr)
                print(f"[AUTO REGISTER] {label}: OK (save to /admin/register-db)")
            else:
                print(f"[AUTO REGISTER] {label}: register fail")
        except Exception as e:
            print(f"[AUTO REGISTER] {label}: {e}")

def _iter_face_files() -> Iterable[str]:
    if not ENABLE_FACE_WATCH or not os.path.isdir(FACE_WATCH_DIR):
        return []
    return [
        os.path.join(FACE_WATCH_DIR, name)
        for name in os.listdir(FACE_WATCH_DIR)
        if name.lower().endswith((".jpg", ".jpeg", ".png", ".bmp", ".webp"))
        and os.path.isfile(os.path.join(FACE_WATCH_DIR, name))
    ]

def _load_face_watch_index() -> Dict[str, float]:
    if not ENABLE_FACE_WATCH:
        return {}
    try:
        client = get_client()
        org_id = get_default_org_id()
        res = client.table("face_watch_index").select("path, mtime").eq("org_id", org_id).limit(10000).execute()
        items = getattr(res, "data", []) or []
        return {str(it.get("path")): float(it.get("mtime", 0.0) or 0.0) for it in items if it.get("path")}
    except Exception:
        return {}

def _save_face_watch_index(idx: Dict[str, float]) -> None:
    if not ENABLE_FACE_WATCH:
        return
    try:
        client = get_client()
        org_id = get_default_org_id()
        rows = [{"org_id": org_id, "path": p, "mtime": float(m)} for p, m in (idx or {}).items()]
        if rows:
            client.table("face_watch_index").upsert(rows, on_conflict="org_id,path").execute()
    except Exception:
        pass

async def face_hot_watcher():
    if not ENABLE_FACE_WATCH:
        return
    idx = _load_face_watch_index()
    while True:
        changed_labels: List[str] = []
        try:
            try:
                missing = [p for p in list(idx.keys()) if not os.path.exists(p)]
                if missing:
                    for p in missing:
                        idx.pop(p, None)
                    _save_face_watch_index(idx)
            except Exception:
                pass
            for p in list(_iter_face_files() or []):
                try:
                    mtime = os.path.getmtime(p)
                    prev = idx.get(p)
                    if prev != mtime:
                        base, _ = os.path.splitext(os.path.basename(p))
                        label = _restore_label_from_safe_base(base)
                        bgr = cv.imread(p)
                        if bgr is None:
                            continue
                        ok_reg, _msg = _engine_sync_call(engine.register_from_image, label, bgr)
                        if ok_reg:
                            try:
                                await _upsert_register_entry_from_image(label, p, bgr)
                            except Exception as e:
                                print("[FACE_WATCHER] upsert failed:", e)
                            idx[p] = mtime
                            changed_labels.append(label)
                except Exception as e:
                    print("[FACE_WATCHER] file error:", p, e)
            if changed_labels:
                _save_face_watch_index(idx)
                if _sio is not None:
                    try:
                        await _sio.emit("att_db_update", {"labels": changed_labels})
                    except Exception:
                        pass
        except Exception as e:
            print("[FACE_WATCHER] loop error:", e)
        await anyio.sleep(FACE_WATCH_INTERVAL)

def prime_face_watch_index_from_dir(only_labels: Optional[set[str]] = None) -> None:
    if not ENABLE_FACE_WATCH:
        return
    try:
        idx = _load_face_watch_index()
        changed = False
        removed = [p for p in list(idx.keys()) if not os.path.exists(p)]
        for p in removed:
            idx.pop(p, None)
            changed = True
        for p in list(_iter_face_files() or []):
            try:
                if only_labels is not None:
                    base = os.path.splitext(os.path.basename(p))[0]
                    lab = _restore_label_from_safe_base(base)
                    if lab not in only_labels:
                        continue
                mtime = os.path.getmtime(p)
                if idx.get(p) != mtime:
                    idx[p] = mtime
                    changed = True
            except Exception:
                continue
        if changed:
            _save_face_watch_index(idx)
    except Exception as e:
        print("[FACE_WATCHER] prime index failed:", e)

def _find_idx_by_id(data: List[dict], item_id: int) -> int:
    for i, it in enumerate(data):
        try:
            if int(str(it.get("id"))) == int(item_id):
                return i
        except Exception:
            pass
    return -1

def _migrate_register_ids() -> None:
    items = load_register_list()
    if not items:
        return
    seen: set[int] = set()
    changed = False
    for it in items:
        try:
            iid = int(it.get("id", 0) or 0)
            if iid > 0:
                if iid in seen:
                    it["id"] = 0
                    changed = True
                else:
                    seen.add(iid)
            else:
                it["id"] = 0
        except Exception:
            it["id"] = 0
            changed = True

    def _alloc_new_id(existing: Optional[List[dict]] = None) -> int:
        used = {int(it.get("id", 0) or 0) for it in (existing or []) if int(it.get("id", 0) or 0) > 0}
        next_id = 1
        while next_id in used:
            next_id += 1
        return next_id

    for it in items:
        try:
            if int(it.get("id", 0) or 0) <= 0:
                new_id = _alloc_new_id(items)
                while new_id in seen:
                    new_id = _alloc_new_id(items)
                it["id"] = new_id
                seen.add(new_id)
                changed = True
        except Exception:
            continue

    if changed:
        save_register_list(items)
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

def _restore_label_from_safe_base(safe_base: str) -> str:
    base = str(safe_base or "").strip()
    if not base:
        return base
    try:
        items = load_register_list()
        for it in items:
            lab = str(it.get("label", "") or "").strip()
            if not lab:
                continue
            from werkzeug.utils import secure_filename
            if secure_filename(lab) == base:
                return lab
    except Exception:
        pass
    return base

def _resolve_entry_image_path(entry: dict, label: str) -> str | None:
    rel = (entry.get("photo_path") or entry.get("path") or "").strip()
    if rel:
        rel_norm = rel.replace("\\", "/").lstrip("/")
        local_candidate = os.path.join(BASE_DIR, rel_norm)
        if os.path.exists(local_candidate):
            return local_candidate
        try:
            from db.storage import download_face_object
        except ModuleNotFoundError as exc:
            print("[STORAGE] optional download not available:", exc)
        else:
            target_dir = Path(UPLOAD_DIR) / "face"
            target_dir.mkdir(parents=True, exist_ok=True)
            dest = target_dir / f"{label}.jpg"
            try:
                download_face_object(rel_norm)
                if dest.exists():
                    return str(dest)
            except Exception as e:
                print("[STORAGE] download failed:", e)
    return None

__all__ = [
    "load_register_list",
    "save_register_list",
    "ensure_register_person_ids",
    "set_socket_server",
    "_gen_person_id",
    "load_register_list",
    "save_register_list",
    "ensure_register_person_ids",
    "crop_face_image",
    "_rel_from_abs",
    "_upsert_register_entry_from_image",
    "auto_register_faces_once",
    "_iter_face_files",
    "_load_face_watch_index",
    "_save_face_watch_index",
    "prime_face_watch_index_from_dir",
    "face_hot_watcher",
    "_find_idx_by_id",
    "_migrate_register_ids",
    "_engine_forget_label",
    "_restore_label_from_safe_base",
    "_resolve_entry_image_path",
]
