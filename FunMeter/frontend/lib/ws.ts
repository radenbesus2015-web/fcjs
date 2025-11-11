// lib/ws.ts
// Port dari src-vue-original/utils/ws.js dengan TypeScript typing

import io from "socket.io-client";
type IOSocket = ReturnType<typeof io>;

let WS_BASE = ""; // absolute ws(s)://... base setelah dinormalisasi
let TLS_PREF: "auto" | "secure" | "insecure" = "auto";

// ===== Helper =====
function isAbsUrl(s = ""): boolean {
  return /^([a-z]+:)?\/\//i.test(s);
}

function pickSecure(pref: "auto" | "secure" | "insecure" = "auto"): boolean {
  if (pref === "secure") return true;
  if (pref === "insecure") return false;
  if (typeof window !== "undefined") return window.location.protocol === "https:";
  return false; // SSR default
}

function normalizeWsBase(input = "", pref: "auto" | "secure" | "insecure" = "auto"): string {
  const secure = pickSecure(pref);
  const scheme = secure ? "wss://" : "ws://";
  let s = String(input || "").trim();

  if (!s) {
    if (typeof window !== "undefined") return scheme + window.location.host;
    return ""; // biarin caller yang handle
  }

  // Jika sudah ws(s):// -> pakai apa adanya
  if (/^wss?:\/\//i.test(s)) return s;

  // Jika http(s):// -> konversi ke ws(s):// dengan TLS sesuai pref/auto
  if (/^https?:\/\//i.test(s)) {
    return s.replace(/^https?:\/\//i, scheme);
  }

  // Relatif path -> gabung ke host origin + scheme ws(s)
  if (s.startsWith("/")) {
    if (typeof window !== "undefined") return scheme + window.location.host + s;
    return s; // SSR fallback
  }

  // host[:port] tanpa schema
  return scheme + s;
}

/** Resolve path relatif ke WS_BASE atau biarkan absolute URL apa adanya */
function resolveWs(pathOrUrl = "", base = WS_BASE): string {
  const s = String(pathOrUrl || "");

  // Absolute? (wss/ws/http/https)
  if (/^wss?:\/\//i.test(s)) return s;
  if (/^https?:\/\//i.test(s)) {
    // Naikkan http(s) -> ws(s) sesuai preferensi
    return normalizeWsBase(s, TLS_PREF);
  }

  // Pastikan base sudah absolute ws(s)://...
  const b = base || normalizeWsBase("", TLS_PREF);
  const clean = s.replace(/^\/+/, "");
  if (!b) return `/${clean}`;

  try {
    // URL() support 'ws' scheme kok
    return new URL(clean, b).toString();
  } catch {
    return `${b.replace(/\/+$/, "")}/${clean}`;
  }
}

// ===== Public API =====
export function setWsBase(urlOrHost: string, tlsPref: "auto" | "secure" | "insecure" = "auto"): void {
  TLS_PREF = (tlsPref || "auto").toLowerCase() as "auto" | "secure" | "insecure";
  WS_BASE = normalizeWsBase(urlOrHost || "", TLS_PREF);
}

/** Pool koneksi: 1 socket per URL, dengan ref counter */
interface PoolEntry {
  socket: IOSocket;
  refs: number;
}

const POOL = new Map<string, PoolEntry>();

interface WsConfig {
  opts?: Record<string, unknown>;
  on?: Record<string, (...args: unknown[]) => void>;
  autoReconnect?: boolean;
  autoRelease?: boolean;
}

interface WsWrapper {
  socket: IOSocket;
  on: (ev: string, fn: (...args: unknown[]) => void) => void;
  off: (ev: string, fn: (...args: unknown[]) => void) => void;
  once: (ev: string, fn: (...args: unknown[]) => void) => void;
  emit: (ev: string, payload?: unknown) => void;
  emitAck: (ev: string, payload?: unknown, timeoutMs?: number) => Promise<unknown>;
  release: () => void;
  close: () => void;
  __autoRelease: boolean;
  __url: string;
}

export function ws(pathOrUrl = "", config: WsConfig = {}): WsWrapper {
  const {
    opts = {},
    on = {},
    autoReconnect = true,
    autoRelease = true,
  } = config;

  const url = resolveWs(pathOrUrl);

  let entry = POOL.get(url);
  if (!entry) {
    const socket = io(url, {
      transports: ["websocket"],
      upgrade: false,
      reconnection: autoReconnect,
      ...opts,
    });
    entry = { socket, refs: 0 };
    POOL.set(url, entry);
  }
  entry.refs++;

  const { socket } = entry;
  const myListeners = new Set<[string, (...args: unknown[]) => void]>();

  function _on(ev: string, fn: (...args: unknown[]) => void): void {
    for (const [e, f] of myListeners) if (e === ev && f === fn) return;
    socket.on(ev, fn);
    myListeners.add([ev, fn]);
  }

  function _off(ev: string, fn: (...args: unknown[]) => void): void {
    socket.off(ev, fn);
    for (const item of myListeners) {
      const [e, f] = item;
      if (e === ev && f === fn) myListeners.delete(item);
    }
  }

  function _once(ev: string, fn: (...args: unknown[]) => void): void {
    socket.once(ev, fn);
  }

  function _emit(ev: string, payload?: unknown): void {
    socket.emit(ev, payload);
  }

  function emitAck(ev: string, payload?: unknown, timeoutMs = 10000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("Ack timeout"));
      }, Math.max(0, timeoutMs || 0));

      const finalize = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      try {
        // socket.emit with ack callback - server should call callback(err, res) or (res)
        socket.emit(ev, payload, (...args: unknown[]) => {
          if (args.length >= 2) {
            const [err, res] = args as [unknown, unknown];
            if (err) return finalize(() => reject(err));
            return finalize(() => resolve(res));
          }
          const single = args[0];
          return finalize(() => resolve(single));
        });
      } catch (e) {
        finalize(() => reject(e as unknown));
      }
    });
  }

  function cleanupListeners(): void {
    for (const item of [...myListeners]) {
      const [ev, fn] = item;
      socket.off(ev, fn);
      myListeners.delete(item);
    }
  }

  function release(): void {
    cleanupListeners();
    if (entry) {
      entry.refs = Math.max(0, entry.refs - 1);
      if (entry.refs === 0) {
        try { socket.close(); } catch {}
        POOL.delete(url);
      }
    }
  }

  function close(): void {
    cleanupListeners();
    try { socket.close(); } catch {}
    POOL.delete(url);
  }

  for (const [ev, fn] of Object.entries(on)) _on(ev, fn);

  return {
    socket,
    on: _on,
    off: _off,
    once: _once,
    emit: _emit,
    emitAck,
    release,
    close,
    __autoRelease: autoRelease,
    __url: url,
  };
}
