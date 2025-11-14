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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

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
    <>
      <Dialog open={modalOpen} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent 
          className="max-w-3xl max-h-[85vh] overflow-auto bg-background border border-border rounded-2xl m-auto shadow-2xl" 
          hideOverlay 
          onEscapeKeyDown={() => closeModal()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
              e.preventDefault();
              document.getElementById('settings-form')?.dispatchEvent(new Event('submit', { bubbles: true }));
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              {ft("title", "Settings")}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              {ft("subtitle", "Manage display preferences and streaming quality")}
            </p>
          </DialogHeader>

          <form id="settings-form" className="space-y-4 sm:space-y-6" onSubmit={handleSubmit}>
            {/* Language Section */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  {ft("language.title", "Language")}
                </label>
                <select
                  value={form.language}
                  onChange={(e) => setForm({ ...form, language: e.target.value })}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {languageOptions.map((option) => (
                    <option key={option.code} value={option.code}>
                      {ft(`language.options.${option.code}`, option.label ?? option.code.toUpperCase())}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {ft("language.help", "Interface language setting")}
                </p>
              </div>

              {/* Theme Section */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  {ft("theme.title", "Theme")}
                </label>
                <div className="grid gap-2 grid-cols-2">
                  <label
                    className={`inline-flex items-center justify-center gap-2 rounded-md border border-input px-3 py-2 text-sm font-medium cursor-pointer transition-all hover:bg-accent/50 ${
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
                    <Icon name="Sun" className="h-4 w-4" />
                    <span>{ft("theme.light", "Light")}</span>
                  </label>
                  <label
                    className={`inline-flex items-center justify-center gap-2 rounded-md border border-input px-3 py-2 text-sm font-medium cursor-pointer transition-all hover:bg-accent/50 ${
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
                    <Icon name="Moon" className="h-4 w-4" />
                    <span>{ft("theme.dark", "Dark")}</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Attendance Section */}
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-foreground border-b border-border pb-2">
                {ft("attendance.title", "Attendance Streaming")}
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    {ft("attendance.width.label", "Send Width (px)")}
                  </label>
                  <input
                    type="number"
                    min="160"
                    max="1920"
                    step="1"
                    value={form.attendanceSendWidth}
                    onChange={(e) => setForm({ ...form, attendanceSendWidth: parseInt(e.target.value) || 640 })}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <p className="text-xs text-muted-foreground">
                    {ft("attendance.width.help", "Frame width sent to server. Smaller = faster.")}
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">
                      {ft("attendance.quality.label", "JPEG Quality")}
                    </label>
                    <span className="font-mono text-foreground font-semibold text-sm">
                      {(() => {
                        console.log('Attendance JPEG Quality:', form.attendanceJpegQuality.toFixed(2));
                        return form.attendanceJpegQuality.toFixed(2);
                      })()}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={form.attendanceJpegQuality}
                    onChange={(e) => setForm({ ...form, attendanceJpegQuality: parseFloat(e.target.value) })}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{ft("attendance.quality.low", "Low (0.1)")}</span>
                    <span>{ft("attendance.quality.high", "High (1.0)")}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {ft("attendance.quality.help", "Image compression quality. Higher = clearer but heavier.")}
                  </p>
                </div>
              </div>
            </div>

            {/* Fun Meter Section */}
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-foreground border-b border-border pb-2">
                {ft("funMeter.title", "Fun Meter Streaming")}
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    {ft("funMeter.width.label", "Send Width (px)")}
                  </label>
                  <input
                    type="number"
                    min="160"
                    max="1920"
                    step="1"
                    value={form.funSendWidth}
                    onChange={(e) => setForm({ ...form, funSendWidth: parseInt(e.target.value) || 640 })}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <p className="text-xs text-muted-foreground">
                    {ft("funMeter.width.help", "Frame width for emotion detection. Smaller = faster.")}
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">
                      {ft("funMeter.quality.label", "JPEG Quality")}
                    </label>
                    <span className="font-mono text-foreground font-semibold text-sm">
                      {(() => {
                        console.log('Fun Meter JPEG Quality:', form.funJpegQuality.toFixed(2));
                        return form.funJpegQuality.toFixed(2);
                      })()}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={form.funJpegQuality}
                    onChange={(e) => setForm({ ...form, funJpegQuality: parseFloat(e.target.value) })}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{ft("funMeter.quality.low", "Low (0.1)")}</span>
                    <span>{ft("funMeter.quality.high", "High (1.0)")}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {ft("funMeter.quality.help", "Compression quality for emotion detection.")}
                  </p>
                </div>
              </div>
            </div>

            {/* Base Interval Section */}
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-foreground border-b border-border pb-2">
                {ft("baseInterval.title", "Base Interval")}
              </h3>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  {ft("baseInterval.label", "Interval (ms)")}
                </label>
                <input
                  type="number"
                  min="100"
                  max="5000"
                  step="100"
                  value={form.baseInterval}
                  onChange={(e) => setForm({ ...form, baseInterval: parseInt(e.target.value) || 1000 })}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
                <p className="text-xs text-muted-foreground">
                  {ft("baseInterval.help", "Frame sending interval to server in milliseconds.")}
                </p>
              </div>
            </div>
          </form>
          <DialogFooter>
            <div className="flex flex-wrap justify-between items-center gap-2 w-full">
              {/* Logout button on the left */}
              {user && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleLogoutClick}
                  className="flex items-center gap-2"
                >
                  <Icon name="LogOut" className="h-4 w-4" />
                  <span>{ft("actions.logout", "Sign out")}</span>
                </Button>
              )}
              
              {/* Other buttons on the right */}
              <div className="flex gap-2 ml-auto">
                <Button
                  type="button"
                  variant="outline"
                  onClick={reset}
                >
                  <Icon name="RotateCcw" className="h-4 w-4 mr-2" />
                  {ft("actions.reset", "Reset")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeModal}
                >
                  {ft("actions.cancel", "Cancel")}
                </Button>
                <Button
                  type="submit"
                  form="settings-form"
                >
                  {ft("actions.save", "Save")}
                </Button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <LogoutConfirmDialog
        open={showLogoutDialog}
        onOpenChange={setShowLogoutDialog}
        onConfirm={handleLogoutConfirm}
      />
    </>
  );
}
