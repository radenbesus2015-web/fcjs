import axios from "axios";

export class HttpError extends Error {
    constructor(message, { status, data, response } = {}) {
      super(message || `HTTP ${status || 0}`);
      this.name = "HttpError";
      this.status = status ?? 0;
      this.data = data;
      this.response = response || null;
    }
}

let API_BASE = (() => {
    if (typeof window === "undefined") return "";
    const { protocol, hostname, port } = window.location;
    const host = port ? `${hostname}:${port}` : hostname;
    return `${protocol}//${host}`; // contoh hasil: https://localhost:3000
})();

export function setApiBase(url) {
    API_BASE = url || API_BASE || "";
    api.defaults.baseURL = API_BASE || undefined;
}


export function resolveApi(path = "", base = API_BASE) {
    const s = String(path || "");
    if (/^https?:\/\//i.test(s)) return s;
    const clean = s.replace(/^\/+/, "");
    if (!base) return `/${clean}`;
    try {
      return new URL(clean, base).toString();
    } catch {
      return `/${clean}`;
    }
}

export const api = axios.create({ timeout: 30000 });

let authHeaderProvider = null;
export function setAuthHeader(fn) {
    authHeaderProvider = typeof fn === "function" ? fn : null;
}

let queryTokenProvider = null;
export function setQueryToken(provider) {
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
    if (extra && typeof extra === "object") config.headers = { ...(config.headers || {}), ...extra };
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

// Convenience helpers similar to the old http.js
export async function request(pathOrUrl, { method = "GET", headers, body, baseUrl, query, parse = "auto", ...rest } = {}) {
    const url = resolveApi(pathOrUrl, baseUrl ?? API_BASE);
    const { params: restParams, token, ...restConfig } = rest;
    const params = { ...(restParams || {}), ...(query || {}) };

    const addToken = (value) => {
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
    if (parse === "raw") return res;
    if (parse === "text") return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    return res.data;
}

export const jsonPost = (url, payload, opts = {}) => request(url, { ...opts, method: "POST", body: payload, parse: "json" });
export const postForm = (url, formData, opts = {}) => request(url, { ...opts, method: "POST", body: formData, parse: "json" });

export async function download(pathOrUrl, filename = "download") {
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
export const apiFetch = (path, options = {}) => request(path, options);
export const apiFetchJSON = (path, options = {}) => request(path, { ...options, parse: "auto" });




