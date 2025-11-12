// components/providers/ErrorBoundary.tsx
// Error Boundary to catch and handle client-side errors gracefully

"use client";

import React, { Component, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // Ignore certain HMR-related errors that don't require error boundary
    const errorMessage = error?.message || '';
    const isHMRError = errorMessage.includes('module factory is not available') ||
                       errorMessage.includes('was instantiated because it was required') ||
                       errorMessage.includes('HMR') ||
                       errorMessage.includes('Cannot find module');
    
    // Don't show error boundary for HMR errors - they usually resolve on next render
    if (isHMRError && process.env.NODE_ENV === 'development') {
      console.warn('[ErrorBoundary] Ignoring HMR-related error:', error);
      return { hasError: false, error: null };
    }
    
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error to console for debugging
    console.error("Error caught by ErrorBoundary:", error, errorInfo);
    
    // Auto-retry for module instantiation errors in development
    const errorMessage = error?.message || '';
    const isModuleError = errorMessage.includes('module') && 
                          (errorMessage.includes('instantiated') || errorMessage.includes('factory'));
    
    if (isModuleError && process.env.NODE_ENV === 'development') {
      console.log('[ErrorBoundary] Module error detected, attempting auto-recovery...');
      // Reset error state after a short delay to allow modules to reload
      setTimeout(() => {
        this.setState({ hasError: false, error: null });
      }, 100);
    }
  }

  render() {
    if (this.state.hasError) {
      // You can render any custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
          <div className="w-full max-w-md text-center">
            <div className="rounded-lg bg-white dark:bg-gray-800 p-8 shadow-lg">
              <div className="mb-4 text-5xl">⚠️</div>
              <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">
                Terjadi Kesalahan
              </h1>
              <p className="mb-6 text-gray-600 dark:text-gray-400">
                Aplikasi mengalami kesalahan tak terduga. Silakan refresh halaman untuk mencoba lagi.
              </p>
              {this.state.error && (
                <details className="mb-6 text-left">
                  <summary className="cursor-pointer text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
                    Detail Error
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded bg-gray-100 dark:bg-gray-900 p-3 text-xs text-red-600 dark:text-red-400">
                    {this.state.error.toString()}
                  </pre>
                </details>
              )}
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center justify-center rounded-md bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
              >
                Refresh Halaman
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
