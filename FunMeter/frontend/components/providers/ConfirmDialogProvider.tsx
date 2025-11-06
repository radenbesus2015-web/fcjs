// components/providers/ConfirmDialogProvider.tsx
// Port dari src-vue-original/stores/confirmStore.ts + useConfirmDialog.ts

"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";

export interface ConfirmDialogOptions {
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
}

interface ConfirmRequest {
  id: number;
  options: Required<ConfirmDialogOptions>;
  resolve: (value: boolean) => void;
}

interface ConfirmDialogContextType {
  currentConfirm: ConfirmRequest | null;
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  resolveCurrentConfirm: (result: boolean) => void;
}

const ConfirmDialogContext = createContext<ConfirmDialogContextType | null>(null);

const DEFAULT_OPTIONS: Required<ConfirmDialogOptions> = {
  title: "Konfirmasi",
  description: "",
  confirmText: "OK",
  cancelText: "Batal",
};

interface ConfirmDialogProviderProps {
  children: ReactNode;
}

export function ConfirmDialogProvider({ children }: ConfirmDialogProviderProps) {
  const [queue, setQueue] = useState<ConfirmRequest[]>([]);
  const [counter, setCounter] = useState(0);

  const currentConfirm = queue[0] ?? null;

  const confirm = useCallback((options: ConfirmDialogOptions): Promise<boolean> => {
    const opts: Required<ConfirmDialogOptions> = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
    
    return new Promise<boolean>((resolve) => {
      setCounter(prev => prev + 1);
      const newRequest: ConfirmRequest = {
        id: counter + 1,
        options: opts,
        resolve,
      };
      
      setQueue(prev => [...prev, newRequest]);
    });
  }, [counter]);

  const resolveCurrentConfirm = useCallback((result: boolean) => {
    setQueue(prev => {
      const [current, ...rest] = prev;
      if (current) {
        current.resolve(result);
      }
      return rest;
    });
  }, []);

  const value: ConfirmDialogContextType = {
    currentConfirm,
    confirm,
    resolveCurrentConfirm,
  };

  return (
    <ConfirmDialogContext.Provider value={value}>
      {children}
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog(): (options?: ConfirmDialogOptions) => Promise<boolean> {
  const context = useContext(ConfirmDialogContext);
  
  if (!context) {
    // Fallback ke window.confirm jika tidak ada provider
    return async (options: ConfirmDialogOptions = {}) => {
      const message = options.description || options.title || "";
      return window.confirm(message);
    };
  }

  return (options: ConfirmDialogOptions = {}) => context.confirm(options);
}

// Hook untuk komponen modal global
export function useConfirmDialogState() {
  const context = useContext(ConfirmDialogContext);
  if (!context) {
    throw new Error("useConfirmDialogState must be used within a ConfirmDialogProvider");
  }
  return {
    currentConfirm: context.currentConfirm,
    resolveCurrentConfirm: context.resolveCurrentConfirm,
  };
}
