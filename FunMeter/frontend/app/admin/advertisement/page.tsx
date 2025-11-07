"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/providers/I18nProvider";
import { useConfirmDialog } from "@/components/providers/ConfirmDialogProvider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "@/lib/toast";
import { Icon } from "@/components/common/Icon";
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from "lucide-react";

type AdType = "image" | "video";
interface AdItem { src: string; type: AdType; enabled?: boolean }

const LS_KEY = "ads.enabled";

export default function AdminAdvertisementPage() {
  const { t } = useI18n();
  const confirm = useConfirmDialog();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<AdItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importJsonInputRef = useRef<HTMLInputElement | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [perPage, setPerPage] = useState<number | "all">(10);
  const effectivePerPage = perPage === "all" ? items.length : perPage;
  const totalPages = perPage === "all" ? 1 : Math.ceil(items.length / effectivePerPage);
  const startIndex = (currentPage - 1) * effectivePerPage;
  const endIndex = startIndex + effectivePerPage;
  const paginatedItems = items.slice(startIndex, endIndex);

  // Load available media from static index + merge with local enabled config
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/assets/advertisements/index.json", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load advertisements list.");
      const data = await res.json();
      const images: string[] = Array.isArray(data?.images) ? data.images : [];
      const videos: string[] = Array.isArray(data?.videos) ? data.videos : [];
      const discovered: AdItem[] = [
        ...images.map((src) => ({ src, type: "image" as const, enabled: true })),
        ...videos.map((src) => ({ src, type: "video" as const, enabled: true })),
      ];
      let enabled: AdItem[] = [];
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) enabled = JSON.parse(raw) as AdItem[];
      } catch {}
      // If there is an existing enabled list, preserve order and set non-listed as disabled
      const merged: AdItem[] = enabled.length
        ? (() => {
            const enabledSet = new Set(enabled.map((e) => e.src));
            const ordered = [
              ...enabled.filter((e) => discovered.some((d) => d.src === e.src)),
              ...discovered.filter((d) => !enabledSet.has(d.src)),
            ];
            return ordered.map((it) => ({ ...it, enabled: enabledSet.has(it.src) }));
          })()
        : discovered;
      setItems(merged);
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : "Failed to load advertisements list.";
      setError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = (silent?: boolean) => {
    try {
      const enabled = items.filter((it) => it.enabled).map(({ src, type }) => ({ src, type }));
      const jsonStr = JSON.stringify(enabled);
      localStorage.setItem(LS_KEY, jsonStr);
      // Verify save by reading back
      const verify = localStorage.getItem(LS_KEY);
      if (verify !== jsonStr) {
        throw new Error("Save verification failed");
      }
      if (!silent) {
        const message = t("adminAds.toast.saved", "Advertisements saved. Attendance page will use this list after refresh.");
        console.log("[ADMIN_ADS] Showing success toast:", message);
        toast.success(message);
      }
    } catch (e: unknown) {
      console.error("[ADMIN_ADS] Save error:", e);
      if (!silent) {
        const message = e instanceof Error ? e.message : t("adminAds.toast.saveFailed", "Failed to save advertisements.");
        console.log("[ADMIN_ADS] Showing error toast:", message);
        toast.error(message);
      }
    }
  };

  const move = (idx: number, dir: -1 | 1) => {
    setItems((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      const tmp = next[idx];
      next[idx] = next[j];
      next[j] = tmp;
      return next;
    });
  };

  const toggle = (idx: number, val: boolean) => {
    setItems((prev) => {
      const next = prev.map((it, i) => (i === idx ? { ...it, enabled: val } : it));
      // Auto-save quietly to persist across navigations
      try {
        const enabled = next.filter((it) => it.enabled).map(({ src, type }) => ({ src, type }));
        localStorage.setItem(LS_KEY, JSON.stringify(enabled));
      } catch {}
      return next;
    });
  };

  // Note: manual media import trigger removed from UI; keep input for potential future use

  const readFileAsDataURL = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const handleImportFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      const picked = Array.from(files).slice(0, 50); // safety limit
      const loaded = await Promise.all(
        picked.map(async (f) => {
          const url = await readFileAsDataURL(f);
          const isImage = f.type.startsWith("image/");
          const isVideo = f.type.startsWith("video/");
          const kind: AdType = isImage ? "image" : isVideo ? "video" : "image";
          return { src: url, type: kind, enabled: true } as AdItem;
        })
      );
      setItems((prev) => {
        const next = [...prev, ...loaded];
        try {
          const enabled = next.filter((it) => it.enabled).map(({ src, type }) => ({ src, type }));
          localStorage.setItem(LS_KEY, JSON.stringify(enabled));
        } catch {}
        return next;
      });
      toast.success(t("adminAds.toast.imported", "Successfully imported advertisement media."));
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : t("adminAds.toast.importFailed", "Failed to import files.");
      toast.error(error);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Delete selected ads
  const deleteSelected = async () => {
    try {
      if (!selected.length) return;
      const toRemove = new Set(selected);
      
      const confirmed = await confirm({
        title: t("adminAds.confirm.delete.title", "Hapus Iklan"),
        description: t("adminAds.confirm.delete.descSelected", "Apakah Anda yakin ingin menghapus {count} iklan yang dipilih? Tindakan ini tidak dapat dibatalkan.", { count: selected.length }),
        confirmText: t("adminAds.confirm.delete.confirm", "Hapus"),
        cancelText: t("adminAds.confirm.delete.cancel", "Batal"),
      });
      
      if (!confirmed) return;
      
      const remaining = items.filter((it) => !toRemove.has(it.src));
      setItems(remaining);
      setSelected([]);
      const enabled = remaining.filter((it) => it.enabled).map(({ src, type }) => ({ src, type }));
      localStorage.setItem(LS_KEY, JSON.stringify(enabled));
      
      // Reset to first page if current page is empty
      const newEffectivePerPage = perPage === "all" ? remaining.length : perPage;
      const newTotalPages = perPage === "all" ? 1 : Math.ceil(remaining.length / newEffectivePerPage);
      if (currentPage > newTotalPages && newTotalPages > 0) {
        setCurrentPage(1);
      }
      
      toast.success(t("adminAds.toast.deletedSelected", "Iklan terpilih berhasil dihapus."));
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : t("adminAds.toast.deleteFailed", "Failed to delete advertisements.");
      toast.error(error);
    }
  };

  // Import ads from JSON file
  const handleImportJson = () => {
    importJsonInputRef.current?.click();
  };

  const importFromJson = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as AdItem[];
      
      if (!Array.isArray(data)) {
        toast.error(t("adminAds.toast.importJsonInvalid", "Format JSON tidak valid."));
        return;
      }

      const imported: AdItem[] = data
        .filter((it): it is AdItem => it && typeof it.src === "string" && (it.type === "image" || it.type === "video"))
        .map(({ src, type }) => ({ src, type, enabled: true }));

      if (imported.length === 0) {
        toast.warn(t("adminAds.toast.importJsonEmpty", "Tidak ada iklan valid dalam file JSON."));
        return;
      }

      setItems((prev) => {
        const existingSrcs = new Set(prev.map((it) => it.src));
        const newItems = imported.filter((it) => !existingSrcs.has(it.src));
        const next = [...prev, ...newItems];
        
        // Auto-save
        try {
          const enabled = next.filter((it) => it.enabled).map(({ src, type }) => ({ src, type }));
          localStorage.setItem(LS_KEY, JSON.stringify(enabled));
        } catch {}
        
        return next;
      });

      toast.success(t("adminAds.toast.importJsonSuccess", "{count} iklan berhasil diimpor dari JSON.", { count: imported.length }));
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : t("adminAds.toast.importJsonFailed", "Gagal mengimpor file JSON.");
      toast.error(error);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex sm:flex-row sm:justify-between sm:items-start gap-2">
          <div>
            <CardTitle>{t("adminAds.title", "Manage Advertisements (Attendance Fun Meter)")}</CardTitle>
            <CardDescription>
              {t("adminAds.subtitle", "Configure which advertisements appear on the Attendance Fun Meter page.")}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleImportJson} variant="outline" size="icon" title={t("common.import", "Import")} aria-label={t("common.import", "Import")}>
              <Icon name="Upload" className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => void load()} title={t("common.reload", "Reload")} aria-label={t("common.reload", "Reload")}>
              <Icon name="RefreshCw" className="h-4 w-4" />
            </Button>
            <input
              ref={importJsonInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void importFromJson(file);
                }
                if (e.target) e.target.value = "";
              }}
            />
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="space-y-4 pt-6">
          {loading && (
            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              {t("state.loading", "Loading data...")}
            </div>
          )}
          {!!error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!loading && !error && (
            <>
              <div className="space-y-3">
                {items.length === 0 && (
                  <div className="text-sm text-muted-foreground">
                    {t("adminAds.empty", "No advertisement media found.")}
                  </div>
                )}
                {paginatedItems.map((it, localIdx) => {
                  const globalIdx = startIndex + localIdx;
                  const isSelected = selected.includes(it.src);
                  return (
                    <div key={it.src} className={`flex items-center gap-3 rounded-md border p-2 transition ${isSelected ? 'opacity-60' : ''}`}>
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selected.includes(it.src)}
                        onChange={(e) => {
                          setSelected((prev) => e.target.checked ? [...prev, it.src] : prev.filter((s) => s !== it.src));
                        }}
                        aria-label={t("adminAds.fields.select", "Pilih iklan")}
                      />
                      <div className="w-28 h-16 bg-muted flex items-center justify-center overflow-hidden rounded">
                        {it.type === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={it.src} alt="Ad" className="w-full h-full object-contain" />
                        ) : (
                          <video src={it.src} className="w-full h-full object-contain" muted />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{it.src}</div>
                        <div className="text-xs text-muted-foreground">{it.type.toUpperCase()}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="icon" onClick={() => move(globalIdx, -1)} disabled={globalIdx === 0}>
                          ↑
                        </Button>
                        <Button variant="outline" size="icon" onClick={() => move(globalIdx, 1)} disabled={globalIdx === items.length - 1}>
                          ↓
                        </Button>
                        <div className="flex items-center gap-2">
                          <input
                            id={`ad-${globalIdx}`}
                            type="checkbox"
                            className="h-4 w-4"
                            checked={!!it.enabled}
                            onChange={(e) => toggle(globalIdx, e.target.checked)}
                          />
                          <Label htmlFor={`ad-${globalIdx}`} className="text-xs">{t("adminAds.fields.show", "Show")}</Label>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              
              {/* Pagination Controls */}
              {items.length > 0 && totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 border-t">
                  <div className="text-sm text-muted-foreground">
                    {t("adminAds.pagination.info", "Menampilkan {start}-{end} dari {total} iklan", {
                      start: startIndex + 1,
                      end: Math.min(endIndex, items.length),
                      total: items.length,
                    })}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage <= 1}
                      title={t("adminAds.pagination.first", "Halaman pertama")}
                    >
                      <ChevronsLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                      disabled={currentPage <= 1}
                      title={t("adminAds.pagination.previous", "Sebelumnya")}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="px-3 py-1 rounded-md bg-gray-100 text-foreground text-sm">
                      {currentPage} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                      disabled={currentPage >= totalPages}
                      title={t("adminAds.pagination.next", "Selanjutnya")}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={currentPage >= totalPages}
                      title={t("adminAds.pagination.last", "Halaman terakhir")}
                    >
                      <ChevronsRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="flex items-center justify-between gap-2 pt-2">
            <div className="flex items-center gap-2">
              {items.length > 0 && (
                <>
                  <Label className="text-sm">{t("adminAds.pagination.perPage", "Per halaman:")}</Label>
                  <select
                    value={perPage}
                    onChange={(e) => {
                      const value = e.target.value;
                      const newPerPage = value === "all" ? "all" : Number(value);
                      setPerPage(newPerPage);
                      setCurrentPage(1); // Reset to first page when changing per page
                    }}
                    className="h-9 rounded-md border px-3 py-1 text-sm"
                  >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value="all">{t("adminAds.pagination.all", "Semua")}</option>
                  </select>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => save()} disabled={loading || !!error}>
                <Icon name="Save" className="h-4 w-4 mr-2" />
                {t("common.save", "Save")}
              </Button>
              <Button onClick={deleteSelected} variant="destructive" disabled={loading || !!error || selected.length === 0}>
                <Icon name="Trash2" className="h-4 w-4 mr-2" />
                {t("common.delete", "Delete")}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/mp4,video/webm"
                multiple
                className="hidden"
                onChange={(e) => handleImportFiles(e.target.files)}
              />
            </div>
          </div>

          <Separator className="my-2" />

          {/* Petunjuk tambahan dihapus sesuai permintaan */}
        </CardContent>
      </Card>
    </div>
  );
}


