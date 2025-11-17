// app/api/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';

function getBackendUrl(): string {
  const backendUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.BACKEND_URL ||
    'http://localhost:8000';

  return backendUrl.replace(/\/+$/, '');
}

// ------------------------------
// FIX PARAMS UNTUK NEXT.JS 16+
// ------------------------------

type ParamsType = { path: string[] };

// Semua method memakai context.params yang berupa Promise
export async function GET(
  request: NextRequest,
  context: { params: Promise<ParamsType> }
) {
  const { path } = await context.params;
  return handleRequest(request, { path });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<ParamsType> }
) {
  const { path } = await context.params;
  return handleRequest(request, { path });
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<ParamsType> }
) {
  const { path } = await context.params;
  return handleRequest(request, { path });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<ParamsType> }
) {
  const { path } = await context.params;
  return handleRequest(request, { path });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<ParamsType> }
) {
  const { path } = await context.params;
  return handleRequest(request, { path });
}

// -------------------------------------------
// HANDLER UTAMA — tetap sama seperti punyamu
// -------------------------------------------
async function handleRequest(
  request: NextRequest,
  params: { path: string[] }
) {
  try {
    const backendUrl = getBackendUrl();
    const pathSegments = params.path || [];
    const path = pathSegments.join('/');

    const url = new URL(path, `${backendUrl}/`);

    request.nextUrl.searchParams.forEach((value, key) => {
      url.searchParams.append(key, value);
    });

    const headers = new Headers();
    request.headers.forEach((value, key) => {
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

    let body: BodyInit | undefined;
    const contentType = request.headers.get('content-type');

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      if (contentType?.includes('multipart/form-data')) {
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
        try {
          const blob = await request.blob();
          body = blob;
        } catch {}
      }
    }

    const response = await fetch(url.toString(), {
      method: request.method,
      headers,
      body,
      redirect: 'follow',
    });

    const responseBody = await response.arrayBuffer();

    const nextResponse = new NextResponse(responseBody, {
      status: response.status,
      statusText: response.statusText,
    });

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

    if (responseBody.byteLength > 0) {
      nextResponse.headers.set(
        'content-length',
        responseBody.byteLength.toString()
      );
    }

    return nextResponse;
  } catch (error) {
    console.error('[API Proxy] Error proxying request:', error);

    return NextResponse.json(
      {
        error: 'Proxy error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
