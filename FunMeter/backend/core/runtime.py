from __future__ import annotations

import os
import threading
from functools import partial
from typing import Any

import asyncio
import numpy as np

from utils.face_engine import FaceEngine


_ENGINE_BACKEND = (os.getenv("OPENCV_BACKEND", "cpu") or "cpu").lower().strip()
engine = FaceEngine(backend=_ENGINE_BACKEND, use_redis=(os.getenv("USE_REDIS", "0") == "1"))
engine.backend_name = _ENGINE_BACKEND  # type: ignore[attr-defined]

ENGINE_LOCK = threading.RLock()


def _call_with_engine_lock(func, *args, **kwargs):
    with ENGINE_LOCK:
        return func(*args, **kwargs)


async def engine_async_call(func, *args, **kwargs):
    runner = partial(_call_with_engine_lock, func, *args, **kwargs)
    return await asyncio.to_thread(runner)


def engine_sync_call(func, *args, **kwargs):
    return _call_with_engine_lock(func, *args, **kwargs)
