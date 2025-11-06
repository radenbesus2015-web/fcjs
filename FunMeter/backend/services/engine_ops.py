from __future__ import annotations

from typing import Dict, List

import cv2 as cv
import numpy as np

from core.runtime import engine, ENGINE_LOCK, engine_sync_call
from services.register_db import load_register_list
from helpers.http import pretty_json


def refresh_from_register(reason: str | None = None) -> dict:
    entries = load_register_list()
    refreshed: list[str] = []
    errors: list[str] = []

    with ENGINE_LOCK:
        current_labels = set(getattr(engine, "db", {}).keys()) if hasattr(engine, "db") else set()
        if getattr(engine, "redis_db", None) is not None:
            for lab in current_labels:
                try:
                    engine.redis_db.delete_label(lab)  # type: ignore[union-attr]
                except Exception as e:
                    errors.append(f"redis delete {lab}: {e}")
        if hasattr(engine, "db"):
            engine.db = {}

        for entry in entries:
            label = str(entry.get("label", "")).strip()
            if not label:
                continue
            vec = None
            emb = entry.get("embedding")
            if isinstance(emb, list) and emb:
                try:
                    arr = np.asarray(emb, dtype=np.float32).reshape(-1)  # type: ignore
                    norm = float(np.linalg.norm(arr))
                    if norm > 0:
                        arr = arr / norm
                    vec = arr
                except Exception as e:
                    errors.append(f"{label}: invalid embedding ({e})")

            if vec is not None:
                engine.db[label] = vec
                if getattr(engine, "redis_db", None) is not None:
                    try:
                        engine.redis_db.save_vector(label, vec)  # type: ignore[union-attr]
                    except Exception as e:
                        errors.append(f"{label}: redis save failed ({e})")
                refreshed.append(label)
                continue
            # Skip entries without valid embedding to avoid expensive Photo->Embedding compute here
            errors.append(f"{label}: missing embedding; skipped")

    if reason:
        print(f"[ENGINE] refresh ({reason}) labels={len(refreshed)} errors={len(errors)}")
    return {"labels": refreshed, "errors": errors}


def engine_summary() -> Dict[str, any]: # type: ignore
    with ENGINE_LOCK:
        backend_pair = (getattr(engine, "backend_id", None), getattr(engine, "target_id", None))
        backend_name = getattr(engine, "backend_name", "unknown")
        labels = []
        if hasattr(engine, "db") and isinstance(engine.db, dict):
            labels = sorted(map(str, engine.db.keys()))
        return {
            "backend": backend_name,
            "backend_id": backend_pair[0],
            "target_id": backend_pair[1],
            "label_count": len(labels),
            "labels": labels,
            "emotion_model": getattr(getattr(engine, "emotion", None), "__class__", type("", (), {})) .__name__ if getattr(engine, "emotion", None) else None,
            "emotion_labels": list(getattr(engine, "emotion_labels", [])),
        }
