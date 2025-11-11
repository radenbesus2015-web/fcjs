// lib/api.ts
// Port dari src-vue-original/utils/api.js dengan TypeScript typing ketat

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosHeaders } from "axios";

export class HttpError extends Error {
  public readonly status: number;
  public readonly data: unknown;
  public readonly response: AxiosResponse | null;

  constructor(message: string, options: { status?: number; data?: unknown; response?: AxiosResponse } = {}) {
    super(message || `HTTP ${options.status || 0}`);
    this.name = "HttpError";
    this.status = options.status ?? 0;
    this.data = options.data;
    this.response = options.response || null;
  }
}

// Determine if we should use API routes (for production/Vercel deployment)
// API routes akan proxy request ke backend yang di-deploy terpisah
const shouldUseApiRoutes = (() => {
  if (typeof window === "undefined") {
    // Server-side: check environment variable
    return process.env.NEXT_PUBLIC_USE_API_ROUTES === 'true' || 
           process.env.NODE_ENV === 'production';
  }
  // Client-side: check if we're in production or explicitly set
  return process.env.NEXT_PUBLIC_USE_API_ROUTES === 'true' ||
         window.location.hostname !== 'localhost';
})();

let API_BASE = (() => {
  if (typeof window === "undefined") return "";
  const { protocol, hostname, port } = window.location;
  const host = port ? `${hostname}:${port}` : hostname;
  return `${protocol}//${host}`; // contoh hasil: https://localhost:3000
})();

export function setApiBase(url: string): void {
  API_BASE = url || API_BASE || "";
  api.defaults.baseURL = API_BASE || undefined;
}

export function resolveApi(path = "", base = API_BASE): string {
  const s = String(path || "");
  
  // Jika sudah absolute URL, return as-is
  if (/^https?:\/\//i.test(s)) return s;
  
  const clean = s.replace(/^\/+/, "");
  
  // Jika menggunakan API routes (production/Vercel), tambahkan prefix /api/
  if (shouldUseApiRoutes && clean) {
    // Pastikan path dimulai dengan /api/
    const apiPath = clean.startsWith('api/') ? clean : `api/${clean}`;
    if (!base) return `/${apiPath}`;
    try {
      return new URL(apiPath, base).toString();
    } catch {
      return `/${apiPath}`;
    }
  }
  
  // Di development dengan rewrites, gunakan path langsung
  if (!base) return `/${clean}`;
  try {
    return new URL(clean, base).toString();
  } catch {
    return `/${clean}`;
  }
}

export const api: AxiosInstance = axios.create({ timeout: 30000 });

type AuthHeaderProvider = () => Record<string, string> | null | undefined;
type QueryTokenProvider = () => string | Record<string, unknown> | null | undefined;

let authHeaderProvider: AuthHeaderProvider | null = null;
export function setAuthHeader(fn: AuthHeaderProvider | null): void {
  authHeaderProvider = typeof fn === "function" ? fn : null;
}

let queryTokenProvider: QueryTokenProvider | null = null;
export function setQueryToken(provider: QueryTokenProvider | string | null): void {
  if (typeof provider === "function") {
    queryTokenProvider = provider;
  } else if (provider == null) {
    queryTokenProvider = null;
  } else {
    const value = provider;
    queryTokenProvider = () => value;
  }
}

api.interceptors.request.use((config) => {
  if (authHeaderProvider) {
    const extra = authHeaderProvider();
    if (extra && typeof extra === "object") {
      const current = config.headers instanceof AxiosHeaders
        ? config.headers.toJSON()
        : (config.headers as Record<string, string> | undefined) || {};
      config.headers = AxiosHeaders.from({ ...current, ...extra });
    }
  }
  if (queryTokenProvider) {
    const value = queryTokenProvider();
    if (value != null) {
      const params = { ...(config.params || {}) };
      if (typeof value === "object") {
        Object.assign(params, value);
      } else {
        params.token = value;
      }
      config.params = params;
    }
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response) {
      const r = err.response;
      const data = r.data;
      const msg = (data && (data.message || data.detail)) || r.statusText || `HTTP ${r.status}`;
      throw new HttpError(msg, { status: r.status, data, response: r });
    }
    if (axios.isCancel(err)) throw new HttpError("Request cancelled", { status: 0 });
    throw new HttpError(err?.message || "Network error", { status: 0 });
  }
);

// Generic request function
interface RequestOptions extends Omit<AxiosRequestConfig, 'url' | 'method' | 'data'> {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  baseUrl?: string;
  query?: Record<string, unknown>;
  parse?: "auto" | "raw" | "text";
  token?: string | (() => string) | Record<string, unknown>;
}

export async function request<T = unknown>(
  pathOrUrl: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = "GET", headers, body, baseUrl, query, parse = "auto", token, params: restParams, ...restConfig } = options;
  const url = resolveApi(pathOrUrl, baseUrl ?? API_BASE);
  const params = { ...(restParams || {}), ...(query || {}) };

  const addToken = (value: string | Record<string, unknown> | null | undefined) => {
    if (value == null) return;
    if (typeof value === "object") {
      Object.assign(params, value);
    } else {
      params.token = value;
    }
  };

  if (token !== undefined) {
    addToken(typeof token === "function" ? token() : token);
  } else if (queryTokenProvider) {
    addToken(queryTokenProvider());
  }

  const res = await api.request({ url, method, headers, data: body, params, ...restConfig });
  if (parse === "raw") return res as T;
  if (parse === "text") return (typeof res.data === "string" ? res.data : JSON.stringify(res.data)) as T;
  return res.data as T;
}

export const jsonPost = <T = unknown>(url: string, payload: unknown, opts: RequestOptions = {}): Promise<T> =>
  request<T>(url, { ...opts, method: "POST", body: payload, parse: "auto" });

export const postForm = <T = unknown>(url: string, formData: FormData, opts: RequestOptions = {}): Promise<T> =>
  request<T>(url, { ...opts, method: "POST", body: formData, parse: "auto" });

export async function download(pathOrUrl: string, filename = "download"): Promise<void> {
  const url = resolveApi(pathOrUrl, API_BASE);
  const res = await api.get(url, { responseType: "blob" });
  const a = document.createElement("a");
  const href = URL.createObjectURL(res.data);
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 0);
}

// Back-compat aliases for minimal refactor
export const apiFetch = <T = unknown>(path: string, options: RequestOptions = {}): Promise<T> => request<T>(path, options);
export const apiFetchJSON = <T = unknown>(path: string, options: RequestOptions = {}): Promise<T> => request<T>(path, { ...options, parse: "auto" });

