// components/providers/WsProvider.tsx
// Port dari src-vue-original/main.js provide SockRoot

"use client";

import React, { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";
import { ws, setWsBase } from "@/lib/ws";
import { CONFIG } from "@/lib/config";
import io from "socket.io-client";

type IOSocket = ReturnType<typeof io>;

interface WsWrapper {
  socket: IOSocket;
  on: (ev: string, fn: (...args: unknown[]) => void) => void;
  off: (ev: string, fn: (...args: unknown[]) => void) => void;
  once: (ev: string, fn: (...args: unknown[]) => void) => void;
  emit: (ev: string, payload?: unknown) => void;
  emitAck: (ev: string, payload?: unknown, timeoutMs?: number) => Promise<unknown>;
  release: () => void;
  close: () => void;
}

const WsContext = createContext<WsWrapper | null>(null);

interface WsProviderProps {
  children: ReactNode;
}

export function WsProvider({ children }: WsProviderProps) {
  const [sockRoot, setSockRoot] = useState<WsWrapper | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // Only initialize on client side
    if (typeof window === "undefined") return;
    
    // Configure WS base and create a persistent root socket
    setWsBase(CONFIG.WS_API);
    const SockRoot = ws("", { autoReconnect: true, autoRelease: false });
    setSockRoot(SockRoot);
    setIsInitialized(true);
    
    console.log("[WS_PROVIDER] WebSocket initialized:", CONFIG.WS_API);

    return () => {
      // Cleanup on unmount
      if (SockRoot) {
        console.log("[WS_PROVIDER] Closing WebSocket connection");
        SockRoot.close();
      }
    };
  }, []);

  return (
    <WsContext.Provider value={sockRoot}>
      {children}
    </WsContext.Provider>
  );
}

export function useWsRoot(): WsWrapper | null {
  return useContext(WsContext);
}

// Hook untuk membuat koneksi WS baru atau menggunakan root
interface UseWsOptions {
  url?: string;
  on?: Record<string, (...args: unknown[]) => void>;
  opts?: Record<string, unknown>;
  root?: boolean;
}

export function useWs(options: UseWsOptions = {}): WsWrapper | null {
  const { url, on = {}, opts = {}, root = false } = options;
  const sockRoot = useWsRoot();
  const sockRef = useRef<WsWrapper | null>(null);

  useEffect(() => {
    const sock = root && sockRoot ? sockRoot : ws(url || "", { opts });
    sockRef.current = sock;

    // Bind events yang diminta komponen ini
    for (const [ev, fn] of Object.entries(on)) {
      sock?.on(ev, fn);
    }

    return () => {
      // Cleanup
      if (root && sockRoot) {
        // Kalau root: cukup lepas event yang halaman ini pasang
        for (const [ev, fn] of Object.entries(on)) {
          sock?.off(ev, fn);
        }
      } else {
        // Kalau halaman sendiri: release ref (pool akan nutup kalau ref=0)
        sock?.release();
      }
    };
  }, [url, root, sockRoot, on, opts]);

  return sockRef.current;
}
