// utils/ws.js
// Satu pintu WebSocket (Socket.IO) untuk semua halaman
import { io } from "socket.io-client";

let WS_BASE = ""; // absolute ws(s)://... base setelah dinormalisasi
let TLS_PREF = "auto"; // "auto" | "secure" | "insecure"

// ===== Helper =====
function isAbsUrl(s = "") {
  return /^([a-z]+:)?\/\//i.test(s);
}
function pickSecure(pref = "auto") {
  if (pref === "secure") return true;
  if (pref === "insecure") return false;
  if (typeof window !== "undefined") return window.location.protocol === "https:";
  return false; // SSR default
}
function normalizeWsBase(input = "", pref = "auto") {
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
function resolveWs(pathOrUrl = "", base = WS_BASE) {
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
export function setWsBase(urlOrHost, tlsPref = "auto") {
  TLS_PREF = (tlsPref || "auto").toLowerCase();
  WS_BASE = normalizeWsBase(urlOrHost || "", TLS_PREF);
}

/** Pool koneksi: 1 socket per URL, dengan ref counter */
const POOL = new Map(); // url -> { socket, refs }

export function ws(pathOrUrl = "", config = {}) {
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
  const myListeners = new Set();

  function _on(ev, fn) {
    for (const [e, f] of myListeners) if (e === ev && f === fn) return;
    socket.on(ev, fn);
    myListeners.add([ev, fn]);
  }
  function _off(ev, fn) {
    socket.off(ev, fn);
    for (const item of myListeners) {
      const [e, f] = item;
      if (e === ev && f === fn) myListeners.delete(item);
    }
  }
  function _once(ev, fn) {
    socket.once(ev, fn);
  }
  function _emit(ev, payload) {
    socket.emit(ev, payload);
  }
  function emitAck(ev, payload, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      try {
        socket.timeout(timeoutMs).emit(ev, payload, (err, res) => {
          if (err) return reject(err);
          resolve(res);
        });
      } catch (e) {
        reject(e);
      }
    });
  }
  function cleanupListeners() {
    for (const item of [...myListeners]) {
      const [ev, fn] = item;
      socket.off(ev, fn);
      myListeners.delete(item);
    }
  }
  function release() {
    cleanupListeners();
    entry.refs = Math.max(0, entry.refs - 1);
    if (entry.refs === 0) {
      try { socket.close(); } catch {}
      POOL.delete(url);
    }
  }
  function close() {
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
