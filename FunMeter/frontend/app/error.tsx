"use client";

import React, { useEffect } from "react";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log error to console or error reporting service
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="w-full max-w-md text-center">
        <div className="rounded-lg bg-white dark:bg-gray-800 p-8 shadow-lg">
          <div className="mb-4 text-5xl">⚠️</div>
          <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">
            Terjadi Kesalahan
          </h1>
          <p className="mb-6 text-gray-600 dark:text-gray-400">
            Aplikasi mengalami kesalahan tak terduga. Silakan coba lagi atau refresh halaman.
          </p>
          {error && (
            <details className="mb-6 text-left">
              <summary className="cursor-pointer text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
                Detail Error
              </summary>
              <pre className="mt-2 max-h-40 overflow-auto rounded bg-gray-100 dark:bg-gray-900 p-3 text-xs text-red-600 dark:text-red-400">
                {error.message}
                {error.digest && `\nDigest: ${error.digest}`}
              </pre>
            </details>
          )}
          <div className="flex gap-3 justify-center">
            <button
              onClick={reset}
              className="inline-flex items-center justify-center rounded-md bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
            >
              Coba Lagi
            </button>
            <button
              onClick={() => window.location.href = "/"}
              className="inline-flex items-center justify-center rounded-md bg-gray-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
            >
              Ke Beranda
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
