// components/modals/SettingsModal.tsx
// Port dari src-vue-original/components/modals/SettingsModal.vue

"use client";

import React, { useEffect } from "react";
import { useI18n } from "@/components/providers/I18nProvider";
import { useSettings } from "@/components/providers/SettingsProvider";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/common/Icon";
import { useTheme } from "@/components/providers/ThemeProvider";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function SettingsModal() {
  const { t, setLocale } = useI18n();
  const { setTheme } = useTheme();
  const { 
    modalOpen, 
    closeModal, 
    form, 
    setForm, 
    submit, 
    reset,
    languageOptions 
  } = useSettings();

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

  return (
    <AlertDialog open={modalOpen} onOpenChange={(open) => !open && closeModal()}>
      <AlertDialogContent className="fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 gap-4 border bg-background p-4 sm:p-6 shadow-lg duration-200 focus:outline-none max-h-[90vh] overflow-hidden rounded-2xl">
        <AlertDialogHeader>
          <div className="flex items-center justify-between gap-4 border-b pb-4 bg-muted/30 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-4">
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

        <div className="max-h-[70vh] overflow-y-auto pr-2">
        <form className="space-y-6" onSubmit={handleSubmit}>
          {/* Language Section */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">
              {ft("language.title", "Bahasa")}
            </h3>
            <label className="space-y-2 block">
              <select
                value={form.language}
                onChange={(e) => setForm({ ...form, language: e.target.value })}
                className="flex h-9 w-full rounded-xl border bg-background px-3 py-1 text-sm focus:ring-2 focus:ring-primary/20 transition-all"
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
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">
              {ft("theme.title", "Tema")}
            </h3>
            <div className="grid gap-3 grid-cols-2">
              <label
                className={`inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium cursor-pointer transition-all ${
                  form.theme === "light" ? "bg-accent text-accent-foreground" : ""
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
                className={`inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium cursor-pointer transition-all ${
                  form.theme === "dark" ? "bg-accent text-accent-foreground" : ""
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
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">
              {ft("attendance.title", "Streaming Absensi")}
            </h3>
            <div className="grid gap-4 grid-cols-2">
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
                  className="flex h-9 w-full rounded-xl border bg-background px-3 py-1 text-sm focus:ring-2 focus:ring-primary/20 transition-all"
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
                  className="flex h-9 w-full rounded-xl border bg-background px-3 py-1 text-sm focus:ring-2 focus:ring-primary/20 transition-all"
                />
                <p className="text-xs text-muted-foreground">
                  {ft("attendance.jpeg.help", "Antara 0.1 - 1.0. Nilai tinggi lebih tajam namun ukuran data lebih besar.")}
                </p>
              </label>
            </div>
          </section>

          {/* Fun Meter Section */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">
              {ft("funMeter.title", "Streaming Fun Meter")}
            </h3>
            <div className="grid gap-4 grid-cols-2">
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
                  className="flex h-9 w-full rounded-xl border bg-background px-3 py-1 text-sm focus:ring-2 focus:ring-primary/20 transition-all"
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
                  className="flex h-9 w-full rounded-xl border bg-background px-3 py-1 text-sm focus:ring-2 focus:ring-primary/20 transition-all"
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
                  className="flex h-9 w-full rounded-xl border bg-background px-3 py-1 text-sm focus:ring-2 focus:ring-primary/20 transition-all"
                />
                <p className="text-xs text-muted-foreground">
                  {ft("funMeter.interval.help", "Default: 200. Jeda antar frame ke server attendance.")}
                </p>
              </label>
            </div>
          </section>

          {/* Action Buttons */}
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={reset}
            >
              {ft("actions.reset", "Atur Ulang ke Bawaan")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={closeModal}
            >
              {ft("actions.cancel", "Batal")}
            </Button>
            <Button type="submit">
              {ft("actions.save", "Simpan")}
            </Button>
          </div>
        </form>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
