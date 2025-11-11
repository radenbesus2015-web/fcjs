// lib/api-proxy.ts
// Utility untuk proxy API requests ke backend production

/**
 * Mendapatkan backend URL dari environment variable
 * Fallback ke localhost untuk development
 */
export function getBackendUrl(): string {
  // Di production, gunakan NEXT_PUBLIC_BACKEND_URL
  // Di development, gunakan localhost:8000
  if (typeof window !== "undefined") {
    // Client-side: gunakan environment variable atau fallback ke localhost
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (backendUrl) {
      return backendUrl.replace(/\/$/, ""); // Remove trailing slash
    }
    // Fallback ke localhost untuk development
    return "http://localhost:8000";
  }
  
  // Server-side: gunakan environment variable atau fallback ke localhost
  const backendUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL;
  if (backendUrl) {
    return backendUrl.replace(/\/$/, ""); // Remove trailing slash
  }
  return "http://localhost:8000";
}

/**
 * Membuat URL lengkap untuk backend endpoint
 */
export function getBackendEndpoint(path: string): string {
  const backendUrl = getBackendUrl();
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${backendUrl}${cleanPath}`;
}

/**
 * Proxy request ke backend dengan error handling
 */
export async function proxyRequest(
  path: string,
  options: {
    method?: string;
    headers?: HeadersInit;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
  } = {}
): Promise<Response> {
  const backendUrl = getBackendEndpoint(path);
  
  // Build query string
  const queryParams = new URLSearchParams();
  if (options.query) {
    Object.entries(options.query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        queryParams.append(key, String(value));
      }
    });
  }
  const queryString = queryParams.toString();
  const fullUrl = queryString ? `${backendUrl}?${queryString}` : backendUrl;

  // Prepare headers
  const headers = new Headers(options.headers);
  
  // Set Content-Type untuk JSON body
  if (options.body && typeof options.body === "object" && !(options.body instanceof FormData)) {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }

  // Prepare body
  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
    // FormData akan set Content-Type sendiri dengan boundary
    headers.delete("Content-Type");
  } else if (options.body && typeof options.body === "object") {
    body = JSON.stringify(options.body);
  } else if (options.body) {
    body = String(options.body);
  }

  try {
    const response = await fetch(fullUrl, {
      method: options.method || "GET",
      headers,
      body,
    });

    return response;
  } catch (error) {
    console.error(`[API Proxy] Error proxying to ${fullUrl}:`, error);
    throw error;
  }
}

