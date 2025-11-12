// app/api/[...path]/route.ts
// API Route handler untuk proxy semua request ke backend FastAPI
// Digunakan untuk deployment di Vercel dimana backend di-deploy terpisah

import { NextRequest, NextResponse } from 'next/server';

// Get backend URL from environment variable
// Di development: gunakan localhost:8000
// Di production: gunakan URL backend yang di-deploy (Railway, Render, dll)
function getBackendUrl(): string {
  // Prioritas: NEXT_PUBLIC_BACKEND_URL > BACKEND_URL > default localhost
  const backendUrl = 
    process.env.NEXT_PUBLIC_BACKEND_URL || 
    process.env.BACKEND_URL || 
    'http://localhost:8000';
  
  // Pastikan tidak ada trailing slash
  return backendUrl.replace(/\/+$/, '');
}

// Handler untuk semua HTTP methods
export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return handleRequest(request, params);
}

export async function POST(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return handleRequest(request, params);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return handleRequest(request, params);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return handleRequest(request, params);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return handleRequest(request, params);
}

async function handleRequest(
  request: NextRequest,
  params: { path: string[] }
) {
  try {
    const backendUrl = getBackendUrl();
    const pathSegments = params.path || [];
    const path = pathSegments.join('/');
    
    // Build full backend URL
    const url = new URL(path, `${backendUrl}/`);
    
    // Copy query parameters
    request.nextUrl.searchParams.forEach((value, key) => {
      url.searchParams.append(key, value);
    });
    
    // Prepare headers (exclude host and connection headers)
    const headers = new Headers();
    request.headers.forEach((value, key) => {
      // Skip headers that should not be forwarded
      const lowerKey = key.toLowerCase();
      if (
        lowerKey !== 'host' &&
        lowerKey !== 'connection' &&
        lowerKey !== 'content-length' &&
        lowerKey !== 'transfer-encoding'
      ) {
        headers.set(key, value);
      }
    });
    
    // Get request body if present
    let body: BodyInit | undefined;
    const contentType = request.headers.get('content-type');
    
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      if (contentType?.includes('multipart/form-data')) {
        // For FormData, we need to read it as form data
        const formData = await request.formData();
        body = formData;
      } else if (contentType?.includes('application/json')) {
        const json = await request.json();
        body = JSON.stringify(json);
        headers.set('content-type', 'application/json');
      } else if (contentType?.includes('application/x-www-form-urlencoded')) {
        const text = await request.text();
        body = text;
        headers.set('content-type', 'application/x-www-form-urlencoded');
      } else {
        // For other types, try to read as text/blob
        try {
          const blob = await request.blob();
          body = blob;
        } catch {
          // If reading fails, body will be undefined
        }
      }
    }
    
    // Make request to backend
    const response = await fetch(url.toString(), {
      method: request.method,
      headers,
      body,
      // Forward redirects
      redirect: 'follow',
    });
    
    // Get response body
    const responseBody = await response.arrayBuffer();
    
    // Create response with same status and headers
    const nextResponse = new NextResponse(responseBody, {
      status: response.status,
      statusText: response.statusText,
    });
    
    // Copy response headers (exclude some that should not be forwarded)
    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey !== 'content-encoding' &&
        lowerKey !== 'content-length' &&
        lowerKey !== 'transfer-encoding' &&
        lowerKey !== 'connection'
      ) {
        nextResponse.headers.set(key, value);
      }
    });
    
    // Set content-length if we have body
    if (responseBody.byteLength > 0) {
      nextResponse.headers.set('content-length', responseBody.byteLength.toString());
    }
    
    return nextResponse;
  } catch (error) {
    console.error('[API Proxy] Error proxying request:', error);
    
    // Return error response
    return NextResponse.json(
      {
        error: 'Proxy error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

