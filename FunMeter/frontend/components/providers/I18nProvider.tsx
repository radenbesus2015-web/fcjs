// components/providers/I18nProvider.tsx
// Port dari src-vue-original/i18n/

"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import idMessages from "@/locales/id.json";
import enMessages from "@/locales/en.json";

// Import messages from JSON files
// Go through `unknown` first to satisfy strict typing of JSON module imports
const idMsgs = idMessages as unknown as Record<string, unknown>;
const enMsgs = enMessages as unknown as Record<string, unknown>;
const messages: Record<string, Record<string, unknown>> = {
  id: idMsgs,
  en: enMsgs,
};

export const LANGUAGE_OPTIONS = [
  { code: "id", label: "Bahasa Indonesia" },
  { code: "en", label: "English" },
];

const FALLBACK_LOCALE = "en";

function resolveLocale(locale: string): string {
  const validCodes = Object.keys(messages);
  if (validCodes.includes(locale)) return locale;
  const normal = String(locale || "").toLowerCase();
  return validCodes.includes(normal) ? normal : FALLBACK_LOCALE;
}

function readMessage(locale: string, path: string): unknown {
  const bag = messages[locale];
  if (!bag) return undefined;
  return path.split(".").reduce((acc: Record<string, unknown> | unknown, part) => {
    if (acc && typeof acc === 'object' && acc !== null && Object.prototype.hasOwnProperty.call(acc, part)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, bag as Record<string, unknown> | unknown);
}

function setDocumentLang(locale: string): void {
  if (typeof document === "undefined") return;
  document.documentElement?.setAttribute("lang", locale);
}

function formatMessage(message: string, values?: Record<string, unknown>): string {
  if (!values || typeof values !== "object") return message;
  const entries = Object.entries(values);
  if (!entries.length) return message;
  let output = String(message);
  for (const [token, value] of entries) {
    const pattern = new RegExp(`\\{${token}\\}`, "g");
    output = output.replace(pattern, String(value));
  }
  return output;
}

interface I18nContextType {
  locale: string;
  available: typeof LANGUAGE_OPTIONS;
  setLocale: (locale: string) => void;
  t: (key: string, fallback?: string, values?: Record<string, unknown>) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

interface I18nProviderProps {
  children: ReactNode;
  initialLocale?: string;
}

export function I18nProvider({ children, initialLocale = FALLBACK_LOCALE }: I18nProviderProps) {
  // Start with FALLBACK_LOCALE for both server and client (avoid hydration mismatch)
  const [locale, setLocaleState] = useState(FALLBACK_LOCALE);
  const [mounted, setMounted] = useState(false);

  // Load from localStorage AFTER hydration (client-only)
  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("settings");
        if (stored) {
          const settings = JSON.parse(stored);
          if (settings.language) {
            const savedLocale = resolveLocale(settings.language);
            if (savedLocale !== locale) {
              setLocaleState(savedLocale);
            }
          }
        }
      } catch (e) {
        console.warn("Failed to load language from localStorage", e);
      }
    }
  }, []); // Run once on mount

  const setLocale = useCallback((nextLocale: string) => {
    const resolved = resolveLocale(nextLocale);
    if (locale === resolved) return;
    setLocaleState(resolved);
    
    // Save to localStorage
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("settings") || "{}";
        const settings = JSON.parse(stored);
        settings.language = resolved;
        localStorage.setItem("settings", JSON.stringify(settings));
      } catch (e) {
        console.warn("Failed to save language to localStorage", e);
      }
    }
  }, [locale]);

  const t = useCallback((key: string, fallback?: string, values?: Record<string, unknown>): string => {
    if (!key) return fallback ?? "";

    // Support legacy usage: t(key, values) -> treat second arg as values
    let actualFallback = fallback;
    let actualValues = values;
    if (actualValues === undefined && actualFallback && typeof actualFallback === "object") {
      actualValues = actualFallback as Record<string, unknown>;
      actualFallback = undefined;
    }

    const current = readMessage(locale, key);
    if (current !== undefined) return formatMessage(String(current), actualValues);
    if (locale !== FALLBACK_LOCALE) {
      const fallbackMsg = readMessage(FALLBACK_LOCALE, key);
      if (fallbackMsg !== undefined) return formatMessage(String(fallbackMsg), actualValues);
    }
    const base = actualFallback ?? key;
    return formatMessage(base, actualValues);
  }, [locale]);

  // Set document lang when locale changes
  useEffect(() => {
    setDocumentLang(locale);
  }, [locale]);

  // Listen to localStorage changes from SettingsProvider (only from other tabs)
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key !== "settings") return;
      try {
        const stored = e.newValue;
        if (stored) {
          const settings = JSON.parse(stored);
          if (settings.language && settings.language !== locale) {
            setLocaleState(resolveLocale(settings.language));
          }
        }
      } catch (err) {
        console.warn("Failed to sync language from localStorage", err);
      }
    };

    // Listen to storage events (from other tabs only - same tab handled by setLocale)
    window.addEventListener("storage", handleStorageChange);
    
    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [locale]);

  const value: I18nContextType = {
    locale,
    available: LANGUAGE_OPTIONS,
    setLocale,
    t,
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextType {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}
