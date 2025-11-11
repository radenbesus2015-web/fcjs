// app/api/[...path]/route.ts
// Universal API proxy route untuk semua backend endpoints

import { NextRequest, NextResponse } from "next/server";
import { proxyRequest, getBackendUrl } from "@/lib/api-proxy";

/**
 * Universal API proxy handler
 * Menangani semua request ke /api/* dan memproxynya ke backend
 * 
 * Contoh:
 * - /api/admin/dashboard-data -> http://backend-url/admin/dashboard-data
 * - /api/auth/login -> http://backend-url/auth/login
 * - /api/register-db-data -> http://backend-url/register-db-data
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return handleProxyRequest(request, params, "GET");
}

export async function POST(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return handleProxyRequest(request, params, "POST");
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return handleProxyRequest(request, params, "PUT");
}

export async function PATCH(
  request: NextRequest,
  { params: { path: string[] } }
) {
  return handleProxyRequest(request, params, "PATCH");
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return handleProxyRequest(request, params, "DELETE");
}

async function handleProxyRequest(
  request: NextRequest,
  params: { path: string[] },
  method: string
) {
  try {
    // Reconstruct path dari params
    const path = `/${params.path.join("/")}`;

    // Get query parameters
    const query: Record<string, string | number | boolean | undefined> = {};
    request.nextUrl.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    // Get headers (forward Authorization dan headers penting lainnya)
    const headers = new Headers();
    const authHeader = request.headers.get("authorization");
    if (authHeader) {
      headers.set("authorization", authHeader);
    }
    
    // Forward headers penting lainnya
    const contentType = request.headers.get("content-type");
    if (contentType) {
      headers.set("content-type", contentType);
    }

    // Get body
    let body: unknown = undefined;
    if (method !== "GET" && method !== "HEAD") {
      const contentType = request.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        try {
          body = await request.json();
        } catch {
          // Body mungkin kosong atau invalid JSON
        }
      } else if (contentType?.includes("multipart/form-data") || contentType?.includes("application/x-www-form-urlencoded")) {
        // Untuk FormData, kita perlu forward sebagai FormData
        try {
          const formData = await request.formData();
          body = formData;
        } catch {
          // Fallback ke text jika gagal parse FormData
          body = await request.text();
        }
      } else {
        // Fallback: baca sebagai text
        try {
          const text = await request.text();
          if (text) {
            body = text;
          }
        } catch {
          // Body kosong atau tidak bisa dibaca
        }
      }
    }

    // Proxy request ke backend
    const response = await proxyRequest(path, {
      method,
      headers,
      body,
      query,
    });

    // Get response body
    const contentType = response.headers.get("content-type");
    let responseBody: unknown;
    
    if (contentType?.includes("application/json")) {
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }
    } else if (contentType?.includes("text/")) {
      responseBody = await response.text();
    } else {
      // Untuk binary data (images, files, dll), gunakan array buffer
      responseBody = await response.arrayBuffer();
    }

    // Create NextResponse dengan status dan headers yang sama
    const nextResponse = NextResponse.json(responseBody, {
      status: response.status,
      statusText: response.statusText,
    });

    // Forward response headers (kecuali yang tidak perlu)
    response.headers.forEach((value, key) => {
      // Skip headers yang dikontrol oleh Next.js
      if (
        !["content-encoding", "content-length", "transfer-encoding"].includes(
          key.toLowerCase()
        )
      ) {
        nextResponse.headers.set(key, value);
      }
    });

    return nextResponse;
  } catch (error) {
    console.error("[API Proxy] Error:", error);
    return NextResponse.json(
      {
        error: "Proxy error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

