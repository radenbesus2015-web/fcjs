"use client";

import React from "react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  return (
    <html>
      <body>
        <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
          <div className="w-full max-w-md text-center">
            <div className="rounded-lg bg-white p-8 shadow-lg">
              <div className="mb-4 text-5xl">⚠️</div>
              <h1 className="mb-2 text-2xl font-bold text-gray-900">
                Terjadi Kesalahan Global
              </h1>
              <p className="mb-6 text-gray-600">
                Aplikasi mengalami kesalahan serius. Silakan refresh halaman untuk memulai ulang.
              </p>
              {error && (
                <details className="mb-6 text-left">
                  <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
                    Detail Error
                  </summary>
                  <pre className="mt-2 max-h-40 overflow-auto rounded bg-gray-100 p-3 text-xs text-red-600">
                    {error.message}
                    {error.digest && `\nDigest: ${error.digest}`}
                    {error.stack && `\n\nStack:\n${error.stack}`}
                  </pre>
                </details>
              )}
              <div className="flex gap-3 justify-center">
                <button
                  onClick={reset}
                  className="inline-flex items-center justify-center rounded-md bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  Coba Lagi
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="inline-flex items-center justify-center rounded-md bg-gray-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
                >
                  Refresh Halaman
                </button>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
