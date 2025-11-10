// components/providers/SettingsProvider.tsx
// Port dari src-vue-original/composables/useSetting.js

"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";

interface ClampOptions {
  min?: number;
  max?: number;
  round?: boolean;
}

interface UseSettingOptions {
  clamp?: ClampOptions;
}

interface SettingsState {
  [key: string]: unknown;
}

interface LanguageOption {
  code: string;
  label: string;
}

interface SettingsForm {
  language: string;
  theme: "light" | "dark";
  attendanceSendWidth: number;
  attendanceJpegQuality: number;
  funSendWidth: number;
  funJpegQuality: number;
  baseInterval: number;
}

interface SettingsContextType {
  state: SettingsState;
  getSetting: (path: string) => unknown;
  setSetting: (path: string, value: unknown, options?: UseSettingOptions) => void;
  useSetting: (path: string, options?: UseSettingOptions) => {
    model: unknown;
    setModel: (value: unknown) => void;
    placeholder: string;
  };
  // Modal management
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  // Form management
  form: SettingsForm;
  setForm: (form: SettingsForm) => void;
  submit: () => void;
  reset: () => void;
  languageOptions: LanguageOption[];
}

const SettingsContext = createContext<SettingsContextType | null>(null);

/** Get nested value by path */
function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce((acc: any, k) => (acc ? acc[k] : undefined), obj);
}

/** Set nested value by path */
function setByPath(obj: Record<string, unknown>, path: string, val: unknown): void {
  const keys = path.split(".");
  const last = keys.pop();
  if (!last) return;
  
  const target = keys.reduce((acc: any, k) => {
    if (!acc[k] || typeof acc[k] !== 'object') {
      acc[k] = {};
    }
    return acc[k];
  }, obj);
  
  target[last] = val;
}

// Default settings structure
const DEFAULT_SETTINGS = {
  theme: "light",
  language: "en",
  funMeter: {
    sendWidth: 640,
    jpegQuality: 0.8,
    funIntervalMs: 100,
    baseInterval: 2000,
  },
  attendance: {
    sendWidth: 640,
    jpegQuality: 0.8,
  },
  baseInterval: 2000,
} as const satisfies SettingsState;

interface SettingsProviderProps {
  children: ReactNode;
  initialSettings?: SettingsState;
}

// Language options
const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: "id", label: "Bahasa Indonesia" },
  { code: "en", label: "English" },
];

// Default form values
const DEFAULT_FORM: SettingsForm = {
  language: "en",
  theme: "light",
  attendanceSendWidth: 640,
  attendanceJpegQuality: 0.8,
  funSendWidth: 640,
  funJpegQuality: 0.8,
  baseInterval: 2000,
};

const SETTINGS_STORAGE_KEY = "settings";

// Load settings from localStorage
function loadSettingsFromStorage(): SettingsState {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to ensure all fields exist
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        // Merge nested objects
        attendance: {
          ...(DEFAULT_SETTINGS.attendance as Record<string, unknown>),
          ...(parsed.attendance || {}),
        },
        funMeter: {
          ...(DEFAULT_SETTINGS.funMeter as Record<string, unknown>),
          ...(parsed.funMeter || {}),
        },
      };
    }
  } catch (e) {
    console.warn("Failed to load settings from localStorage", e);
  }
  return DEFAULT_SETTINGS;
}

export function SettingsProvider({ children, initialSettings }: SettingsProviderProps) {
  // Load initial settings from localStorage or use provided initialSettings
  const [state, setState] = useState<SettingsState>(() => {
    if (initialSettings) return initialSettings;
    return loadSettingsFromStorage();
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<SettingsForm>(DEFAULT_FORM);

  // Load settings from localStorage on mount (only if not using initialSettings)
  useEffect(() => {
    if (!initialSettings) {
      const loaded = loadSettingsFromStorage();
      // Only update if different to avoid unnecessary re-renders
      setState(prevState => {
        const stateStr = JSON.stringify(prevState);
        const loadedStr = JSON.stringify(loaded);
        return stateStr === loadedStr ? prevState : loaded;
      });
    }
  }, [initialSettings]);

  // Save settings to localStorage whenever state changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      // Save the entire state object to localStorage
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Failed to save settings to localStorage", e);
    }
  }, [state]);

  // Listen to localStorage changes from ThemeProvider/I18nProvider to keep in sync
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    const handleStorageChange = () => {
      try {
        const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          // Update state if localStorage has different values
          setState(prevState => {
            const prevStr = JSON.stringify(prevState);
            const parsedStr = JSON.stringify({
              ...DEFAULT_SETTINGS,
              ...parsed,
              attendance: {
                ...(DEFAULT_SETTINGS.attendance as Record<string, unknown>),
                ...(parsed.attendance || {}),
              },
              funMeter: {
                ...(DEFAULT_SETTINGS.funMeter as Record<string, unknown>),
                ...(parsed.funMeter || {}),
              },
            });
            if (prevStr !== parsedStr) {
              return {
                ...DEFAULT_SETTINGS,
                ...parsed,
                attendance: {
                  ...(DEFAULT_SETTINGS.attendance as Record<string, unknown>),
                  ...(parsed.attendance || {}),
                },
                funMeter: {
                  ...(DEFAULT_SETTINGS.funMeter as Record<string, unknown>),
                  ...(parsed.funMeter || {}),
                },
              };
            }
            return prevState;
          });
        }
      } catch (e) {
        console.warn("Failed to sync settings from localStorage", e);
      }
    };

    // Listen to storage events (from other tabs)
    window.addEventListener("storage", handleStorageChange);
    
    // Also check periodically for same-tab updates
    const interval = setInterval(handleStorageChange, 500);
    
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  const getSetting = useCallback((path: string): unknown => {
    return getByPath(state, path);
  }, [state]);

  const setSetting = useCallback((path: string, value: unknown, options: UseSettingOptions = {}) => {
    setState(prevState => {
      const newState = { ...prevState };
      
      // Coerce number if target currently a number
      const current = getByPath(newState, path);
      let nextValue = value;

      if (typeof current === "number") {
        const n = typeof value === "string" ? Number(value) : value;
        if (!Number.isFinite(n)) return newState;
        nextValue = n as number;

        const { clamp } = options;
        if (clamp) {
          if (clamp.round) nextValue = Math.round(nextValue as number);
          if (typeof clamp.min === "number") nextValue = Math.max(clamp.min, nextValue as number);
          if (typeof clamp.max === "number") nextValue = Math.min(clamp.max, nextValue as number);
        }
      }

      setByPath(newState, path, nextValue);
      return newState;
    });
  }, []);

  const useSetting = useCallback((path: string, options: UseSettingOptions = {}) => {
    const model = getSetting(path);
    const setModel = (value: unknown) => setSetting(path, value, options);
    const placeholder = String(model ?? "");

    return { model, setModel, placeholder };
  }, [getSetting, setSetting]);

  // Modal management
  const openModal = useCallback(() => {
    // Load current settings into form
    setForm({
      language: (getSetting("language") as string) || "en",
      theme: (getSetting("theme") as "light" | "dark") || "light",
      attendanceSendWidth: (getSetting("attendance.sendWidth") as number) || 640,
      attendanceJpegQuality: (getSetting("attendance.jpegQuality") as number) || 0.8,
      funSendWidth: (getSetting("funMeter.sendWidth") as number) || 640,
      funJpegQuality: (getSetting("funMeter.jpegQuality") as number) || 0.8,
      baseInterval: (getSetting("baseInterval") as number) || 2000,
    });
    setModalOpen(true);
  }, [getSetting]);

  const closeModal = useCallback(() => {
    setModalOpen(false);
  }, []);

  // Form management
  const submit = useCallback(() => {
    // Save form values to settings
    setSetting("language", form.language);
    setSetting("theme", form.theme);
    setSetting("attendance.sendWidth", form.attendanceSendWidth);
    setSetting("attendance.jpegQuality", form.attendanceJpegQuality);
    setSetting("funMeter.sendWidth", form.funSendWidth);
    setSetting("funMeter.jpegQuality", form.funJpegQuality);
    setSetting("baseInterval", form.baseInterval);
    
    closeModal();
  }, [form, setSetting, closeModal]);

  const reset = useCallback(() => {
    setForm(DEFAULT_FORM);
  }, []);

  const value: SettingsContextType = {
    state,
    getSetting,
    setSetting,
    useSetting,
    modalOpen,
    openModal,
    closeModal,
    form,
    setForm,
    submit,
    reset,
    languageOptions: LANGUAGE_OPTIONS,
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextType {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}

export function useSetting(path: string, options: UseSettingOptions = {}) {
  const { useSetting: useSettingFromContext } = useSettings();
  return useSettingFromContext(path, options);
}
