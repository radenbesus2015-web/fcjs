// components/providers/AuthProvider.tsx
// Port dari src-vue-original/composables/useAuth.ts

"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { api, setAuthHeader, setQueryToken } from "@/lib/api";
import { toast } from "@/toast";

export type AuthStatus = "idle" | "loading" | "authenticated" | "unauthenticated";

export interface AuthUser {
  id: string | number;
  name: string;
  email: string;
  username?: string;
  avatar?: string;
  role?: string;
  is_admin?: boolean;
  is_owner?: boolean;
  api_key?: string;
}

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  token: string;
  showModal: boolean;
}

interface AuthActions {
  openModal: () => void;
  closeModal: () => void;
  bootstrap: () => Promise<void>;
  login: (payload: { email: string; password: string }) => Promise<boolean>;
  logout: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
  updateUser: (partial: Partial<AuthUser>) => void;
}

type AuthContextType = AuthState & AuthActions & {
  isAuthed: boolean;
};

const AuthContext = createContext<AuthContextType | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string>("");
  const [showModal, setShowModal] = useState(false);
  const [isReturningUser, setIsReturningUser] = useState(false);

  const openModal = useCallback(() => setShowModal(true), []);
  const closeModal = useCallback(() => setShowModal(false), []);

  const applyToken = useCallback((t?: string) => {
    const newToken = t || "";
    setToken(newToken);
    if (newToken) {
      localStorage.setItem("fm_token", newToken);
      setAuthHeader(() => ({ Authorization: `Bearer ${newToken}` }));
      setQueryToken(() => newToken);
      try {
        const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
        const attrs = ["path=/", "max-age=2592000"]; // 30 days
        if (isHttps) attrs.push("secure");
        document.cookie = `api_key=${encodeURIComponent(newToken)}; ${attrs.join("; ")}`;
      } catch {}
    } else {
      localStorage.removeItem("fm_token");
      setAuthHeader(null);
      setQueryToken(null);
      try {
        const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
        const attrs = ["path=/", "max-age=0"]; // expire immediately
        if (isHttps) attrs.push("secure");
        document.cookie = `api_key=; ${attrs.join("; ")}`;
      } catch {}
    }
  }, []);

  const bootstrap = useCallback(async () => {
    // load token kalau ada
    const saved = localStorage.getItem("fm_token") || "";
    if (saved) {
      applyToken(saved);
      setIsReturningUser(true);
    }

    setStatus("loading");
    try {
      const response = await api.get("/auth/me");
      const backendUser = response.data?.user || response.data;
      // Map backend user format to frontend AuthUser format
      const frontendUser: AuthUser | null = backendUser ? {
        id: backendUser.id || backendUser.username || "",
        name: backendUser.username || "",
        email: backendUser.username || "", // username doubles as email
        username: backendUser.username,
        is_admin: backendUser.is_admin,
        is_owner: backendUser.is_owner,
      } : null;
      setUser(frontendUser);
      setStatus("authenticated");
    } catch {
      setUser(null);
      setStatus("unauthenticated");
    }
  }, [applyToken]);

  const login = useCallback(async (payload: { email: string; password: string }): Promise<boolean> => {
    setStatus("loading");
    try {
      // Backend expects 'username' not 'email'
      const response = await api.post("/auth/login", {
        username: payload.email,
        password: payload.password,
      });
      const data = response.data;
      // Backend returns { ok: True, user: { api_key, username, id, is_admin, is_owner } }
      // Extract api_key from user object to use as token
      const apiKey = data?.user?.api_key;
      if (apiKey) {
        applyToken(apiKey);
      }
      // Map backend user format to frontend AuthUser format
      const backendUser = data?.user;
      const frontendUser: AuthUser | null = backendUser ? {
        id: backendUser.id || backendUser.username || "",
        name: backendUser.username || "",
        email: backendUser.username || "", // username doubles as email
        username: backendUser.username,
        is_admin: backendUser.is_admin,
        is_owner: backendUser.is_owner,
      } : null;
      setUser(frontendUser);
      setStatus(frontendUser ? "authenticated" : "unauthenticated");
      
      // Show welcome toast after successful login
      if (frontendUser) {
        const userName = frontendUser.username || frontendUser.name || "User";
        const welcomeMessage = isReturningUser 
          ? `🎉 Selamat datang kembali, ${userName}!`
          : `🎉 Selamat datang, ${userName}!`;
        
        // Delay toast slightly to ensure modal closes first
        setTimeout(() => {
          toast.success(welcomeMessage, { duration: 4000 });
        }, 300);
        
        // Reset returning user flag after first login
        setIsReturningUser(false);
      }
      
      closeModal();
      return true;
    } catch (err) {
      setStatus("unauthenticated");
      throw err;
    }
  }, [applyToken, closeModal, isReturningUser]);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout").catch(() => {});
    } finally {
      applyToken("");
      setUser(null);
      setStatus("unauthenticated");
    }
  }, [applyToken]);

  const setUserCallback = useCallback((newUser: AuthUser | null) => {
    setUser(newUser);
  }, []);

  const updateUser = useCallback((partial: Partial<AuthUser>) => {
    setUser((prev) => (prev ? { ...prev, ...partial } : prev));
  }, []);

  const isAuthed = status === "authenticated";

  // Bootstrap on mount
  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const value: AuthContextType = {
    status,
    user,
    token,
    showModal,
    isAuthed,
    openModal,
    closeModal,
    bootstrap,
    login,
    logout,
    setUser: setUserCallback,
    updateUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
