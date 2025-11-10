"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/providers/I18nProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { useConfirmDialog } from "@/components/providers/ConfirmDialogProvider";
import { request } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface FaceEngineConfig {
  min_cosine_accept?: number;
  fun_ws_min_interval?: number;
  att_ws_min_interval?: number;
  yunet_score_threshold?: number;
  yunet_nms_threshold?: number;
  yunet_top_k?: number;
}

interface AttendanceConfigCfg {
  cooldown_sec?: number;
  min_cosine_accept?: number;
}

interface ConfigData {
  face_engine: FaceEngineConfig;
  attendance: AttendanceConfigCfg;
}

interface DashboardData {
  config?: ConfigData;
  config_defaults?: ConfigData;
  current_user?: { username: string; api_key?: string };
}

export default function AdminConfigPage() {
  const { t, locale } = useI18n();
  const { user, setUser } = useAuth();
  const confirmDialog = useConfirmDialog();

  const [state, setState] = useState({
    loading: true,
    error: "",
    config: { face_engine: {}, attendance: {} } as ConfigData,
    defaults: { face_engine: {}, attendance: {} } as ConfigData,
  });

  const [saving, setSaving] = useState(false);
  const [jsonModal, setJsonModal] = useState({ open: false, title: "", content: "" });

  const [faceForm, setFaceForm] = useState({
    min_cosine_accept: "",
    fun_ws_min_interval: "",
    att_ws_min_interval: "",
    yunet_score_threshold: "",
    yunet_nms_threshold: "",
    yunet_top_k: "",
  });

  const [attendanceForm, setAttendanceForm] = useState({
    cooldown_str: "",
    min_cosine_accept: "",
  });

  // helpers for mm:ss or seconds parsing/formatting (cooldown only)
  const formatDuration = (value: unknown): string => {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) {
      const m = Math.floor(n / 60);
      const s = Math.max(0, Math.round(n % 60));
      return `${m}:${String(s).padStart(2, "0")}`;
    }
    const s = String(value || "").trim();
    if (!s) return "";
    if (/^\d{1,}:[0-5]\d$/.test(s)) return s;
    const x = Number(s);
    if (Number.isFinite(x) && x >= 0) {
      const m = Math.floor(x / 60);
      const sec = Math.max(0, Math.round(x % 60));
      return `${m}:${String(sec).padStart(2, "0")}`;
    }
    return s;
  };

  const parseDuration = (input: unknown): number | null => {
    const s = String(input ?? "").trim();
    if (!s) return null;
    if (/^\d{1,}:[0-5]\d$/.test(s)) {
      const [m, sec] = s.split(":");
      return Math.max(0, Number(m) * 60 + Number(sec));
    }
    const n = Number(s);
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
    throw new Error(t("adminConfig.errors.mustDuration", "Cooldown harus berupa mm:ss atau jumlah detik."));
  };

  const toInputValue = (value: unknown): string => {
    if (value === undefined || value === null) return "";
    return String(value);
  };

  const hydrateForms = useCallback(() => {
    const face = state.config?.face_engine || {};
    setFaceForm({
      min_cosine_accept: toInputValue(face.min_cosine_accept),
      fun_ws_min_interval: toInputValue(face.fun_ws_min_interval),
      att_ws_min_interval: toInputValue(face.att_ws_min_interval),
      yunet_score_threshold: toInputValue(face.yunet_score_threshold),
      yunet_nms_threshold: toInputValue(face.yunet_nms_threshold),
      yunet_top_k: toInputValue(face.yunet_top_k),
    });

    const attendance = state.config?.attendance || {};
    setAttendanceForm({
      cooldown_str: formatDuration(attendance.cooldown_sec),
      min_cosine_accept: toInputValue(attendance.min_cosine_accept),
    });
  }, [state.config]);

  const loadConfig = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: "" }));
    try {
      const data = await request<DashboardData>("/admin/dashboard-data", { method: "GET" });
      const config = data?.config || { face_engine: {}, attendance: {} };
      const defaults = data?.config_defaults || { face_engine: {}, attendance: {} };
      setState({ loading: false, error: "", config, defaults });

      // no-op: we don't need to update auth user here
    } catch (err: unknown) {
      const error = err as { message?: string };
      setState(prev => ({ ...prev, loading: false, error: error?.message || t("adminConfig.error.fetch", "Gagal memuat konfigurasi.") }));
    }
  }, [t, user]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (!state.loading) hydrateForms();
  }, [state.loading, hydrateForms]);

  const buildConfigPayload = (scope: "face_engine" | "attendance") => {
    if (scope === "face_engine") {
      const payload: Record<string, number> = {};
      const parseNumber = (key: keyof FaceEngineConfig, value: string) => {
        if (value === "" || value === null || value === undefined) return;
        const num = Number(value);
        if (Number.isNaN(num)) throw new Error(t("adminConfig.errors.mustNumber", "{field} harus berupa angka.", { field: String(key) }));
        payload[key] = num;
      };
      parseNumber("min_cosine_accept", faceForm.min_cosine_accept);
      parseNumber("fun_ws_min_interval", faceForm.fun_ws_min_interval);
      parseNumber("att_ws_min_interval", faceForm.att_ws_min_interval);
      parseNumber("yunet_score_threshold", faceForm.yunet_score_threshold);
      parseNumber("yunet_nms_threshold", faceForm.yunet_nms_threshold);
      parseNumber("yunet_top_k", faceForm.yunet_top_k);
      if (Object.keys(payload).length === 0) return null;
      return { face_engine: payload } as Partial<ConfigData>;
    }

    if (scope === "attendance") {
      const payload: Record<string, number> = {};
      const cooldownRaw = String(attendanceForm.cooldown_str ?? "").trim();
      if (cooldownRaw !== "") {
        const total = parseDuration(cooldownRaw);
        if (total !== null) payload["cooldown_sec"] = total;
      }
      if (attendanceForm.min_cosine_accept !== "") {
        const num = Number(attendanceForm.min_cosine_accept);
        if (Number.isNaN(num)) throw new Error(t("adminConfig.errors.mustNumber", "{field} harus berupa angka.", { field: "min_cosine_accept" }));
        payload["min_cosine_accept"] = num;
      }
      if (Object.keys(payload).length === 0) return null;
      return { attendance: payload } as Partial<ConfigData>;
    }
    return null;
  };

  const submitConfig = async (scope: "face_engine" | "attendance") => {
    try {
      const payload = buildConfigPayload(scope);
      if (!payload) {
        toast.info(t("adminConfig.toast.noChanges", "Tidak ada perubahan untuk disimpan."));
        return;
      }
      setSaving(true);
      await request("/config", { method: "PUT", body: payload });
      toast.success(t("adminConfig.toast.saved", "Konfigurasi disimpan."));
      await loadConfig();
    } catch (err: unknown) {
      const error = err as { message?: string };
      toast.error(error?.message || t("adminConfig.error.generic", "Gagal menyimpan konfigurasi."));
    } finally {
      setSaving(false);
    }
  };

  const resetConfig = async (scope: "face_engine" | "attendance" | "all") => {
    const label = scope === "face_engine"
      ? t("adminConfig.reset.scopeFace", "konfigurasi face engine")
      : scope === "attendance"
      ? t("adminConfig.reset.scopeAttendance", "konfigurasi attendance")
      : t("adminConfig.reset.scopeAll", "semua konfigurasi");

    const confirmed = await confirmDialog({
      title: t("adminConfig.reset.title", "Konfirmasi Reset"),
      description: t("adminConfig.reset.confirm", "Atur ulang {scope}?", { scope: label }),
      confirmText: t("adminConfig.reset.ok", "Atur ulang"),
      cancelText: t("common.cancel", "Batal"),
    });
    if (!confirmed) return;
    try {
      await request("/config/reset", { method: "POST", body: { scope } });
      toast.success(t("adminConfig.toast.reset", "Konfigurasi direset."));
      await loadConfig();
    } catch (err: unknown) {
      const error = err as { message?: string };
      toast.error(error?.message || t("adminConfig.error.generic", "Gagal menyimpan konfigurasi."));
    }
  };

  const openJsonModal = (title: string, payload: unknown) => {
    let content = "";
    try {
      content = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    } catch {
      content = String(payload ?? "");
    }
    setJsonModal({ open: true, title, content });
  };

  const closeJsonModal = () => setJsonModal(prev => ({ ...prev, open: false }));

  return (
    <div className="space-y-6" key={locale}>
      {/* Status */}
      {state.error && (
        <Alert variant="destructive">
          <AlertTitle>{t("adminConfig.error.title", "Terjadi kesalahan")}</AlertTitle>
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {state.loading && (
        <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          {t("state.loading", "Memuat data config...")}
        </div>
      )}

      {/* Face Engine Section */}
      {!state.loading && (
        <Card>
          <CardHeader className="flex sm:flex-row sm:justify-between">
            <div className="space-y-1.5">
              <CardTitle>{t("adminConfig.sections.faceEngine.title", "Face Engine")}</CardTitle>
              <CardDescription>
                {t("adminConfig.sections.faceEngine.subtitle", "Atur interval WS dan ambang deteksi YuNet.")}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => resetConfig("face_engine")}>{t("adminConfig.actions.resetFace", "Atur Ulang Face Engine")}</Button>
              <Button variant="outline" size="sm" onClick={() => resetConfig("attendance")}>{t("adminConfig.actions.resetAttendance", "Atur Ulang Absensi")}</Button>
              <Button variant="destructive" size="sm" onClick={() => resetConfig("all")}>{t("adminConfig.actions.resetAll", "Atur Ulang Semua")}</Button>
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="p-6 space-y-6">
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submitConfig("face_engine"); }}>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">{t("adminConfig.fields.minCosine", "Ambang Cosine Minimum")}</Label>
                <Input value={faceForm.min_cosine_accept} onChange={(e)=> setFaceForm(prev => ({ ...prev, min_cosine_accept: e.target.value }))} />
                <p className="text-[11px] text-muted-foreground">
                  {t("adminConfig.defaults.value", "Default: {value}", { value: (state.defaults.face_engine?.min_cosine_accept as unknown) ?? "—" })}
                </p>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">{t("adminConfig.fields.funInterval", "Interval WS Fun (detik)")}</Label>
                <Input value={faceForm.fun_ws_min_interval} onChange={(e)=> setFaceForm(prev => ({ ...prev, fun_ws_min_interval: e.target.value }))} />
                <p className="text-[11px] text-muted-foreground">
                  {t("adminConfig.defaults.value", "Default: {value}", { value: (state.defaults.face_engine?.fun_ws_min_interval as unknown) ?? "—" })}
                </p>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">{t("adminConfig.fields.attInterval", "Interval WS Attendance (detik)")}</Label>
                <Input value={faceForm.att_ws_min_interval} onChange={(e)=> setFaceForm(prev => ({ ...prev, att_ws_min_interval: e.target.value }))} />
                <p className="text-[11px] text-muted-foreground">
                  {t("adminConfig.defaults.value", "Default: {value}", { value: (state.defaults.face_engine?.att_ws_min_interval as unknown) ?? "—" })}
                </p>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">{t("adminConfig.fields.scoreThreshold", "Ambang Skor YuNet")}</Label>
                <Input value={faceForm.yunet_score_threshold} onChange={(e)=> setFaceForm(prev => ({ ...prev, yunet_score_threshold: e.target.value }))} />
                <p className="text-[11px] text-muted-foreground">
                  {t("adminConfig.defaults.value", "Default: {value}", { value: (state.defaults.face_engine?.yunet_score_threshold as unknown) ?? "—" })}
                </p>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">{t("adminConfig.fields.nmsThreshold", "Ambang NMS YuNet")}</Label>
                <Input value={faceForm.yunet_nms_threshold} onChange={(e)=> setFaceForm(prev => ({ ...prev, yunet_nms_threshold: e.target.value }))} />
                <p className="text-[11px] text-muted-foreground">
                  {t("adminConfig.defaults.value", "Default: {value}", { value: (state.defaults.face_engine?.yunet_nms_threshold as unknown) ?? "—" })}
                </p>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">{t("adminConfig.fields.topK", "YuNet Top K")}</Label>
                <Input value={faceForm.yunet_top_k} onChange={(e)=> setFaceForm(prev => ({ ...prev, yunet_top_k: e.target.value }))} />
                <p className="text-[11px] text-muted-foreground">
                  {t("adminConfig.defaults.value", "Default: {value}", { value: (state.defaults.face_engine?.yunet_top_k as unknown) ?? "—" })}
                </p>
              </div>

              <div className="sm:col-span-2">
                <Button type="submit" disabled={saving}>{t("adminConfig.actions.saveFace", "Simpan Face Engine")}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Attendance Section */}
      {!state.loading && (
        <Card>
          <CardHeader className="space-y-1.5">
            <CardTitle>{t("adminConfig.sections.attendance.title", "Absensi")}</CardTitle>
            <CardDescription>
              {t("adminConfig.sections.attendance.subtitle", "Konfigurasi cooldown dan threshold absensi")}
            </CardDescription>
          </CardHeader>
          <Separator />
          <CardContent className="p-6">
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submitConfig("attendance"); }}>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">{t("adminConfig.fields.cooldownSec", "Cooldown")}</Label>
                <Input
                  value={attendanceForm.cooldown_str}
                  onChange={(e)=> setAttendanceForm(prev => ({ ...prev, cooldown_str: e.target.value }))}
                  placeholder={t("adminConfig.help.wsInterval", "mm:ss atau detik")}
                />
                <p className="text-[11px] text-muted-foreground">
                  {t("adminConfig.defaults.value", "Default: {value}", { value: (state.defaults.attendance?.cooldown_sec as unknown) ?? "—" })}
                </p>
              </div>

              {/* Optional attendance min cosine (hidden by default) */}
              {/*
              <div className="space-y-1">
                <Label className="text-xs font-semibold">{t("adminConfig.fields.minCosine", "Min Cosine Accept (Attendance)")}</Label>
                <Input value={attendanceForm.min_cosine_accept} onChange={(e)=> setAttendanceForm(prev => ({ ...prev, min_cosine_accept: e.target.value }))} />
                <p className="text-[11px] text-muted-foreground">
                  {t("adminConfig.defaults.value", "Default: {value}", { value: (state.defaults.attendance?.min_cosine_accept as unknown) ?? "—" })}
                </p>
              </div>
              */}

              <div className="sm:col-span-2">
                <Button type="submit" disabled={saving}>{t("adminConfig.actions.saveAttendance", "Simpan Absensi")}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* JSON Modal */}
      <Dialog open={jsonModal.open} onOpenChange={(open) => { if (!open) setJsonModal(prev => ({ ...prev, open: false })); else setJsonModal(prev => ({ ...prev, open: true })); }}>
        <DialogContent 
          hideOverlay 
          className="max-w-3xl max-h-[85vh] overflow-auto bg-background rounded-xl m-auto" 
          onEscapeKeyDown={() => setJsonModal(prev => ({ ...prev, open: false }))} 
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              setJsonModal(prev => ({ ...prev, open: false }));
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{jsonModal.title}</DialogTitle>
            <DialogDescription>
              {t("adminConfig.json.hint", "Dump data mentah untuk debugging")}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-auto rounded-lg bg-muted p-4">
            <pre className="text-xs leading-relaxed">{jsonModal.content}</pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
