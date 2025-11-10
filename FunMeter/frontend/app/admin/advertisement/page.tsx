"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [arrowAnimation, setArrowAnimation] = useState<{ index: number; direction: -1 | 1 } | null>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const prevPositionsRef = useRef(new Map<string, DOMRect>());
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [perPage, setPerPage] = useState<number | "all">(10);
  const effectivePerPage = perPage === "all" ? items.length : perPage;
  const totalPages = perPage === "all" ? 1 : Math.ceil(items.length / effectivePerPage);
  const startIndex = (currentPage - 1) * effectivePerPage;
  const endIndex = startIndex + effectivePerPage;
  const paginatedItems = items.slice(startIndex, endIndex);

  useEffect(() => {
    if (!arrowAnimation) return;
    const timeout = window.setTimeout(() => setArrowAnimation(null), 280);
    return () => window.clearTimeout(timeout);
  }, [arrowAnimation]);

  useLayoutEffect(() => {
    const currentPositions = new Map<string, DOMRect>();
    itemRefs.current.forEach((el, key) => {
      currentPositions.set(key, el.getBoundingClientRect());
    });

    currentPositions.forEach((rect, key) => {
      const prev = prevPositionsRef.current.get(key);
      if (!prev) return;
      const el = itemRefs.current.get(key);
      if (!el) return;
      const deltaY = prev.top - rect.top;
      if (Math.abs(deltaY) < 1) return;
      el.animate(
        [
          { transform: `translateY(${deltaY}px)` },
          { transform: "translateY(0)" }
        ],
        {
          duration: 280,
          easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
        }
      );
    });

    prevPositionsRef.current = currentPositions;
  }, [items, startIndex, endIndex]);

  // Load available media from static index + merge with local enabled config
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    toast.info(t("adminAds.toast.loading", "Memuat daftar iklan..."), { duration: 2000 });
    
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
      toast.success(t("adminAds.toast.loaded", "✅ Berhasil memuat {count} iklan", { count: merged.length }), { duration: 3000 });
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : "Failed to load advertisements list.";
      setError(error);
      toast.error(t("adminAds.toast.loadError", "❌ Gagal memuat daftar iklan: {error}", { error }), { duration: 5000 });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const save = (silent?: boolean) => {
    try {
      if (!silent) {
        setSaving(true);
        toast.info(t("adminAds.toast.saving", "Menyimpan iklan..."), { duration: 2000 });
      }
      
      const enabled = items.filter((it) => it.enabled).map(({ src, type }) => ({ src, type }));
      const jsonStr = JSON.stringify(enabled);
      localStorage.setItem(LS_KEY, jsonStr);
      // Verify save by reading back
      const verify = localStorage.getItem(LS_KEY);
      if (verify !== jsonStr) {
        throw new Error("Save verification failed");
      }
      if (!silent) {
        const message = t("adminAds.toast.saved", "✅ Iklan berhasil disimpan. Halaman attendance akan menggunakan daftar ini setelah refresh.");
        console.log("[ADMIN_ADS] Showing success toast:", message);
        toast.success(message, { duration: 3000 });
      }
    } catch (e: unknown) {
      console.error("[ADMIN_ADS] Save error:", e);
      if (!silent) {
        const message = e instanceof Error ? e.message : t("adminAds.toast.saveFailed", "❌ Gagal menyimpan iklan.");
        console.log("[ADMIN_ADS] Showing error toast:", message);
        toast.error(message, { duration: 5000 });
      }
    } finally {
      if (!silent) {
        setSaving(false);
      }
    }
  };

  const move = (idx: number, dir: -1 | 1) => {
    let targetIndex: number | null = null;
    setItems((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      const tmp = next[idx];
      next[idx] = next[j];
      next[j] = tmp;
      targetIndex = j;
      return next;
    });
    if (targetIndex !== null) {
      setArrowAnimation({ index: targetIndex, direction: dir });
    }
  };

  // Drag and drop handlers
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    // Prevent drag from interactive elements
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'BUTTON' || target.closest('button') || target.closest('input')) {
      e.preventDefault();
      return;
    }
    
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/html", String(index));
    // Add visual feedback
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "0.5";
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    // Reset visual feedback
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "1";
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    setItems((prev) => {
      const next = [...prev];
      const draggedItem = next[draggedIndex];
      
      // Remove dragged item from its original position
      next.splice(draggedIndex, 1);
      
      // Calculate new index after removal
      // Item yang di-drop akan menggantikan posisi item yang di-drop
      // Item yang tergantikan akan turun satu posisi
      let adjustedDropIndex: number;
      if (draggedIndex < dropIndex) {
        // Dragging down: after removal, target index shifts down by 1
        // We want to insert at the position of the target item
        adjustedDropIndex = dropIndex - 1;
      } else {
        // Dragging up: target index stays the same
        // We want to insert at the position of the target item
        adjustedDropIndex = dropIndex;
      }
      
      // Insert dragged item at new position
      // This will push the target item down by one position
      next.splice(adjustedDropIndex, 0, draggedItem);
      
      // Auto-save after reordering
      try {
        const enabled = next.filter((it) => it.enabled).map(({ src, type }) => ({ src, type }));
        localStorage.setItem(LS_KEY, JSON.stringify(enabled));
      } catch {}
      
      return next;
    });

    setDraggedIndex(null);
    setDragOverIndex(null);
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
    
    toast.info(t("adminAds.toast.importing", "Mengimpor {count} file...", { count: files.length }), { duration: 2000 });
    
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
      toast.success(t("adminAds.toast.imported", "✅ Berhasil mengimpor {count} media iklan", { count: loaded.length }), { duration: 3000 });
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : t("adminAds.toast.importFailed", "❌ Gagal mengimpor file");
      toast.error(error, { duration: 5000 });
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
      
      setDeleting(true);
      toast.info(t("adminAds.toast.deleting", "Menghapus {count} iklan...", { count: selected.length }), { duration: 2000 });
      
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
      
      toast.success(t("adminAds.toast.deletedSelected", "✅ {count} iklan berhasil dihapus", { count: selected.length }), { duration: 3000 });
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : t("adminAds.toast.deleteFailed", "❌ Gagal menghapus iklan");
      toast.error(error, { duration: 5000 });
    } finally {
      setDeleting(false);
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
        toast.error(t("adminAds.toast.importJsonInvalid", "❌ Format JSON tidak valid"), { duration: 4000 });
        return;
      }

      const imported: AdItem[] = data
        .filter((it): it is AdItem => it && typeof it.src === "string" && (it.type === "image" || it.type === "video"))
        .map(({ src, type }) => ({ src, type, enabled: true }));

      if (imported.length === 0) {
        toast.warn(t("adminAds.toast.importJsonEmpty", "⚠️ Tidak ada iklan valid dalam file JSON"), { duration: 4000 });
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

      toast.success(t("adminAds.toast.importJsonSuccess", "✅ Berhasil mengimpor {count} iklan dari JSON", { count: imported.length }), { duration: 3000 });
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : t("adminAds.toast.importJsonFailed", "❌ Gagal mengimpor file JSON");
      toast.error(error, { duration: 5000 });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex sm:flex-row sm:justify-between sm:items-start gap-2">
          <div className="space-y-1.5">
            <CardTitle>{t("adminAds.title", "Manage Advertisements (Attendance Fun Meter)")}</CardTitle>
            <CardDescription>
              {t("adminAds.subtitle", "Configure which advertisements appear on the Attendance Fun Meter page.")}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleImportJson} variant="outline" size="icon" title={t("common.import", "Import")} aria-label={t("common.import", "Import")} disabled={loading}>
              <Icon name="Upload" className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => void load()} title={t("common.reload", "Reload")} aria-label={t("common.reload", "Reload")} disabled={loading}>
              <Icon name="RefreshCw" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
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
            <div className="flex items-center justify-center p-12 rounded-lg border bg-muted/30">
              <div className="flex flex-col items-center gap-3">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                <p className="text-sm font-medium text-muted-foreground">
                  {t("state.loading", "Memuat data iklan...")}
                </p>
              </div>
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
                  const isDragging = draggedIndex === globalIdx;
                  const isDragOver = dragOverIndex === globalIdx;
                  const isArrowAnimated = arrowAnimation?.index === globalIdx;
                  const itemStyle: React.CSSProperties = {
                    transition: "background-color 0.25s ease, box-shadow 0.25s ease",
                  };
                  if (isArrowAnimated) {
                    itemStyle.boxShadow = "0 12px 28px rgba(15, 23, 42, 0.18)";
                  }
                  return (
                    <div 
                      key={it.src} 
                      ref={(el) => {
                        if (el) {
                          itemRefs.current.set(it.src, el);
                        } else {
                          itemRefs.current.delete(it.src);
                        }
                      }}
                      draggable
                      onDragStart={(e) => handleDragStart(e, globalIdx)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e) => handleDragOver(e, globalIdx)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, globalIdx)}
                      className={`flex items-center gap-3 rounded-md border p-2 transition cursor-move ${
                        isSelected ? 'opacity-60' : ''
                      } ${
                        isDragging ? 'opacity-50' : ''
                      } ${
                        isDragOver ? 'border-primary border-2 bg-primary/5' : ''
                      } ${
                        isArrowAnimated ? 'ring-2 ring-primary/60 bg-primary/10' : ''
                      }`}
                      style={itemStyle}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selected.includes(it.src)}
                        onChange={(e) => {
                          setSelected((prev) => e.target.checked ? [...prev, it.src] : prev.filter((s) => s !== it.src));
                        }}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={t("adminAds.fields.select", "Pilih iklan")}
                      />
                      <div className="w-28 h-16 bg-muted flex items-center justify-center overflow-hidden rounded">
                        {it.type === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img 
                            src={it.src} 
                            alt="Ad preview" 
                            className="w-full h-full object-cover" 
                            draggable={false}
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <video 
                            src={it.src} 
                            className="w-full h-full object-cover" 
                            muted 
                            draggable={false}
                            preload="metadata"
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{it.src}</div>
                        <div className="text-xs text-muted-foreground">{it.type.toUpperCase()}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="icon" onClick={(e) => { e.stopPropagation(); move(globalIdx, -1); }} disabled={globalIdx === 0} className="hidden md:flex">
                          ↑
                        </Button>
                        <Button variant="outline" size="icon" onClick={(e) => { e.stopPropagation(); move(globalIdx, 1); }} disabled={globalIdx === items.length - 1} className="hidden md:flex">
                          ↓
                        </Button>
                        <div className="flex items-center gap-2">
                          <input
                            id={`ad-${globalIdx}`}
                            type="checkbox"
                            className="h-4 w-4"
                            checked={!!it.enabled}
                            onChange={(e) => { e.stopPropagation(); toggle(globalIdx, e.target.checked); }}
                            onClick={(e) => e.stopPropagation()}
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
                    <span className="px-3 py-1 rounded-md bg-muted text-foreground text-sm">
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
              <Button onClick={() => save()} disabled={loading || saving || !!error}>
                {saving ? (
                  <>
                    <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    {t("adminAds.actions.saving", "Menyimpan...")}
                  </>
                ) : (
                  <>
                    <Icon name="Save" className="h-4 w-4 mr-2" />
                    {t("common.save", "Save")}
                  </>
                )}
              </Button>
              <Button onClick={deleteSelected} variant="destructive" disabled={loading || deleting || !!error || selected.length === 0}>
                {deleting ? (
                  <>
                    <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    {t("adminAds.actions.deleting", "Menghapus...")}
                  </>
                ) : (
                  <>
                    <Icon name="Trash2" className="h-4 w-4 mr-2" />
                    {t("common.delete", "Delete")}
                  </>
                )}
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


