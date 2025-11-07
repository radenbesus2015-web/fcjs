// components/modals/LoginModal.tsx
// Modal login yang terhubung ke AuthProvider

"use client";

import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useI18n } from "@/components/providers/I18nProvider";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Icon } from "@/components/common/Icon";
import { api } from "@/lib/api";

type AuthMode = "login" | "register";

export function LoginModal() {
  const { t } = useI18n();
  const { showModal, closeModal, login, status } = useAuth();
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string>("");
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string; confirmPassword?: string }>({});
  const formRef = useRef<HTMLFormElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  const isBusy = status === "loading";

  const validate = (): boolean => {
    const errs: { username?: string; password?: string; confirmPassword?: string } = {};
    if (!username.trim()) {
      errs.username = t("auth.validation.usernameRequired", "Nama pengguna wajib diisi");
    }
    if (!password) {
      errs.password = t("auth.validation.passwordRequired", "Kata sandi wajib diisi");
    }
    if (mode === "register") {
      if (!confirmPassword) {
        errs.confirmPassword = t("auth.validation.confirmPasswordRequired", "Konfirmasi kata sandi wajib diisi");
      } else if (password !== confirmPassword) {
        errs.confirmPassword = t("auth.validation.passwordMismatch", "Konfirmasi kata sandi tidak sama");
      }
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!validate()) return;
    try {
      if (mode === "login") {
        await login({ email: username.trim(), password });
        setPassword("");
      } else {
        // Optional registration endpoint; if not available, this will show error toast in UI
        await api.post("/auth/register", { username: username.trim(), password });
        // After register, auto login for convenience
        await login({ email: username.trim(), password });
        setPassword("");
        setConfirmPassword("");
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ||
        (mode === "login"
          ? t("auth.errors.loginFailed", "Gagal masuk")
          : t("auth.errors.registerFailed", "Gagal mendaftar"));
      setError(msg);
    }
  };

  // Autofocus username on open and allow Enter to submit even if focus outside inputs
  // Also handle ESC to close modal
  useEffect(() => {
    if (showModal) {
      // small delay to ensure dialog is mounted
      const id = window.setTimeout(() => usernameRef.current?.focus(), 0);
      const onKey = (ev: KeyboardEvent) => {
        // Handle ESC to close modal
        if (ev.key === "Escape") {
          ev.preventDefault();
          closeModal();
          return;
        }
        // Handle Enter to submit
        if (ev.key !== "Enter") return;
        const target = ev.target as HTMLElement | null;
        const tag = (target?.tagName || "").toLowerCase();
        const isFormEl = ["input", "textarea", "select", "button"].includes(tag) || target?.isContentEditable;
        const isAriaButton = target?.getAttribute?.("role") === "button" || target?.getAttribute?.("role") === "tab";
        // If focus is on buttons/inputs or tabs, let default behavior happen (e.g., click the focused tab button)
        if (isFormEl || isAriaButton) return;
        ev.preventDefault();
        formRef.current?.requestSubmit();
      };
      window.addEventListener("keydown", onKey);
      return () => {
        window.clearTimeout(id);
        window.removeEventListener("keydown", onKey);
      };
    }
  }, [showModal, closeModal]);

  // Clear field errors when switching mode and reset confirmPassword
  useEffect(() => {
    setFieldErrors({});
    setError("");
    if (mode === "login") setConfirmPassword("");
  }, [mode]);

  return (
    <AlertDialog open={showModal} onOpenChange={(open) => !open && closeModal()}>
      <AlertDialogContent className="fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 gap-0 border bg-background p-0 shadow-lg duration-200 focus:outline-none overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[state=open]:slide-in-from-top-4 data-[state=closed]:slide-out-to-top-4 max-h-[90vh] overflow-y-auto rounded-2xl">
        <div className="grid grid-cols-1 md:grid-cols-2">
          {/* Left welcome panel */}
          <div className="relative p-6 md:p-8 bg-background min-h-[360px] md:min-h-[420px] flex flex-col">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <div className="h-9 w-9 rounded-full grid place-items-center bg-orange-500 text-white">
                <Icon name="Smile" className="h-5 w-5" />
              </div>
              <span>{t("brand.title", "Absensi Wajah")}</span>
            </div>
            <div className="flex-1 grid place-items-center">
              <div className="space-y-2 text-center">
                <h2 className="text-2xl font-semibold">{t("auth.welcome.title", "Selamat datang kembali")}</h2>
                <p className="text-muted-foreground">
                {t("auth.welcome.subtitle", "Masuk untuk akses dashboard dan fun meter kamu.")}
                </p>
              </div>
            </div>
            <p className="mt-auto text-[11px] text-muted-foreground">
              {t("auth.welcome.terms", "Dengan masuk, kamu setuju pada Ketentuan & Kebijakan Privasi.")}
            </p>
          </div>

          {/* Right form panel */}
          <div className="relative p-6 md:p-8 bg-muted/40 border-l">
            <AlertDialogHeader>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    {t("auth.account.title", "Akun")}
                  </p>
                  <AlertDialogTitle className="sr-only">{t("auth.account.subtitle", "Masuk atau daftar akun baru.")}</AlertDialogTitle>
                  <p className="text-xs text-muted-foreground">{t("auth.account.subtitle", "Masuk atau daftar akun baru.")}</p>
                </div>
                <Button type="button" variant="ghost" size="icon" onClick={closeModal} aria-label={t("common.close", "Tutup")}>
                  <Icon name="X" className="h-4 w-4" />
                </Button>
              </div>
            </AlertDialogHeader>

            {/* Segmented switch */}
            <div
              className="mt-4 mb-4 rounded-full bg-muted inline-flex p-1 w-full max-w-xs"
              role="tablist"
              aria-label={t("auth.tabs.label", "Pilih mode autentikasi")}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") { setMode("login"); }
                if (e.key === "ArrowRight") { setMode("register"); }
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-medium ${mode === "login" ? "bg-background shadow" : "text-muted-foreground"}`}
                onClick={() => setMode("login")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setMode("login");
                  }
                }}
              >
                {t("auth.tabs.login", "Masuk")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "register"}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-medium ${mode === "register" ? "bg-background shadow" : "text-muted-foreground"}`}
                onClick={() => setMode("register")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setMode("register");
                  }
                }}
              >
                {t("auth.tabs.register", "Daftar")}
              </button>
            </div>

            <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
              {error ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-600">
                  {error}
                </div>
              ) : null}

              <div>
                <label className="block text-sm font-medium mb-2">
                  {t("auth.fields.username", "Nama Pengguna")}
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  ref={usernameRef}
                  className={`w-full px-3 py-2 border rounded-xl transition-all ${fieldErrors.username ? "border-red-500 focus-visible:ring-red-500" : "focus:ring-2 focus:ring-primary/20"}`}
                  placeholder={t("auth.placeholders.username", "Masukkan nama pengguna atau email")}
                  required
                  autoComplete="username"
                />
                {fieldErrors.username && (
                  <p className="mt-1 text-xs text-red-600">{fieldErrors.username}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  {t("auth.fields.password", "Kata Sandi")}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`w-full px-3 py-2 border rounded-xl transition-all ${fieldErrors.password ? "border-red-500 focus-visible:ring-red-500" : "focus:ring-2 focus:ring-primary/20"}`}
                  placeholder={t("auth.placeholders.password", "Masukkan kata sandi")}
                  required
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
                {fieldErrors.password && (
                  <p className="mt-1 text-xs text-red-600">{fieldErrors.password}</p>
                )}
              </div>

              {mode === "register" && (
                <div>
                  <label className="block text-sm font-medium mb-2">
                    {t("auth.fields.confirmPassword", "Konfirmasi Kata Sandi")}
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={`w-full px-3 py-2 border rounded-xl transition-all ${fieldErrors.confirmPassword ? "border-red-500 focus-visible:ring-red-500" : "focus:ring-2 focus:ring-primary/20"}`}
                    placeholder={t("auth.placeholders.confirmPassword", "Ulangi kata sandi")}
                    required
                    autoComplete="new-password"
                  />
                  {fieldErrors.confirmPassword && (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors.confirmPassword}</p>
                  )}
                </div>
              )}

              <div className="pt-2">
                <Button
                  type="submit"
                  className="w-full bg-orange-600 text-white hover:bg-orange-600/90"
                  disabled={isBusy}
                >
                  {mode === "login"
                    ? (isBusy ? t("auth.login.loading", "Memproses...") : t("auth.login.submit", "Masuk"))
                    : (isBusy ? t("auth.register.loading", "Memproses...") : t("auth.register.submit", "Daftar"))}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
