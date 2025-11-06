from __future__ import annotations

import os
from pathlib import Path
import random
import threading
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Optional, TYPE_CHECKING, cast

try:
    # runtime cuma butuh factory-nya
    from supabase import create_client as _create_client
except Exception:
    _create_client = None  # type: ignore[assignment]

# Tipe Client cuma muncul saat type checking
if TYPE_CHECKING:
    from supabase import Client as SupabaseClient  # pragma: no cover
else:
    SupabaseClient = Any  # type: ignore[misc,assignment]

__all__ = [
    "SupabaseNotConfigured",
    "SupabaseConfig",
    "get_client",
    "get_default_org_id",
]

# =========================
# Exceptions & Config
# =========================

class SupabaseNotConfigured(RuntimeError):
    pass


@dataclass(frozen=True)
class SupabaseConfig:
    url: str
    key: str
    default_org_slug: Optional[str] = None
    default_org_name: Optional[str] = None


def _load_config() -> SupabaseConfig:
    url = os.getenv("SUPABASE_URL", "").strip()
    key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY") or
        os.getenv("SUPABASE_SERVICE_KEY") or
        os.getenv("SUPABASE_KEY") or
        os.getenv("SUPABASE_ANON_KEY") or
        ""
    ).strip()

    if not url or not key:
        raise SupabaseNotConfigured(
            "SUPABASE_URL atau KEY tidak ter-set di environment "
            "(coba set SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_KEY / SUPABASE_KEY / SUPABASE_ANON_KEY)."
        )

    return SupabaseConfig(
        url=url,
        key=key,
        default_org_slug=os.getenv("DEFAULT_ORG_SLUG") or os.getenv("ORG_SLUG"),
        default_org_name=os.getenv("DEFAULT_ORG_NAME") or os.getenv("ORG_NAME"),
    )



# =========================
# Retry helper
# =========================

def _get_status_from_error(err: Exception) -> Optional[int]:
    # Coba ambil status_code dari berbagai bentuk error (httpx/postgrest)
    for attr in ("response", "res", "result"):
        resp = getattr(err, attr, None)
        if resp is None:
            continue
        for f in ("status_code", "status"):
            sc = getattr(resp, f, None)
            if isinstance(sc, int):
                return sc
        # httpx.HTTPStatusError.message internasional
        try:
            sc = int(str(getattr(resp, "status_code", None)))
            return sc
        except Exception:
            pass
    # Beberapa error bawa .code
    code = getattr(err, "code", None)
    if isinstance(code, int):
        return code
    return None


def _get_retry_after_seconds(err: Exception) -> Optional[float]:
    resp = getattr(err, "response", None)
    if resp is not None:
        # httpx response / requests response kompatibel
        headers = getattr(resp, "headers", None)
        if headers:
            ra = headers.get("Retry-After") or headers.get("retry-after")
            if ra:
                try:
                    return float(ra)
                except Exception:
                    pass
    return None


def _should_retry(status: Optional[int]) -> bool:
    # Retry untuk 429 & 5xx saja
    if status is None:
        return True  # network hiccup; coba ulang
    if status == 429:
        return True
    if 500 <= status <= 599:
        return True
    return False


def _sleep_backoff(attempt: int, retry_after: Optional[float]) -> None:
    if retry_after is not None:
        time.sleep(max(0.0, retry_after))
        return
    # Exponential backoff + jitter kecil
    base = min(5.0, 0.4 * (2 ** attempt))
    jitter = random.random() * 0.2
    time.sleep(base + jitter)


# =========================
# Query proxy with retry
# =========================

class _QueryProxy:
    """
    Ngebungkus PostgrestQueryBuilder dari supabase-py.
    Chain method apapun (select/eq/gt/in_/order/limit/insert/dll) tetep balik _QueryProxy,
    tapi saat .execute() dipanggil → pakai retry wrapper.
    """
    __slots__ = ("_qb", "_attempts")

    def __init__(self, qb: Any, attempts: int = 3) -> None:
        self._qb = qb
        self._attempts = attempts

    def __getattr__(self, name: str):
        if name == "execute":
            return self._execute_with_retry
        # Bungkus semua call chain method
        attr = getattr(self._qb, name)
        if callable(attr):
            def _wrapped(*args, **kwargs):
                res = attr(*args, **kwargs)
                # Sebagian method balikin QueryBuilder baru, jadi bungkus lagi
                return _QueryProxy(res, attempts=self._attempts)
            return _wrapped
        # Properti langsung (jarang dipakai)
        return attr

    # Jalankan eksekusi dengan retry untuk 429/5xx atau error jaringan
    def _execute_with_retry(self, *args, **kwargs):
        last_err: Optional[Exception] = None
        for i in range(self._attempts):
            try:
                res = self._qb.execute(*args, **kwargs)
                # supabase-py v1 punya res.error; v2 biasanya raise kalau error
                err = getattr(res, "error", None)
                if err:
                    # Bentuk err bisa dict/string/obj; fallback ke raise supaya ke-catch loop
                    raise RuntimeError(f"Supabase error: {err}")
                return res
            except Exception as e:  # noqa: BLE001
                last_err = e
                status = _get_status_from_error(e)
                if not _should_retry(status):
                    raise
                _sleep_backoff(i, _get_retry_after_seconds(e))
        # Habis jatah retry
        assert last_err is not None
        raise last_err


class _ClientProxy:
    """
    Proxy untuk Supabase Client supaya .table() (atau .from_) balikin _QueryProxy
    yang sudah auto-retry saat .execute() dipanggil.
    """
    __slots__ = ("_client", "_attempts")

    def __init__(self, client: 'SupabaseClient', attempts: int = 3) -> None:
        self._client = client
        self._attempts = attempts

    def table(self, name: str) -> _QueryProxy:
        qb = self._client.table(name)
        return _QueryProxy(qb, attempts=self._attempts)

    # Supabase v1 alias
    def from_(self, name: str) -> _QueryProxy:  # noqa: A003 - namanya memang from_
        qb = self._client.from_(name)
        return _QueryProxy(qb, attempts=self._attempts)

    # Delegasikan attribute lain ke client asli (auth, storage, functions, dsb)
    def __getattr__(self, name: str):
        return getattr(self._client, name)


# =========================
# Singleton Client
# =========================

_CLIENT_LOCK = threading.RLock()
_CLIENT_SINGLETON: Optional[_ClientProxy] = None


def get_client() -> _ClientProxy:
    """
    Dapatkan client Supabase proxy (singleton & thread-safe).
    """
    global _CLIENT_SINGLETON
    if _CLIENT_SINGLETON is not None:
        return _CLIENT_SINGLETON

    with _CLIENT_LOCK:
        if _CLIENT_SINGLETON is not None:
            return _CLIENT_SINGLETON
        cfg = _load_config()
        if _create_client is None:
            raise SupabaseNotConfigured("supabase package tidak tersedia")
        real_client = _create_client(cfg.url, cfg.key)  # runtime object
        _CLIENT_SINGLETON = _ClientProxy(cast('SupabaseClient', real_client),
                                        attempts=int(os.getenv("SUPABASE_RETRY_ATTEMPTS", "3") or "3"))
        return _CLIENT_SINGLETON


# =========================
# Default org resolver (cached)
# =========================

@lru_cache(maxsize=1)
def get_default_org_id() -> str:
    """
    Cari (atau buat) organization default berdasarkan slug.
    Cache di memori biar gak nge-spam DB saat traffic kencang.
    """
    client = get_client()
    cfg = _load_config()

    slug = (cfg.default_org_slug or "default").strip()
    if not slug:
        slug = "default"

    # 1) Coba cari
    res = client.table("organizations").select("id").eq("slug", slug).limit(1).execute()
    rows = getattr(res, "data", []) or []
    if rows and rows[0].get("id"):
        return str(rows[0]["id"])

    # 2) Kalau gak ada, buat
    payload = {"name": (cfg.default_org_name or slug.title()), "slug": slug}
    ins = client.table("organizations").insert(payload).execute()
    created = getattr(ins, "data", []) or []
    if created and created[0].get("id"):
        return str(created[0]["id"])

    raise SupabaseNotConfigured("Gagal membuat/menemukan default organization di Supabase")
