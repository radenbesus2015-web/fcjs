// components/modals/SettingsModal.tsx
// Port dari src-vue-original/components/modals/SettingsModal.vue

"use client";

import React, { useEffect, useState } from "react";
import { useI18n } from "@/components/providers/I18nProvider";
import { useSettings } from "@/components/providers/SettingsProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/common/Icon";
import { useTheme } from "@/components/providers/ThemeProvider";
import { LogoutConfirmDialog } from "@/components/common/LogoutConfirmDialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function SettingsModal() {
  const { t, setLocale } = useI18n();
  const { setTheme } = useTheme();
  const { user, logout } = useAuth();
  const { 
    modalOpen, 
    closeModal, 
    form, 
    setForm, 
    submit, 
    reset,
    languageOptions 
  } = useSettings();
  
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);

  const ft = (path: string, fallback: string) => t(`settings.${path}`, fallback);

  // ESC key handler
  useEffect(() => {
    if (!modalOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeModal();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [modalOpen, closeModal]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Apply language to I18nProvider immediately
    setLocale(form.language);
    // Apply theme to ThemeProvider immediately
    if (form.theme === "light" || form.theme === "dark") {
      setTheme(form.theme);
    }
    submit();
  };

  const handleLogoutClick = () => {
    setShowLogoutDialog(true);
  };

  const handleLogoutConfirm = () => {
    logout();
    closeModal();
  };

  return (
    <AlertDialog open={modalOpen} onOpenChange={(open) => !open && closeModal()}>
      <AlertDialogContent className="fixed left-1/2 top-1/2 z-50 flex flex-col w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 border border-border bg-background shadow-lg duration-200 focus:outline-none max-h-[95vh] rounded-2xl overflow-hidden">
        <AlertDialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between gap-4 border-b border-border pb-4 bg-background px-4 sm:px-6 pt-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-widest">
                {ft("breadcrumb", "Preferensi")}
              </p>
              <AlertDialogTitle className="text-xl font-semibold">
                {ft("title", "Pengaturan Tampilan & Kualitas")}
              </AlertDialogTitle>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={closeModal}
              aria-label={ft("actions.close", "Tutup")}
            >
              <Icon name="X" className="h-4 w-4" />
            </Button>
          </div>
        </AlertDialogHeader>

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 sm:px-6">
        <form id="settings-form" className="space-y-4 sm:space-y-6 py-4" onSubmit={handleSubmit}>
          {/* Language Section */}
          <section className="space-y-3 p-4 rounded-lg bg-card border border-border">
            <h3 className="text-sm font-semibold text-foreground">
              {ft("language.title", "Bahasa")}
            </h3>
            <label className="space-y-2 block">
              <select
                value={form.language}
                onChange={(e) => setForm({ ...form, language: e.target.value })}
                className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground focus:ring-2 focus:ring-ring focus:border-ring transition-all"
              >
                {languageOptions.map((option) => (
                  <option key={option.code} value={option.code}>
                    {ft(`language.options.${option.code}`, option.label ?? option.code.toUpperCase())}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {ft("language.help", "Mengatur bahasa antarmuka. Default: Bahasa Indonesia.")}
              </p>
            </label>
          </section>

          {/* Theme Section */}
          <section className="space-y-3 p-4 rounded-lg bg-card border border-border">
            <h3 className="text-sm font-semibold text-foreground">
              {ft("theme.title", "Tema")}
            </h3>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              <label
                className={`inline-flex items-center justify-center gap-2 rounded-lg border border-input px-4 py-2 text-sm font-medium cursor-pointer transition-all hover:bg-accent/50 ${
                  form.theme === "light" ? "bg-accent text-accent-foreground border-accent" : "bg-background text-foreground"
                }`}
              >
                <input
                  type="radio"
                  value="light"
                  checked={form.theme === "light"}
                  onChange={(e) => { const v = e.target.value as "light" | "dark"; setForm({ ...form, theme: v }); }}
                  className="sr-only"
                />
                <Icon name="Sun" className="text-base" />
                <span>{ft("theme.light", "Terang")}</span>
              </label>
              <label
                className={`inline-flex items-center justify-center gap-2 rounded-lg border border-input px-4 py-2 text-sm font-medium cursor-pointer transition-all hover:bg-accent/50 ${
                  form.theme === "dark" ? "bg-accent text-accent-foreground border-accent" : "bg-background text-foreground"
                }`}
              >
                <input
                  type="radio"
                  value="dark"
                  checked={form.theme === "dark"}
                  onChange={(e) => { const v = e.target.value as "light" | "dark"; setForm({ ...form, theme: v }); }}
                  className="sr-only"
                />
                <Icon name="Moon" className="text-base" />
                <span>{ft("theme.dark", "Gelap")}</span>
              </label>
            </div>
          </section>

          {/* Attendance Section */}
          <section className="space-y-3 p-4 rounded-lg bg-card border border-border">
            <h3 className="text-sm font-semibold text-foreground">
              {ft("attendance.title", "Streaming Absensi")}
            </h3>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium">
                  {ft("attendance.width.label", "Lebar Kirim (px)")}
                </span>
                <input
                  type="number"
                  min="120"
                  max="1920"
                  value={form.attendanceSendWidth}
                  onChange={(e) => setForm({ ...form, attendanceSendWidth: Number(e.target.value) })}
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground focus:ring-2 focus:ring-ring focus:border-ring transition-all"
                />
                <p className="text-xs text-muted-foreground">
                  {ft("attendance.width.help", "Mengatur resolusi frame untuk absensi.")}
                </p>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">
                  {ft("attendance.jpeg.label", "Kualitas JPEG")}
                </span>
                <input
                  type="number"
                  step="0.05"
                  min="0.1"
                  max="1"
                  value={form.attendanceJpegQuality}
                  onChange={(e) => setForm({ ...form, attendanceJpegQuality: Number(e.target.value) })}
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground focus:ring-2 focus:ring-ring focus:border-ring transition-all"
                />
                <p className="text-xs text-muted-foreground">
                  {ft("attendance.jpeg.help", "Antara 0.1 - 1.0. Nilai tinggi lebih tajam namun ukuran data lebih besar.")}
                </p>
              </label>
            </div>
          </section>

          {/* Fun Meter Section */}
          <section className="space-y-3 p-4 rounded-lg bg-card border border-border">
            <h3 className="text-sm font-semibold text-foreground">
              {ft("funMeter.title", "Streaming Fun Meter")}
            </h3>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium">
                  {ft("funMeter.width.label", "Lebar Kirim (px)")}
                </span>
                <input
                  type="number"
                  min="160"
                  max="1920"
                  value={form.funSendWidth}
                  onChange={(e) => setForm({ ...form, funSendWidth: Number(e.target.value) })}
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground focus:ring-2 focus:ring-ring focus:border-ring transition-all"
                />
                <p className="text-xs text-muted-foreground">
                  {ft("funMeter.width.help", "Mengatur resolusi frame untuk analisis emosi.")}
                </p>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">
                  {ft("funMeter.jpeg.label", "Kualitas JPEG")}
                </span>
                <input
                  type="number"
                  step="0.05"
                  min="0.1"
                  max="1"
                  value={form.funJpegQuality}
                  onChange={(e) => setForm({ ...form, funJpegQuality: Number(e.target.value) })}
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground focus:ring-2 focus:ring-ring focus:border-ring transition-all"
                />
                <p className="text-xs text-muted-foreground">
                  {ft("funMeter.jpeg.help", "Antara 0.1 - 1.0. Nilai tinggi lebih tajam namun ukuran data lebih besar.")}
                </p>
              </label>
              <label className="space-y-2 col-span-full">
                <span className="text-sm font-medium">
                  {ft("funMeter.interval.label", "Interval Attendance & FunMeter (ms)")}
                </span>
                <input
                  type="number"
                  min="10"
                  max="5000"
                  value={form.baseInterval}
                  onChange={(e) => setForm({ ...form, baseInterval: Number(e.target.value) })}
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground focus:ring-2 focus:ring-ring focus:border-ring transition-all"
                />
                <p className="text-xs text-muted-foreground">
                  {ft("funMeter.interval.help", "Default: 200. Jeda antar frame ke server attendance.")}
                </p>
              </label>
            </div>
          </section>

        </form>
        </div>
        
        {/* Sticky Footer */}
        <div className="flex-shrink-0 border-t border-border bg-background px-4 sm:px-6 py-4">
          <div className="flex flex-wrap justify-between items-center gap-1 sm:gap-2 md:gap-3">
            {/* Logout button on the left */}
            {user && (
              <Button
                type="button"
                variant="destructive"
                onClick={handleLogoutClick}
                className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3"
                title={t("avatar.menu.logout", "Sign out")}
              >
                <Icon name="LogOut" className="h-4 w-4" />
                <span className="hidden md:inline">{t("avatar.menu.logout", "Sign out")}</span>
              </Button>
            )}
            
            {/* Other buttons on the right */}
            <div className="flex flex-wrap gap-1 sm:gap-2 md:gap-3 ml-auto">
              <Button
                type="button"
                variant="outline"
                onClick={reset}
                className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3"
                title={ft("actions.reset", "Atur Ulang ke Bawaan")}
              >
                <Icon name="RotateCcw" className="h-4 w-4" />
                <span className="hidden md:inline">{ft("actions.reset", "Atur Ulang ke Bawaan")}</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={closeModal}
                className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3"
                title={ft("actions.cancel", "Batal")}
              >
                <Icon name="X" className="h-4 w-4" />
                <span className="hidden md:inline">{ft("actions.cancel", "Batal")}</span>
              </Button>
              <Button 
                type="submit" 
                form="settings-form"
                className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3"
                title={ft("actions.save", "Simpan")}
              >
                <Icon name="Save" className="h-4 w-4" />
                <span className="hidden md:inline">{ft("actions.save", "Simpan")}</span>
              </Button>
            </div>
          </div>
        </div>
      </AlertDialogContent>
      
      {/* Logout Confirmation Dialog */}
      <LogoutConfirmDialog
        open={showLogoutDialog}
        onOpenChange={setShowLogoutDialog}
        onConfirm={handleLogoutConfirm}
      />
    </AlertDialog>
  );
}
