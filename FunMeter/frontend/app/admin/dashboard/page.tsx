// app/admin/dashboard/page.tsx
// Port 1:1 dari src-vue-original/pages/admin/AdminDashboardPage.vue dengan penyesuaian Next.js

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/providers/I18nProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { useConfirmDialog } from "@/components/providers/ConfirmDialogProvider";
import { request } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Icon } from "@/components/common/Icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

interface DashboardStats {
  users: number;
  labels: number;
  attendance_events: number;
}

interface ModelSummary {
  backend?: string;
  backend_id?: string | number;
  target_id?: string | number;
  emotion_model?: string;
  emotion_labels?: string[];
  labels?: string[];
}

interface CurrentUser {
  id: string;
  username: string;
  api_key?: string;
}

interface DashboardResponse {
  generated_at?: string;
  stats?: DashboardStats;
  model_summary?: ModelSummary;
  current_user?: CurrentUser | null;
}

export default function AdminDashboardPage() {
  const { t } = useI18n();
  const { user: authUser, setUser } = useAuth();
  const confirm = useConfirmDialog();

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [generatedAt, setGeneratedAt] = useState<string>("");
  const [stats, setStats] = useState<DashboardStats>({ users: 0, labels: 0, attendance_events: 0 });
  const [modelSummary, setModelSummary] = useState<ModelSummary>({});
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [copying, setCopying] = useState<boolean>(false);
  const [rotating, setRotating] = useState<boolean>(false);

  const quickCards = useMemo(() => ([
    { label: t("adminDashboard.stats.users.label", "Users"), value: stats.users, caption: t("adminDashboard.stats.users.caption", "Registered accounts") },
    { label: t("adminDashboard.stats.faces.label", "Known Faces"), value: stats.labels, caption: t("adminDashboard.stats.faces.caption", "Embeddings in memory") },
    { label: t("adminDashboard.stats.attendance.label", "Attendance Events"), value: stats.attendance_events, caption: t("adminDashboard.stats.attendance.caption", "Total log entries") },
  ]), [stats, t]);

  const maskedApiKey = useMemo(() => {
    const key = currentUser?.api_key || "";
    if (!key) return t("adminDashboard.apiKey.empty", "Belum ada API key");
    if (showApiKey) return key;
    if (key.length <= 4) return "•".repeat(Math.max(4, key.length));
    const tail = key.slice(-4);
    return `${"•".repeat(Math.max(4, key.length - 4))}${tail}`;
  }, [currentUser?.api_key, showApiKey, t]);

  async function loadDashboard() {
    setLoading(true);
    setError("");
    try {
      const data = await request<DashboardResponse>("/admin/dashboard-data");
      setGeneratedAt(data.generated_at || "");
      setStats(data.stats || { users: 0, labels: 0, attendance_events: 0 });
      setModelSummary(data.model_summary || {});
      setCurrentUser(data.current_user || null);
      // Sinkronisasi token pengguna tidak diperlukan di sini; AuthProvider mengatur token terpusat.
      if (!data.current_user) setShowApiKey(false);
    } catch (err: unknown) {
      console.error(err);
      setError(t("adminDashboard.error.generic", "Gagal memuat dashboard."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  async function reloadModel() {
    try {
      await request("/admin/actions/reload-model", { method: "POST", body: {} });
      toast.success(t("adminDashboard.toast.modelReloaded", "Model berhasil dimuat ulang."));
      await loadDashboard();
    } catch (err: unknown) {
      console.error(err);
      toast.error(t("adminDashboard.error.generic", "Gagal memuat dashboard."));
    }
  }

  async function reloadServer() {
    const ok = await confirm({
      title: t("adminDashboard.confirm.reloadServerTitle", "Muat ulang server?"),
      description: t("adminDashboard.confirm.reloadServer", "Memuat ulang server akan menerapkan ulang konfigurasi. Lanjutkan?"),
      confirmText: t("adminDashboard.confirm.reloadAction", "Muat ulang"),
      cancelText: t("common.cancel", "Batal"),
    });
    if (!ok) return;
    try {
      await request("/admin/actions/reload-server", { method: "POST", body: {} });
      toast.success(t("adminDashboard.toast.serverReloaded", "Server dimuat ulang."));
      await loadDashboard();
    } catch (err: unknown) {
      console.error(err);
      toast.error(t("adminDashboard.error.generic", "Gagal memuat dashboard."));
    }
  }

  async function copyApiKey() {
    const key = currentUser?.api_key || "";
    if (!key) {
      toast.error(t("adminDashboard.apiKey.notAvailable", "API key tidak tersedia."));
      return;
    }
    setCopying(true);
    try {
      await navigator.clipboard.writeText(key);
      toast.success(t("adminDashboard.apiKey.copied", "API key disalin ke clipboard."));
    } catch {
      toast.error(t("adminDashboard.apiKey.copyError", "Gagal menyalin API key."));
    } finally {
      setCopying(false);
    }
  }

  async function rotateApiKey() {
    if (!currentUser?.id) return;
    const ok = await confirm({
      title: t("confirm.rotateKeyTitle", "Putar API key?"),
      description: t("confirm.rotateKey", "Generate API key baru untuk akun kamu? Kamu harus memperbarui token header setelah ini."),
      confirmText: t("confirm.rotateAction", "Generate"),
      cancelText: t("common.cancel", "Batal"),
    });
    if (!ok) return;
    setRotating(true);
    try {
      const data = await request<{ user?: CurrentUser }>(`/admin/users/${encodeURIComponent(currentUser.id)}/api-key`, { method: "POST", body: {} });
      toast.success(t("adminDashboard.toast.apiKeyRotated", "API key diperbarui."));
      await loadDashboard();
      if (data?.user?.api_key) {
        try { localStorage.setItem("fm_token", data.user.api_key); } catch {}
      }
    } catch (err: unknown) {
      console.error(err);
      toast.error(t("adminDashboard.error.rotateKey", "Gagal memutar API key."));
    } finally {
      setRotating(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          {t("adminDashboard.state.loading", "Memuat dashboard…")}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-rose-300/60">
        <CardContent className="py-6 text-center text-sm text-rose-600">
          {error}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header / Actions */}
      <div>
        <p className="text-xs tracking-widest text-muted-foreground uppercase">
          {t("adminDashboard.breadcrumb", "Admin Console")}
        </p>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-2xl">
              {t("adminDashboard.greeting", "Hello, {name}", { name: currentUser?.username || t("adminDashboard.fallbackName", "Admin") })}
            </CardTitle>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={reloadModel}>
              <Icon name="RotateCw" className="mr-2 h-4 w-4" />{t("adminDashboard.actions.reloadModel", "Reload Model")}
            </Button>
            <Button onClick={reloadServer}>
              <Icon name="Rocket" className="mr-2 h-4 w-4" />{t("adminDashboard.actions.reloadServer", "Reload Server")}
            </Button>
          </div>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        {quickCards.map((card) => (
          <Card key={card.label}>
            <CardContent className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{card.label}</p>
              <p className="mt-2 text-3xl font-semibold">{card.value}</p>
              <p className="text-xs text-muted-foreground">{card.caption}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* API Key */}
      {currentUser && (
        <Card>
          <CardHeader className="pb-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {t("adminDashboard.apiKey.title", "YOUR API KEY")}
            </p>
            <CardTitle className="text-base">{t("adminDashboard.apiKey.subtitle", "Kredensial pribadi")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="space-y-2 w-full sm:w-auto">
              <Label className="sr-only">API Key</Label>
              <div className="flex flex-wrap sm:flex-nowrap gap-2">
                <Input value={maskedApiKey} readOnly className="font-mono font-semibold tracking-wide" />
                <Button variant="outline" size="sm" onClick={() => setShowApiKey(v => !v)}>
                  {showApiKey ? t("adminDashboard.apiKey.hide", "Sembunyikan") : t("adminDashboard.apiKey.show", "Tampilkan")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="whitespace-nowrap"
                  disabled={copying}
                  onClick={copyApiKey}
                  aria-label={t("adminDashboard.apiKey.copy", "Salin API Key")}
                >
                  {copying ? (
                    t("adminDashboard.apiKey.copying", "Menyalin…")
                  ) : (
                    <>
                      <span className="sm:hidden">{t("adminDashboard.apiKey.copyShort", "Salin")}</span>
                      <span className="hidden sm:inline">{t("adminDashboard.apiKey.copy", "Salin API Key")}</span>
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  className="whitespace-nowrap"
                  disabled={rotating}
                  onClick={rotateApiKey}
                  aria-label={t("adminDashboard.actions.rotateKey", "Putar API Key")}
                >
                  {rotating ? (
                    t("adminDashboard.actions.processing", "Memproses…")
                  ) : (
                    <>
                      <span className="sm:hidden">{t("adminDashboard.actions.rotateShort", "Putar")}</span>
                      <span className="hidden sm:inline">{t("adminDashboard.actions.rotateKey", "Putar API Key")}</span>
                    </>
                  )}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">{t("adminDashboard.apiKey.hint", "Send via Authorization header: Bearer <API_KEY>")}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Model Summary */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg">{t("adminDashboard.model.title", "Active Model")}</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="space-y-6 text-sm p-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("adminDashboard.model.backendLabel", "Backend")}</p>
            <p className="font-semibold uppercase">{modelSummary.backend || t("adminDashboard.model.unknown", "UNKNOWN")}</p>
            <p className="text-xs text-muted-foreground">
              {t("adminDashboard.model.backendMeta", "Backend {backendId} • target {targetId}", { backendId: modelSummary.backend_id ?? "—", targetId: modelSummary.target_id ?? "—" })}
            </p>
          </div>
          <Separator />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("adminDashboard.model.emotionLabel", "Emotion Model")}</p>
            <p className="font-semibold">{modelSummary.emotion_model || t("adminDashboard.model.none", "None")}</p>
            <p className="text-xs text-muted-foreground">{t("adminDashboard.model.emotionCount", "Labels: {count}", { count: (modelSummary.emotion_labels || []).length })}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(modelSummary.emotion_labels || []).length > 0 ? (
                (modelSummary.emotion_labels || []).map((lbl) => (
                  <Badge key={lbl}>{lbl}</Badge>
                ))
              ) : (
                <Badge>{t("adminDashboard.model.noEmotionLabels", "Tidak ada label emosi")}</Badge>
              )}
            </div>
          </div>
          <Separator />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("adminDashboard.model.registeredLabels", "Registered Labels")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(modelSummary.labels || []).length > 0 ? (
                (modelSummary.labels || []).map((label) => (
                  <Badge key={label}>{label}</Badge>
                ))
              ) : (
                <Badge>{t("adminDashboard.model.noLabels", "Tidak ada label")}</Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
