from __future__ import annotations

import re
import secrets
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional, Set, Tuple, Union

from pydantic import BaseModel, Field, model_validator

from helpers.time_utils import (
    clamp_int as _clamp_int,
    hhmm_to_minutes as _hhmm_to_minutes,
    normalize_hhmm as _normalize_hhmm,
)
from utils.config_store import DEFAULT_CONFIG
from services.register_db import _gen_person_id, load_register_list

_OVERRIDE_ID_RE = re.compile(r"^p-[a-z0-9]{4}-[a-z0-9]{3}-[a-z0-9]{3}$", re.IGNORECASE)
_UUID_RE = re.compile(r"^[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}$",re.IGNORECASE)

_ATT_GRACE_IN = int(DEFAULT_CONFIG["attendance"].get("grace_in_min", 10))
_ATT_GRACE_OUT = int(DEFAULT_CONFIG["attendance"].get("grace_out_min", 5))


def set_attendance_grace_defaults(grace_in: int, grace_out: int) -> None:
    """Update grace defaults used by validation models."""
    global _ATT_GRACE_IN, _ATT_GRACE_OUT
    _ATT_GRACE_IN = grace_in
    _ATT_GRACE_OUT = grace_out

def _load_reg_list() -> List[dict]:
    try:
        return load_register_list()
    except Exception:
        return []

class RegisterPayload(BaseModel):
    username: str
    password: str
    is_admin: bool = False

class Promote(BaseModel):
    user_id: Optional[str] = None
    username: Optional[str] = None
    is_admin: bool = True

    @model_validator(mode="after")
    def _ensure_identifier(self) -> "Promote":
        user_id = (self.user_id or "").strip() if self.user_id else ""
        username = (self.username or "").strip() if self.username else ""
        if not user_id and not username:
            raise ValueError("user_id atau username wajib diisi")
        self.user_id = user_id or None
        self.username = username or None
        return self

class ApiKeyReset(BaseModel):
    new_api_key: Optional[str] = None

class LoginPayload(BaseModel):
    username: str = ""
    password: str = ""
    api_key: Optional[str] = None

class SetPasswordPayload(BaseModel):
    user_id: Optional[str] = None
    username: Optional[str] = None
    password: str

    @model_validator(mode="after")
    def _validate_ident(self) -> "SetPasswordPayload":
        uid = (self.user_id or "").strip() if self.user_id else ""
        uname = (self.username or "").strip() if self.username else ""
        if not uid and not uname:
            raise ValueError("user_id atau username wajib diisi")
        self.user_id = uid or None
        self.username = uname or None
        return self

class AdminUpdate(BaseModel):
    label: Optional[str] = None
    move_photo: Optional[bool] = False
    reembed: Optional[bool] = True

class AdminBulk(BaseModel):
    action: Literal["delete", "reembed", "export"]
    ids: List[int] = Field(default_factory=list)
    delete_photo: Optional[bool] = False

class AttendanceClear(BaseModel):
    label: Optional[str] = Field(default=None, description="Kosongkan untuk hapus semua")

class AttendanceDailyDelete(BaseModel):
    label: Optional[str] = Field(default=None, description="Filter label; kosong untuk semua label pada tanggal tsb")
    date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    person_id: Optional[str] = Field(default=None, description="Jika diisi, hanya hapus log milik person_id tersebut")

class AttendanceEventCreate(BaseModel):
    label: str
    ts: Optional[str] = Field(None, description="Timestamp WIB 'YYYY-MM-DD HH:MM:SS' (opsional)")
    score: Optional[float] = 0.0

class AttendanceEventUpdate(BaseModel):
    label: Optional[str] = None
    ts: Optional[str] = None
    score: Optional[float] = None

class EventsBulkDelete(BaseModel):
    label: Optional[str] = None
    start: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    end: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")

class FaceEngineUpdate(BaseModel):
    min_cosine_accept: Optional[float] = Field(None, ge=0.0, le=1.0)
    fun_ws_min_interval: Optional[float] = Field(None, ge=0.01, le=5.0)
    att_ws_min_interval: Optional[float] = Field(None, ge=0.01, le=5.0)
    yunet_score_threshold: Optional[float] = Field(None, ge=0.0, le=1.0)
    yunet_nms_threshold: Optional[float] = Field(None, ge=0.0, le=1.0)
    yunet_top_k: Optional[int] = Field(None, ge=1, le=10000)

class AttendanceRule(BaseModel):
    day: Literal["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]
    label: Optional[str] = Field(None, max_length=64)
    enabled: Optional[bool] = True
    check_in: Optional[str] = Field(None, description="Format HH:MM (24 jam)")
    check_out: Optional[str] = Field(None, description="Format HH:MM (24 jam)")
    grace_in_min: Optional[int] = Field(None, ge=0, le=240)
    grace_out_min: Optional[int] = Field(None, ge=0, le=240)
    notes: Optional[str] = Field(None, max_length=280)

    @model_validator(mode="after")
    def validate_rule(self) -> "AttendanceRule":
        day = self.day
        enabled = bool(self.enabled)
        self.enabled = enabled

        label = (self.label or "").strip()
        self.label = label[:64] if label else "Jam Kerja Normal"

        raw_check_in = self.check_in
        raw_check_out = self.check_out

        norm_check_in = _normalize_hhmm(raw_check_in)
        norm_check_out = _normalize_hhmm(raw_check_out)

        if enabled:
            if norm_check_in is None or norm_check_out is None:
                raise ValueError(f"{day}: check_in dan check_out wajib diisi (format HH:MM)")
            if _hhmm_to_minutes(norm_check_out) <= _hhmm_to_minutes(norm_check_in):
                raise ValueError(f"{day}: check_out harus lebih besar dari check_in")
        else:
            if raw_check_in and norm_check_in is None:
                raise ValueError(f"{day}: check_in harus menggunakan format HH:MM")
            if raw_check_out and norm_check_out is None:
                raise ValueError(f"{day}: check_out harus menggunakan format HH:MM")

        self.check_in = norm_check_in
        self.check_out = norm_check_out

        base_grace_in = _clamp_int(_ATT_GRACE_IN, 0, 240, DEFAULT_CONFIG["attendance"]["grace_in_min"])
        base_grace_out = _clamp_int(_ATT_GRACE_OUT, 0, 240, DEFAULT_CONFIG["attendance"]["grace_out_min"])
        grace_in_default = base_grace_in if enabled else 0
        grace_out_default = base_grace_out if enabled else 0
        self.grace_in_min = _clamp_int(self.grace_in_min, 0, 240, default=grace_in_default)
        self.grace_out_min = _clamp_int(self.grace_out_min, 0, 240, default=grace_out_default)

        notes = (self.notes or "").strip()
        self.notes = notes[:280]
        return self

class OverrideTarget(BaseModel):
    type: str
    value: str

    @model_validator(mode="after")
    def validate_target(self) -> "OverrideTarget":
        value = (self.value or "").strip()
        if not value:
            raise ValueError("Target override kosong")

        raw_type = (self.type or "label").strip().lower()
        if raw_type in {"person", "person_id"}:
            self.type = "person"
        elif raw_type in {"group", "group_id"}:
            self.type = "group"
        elif raw_type == "face_id":
            self.type = "face_id"
        else:
            self.type = "label"

        if self.type == "person" and not _OVERRIDE_ID_RE.match(value):
            raise ValueError("person override harus format p-xxxx-xxx-xxx")
        if self.type == "group" and not _UUID_RE.match(value):
            raise ValueError("group override harus UUID")
        if self.type == "face_id":
            try:
                int(value)
            except ValueError as exc:
                raise ValueError("face_id harus integer") from exc

        self.value = value
        return self

class AttendanceOverride(BaseModel):
    id: Optional[str] = None
    start_date: str = Field(..., description="Format YYYY-MM-DD")
    end_date: Optional[str] = Field(None, description="Format YYYY-MM-DD")
    label: Optional[str] = Field(None, max_length=64)
    enabled: Optional[bool] = True
    check_in: Optional[str] = Field(None, description="Format HH:MM (24 jam)")
    check_out: Optional[str] = Field(None, description="Format HH:MM (24 jam)")
    grace_in_min: Optional[int] = Field(None, ge=0, le=240)
    grace_out_min: Optional[int] = Field(None, ge=0, le=240)
    notes: Optional[str] = Field(None, max_length=280)
    targets: Optional[List[Union[str, OverrideTarget]]] = Field(
        default=None,
        description="Daftar label yang terkena override; kosong/null berarti berlaku untuk semua.",
    )

    # Keep Pydantic happy: validator calls a normal method
    @model_validator(mode="after")
    def _validate_model(self) -> "AttendanceOverride":
        return self._normalize_values()

    # Your original logic, now as a plain method you can call directly
    def _normalize_values(self) -> "AttendanceOverride":
        start = (self.start_date or "").strip()
        if not start:
            raise ValueError("start_date wajib diisi (format YYYY-MM-DD)")
        try:
            start_dt = datetime.strptime(start, "%Y-%m-%d")
        except Exception as exc:  # noqa: BLE001
            raise ValueError("start_date harus format YYYY-MM-DD") from exc

        end_raw = (self.end_date or start).strip()
        try:
            end_dt = datetime.strptime(end_raw, "%Y-%m-%d")
        except Exception as exc:  # noqa: BLE001
            raise ValueError("end_date harus format YYYY-MM-DD") from exc

        if end_dt < start_dt:
            start_dt, end_dt = end_dt, start_dt

        self.start_date = start_dt.strftime("%Y-%m-%d")
        self.end_date = end_dt.strftime("%Y-%m-%d")

        enabled = bool(self.enabled)
        self.enabled = enabled

        norm_check_in = _normalize_hhmm(self.check_in)
        norm_check_out = _normalize_hhmm(self.check_out)

        if enabled:
            if norm_check_in is None or norm_check_out is None:
                raise ValueError("check_in dan check_out wajib diisi untuk override aktif")
            if _hhmm_to_minutes(norm_check_out) <= _hhmm_to_minutes(norm_check_in):
                raise ValueError("check_out harus lebih besar dari check_in")

        self.check_in = norm_check_in
        self.check_out = norm_check_out

        default_grace_in = _ATT_GRACE_IN if enabled else 0
        default_grace_out = _ATT_GRACE_OUT if enabled else 0
        self.grace_in_min = _clamp_int(self.grace_in_min, 0, 240, default=default_grace_in)
        self.grace_out_min = _clamp_int(self.grace_out_min, 0, 240, default=default_grace_out)

        label = (self.label or "").strip()
        self.label = label[:64] if label else "Custom Schedule"

        notes = (self.notes or "").strip()
        self.notes = notes[:280]

        raw_targets = self.targets
        if raw_targets:
            if isinstance(raw_targets, (str, bytes)):
                raw_targets = [raw_targets]
            cleaned_typed: List[OverrideTarget] = []
            seen: Set[Tuple[str, str]] = set()
            for item in raw_targets:
                if isinstance(item, OverrideTarget):
                    raw_type = (item.type or "label").strip().lower()
                    t_val = (item.value or "").strip()
                elif isinstance(item, dict):
                    raw_type = str(item.get("type") or "label").strip().lower()
                    t_val = str(item.get("value") or "").strip()
                else:
                    t_val = str(item or "").strip()
                    if not t_val:
                        continue
                    if _OVERRIDE_ID_RE.match(t_val):
                        raw_type = "person"
                    elif _UUID_RE.match(t_val):
                        raw_type = "group"
                    elif t_val.isdigit():
                        raw_type = "face_id"
                        try:
                            num = int(t_val)
                            if not any(int(it.get("id", -1)) == num for it in _load_reg_list()):
                                raw_type = "label"
                        except Exception:
                            raw_type = "label"
                    else:
                        raw_type = "label"
                if not t_val:
                    continue
                norm_type = (
                    "person"
                    if raw_type in {"person", "person_id"}
                    else "group"
                    if raw_type in {"group", "group_id"}
                    else "face_id"
                    if raw_type == "face_id"
                    else "label"
                )
                key_val = t_val.casefold() if norm_type != "group" else t_val.lower()
                key = (norm_type, key_val)
                if key in seen:
                    continue
                cleaned_typed.append(OverrideTarget(type=norm_type, value=t_val))
                seen.add(key)
                if len(cleaned_typed) >= 64:
                    break
            self.targets = cleaned_typed or None  # type: ignore[assignment]
        else:
            self.targets = None

        if not self.id:
            self.id = secrets.token_hex(8)

        return self

class AttendanceUpdate(BaseModel):
    cooldown_sec: Optional[int] = Field(None, ge=0, le=7 * 24 * 3600)
    min_cosine_accept: Optional[float] = Field(None, ge=0.0, le=1.0)
    grace_in_min: Optional[int] = Field(None, ge=0, le=240)
    grace_out_min: Optional[int] = Field(None, ge=0, le=240)
    rules: Optional[List[AttendanceRule]] = None
    overrides: Optional[List[AttendanceOverride]] = None

class AttendanceSchedulePayload(BaseModel):
    grace_in_min: Optional[int] = Field(None, ge=0, le=240)
    grace_out_min: Optional[int] = Field(None, ge=0, le=240)
    rules: Optional[List[AttendanceRule]] = None
    overrides: Optional[List[AttendanceOverride]] = None

    @model_validator(mode="after")
    def _normalize(self) -> "AttendanceSchedulePayload":
        if self.overrides is not None:
            normalized: List[AttendanceOverride] = []
            for item in (self.overrides or []):
                if isinstance(item, AttendanceOverride):
                    normalized.append(item._normalize_values())
                else:
                    normalized.append(AttendanceOverride(**item)._normalize_values())
            self.overrides = normalized
        return self

class ConfigUpdate(BaseModel):
    face_engine: Optional[FaceEngineUpdate] = None
    attendance: Optional[AttendanceUpdate] = None

class ConfigReset(BaseModel):
    scope: Literal["all", "face_engine", "attendance"] = "all"

__all__ = [
    "RegisterPayload",
    "Promote",
    "ApiKeyReset",
    "LoginPayload",
    "SetPasswordPayload",
    "AdminUpdate",
    "AdminBulk",
    "AttendanceClear",
    "AttendanceDailyDelete",
    "AttendanceEventCreate",
    "AttendanceEventUpdate",
    "EventsBulkDelete",
    "FaceEngineUpdate",
    "AttendanceRule",
    "OverrideTarget",
    "AttendanceOverride",
    "AttendanceUpdate",
    "AttendanceSchedulePayload",
    "ConfigUpdate",
    "ConfigReset",
    "set_attendance_grace_defaults",
    "_ATT_GRACE_IN",
    "_ATT_GRACE_OUT",
    "_OVERRIDE_ID_RE",
    "_UUID_RE",
]
