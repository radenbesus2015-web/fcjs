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
import { 
  fetchAllAdvertisements, 
  uploadAdvertisement, 
  updateAdvertisement, 
  deleteAdvertisement, 
  reorderAdvertisements,
  type Advertisement 
} from "@/lib/supabase-advertisements";

type AdType = "image" | "video";
interface AdItem extends Advertisement {
  src: string;
  type: AdType;
  enabled: boolean;
  display_order: number;
}

// LS_KEY removed - now using backend API

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
  const itemRefs = useRef(new Map<string, HTMLDivElement | HTMLTableRowElement>());
  const prevPositionsRef = useRef(new Map<string, DOMRect>());
  
  // View mode state (grid or list)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('adminAds.viewMode');
      return (saved === 'grid' || saved === 'list') ? saved : 'list';
    }
    return 'list';
  });
  
  // Save view mode to localStorage
  useEffect(() => {
    localStorage.setItem('adminAds.viewMode', viewMode);
  }, [viewMode]);
  
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

  // Track previous view mode untuk skip animasi saat switch view
  const prevViewModeRef = useRef(viewMode);
  
  useLayoutEffect(() => {
    // Skip animasi jika view mode berubah (grid ↔ list)
    if (prevViewModeRef.current !== viewMode) {
      prevViewModeRef.current = viewMode;
      // Reset positions untuk view baru
      const currentPositions = new Map<string, DOMRect>();
      itemRefs.current.forEach((el, key) => {
        currentPositions.set(key, el.getBoundingClientRect());
      });
      prevPositionsRef.current = currentPositions;
      return;
    }
    
    const currentPositions = new Map<string, DOMRect>();
    itemRefs.current.forEach((el, key) => {
      currentPositions.set(key, el.getBoundingClientRect());
    });

    currentPositions.forEach((rect, key) => {
      const prev = prevPositionsRef.current.get(key);
      if (!prev) return;
      const el = itemRefs.current.get(key);
      if (!el) return;
      
      // Calculate delta for both X and Y (untuk grid view)
      const deltaX = prev.left - rect.left;
      const deltaY = prev.top - rect.top;
      
      // Skip jika tidak ada perubahan posisi
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
      
      // FLIP animation: First, Last, Invert, Play
      el.animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)`, opacity: 0.8 },
          { transform: "translate(0, 0)", opacity: 1 }
        ],
        {
          duration: 320,
          easing: "cubic-bezier(0.34, 1.56, 0.64, 1)", // Bouncy easing
        }
      );
    });

    prevPositionsRef.current = currentPositions;
  }, [items, startIndex, endIndex, viewMode]);

  // Load advertisements from backend API
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    toast.info(t("adminAds.toast.loading", "Memuat daftar iklan..."), { duration: 2000 });
    
    try {
      const data = await fetchAllAdvertisements();
      // Convert backend Advertisement to AdItem
      const items: AdItem[] = data.map((ad: Advertisement) => ({
        id: ad.id,
        src: ad.src,
        type: ad.type as AdType,
        enabled: ad.enabled,
        display_order: ad.display_order,
        file_name: ad.file_name,
        file_size: ad.file_size,
        mime_type: ad.mime_type,
        title: ad.title,
        description: ad.description,
        created_at: ad.created_at,
        updated_at: ad.updated_at,
      }));
      // Sort by display_order
      items.sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
      setItems(items);
      toast.success(t("adminAds.toast.loaded", "✅ Berhasil memuat {count} iklan", { count: items.length }), { duration: 3000 });
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : "Failed to load advertisements list.";
      setError(error);
      toast.error(t("adminAds.toast.loadError", "❌ Gagal memuat daftar iklan: {error}", { error }), { duration: 5000 });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const save = async (silent?: boolean) => {
    try {
      if (!silent) {
        setSaving(true);
        toast.info(t("adminAds.toast.saving", "Menyimpan iklan..."), { duration: 2000 });
      }
      
      // Update enabled status and display_order for all items
      await Promise.all(
        items.map((item, index) => 
          updateAdvertisement(item.id, {
            enabled: item.enabled,
            display_order: index,
          })
        )
      );
      
      if (!silent) {
        const message = t("adminAds.toast.saved", "✅ Iklan berhasil disimpan. Halaman attendance akan menggunakan daftar ini setelah refresh.");
        toast.success(message, { duration: 3000 });
      }
    } catch (e: unknown) {
      console.error("[ADMIN_ADS] Save error:", e);
      if (!silent) {
        const message = e instanceof Error ? e.message : t("adminAds.toast.saveFailed", "❌ Gagal menyimpan iklan.");
        toast.error(message, { duration: 5000 });
      }
    } finally {
      if (!silent) {
        setSaving(false);
      }
    }
  };

  const move = async (idx: number, dir: -1 | 1) => {
    let targetIndex: number | null = null;
    let newItems: AdItem[] = [];
    
    setItems((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      const tmp = next[idx];
      next[idx] = next[j];
      next[j] = tmp;
      targetIndex = j;
      newItems = next;
      return next;
    });
    
    if (targetIndex !== null && newItems.length > 0) {
      setArrowAnimation({ index: targetIndex, direction: dir });
      
      // Update display_order di backend
      try {
        const orders = newItems.map((item, index) => ({
          id: item.id,
          display_order: index,
        }));
        await reorderAdvertisements(orders);
      } catch (e) {
        console.error("[ADMIN_ADS] Failed to reorder:", e);
        // Reload untuk sync dengan backend
        void load();
      }
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
        const orders = next.map((item, index) => ({
          id: item.id,
          display_order: index,
        }));
        void reorderAdvertisements(orders);
      } catch {}
      
      return next;
    });

    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const toggle = async (idx: number, val: boolean) => {
    const item = items[idx];
    if (!item) return;
    
    setItems((prev) => {
      return prev.map((it, i) => (i === idx ? { ...it, enabled: val } : it));
    });
    
    // Update enabled status di backend
    try {
      await updateAdvertisement(item.id, { enabled: val });
    } catch (e) {
      console.error("[ADMIN_ADS] Failed to update enabled status:", e);
      // Revert on error
      setItems((prev) => {
        return prev.map((it, i) => (i === idx ? { ...it, enabled: !val } : it));
      });
      toast.error(t("adminAds.toast.updateFailed", "❌ Gagal mengupdate status iklan"), { duration: 3000 });
    }
  };

  // Note: manual media import trigger removed from UI; keep input for potential future use

  const handleImportFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    toast.info(t("adminAds.toast.importing", "Mengimpor {count} file...", { count: files.length }), { duration: 2000 });
    
    try {
      const picked = Array.from(files).slice(0, 50); // safety limit
      const uploaded = await Promise.all(
        picked.map(async (file) => {
          const isImage = file.type.startsWith("image/");
          const isVideo = file.type.startsWith("video/");
          if (!isImage && !isVideo) {
            throw new Error(`File type not supported: ${file.type}`);
          }
          
          // Upload ke backend
          const ad = await uploadAdvertisement({
            file,
            enabled: true,
            display_order: items.length, // Add to end
          });
          
          return {
            id: ad.id,
            src: ad.src,
            type: ad.type as AdType,
            enabled: ad.enabled,
            display_order: ad.display_order,
            file_name: ad.file_name,
            file_size: ad.file_size,
            mime_type: ad.mime_type,
            title: ad.title,
            description: ad.description,
            created_at: ad.created_at,
            updated_at: ad.updated_at,
          } as AdItem;
        })
      );
      
      // Reload untuk sync dengan backend
      await load();
      
      toast.success(t("adminAds.toast.imported", "✅ Berhasil mengimpor {count} media iklan", { count: uploaded.length }), { duration: 3000 });
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
      
      // Find items by src (selected is array of src strings)
      const itemsToDelete = items.filter((it) => selected.includes(it.src));
      if (itemsToDelete.length === 0) return;
      
      const confirmed = await confirm({
        title: t("adminAds.confirm.delete.title", "Hapus Iklan"),
        description: t("adminAds.confirm.delete.descSelected", "Apakah Anda yakin ingin menghapus {count} iklan yang dipilih? Tindakan ini tidak dapat dibatalkan.", { count: itemsToDelete.length }),
        confirmText: t("adminAds.confirm.delete.confirm", "Hapus"),
        cancelText: t("adminAds.confirm.delete.cancel", "Batal"),
      });
      
      if (!confirmed) return;
      
      setDeleting(true);
      toast.info(t("adminAds.toast.deleting", "Menghapus {count} iklan...", { count: itemsToDelete.length }), { duration: 2000 });
      
      // Delete dari backend
      await Promise.all(
        itemsToDelete.map((item) => deleteAdvertisement(item.id))
      );
      
      // Reload untuk sync dengan backend
      await load();
      
      setSelected([]);
      
      // Reset to first page if current page is empty
      const newEffectivePerPage = perPage === "all" ? items.length - itemsToDelete.length : perPage;
      const newTotalPages = perPage === "all" ? 1 : Math.ceil((items.length - itemsToDelete.length) / newEffectivePerPage);
      if (currentPage > newTotalPages && newTotalPages > 0) {
        setCurrentPage(1);
      }
      
      toast.success(t("adminAds.toast.deletedSelected", "✅ {count} iklan berhasil dihapus", { count: itemsToDelete.length }), { duration: 3000 });
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

  const importFromJson = async (_file: File) => {
    try {
      // Import from JSON is deprecated - show warning and reload from backend
      toast.warn(t("adminAds.toast.importJsonDeprecated", "⚠️ Import JSON tidak didukung. Gunakan tombol Upload untuk menambah iklan baru."), { duration: 4000 });
      await load();
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
            <CardTitle>{t("pages.adminAdvertisement.title", "Kelola Iklan")}</CardTitle>
            <CardDescription>
              {t("pages.adminAdvertisement.subtitle", "Atur iklan yang ditampilkan pada halaman Absensi Fun Meter.")}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex items-center border rounded-md">
              <Button 
                variant={viewMode === 'grid' ? 'default' : 'ghost'} 
                size="icon"
                className="rounded-r-none"
                onClick={() => setViewMode('grid')}
                title={t("adminAds.view.grid", "Tampilan Grid")}
              >
                <Icon name="LayoutGrid" className="h-4 w-4" />
              </Button>
              <Button 
                variant={viewMode === 'list' ? 'default' : 'ghost'} 
                size="icon"
                className="rounded-l-none border-l"
                onClick={() => setViewMode('list')}
                title={t("adminAds.view.list", "Tampilan List")}
              >
                <Icon name="LayoutList" className="h-4 w-4" />
              </Button>
            </div>
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
              {items.length === 0 ? (
                <div className="text-sm text-muted-foreground p-6 text-center">
                  {t("adminAds.empty", "No advertisement media found.")}
                </div>
              ) : viewMode === 'list' ? (
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-3 font-medium w-12">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={paginatedItems.length > 0 && paginatedItems.every((it) => selected.includes(it.src))}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelected((prev) => [...new Set([...prev, ...paginatedItems.map((it) => it.src)])]);
                              } else {
                                const pageSrcs = new Set(paginatedItems.map((it) => it.src));
                                setSelected((prev) => prev.filter((s) => !pageSrcs.has(s)));
                              }
                            }}
                            aria-label="Select all"
                          />
                        </th>
                        <th className="text-left p-3 font-medium w-24">{t("adminAds.table.preview", "Preview")}</th>
                        <th className="text-left p-3 font-medium">{t("adminAds.table.fileName", "Nama File")}</th>
                        <th className="text-left p-3 font-medium w-20">{t("adminAds.table.type", "Jenis")}</th>
                        <th className="text-right p-3 font-medium w-24">{t("adminAds.table.size", "Ukuran")}</th>
                        <th className="text-center p-3 font-medium w-24 hidden md:table-cell">{t("adminAds.table.order", "Urutan")}</th>
                        <th className="text-center p-3 font-medium w-20">{t("adminAds.table.show", "Show")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedItems.map((it, localIdx) => {
                        const globalIdx = startIndex + localIdx;
                        const isSelected = selected.includes(it.src);
                        const isDragging = draggedIndex === globalIdx;
                        const isDragOver = dragOverIndex === globalIdx;
                        const isArrowAnimated = arrowAnimation?.index === globalIdx;
                        
                        return (
                          <tr 
                            key={it.id || it.src}
                            ref={(el) => {
                              if (el) {
                                itemRefs.current.set(it.id || it.src, el);
                              } else {
                                itemRefs.current.delete(it.id || it.src);
                              }
                            }}
                            draggable
                            onDragStart={(e) => handleDragStart(e, globalIdx)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => handleDragOver(e, globalIdx)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, globalIdx)}
                            className={`border-b last:border-0 transition-colors cursor-move ${
                              isSelected ? 'bg-muted/50' : ''
                            } ${
                              isDragging ? 'opacity-50' : ''
                            } ${
                              isDragOver ? 'bg-primary/10' : ''
                            } ${
                              isArrowAnimated ? 'bg-primary/20' : ''
                            } hover:bg-muted/30`}
                          >
                            <td className="p-3">
                              <input
                                type="checkbox"
                                className="h-4 w-4"
                                checked={isSelected}
                                onChange={(e) => {
                                  setSelected((prev) => e.target.checked ? [...prev, it.src] : prev.filter((s) => s !== it.src));
                                }}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={t("adminAds.fields.select", "Pilih iklan")}
                              />
                            </td>
                            <td className="p-3">
                              <div className="w-20 h-12 bg-muted flex items-center justify-center overflow-hidden rounded">
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
                            </td>
                            <td className="p-3">
                              <div className="text-sm font-medium truncate max-w-xs">
                                {it.title || it.file_name || it.src.split('/').pop() || 'Unknown'}
                              </div>
                            </td>
                            <td className="p-3">
                              <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${
                                it.type === 'image' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                              }`}>
                                {it.type.toUpperCase()}
                              </span>
                            </td>
                            <td className="p-3 text-right text-sm text-muted-foreground">
                              {it.file_size ? `${(it.file_size / 1024 / 1024).toFixed(2)} MB` : '-'}
                            </td>
                            <td className="p-3 hidden md:table-cell">
                              <div className="flex items-center justify-center gap-1">
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-8 w-8"
                                  onClick={(e) => { e.stopPropagation(); move(globalIdx, -1); }} 
                                  disabled={globalIdx === 0}
                                  title="Move up"
                                >
                                  ↑
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-8 w-8"
                                  onClick={(e) => { e.stopPropagation(); move(globalIdx, 1); }} 
                                  disabled={globalIdx === items.length - 1}
                                  title="Move down"
                                >
                                  ↓
                                </Button>
                              </div>
                            </td>
                            <td className="p-3">
                              <div className="flex items-center justify-center">
                                <input
                                  id={`ad-show-${globalIdx}`}
                                  type="checkbox"
                                  className="h-4 w-4"
                                  checked={!!it.enabled}
                                  onChange={(e) => { e.stopPropagation(); toggle(globalIdx, e.target.checked); }}
                                  onClick={(e) => e.stopPropagation()}
                                  title={it.enabled ? 'Hide' : 'Show'}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                /* Grid View */
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {paginatedItems.map((it, localIdx) => {
                    const globalIdx = startIndex + localIdx;
                    const isSelected = selected.includes(it.src);
                    const isDragging = draggedIndex === globalIdx;
                    const isDragOver = dragOverIndex === globalIdx;
                    const isArrowAnimated = arrowAnimation?.index === globalIdx;
                    
                    return (
                      <div 
                        key={it.id || it.src}
                        ref={(el) => {
                          if (el) {
                            itemRefs.current.set(it.id || it.src, el);
                          } else {
                            itemRefs.current.delete(it.id || it.src);
                          }
                        }}
                        draggable
                        onDragStart={(e) => handleDragStart(e, globalIdx)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOver(e, globalIdx)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, globalIdx)}
                        className={`rounded-lg border transition-all duration-300 cursor-move ${
                          isSelected ? 'ring-2 ring-primary bg-primary/5' : ''
                        } ${
                          isDragging ? 'opacity-50 scale-95' : ''
                        } ${
                          isDragOver ? 'border-primary border-2 bg-primary/10 scale-105 shadow-xl' : ''
                        } ${
                          isArrowAnimated ? 'ring-2 ring-primary shadow-lg bg-gradient-to-br from-primary/10 to-primary/5 scale-105' : ''
                        } hover:shadow-lg hover:border-primary/50 hover:scale-[1.02]`}
                        style={{
                          transition: isArrowAnimated 
                            ? 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)' 
                            : 'all 0.3s ease-in-out'
                        }}
                      >
                        {/* Card Header with Checkbox */}
                        <div className="p-3 border-b bg-muted/30 flex items-center justify-between">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={isSelected}
                            onChange={(e) => {
                              setSelected((prev) => e.target.checked ? [...prev, it.src] : prev.filter((s) => s !== it.src));
                            }}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={t("adminAds.fields.select", "Pilih iklan")}
                          />
                          <div className="flex items-center gap-1">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-7 w-7 hover:bg-primary/20 active:scale-90 transition-all"
                              onClick={(e) => { e.stopPropagation(); move(globalIdx, -1); }} 
                              disabled={globalIdx === 0}
                              title={t("adminAds.actions.moveLeft", "Pindah ke kiri")}
                            >
                              <span className="text-lg">←</span>
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-7 w-7 hover:bg-primary/20 active:scale-90 transition-all"
                              onClick={(e) => { e.stopPropagation(); move(globalIdx, 1); }} 
                              disabled={globalIdx === items.length - 1}
                              title={t("adminAds.actions.moveRight", "Pindah ke kanan")}
                            >
                              <span className="text-lg">→</span>
                            </Button>
                          </div>
                        </div>

                        {/* Preview */}
                        <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
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

                        {/* Card Footer with Info */}
                        <div className="p-3 space-y-2">
                          <div className="text-sm font-medium truncate" title={it.title || it.file_name || it.src}>
                            {it.title || it.file_name || it.src.split('/').pop() || 'Unknown'}
                          </div>
                          <div className="flex items-center justify-between">
                            <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${
                              it.type === 'image' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                            }`}>
                              {it.type.toUpperCase()}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {it.file_size ? `${(it.file_size / 1024 / 1024).toFixed(2)} MB` : '-'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between pt-2 border-t">
                            <Label htmlFor={`ad-grid-${globalIdx}`} className="text-xs font-medium">
                              {t("adminAds.fields.show", "Show")}
                            </Label>
                            <input
                              id={`ad-grid-${globalIdx}`}
                              type="checkbox"
                              className="h-4 w-4"
                              checked={!!it.enabled}
                              onChange={(e) => { e.stopPropagation(); toggle(globalIdx, e.target.checked); }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              
              
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
              <Button 
                onClick={() => save()} 
                disabled={loading || saving || !!error}
                title={t("common.save", "Save")}
                aria-label={t("common.save", "Save")}
              >
                {saving ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    <span className="ml-2 hidden lg:inline">
                      {t("adminAds.actions.saving", "Menyimpan...")}
                    </span>
                  </>
                ) : (
                  <>
                    <Icon name="Save" className="h-4 w-4" />
                    <span className="ml-2 hidden lg:inline">
                      {t("common.save", "Save")}
                    </span>
                  </>
                )}
              </Button>
              <Button 
                onClick={deleteSelected} 
                variant="destructive" 
                disabled={loading || deleting || !!error || selected.length === 0}
                title={t("common.delete", "Delete")}
                aria-label={t("common.delete", "Delete")}
              >
                {deleting ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    <span className="ml-2 hidden lg:inline">
                      {t("adminAds.actions.deleting", "Menghapus...")}
                    </span>
                  </>
                ) : (
                  <>
                    <Icon name="Trash2" className="h-4 w-4" />
                    <span className="ml-2 hidden lg:inline">
                      {t("common.delete", "Delete")}
                    </span>
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading || saving || !!error}
                title={t("common.upload", "Upload")}
                aria-label={t("common.upload", "Upload")}
              >
                <Icon name="Upload" className="h-4 w-4" />
                <span className="ml-2 hidden lg:inline">
                  {t("common.upload", "Upload")}
                </span>
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,.jpg,.jpeg,.png,.gif,.webp,.mp4,.webm,.ogg,.mov"
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


