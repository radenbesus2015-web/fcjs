from __future__ import annotations

import json
from typing import Any
from fastapi.responses import JSONResponse


def pretty_json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True)


def json_error(message: str, status_code: int = 400, **extra: Any) -> JSONResponse:
    payload = {"status": "error", "message": message}
    if extra:
        payload.update(extra)
    return JSONResponse(status_code=status_code, content=payload)

