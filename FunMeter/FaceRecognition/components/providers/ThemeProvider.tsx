// components/providers/ThemeProvider.tsx
// Port dari src-vue-original/App.vue useDark functionality

"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

export function ThemeProvider({ 
  children, 
  defaultTheme = "light", 
  storageKey = "app-theme" 
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);

  useEffect(() => {
    // Load theme from localStorage on mount
    // First try from settings (same as Vue original)
    try {
      const settingsStr = localStorage.getItem("settings");
      if (settingsStr) {
        const settings = JSON.parse(settingsStr);
        if (settings.theme === "light" || settings.theme === "dark") {
          setThemeState(settings.theme);
          return;
        }
      }
    } catch (e) {
      console.warn("Failed to load theme from settings", e);
    }
    
    // Fallback to app-theme key
    const stored = localStorage.getItem(storageKey) as Theme;
    if (stored && (stored === "light" || stored === "dark")) {
      setThemeState(stored);
    }
  }, [storageKey]);

  useEffect(() => {
    // Apply theme to document
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    
    // Store in both localStorage keys for compatibility
    localStorage.setItem(storageKey, theme);
    
    // Also update settings object
    try {
      const settingsStr = localStorage.getItem("settings") || "{}";
      const settings = JSON.parse(settingsStr);
      settings.theme = theme;
      localStorage.setItem("settings", JSON.stringify(settings));
    } catch (e) {
      console.warn("Failed to save theme to settings", e);
    }
  }, [theme, storageKey]);

  // Listen to storage changes from SettingsProvider
  useEffect(() => {
    const handleStorageChange = () => {
      try {
        const settingsStr = localStorage.getItem("settings");
        if (settingsStr) {
          const settings = JSON.parse(settingsStr);
          if (settings.theme && settings.theme !== theme) {
            setThemeState(settings.theme);
          }
        }
      } catch (e) {
        console.warn("Failed to sync theme from settings", e);
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
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  const toggleTheme = () => {
    setThemeState(prev => prev === "light" ? "dark" : "light");
  };

  const isDark = theme === "dark";

  const value: ThemeContextType = {
    theme,
    setTheme,
    toggleTheme,
    isDark,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
