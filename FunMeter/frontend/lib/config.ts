// lib/config.ts
// Port dari src-vue-original/config.ts dengan Next.js environment variables

interface NextEnv {
  readonly NEXT_PUBLIC_WS_HTTP_BASE?: string;      // contoh: "api.rheia.my.id" | "https://api.rheia.my.id" | "/socket.io"
  readonly NEXT_PUBLIC_TLS_CONNECTION?: string;    // "auto" | "secure" | "insecure"
}

// Default to localhost:8000 for development if not set in environment
const rawBase = (process.env.NEXT_PUBLIC_WS_HTTP_BASE || "localhost:8000").trim();
const tlsRaw = (process.env.NEXT_PUBLIC_TLS_CONNECTION || "auto").trim().toLowerCase() as
  | "auto" | "secure" | "insecure";

function isSecureBy(pref: "auto" | "secure" | "insecure"): boolean {
  if (pref === "secure") return true;
  if (pref === "insecure") return false;
  // auto: ikut origin (fallback false di SSR)
  return typeof window !== "undefined" ? window.location.protocol === "https:" : false;
}

const isSecure = isSecureBy(tlsRaw);
const WS_SCHEME = isSecure ? "wss" : "ws";
const HTTP_SCHEME = isSecure ? "https" : "http";

/** Tambah scheme dengan cerdas:
 * - Kalau sudah http(s)/ws(s) -> ganti scheme sesuai argumen
 * - Kalau diawali "/" -> pakai host origin (https://host + path)
 * - Kalau cuma host:port -> prefix dengan scheme
 */
function withSchemeSmart(base: string, scheme: string): string {
  if (!base) {
    // Kosong -> pakai origin (buat axios/Socket.IO nyaman)
    if (typeof window !== "undefined") return `${scheme}://${window.location.host}`;
    return "";
  }
  if (/^(https?|wss?):\/\//i.test(base)) {
    return base.replace(/^(https?|wss?):\/\//i, scheme + "://");
  }
  if (base.startsWith("/")) {
    const host = typeof window !== "undefined" ? window.location.host : "localhost";
    return `${scheme}://${host}${base}`;
  }
  return `${scheme}://${base}`;
}

export const CONFIG = {
  WS_HTTP_BASE: rawBase,             // mentahan dari ENV, boleh kosong
  TLS_CONNECTION: tlsRaw,            // "auto" | "secure" | "insecure"
  isSecure,                          // hasil resolusi akhir
  WS_SCHEME,                         // "wss" atau "ws"
  HTTP_SCHEME,                       // "https" atau "http"
  WS_API: withSchemeSmart(rawBase, WS_SCHEME),     // ws(s)://...
  HTTP_API: withSchemeSmart(rawBase, HTTP_SCHEME), // http(s)://...
} as const;

export default CONFIG;
