// app/admin/list-members/page.tsx
// Port dari src-vue-original/pages/admin/AdminFaceDbPage.vue

"use client";

import React, { useState, useEffect } from "react";
import { useI18n } from "@/components/providers/I18nProvider";
import { useConfirmDialog } from "@/components/providers/ConfirmDialogProvider";
import { request, resolveApi } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/common/Icon";

interface FaceItem {
  id: string | number;
  label: string;
  person_id?: string;
  ts?: string; // timestamp ISO
  time?: string;
  timestamp?: string;
  created_at?: string;
  date?: string;
  photo_url?: string;
  photo_path?: string;
}

interface BulkUploadItem {
  id: string;
  file: File;
  name: string;
  label: string;
  status: "ready" | "uploading" | "ok" | "duplicate" | "err" | "skip";
  message: string;
  previewUrl: string;
}

export default function AdminListMembersPage() {
  const { t } = useI18n();
  const confirm = useConfirmDialog();
  const [items, setItems] = useState<FaceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalMembers, setTotalMembers] = useState(0);
  const [perPage, setPerPage] = useState<number | "all">(12);
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState<string>("");
  const [editingItem, setEditingItem] = useState<FaceItem | null>(null);
  const [editingReplaceFile, setEditingReplaceFile] = useState<File | null>(null);
  const [savingEdit, setSavingEdit] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<"table" | "grid">("grid");
  const editFileInputRef = React.useRef<HTMLInputElement>(null);
  
  // Bulk upload state
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkItems, setBulkItems] = useState<BulkUploadItem[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkForce, setBulkForce] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const bulkFileInputRef = React.useRef<HTMLInputElement>(null);


  // ESC key handler for edit label modal
  React.useEffect(() => {
    if (!editingId) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !savingEdit) {
        cancelEditLabel();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [editingId, savingEdit]);

  // ESC key handler for bulk upload modal
  React.useEffect(() => {
    if (!bulkModalOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !bulkRunning) {
        // Revoke preview URLs
        bulkItems.forEach(item => {
          if (item.previewUrl.startsWith("blob:")) {
            URL.revokeObjectURL(item.previewUrl);
          }
        });
        setBulkModalOpen(false);
        setBulkItems([]);
        setBulkForce(false);
        setBulkProgress({ done: 0, total: 0 });
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [bulkModalOpen, bulkRunning, bulkItems]);

  // Fetch members data
  const fetchMembers = async (page = 1, search = "", sortOrder?: "asc" | "desc", itemsPerPage?: number | "all") => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set("page", String(page));
      const currentPerPage = itemsPerPage !== undefined ? itemsPerPage : perPage;
      if (currentPerPage === "all") {
        params.set("per_page", "9999"); // Set large number for "all"
      } else {
        params.set("per_page", String(currentPerPage));
      }
      params.set("order", sortOrder || order);  // Use passed sortOrder or current state
      if (search.trim()) params.set("q", search.trim());
      const response = await request<{
        items: FaceItem[];
        meta?: { page?: number; total_pages?: number; total?: number; per_page?: number; order?: string };
      }>(`/register-db-data?${params.toString()}`);

      setItems(response.items || []);
      setCurrentPage(response.meta?.page || page);
      // If "all" is selected, set totalPages to 1 since all items are on one page
      if (currentPerPage === "all") {
        setTotalPages(1);
      } else {
      setTotalPages(response.meta?.total_pages || 1);
      }
      setTotalMembers(response.meta?.total || (response.items?.length || 0));
    } catch (error) {
      toast.error(t("adminListMembers.toast.fetchError", "Gagal memuat data anggota"));
    } finally {
      setLoading(false);
    }
  };

  const startEditLabel = (row: FaceItem) => {
    setEditingId(String(row.id));
    setEditingLabel(row.label || "");
    setEditingItem(row);
    setEditingReplaceFile(null);
  };

  const cancelEditLabel = () => {
    setEditingId(null);
    setEditingLabel("");
    setEditingItem(null);
    setEditingReplaceFile(null);
    setSavingEdit(false);
  };

  const handleEditFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setEditingReplaceFile(file);
  };

  const saveEditLabel = async () => {
    if (!editingId || !editingItem) return;
    const newLabel = editingLabel.trim();
    if (!newLabel) {
      toast.warn(t("adminListMembers.edit.empty", "Label tidak boleh kosong"));
      return;
    }
    
    try {
      setSavingEdit(true);
      
      // Save label if changed
      if (newLabel !== editingItem.label) {
      await request(`http://localhost:8000/admin/register-db/item/${editingId}`, {
        method: "PUT",
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('api_key') || ''}`,
          'Content-Type': 'application/json'
        },
        body: { label: newLabel },
      });
      }
      
      // Replace photo if file selected
      if (editingReplaceFile) {
      const formData = new FormData();
        formData.append('label', newLabel);
        formData.append('file', editingReplaceFile);
      formData.append('force', '1');
      
      await request('http://localhost:8000/register-face', {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('api_key') || ''}`
        }
      });
      }
      
      toast.success(t("adminListMembers.edit.success", "Data berhasil diperbarui."));
      cancelEditLabel();
      fetchMembers(currentPage, searchQuery);
    } catch (error: any) {
      const msg = error?.message || error?.data?.message || "Gagal menyimpan";
      toast.error(t("adminListMembers.edit.error", "Gagal menyimpan: {msg}", { msg }));
      setSavingEdit(false);
    }
  };


  // Delete member
  const deleteMember = async (memberId: string, memberName: string) => {
    const confirmed = await confirm({
      title: t("adminListMembers.confirm.delete.title", "Hapus Anggota"),
      description: t("adminListMembers.confirm.delete.desc", "Apakah Anda yakin ingin menghapus {name}? Tindakan ini tidak dapat dibatalkan.", { name: memberName }),
      confirmText: t("adminListMembers.confirm.delete.confirm", "Hapus"),
      cancelText: t("adminListMembers.confirm.delete.cancel", "Batal"),
    });

    if (!confirmed) return;

    try {
      console.log("[DELETE] Deleting member ID:", memberId);
      // Backend endpoint: /admin/register-db/item/{item_id}?delete_photo=1
      await request(`http://localhost:8000/admin/register-db/item/${memberId}?delete_photo=1`, { 
        method: "DELETE",
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('api_key') || ''}`
        }
      });
      toast.success(t("adminListMembers.toast.deleteSuccess", "Anggota berhasil dihapus: {name}", { name: memberName }));
      console.log("[DELETE] Success! Refreshing list...");
      fetchMembers(currentPage, searchQuery);
    } catch (error: any) {
      console.error("[DELETE] Error:", error);
      const errorMsg = error?.message || error?.data?.message || "Unknown error";
      toast.error(t("adminListMembers.toast.deleteError", "Gagal menghapus anggota: {error}", { error: errorMsg }));
    }
  };

  // Delete multiple members
  const deleteSelectedMembers = async () => {
    if (selectedMembers.length === 0) {
      toast.info(t("adminListMembers.toast.noSelection", "Tidak ada anggota yang dipilih"));
      return;
    }

    const confirmed = await confirm({
      title: t("adminListMembers.confirm.deleteMultiple.title", "Hapus Beberapa Anggota"),
      description: t("adminListMembers.confirm.deleteMultiple.desc", "Apakah Anda yakin ingin menghapus {count} anggota yang dipilih?", { count: selectedMembers.length }),
      confirmText: t("adminListMembers.confirm.deleteMultiple.confirm", "Hapus Semua"),
      cancelText: t("adminListMembers.confirm.deleteMultiple.cancel", "Batal"),
    });

    if (!confirmed) return;

    try {
      console.log("[BULK_DELETE] Deleting members:", selectedMembers);
      await request("http://localhost:8000/admin/register-db/bulk", {
        method: "POST",
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('api_key') || ''}`,
          'Content-Type': 'application/json'
        },
        body: { 
          action: "delete",
          ids: selectedMembers.map(id => parseInt(id)),
          delete_photo: true
        },
      });
      toast.success(t("adminListMembers.toast.deleteMultipleSuccess", "{count} anggota berhasil dihapus", { count: selectedMembers.length }));
      console.log("[BULK_DELETE] Success! Clearing selection and refreshing...");
      setSelectedMembers([]);
      fetchMembers(currentPage, searchQuery);
    } catch (error: any) {
      console.error("[BULK_DELETE] Error:", error);
      const errorMsg = error?.message || error?.data?.message || "Unknown error";
      toast.error(t("adminListMembers.toast.deleteMultipleError", "Gagal menghapus anggota: {error}", { error: errorMsg }));
    }
  };

  // Export selected members
  const exportSelectedMembers = async () => {
    if (selectedMembers.length === 0) {
      toast.info(t("adminListMembers.toast.noSelection", "Tidak ada anggota yang dipilih"));
      return;
    }

    try {
      console.log("[EXPORT] Exporting members:", selectedMembers);
      const response = await fetch("http://localhost:8000/admin/register-db/bulk", {
        method: "POST",
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('api_key') || ''}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          action: "export",
          ids: selectedMembers.map(id => parseInt(id))
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      if (!blob || blob.size === 0) {
        toast.warn(t("adminListMembers.toast.exportEmpty", "Tidak ada foto yang bisa diekspor"));
        return;
      }

      // Extract filename from Content-Disposition header
      const disposition = response.headers.get("content-disposition") || "";
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const filename = match ? match[1] : `register_export_${Date.now()}.zip`;

      // Download file
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      toast.success(t("adminListMembers.toast.exportSuccess", "Export selesai: {filename}", { filename }));
      console.log("[EXPORT] Success! Downloaded:", filename);
    } catch (error: any) {
      console.error("[EXPORT] Error:", error);
      const errorMsg = error?.message || "Unknown error";
      toast.error(t("adminListMembers.toast.exportError", "Gagal export: {error}", { error: errorMsg }));
    }
  };

  // Bulk upload functions
  const openBulkUploadModal = () => {
    setBulkModalOpen(true);
    setBulkItems([]);
    setBulkForce(false);
    setBulkProgress({ done: 0, total: 0 });
  };

  const closeBulkUploadModal = () => {
    // Revoke preview URLs
    bulkItems.forEach(item => {
      if (item.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(item.previewUrl);
      }
    });
    setBulkModalOpen(false);
    setBulkItems([]);
    setBulkForce(false);
    setBulkProgress({ done: 0, total: 0 });
  };

  const handleBulkFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const newItems: BulkUploadItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith("image/")) {
        toast.warn(t("adminListMembers.toast.fileNotImage", "{name} bukan gambar, dilewati", { name: file.name }));
        continue;
      }

      const id = `${Date.now()}-${Math.random().toString(36)}`;
      const label = file.name.replace(/\.[^.]+$/, ""); // Remove extension
      const previewUrl = URL.createObjectURL(file);

      newItems.push({
        id,
        file,
        name: file.name,
        label,
        status: "ready",
        message: t("adminListMembers.bulk.statusReady", "Siap diunggah"),
        previewUrl,
      });
    }

    setBulkItems(prev => [...prev, ...newItems]);
    setBulkProgress({ done: 0, total: bulkItems.length + newItems.length });
    
    // Reset file input
    if (event.target) event.target.value = "";
  };

  const removeBulkItem = (id: string) => {
    setBulkItems(prev => {
      const item = prev.find(it => it.id === id);
      if (item && item.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(item.previewUrl);
      }
      return prev.filter(it => it.id !== id);
    });
  };

  const updateBulkItemLabel = (id: string, label: string) => {
    setBulkItems(prev => prev.map(item => 
      item.id === id ? { ...item, label } : item
    ));
  };

  const startBulkUpload = async () => {
    if (bulkItems.length === 0) {
      toast.info(t("adminListMembers.toast.noBulkItems", "Tidak ada file yang dipilih"));
      return;
    }

    setBulkRunning(true);
    setBulkProgress({ done: 0, total: bulkItems.length });

    let successCount = 0;
    let errorCount = 0;
    let duplicateCount = 0;
    let skipCount = 0;

    for (let i = 0; i < bulkItems.length; i++) {
      const item = bulkItems[i];
      const label = item.label.trim();

      if (!label) {
        setBulkItems(prev => prev.map(it => 
          it.id === item.id 
            ? { ...it, status: "skip", message: t("adminListMembers.bulk.labelEmpty", "Label kosong, dilewati") }
            : it
        ));
        skipCount++;
        setBulkProgress({ done: i + 1, total: bulkItems.length });
        continue;
      }

      // Update status to uploading
      setBulkItems(prev => prev.map(it => 
        it.id === item.id 
          ? { ...it, status: "uploading", message: t("adminListMembers.bulk.uploading", "Mengunggah...") }
          : it
      ));

      try {
        const formData = new FormData();
        formData.append("label", label);
        formData.append("file", item.file);
        formData.append("force", bulkForce ? "1" : "0");

        const response = await fetch("http://localhost:8000/register-face", {
          method: "POST",
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('api_key') || ''}`
          },
          body: formData,
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw { status: response.status, message: error.message || `HTTP ${response.status}` };
        }

        const result = await response.json();
        setBulkItems(prev => prev.map(it => 
          it.id === item.id 
            ? { 
                ...it, 
                status: "ok", 
                message: t("adminListMembers.bulk.success", "Berhasil: {label}", { label: result.label || label }),
                label: result.label || label
              }
            : it
        ));
        successCount++;

        // Small delay to avoid overwhelming server
        await new Promise(resolve => setTimeout(resolve, 400));
      } catch (error: any) {
        const errorMsg = error?.message || "Upload gagal";
        
        if (error?.status === 409 || errorMsg.includes("409")) {
          setBulkItems(prev => prev.map(it => 
            it.id === item.id 
              ? { ...it, status: "duplicate", message: t("adminListMembers.bulk.duplicate", "Duplikat: {msg}", { msg: errorMsg }) }
              : it
          ));
          duplicateCount++;
        } else {
          setBulkItems(prev => prev.map(it => 
            it.id === item.id 
              ? { ...it, status: "err", message: t("adminListMembers.bulk.error", "Error: {msg}", { msg: errorMsg }) }
              : it
          ));
          errorCount++;
        }
      }

      setBulkProgress({ done: i + 1, total: bulkItems.length });
    }

    setBulkRunning(false);
    
    const summaryParts = [];
    if (successCount > 0) summaryParts.push(t("adminListMembers.bulk.summarySuccess", "Sukses: {count}", { count: successCount }));
    if (duplicateCount > 0) summaryParts.push(t("adminListMembers.bulk.summaryDuplicate", "Duplikat: {count}", { count: duplicateCount }));
    if (errorCount > 0) summaryParts.push(t("adminListMembers.bulk.summaryError", "Gagal: {count}", { count: errorCount }));
    if (skipCount > 0) summaryParts.push(t("adminListMembers.bulk.summarySkip", "Lewati: {count}", { count: skipCount }));
    
    toast.success(t("adminListMembers.bulk.completed", "Selesai. {summary}", { summary: summaryParts.join(", ") }));
    
    // Refresh data
    fetchMembers(currentPage, searchQuery);
  };

  // Toggle member selection
  const toggleMemberSelection = (memberId: string) => {
    setSelectedMembers(prev => 
      prev.includes(memberId) 
        ? prev.filter(id => id !== memberId)
        : [...prev, memberId]
    );
  };

  // Select all members
  const toggleSelectAll = () => {
    if (selectedMembers.length === items.length) {
      setSelectedMembers([]);
    } else {
      setSelectedMembers(items.map(m => String(m.id)));
    }
  };

  // Search members
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setCurrentPage(1);
    fetchMembers(1, query);
  };

  useEffect(() => {
    fetchMembers();
  }, []);

  const photoUrl = (row: FaceItem): string => {
    const p = row.photo_url || row.photo_path || "";
    if (!p) return "";
    const s = String(p).replace(/\\/g, "/");
    return /^https?:\/\//i.test(s) ? s : resolveApi(s.replace(/^\/+/, ""));
  };
  const rowTs = (row: FaceItem): string => {
    const s = row.ts || row.time || row.timestamp || row.created_at || row.date || "";
    if (!s) return "-";
    const d = new Date(String(s).replace(" ", "T"));
    if (Number.isNaN(d.getTime())) return String(s);
    return d.toLocaleString("id-ID");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground">
            {t("adminListMembers.subtitle", "Kelola database wajah anggota ({total} anggota)", { total: totalMembers })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => fetchMembers(currentPage, searchQuery)} variant="outline" size="sm">
            <Icon name="RefreshCw" className="h-4 w-4 mr-2" />
            {t("adminListMembers.actions.refresh", "Refresh")}
          </Button>
          {/* <Button variant="default" size="sm">
            <Icon name="UserPlus" className="h-4 w-4 mr-2" />
            {t("adminListMembers.actions.addMember", "Tambah Anggota")}
          </Button> */}
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 max-w-md">
          <div className="relative">
            <Icon name="Search" className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={t("adminListMembers.search.placeholder", "Search labels…")}
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-md"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* View switch */}
          <div className="hidden md:flex items-center gap-1 mr-2">
            <Button variant={viewMode==="grid"?"default":"outline"} size="sm" onClick={() => setViewMode("grid")}>Grid</Button>
            <Button variant={viewMode==="table"?"default":"outline"} size="sm" onClick={() => setViewMode("table")}>List</Button>
          </div>
          <select
            className="h-9 rounded-md border px-2 text-sm"
            value={perPage}
            onChange={(e) => { 
              const value = e.target.value;
              const newPerPage = value === "all" ? "all" : Number(value);
              setPerPage(newPerPage); 
              fetchMembers(1, searchQuery, undefined, newPerPage);  // Pass new perPage value directly
            }}
          >
            <option value={12}>12</option>
            <option value={22}>22</option>
            <option value={52}>52</option>
            <option value="all">{t("adminListMembers.perPage.all", "Semua")}</option>
          </select>
          <select
            className="h-9 rounded-md border px-2 text-sm"
            value={order}
            onChange={(e) => { 
              const newOrder = e.target.value as "asc" | "desc";
              setOrder(newOrder); 
              fetchMembers(1, searchQuery, newOrder);  // Pass new order value directly
            }}
          >
            <option value="desc">{t("adminListMembers.order.newest", "Newest")}</option>
            <option value="asc">{t("adminListMembers.order.oldest", "Oldest")}</option>
          </select>
          <Button onClick={openBulkUploadModal} variant="outline" size="sm">
            <Icon name="Upload" className="h-4 w-4 mr-2" />
            {t("adminListMembers.actions.bulkUpload", "Bulk Upload")}
          </Button>
          <Button onClick={deleteSelectedMembers} variant="destructive" size="sm" disabled={selectedMembers.length===0}>
            <Icon name="Trash2" className="h-4 w-4 mr-2" />
            {t("adminListMembers.actions.deleteSelected", "Delete")}
          </Button>
          <Button onClick={exportSelectedMembers} variant="outline" size="sm" disabled={selectedMembers.length===0}>
            <Icon name="FileArchive" className="h-4 w-4 mr-2" />
            {t("adminListMembers.actions.export", "Ekspor")}
          </Button>
        </div>
      </div>

      {/* Members Table / Grid */}
      {viewMode === "table" ? (
      <div className="border rounded-lg max-h-[70vh] overflow-auto">
        <div className="min-w-full">
          <table className="w-full">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="w-12 p-4">
                  <input
                    type="checkbox"
                    checked={selectedMembers.length === items.length && items.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded"
                  />
                </th>
                <th className="text-left p-4 font-medium">{t("adminListMembers.table.label", "Label")}</th>
                <th className="text-left p-4 font-medium">{t("adminListMembers.table.photo", "Photo")}</th>
                <th className="text-left p-4 font-medium">{t("adminListMembers.table.timestamp", "Timestamp")}</th>
                <th className="text-left p-4 font-medium">
                  {t("adminListMembers.table.actions", "Aksi")}
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center">
                    <Icon name="Loader2" className="h-6 w-6 animate-spin mx-auto" />
                  </td>
                </tr>
              ) : items.length > 0 ? (
                items.map((row) => (
                  <tr key={String(row.id)} className="border-b hover:bg-muted/50 align-top">
                    <td className="p-4">
                      <input
                        type="checkbox"
                        checked={selectedMembers.includes(String(row.id))}
                        onChange={() => toggleMemberSelection(String(row.id))}
                        className="rounded"
                      />
                    </td>
                    <td className="p-4">
                      <div className="space-y-1">
                        <div className="font-medium">{row.label}</div>
                        <div className="text-xs text-muted-foreground">{t("common.idLabel", "ID:")} {String(row.id)}</div>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        {photoUrl(row) ? (
                          <img src={photoUrl(row)} alt={row.label} className="h-16 w-16 rounded-md object-cover border" />
                        ) : (
                          <div className="h-16 w-16 rounded-md bg-muted" />
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-sm whitespace-nowrap">{rowTs(row)}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => startEditLabel(row)}
                        >
                          <Icon name="Pencil" className="h-4 w-4 mr-2" />
                          {t("adminListMembers.actions.edit", "Edit")}
                        </Button>
                      <Button 
                        variant="destructive" 
                        size="sm"
                        onClick={() => deleteMember(String(row.id), row.label)}
                      >
                        <Icon name="Trash2" className="h-4 w-4 mr-2" />
                        {t("adminListMembers.actions.delete", "Delete")}
                      </Button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    <Icon name="Users" className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>{t("adminListMembers.table.empty", "Belum ada anggota terdaftar")}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between p-4 border-t">
            <div className="text-sm text-muted-foreground">
              {t("adminListMembers.pagination.info", "Menampilkan {start}-{end} dari {total} anggota", {
                start: perPage === "all" ? 1 : (currentPage - 1) * perPage + 1,
                end: perPage === "all" ? totalMembers : Math.min(currentPage * perPage, totalMembers),
                total: totalMembers,
              })}
            </div>
            
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchMembers(currentPage - 1, searchQuery)}
                disabled={currentPage <= 1}
              >
                {t("adminListMembers.pagination.previous", "Sebelumnya")}
              </Button>
              
              <span className="text-sm">
                {t("adminListMembers.pagination.current", "Halaman {page} dari {total}", {
                  page: currentPage,
                  total: totalPages,
                })}
              </span>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchMembers(currentPage + 1, searchQuery)}
                disabled={currentPage >= totalPages}
              >
                {t("adminListMembers.pagination.next", "Selanjutnya")}
              </Button>
            </div>
          </div>
        )}
      </div>
      ) : (
        <div className="border rounded-lg max-h-[70vh] overflow-auto">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 p-4">
          {loading ? (
            <div className="col-span-full p-8 text-center">
              <Icon name="Loader2" className="h-6 w-6 animate-spin mx-auto" />
            </div>
          ) : items.length > 0 ? (
            items.map((row) => (
              <div key={String(row.id)} className="border rounded-lg overflow-hidden bg-card">
                <div className="flex items-center gap-3 p-4 border-b">
                  <input
                    type="checkbox"
                    checked={selectedMembers.includes(String(row.id))}
                    onChange={() => toggleMemberSelection(String(row.id))}
                    className="rounded"
                  />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{row.label}</div>
                    <div className="text-xs text-muted-foreground truncate">ID: {String(row.id)} • {rowTs(row)}</div>
                  </div>
                </div>
                <div className="p-4">
                  <div className="flex items-center gap-3">
                    {photoUrl(row) ? (
                      <img src={photoUrl(row)} alt={row.label} className="h-16 w-16 rounded-md object-cover border" />
                    ) : (
                      <div className="h-16 w-16 rounded-md bg-muted" />
                    )}
                    <div className="flex flex-col items-start gap-2">
                      <button
                        onClick={() => startEditLabel(row)}
                          title={t("adminListMembers.actions.edit", "Edit")}
                          aria-label={t("adminListMembers.actions.edit", "Edit")}
                          className="flex items-center gap-2 p-2 rounded hover:bg-muted text-blue-600"
                      >
                        <Icon name="Pencil" className="h-4 w-4" />
                          <span className="text-xs">{t("adminListMembers.grid.edit", "Edit")}</span>
                      </button>
                      <button
                          onClick={() => deleteMember(String(row.id), row.label)}
                          title={t("adminListMembers.actions.delete", "Delete")}
                          aria-label={t("adminListMembers.actions.delete", "Delete")}
                          className="flex items-center gap-2 p-2 rounded hover:bg-muted text-red-600"
                        >
                          <Icon name="Trash2" className="h-4 w-4" />
                          <span className="text-xs">{t("adminListMembers.actions.delete", "Delete")}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full p-8 text-center text-muted-foreground">
              <Icon name="Users" className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>{t("adminListMembers.table.empty", "Belum ada anggota terdaftar")}</p>
            </div>
          )}
          </div>
        </div>
      )}

      {/* Pagination for Grid View */}
      {viewMode === "grid" && (perPage === "all" || totalPages > 1) && (
        <div className="flex items-center justify-between p-4 border-t bg-muted/30">
          <div className="text-sm text-muted-foreground">
              {perPage === "all" ? (
                t("adminListMembers.pagination.infoAll", "Menampilkan semua {total} anggota", { total: totalMembers })
              ) : (
                t("adminListMembers.pagination.info", "Menampilkan {start}-{end} dari {total} anggota", {
                  start: (currentPage - 1) * perPage + 1,
                  end: Math.min(currentPage * perPage, totalMembers),
                  total: totalMembers,
                })
              )}
          </div>
          
          {perPage !== "all" && (
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchMembers(currentPage - 1, searchQuery)}
                disabled={currentPage <= 1}
              >
                {t("adminListMembers.pagination.previous", "Sebelumnya")}
              </Button>
              
              <span className="text-sm text-muted-foreground">
                {t("adminListMembers.pagination.current", "Halaman {page} dari {total}", {
                  page: currentPage,
                  total: totalPages,
                })}
              </span>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchMembers(currentPage + 1, searchQuery)}
                disabled={currentPage >= totalPages}
              >
                {t("adminListMembers.pagination.next", "Selanjutnya")}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Edit Modal */}
      {editingId && editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div>
                <h2 className="text-xl font-semibold">{t("adminListMembers.edit.modalTitle", "Edit")}</h2>
                <p className="text-sm text-muted-foreground">
                  {t("adminListMembers.edit.modalSubtitle", "Ubah data anggota")}
                </p>
              </div>
              <button
                onClick={cancelEditLabel}
                disabled={savingEdit}
                className="text-muted-foreground hover:text-foreground"
              >
                <Icon name="X" className="h-5 w-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Label Input */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  {t("adminListMembers.table.label", "Label")}
                </label>
                <input
                  type="text"
                  value={editingLabel}
                  onChange={(e) => setEditingLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (!savingEdit) saveEditLabel();
                    }
                  }}
                  className="w-full px-3 py-2 border rounded-lg bg-background border-border"
                  autoFocus
                  disabled={savingEdit}
                />
              </div>

              {/* Photo Section */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  {t("adminListMembers.edit.photo", "Foto")}
                </label>
                
              {/* Current Photo Preview */}
                <div className="flex items-center gap-4 mb-4">
                  {photoUrl(editingItem) ? (
                    <img src={photoUrl(editingItem)} alt={editingItem.label} className="h-32 w-32 rounded-md object-cover border" />
                ) : (
                  <div className="h-32 w-32 rounded-md bg-muted flex items-center justify-center">
                    <Icon name="User" className="h-12 w-12 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1">
                    <p className="text-sm font-medium mb-2">{t("adminListMembers.edit.currentPhoto", "Foto saat ini")}</p>
                    <p className="text-xs text-muted-foreground">{t("adminListMembers.edit.photoHint", "Pilih foto baru untuk mengganti foto saat ini")}</p>
                </div>
              </div>

              {/* File Drop Zone */}
              <div 
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition"
                  onClick={() => editFileInputRef.current?.click()}
              >
                <input
                    ref={editFileInputRef}
                  type="file"
                  accept="image/*"
                    onChange={handleEditFileSelect}
                  className="hidden"
                    disabled={savingEdit}
                />
                <Icon name="Upload" className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
                  {editingReplaceFile ? (
                  <div className="space-y-2">
                      <p className="text-sm font-medium">{editingReplaceFile.name}</p>
                      <p className="text-xs text-muted-foreground">{(editingReplaceFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                      {t("adminListMembers.edit.dragDrop", "Tarik & letakkan foto ke sini atau klik untuk memilih")}
                  </p>
                )}
              </div>

              {/* Action Buttons */}
                <div className="flex items-center gap-3 mt-4">
                <Button
                    onClick={() => editFileInputRef.current?.click()}
                    disabled={savingEdit}
                  variant="outline"
                  className="flex-1"
                >
                  <Icon name="FileImage" className="h-4 w-4 mr-2" />
                    {t("adminListMembers.edit.chooseFile", "Pilih File")}
                </Button>
                  {editingReplaceFile && (
                <Button
                      onClick={() => setEditingReplaceFile(null)}
                      disabled={savingEdit}
                  variant="outline"
                      size="sm"
                >
                      <Icon name="X" className="h-4 w-4 mr-2" />
                      {t("common.clear", "Clear")}
                </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
              <Button
                variant="outline"
                onClick={cancelEditLabel}
                disabled={savingEdit}
              >
                {t("common.cancel", "Cancel")}
              </Button>
              <Button
                onClick={saveEditLabel}
                disabled={savingEdit || !editingLabel.trim()}
              >
                {savingEdit ? (
                  <>
                    <Icon name="Loader2" className="h-4 w-4 mr-2 animate-spin" />
                    {t("adminListMembers.edit.saving", "Menyimpan...")}
                  </>
                ) : (
                  t("common.save", "Save")
                )}
              </Button>
            </div>
          </div>
        </div>
      )}


      {/* Bulk Upload Modal */}
      {bulkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col border">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b">
              <div>
                <h2 className="text-xl font-semibold">{t("adminListMembers.bulk.title", "Bulk Upload")}</h2>
                <p className="text-sm text-muted-foreground">
                  {t("adminListMembers.bulk.description", "Upload banyak foto sekaligus")}
                </p>
              </div>
              <button
                onClick={closeBulkUploadModal}
                disabled={bulkRunning}
                className="text-muted-foreground hover:text-foreground"
              >
                <Icon name="X" className="h-5 w-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* File Input */}
              <div className="border-2 border-dashed rounded-lg p-8 text-center border-border hover:border-primary transition">
                <input
                  ref={bulkFileInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleBulkFileSelect}
                  className="hidden"
                  disabled={bulkRunning}
                />
                <Button
                  onClick={() => bulkFileInputRef.current?.click()}
                  disabled={bulkRunning}
                  variant="outline"
                >
                  <Icon name="Upload" className="h-4 w-4 mr-2" />
                  {t("adminListMembers.bulk.selectFiles", "Pilih File")}
                </Button>
                <p className="text-sm text-muted-foreground mt-2">
                  {t("adminListMembers.bulk.hint", "Pilih satu atau lebih file gambar")}
                </p>
              </div>

              {/* Force Upload Checkbox */}
              {bulkItems.length > 0 && (
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={bulkForce}
                    onChange={(e) => setBulkForce(e.target.checked)}
                    disabled={bulkRunning}
                    className="rounded"
                  />
                  <span className="text-sm">
                    {t("adminListMembers.bulk.forceUpload", "Upload paksa (override duplikat)")}
                  </span>
                </label>
              )}

              {/* Progress */}
              {bulkRunning && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>{t("adminListMembers.bulk.uploading", "Mengunggah...")}</span>
                    <span>{bulkProgress.done} / {bulkProgress.total}</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div 
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Items List */}
              {bulkItems.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm">
                    {t("adminListMembers.bulk.files", "File ({count})", { count: bulkItems.length })}
                  </h3>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {bulkItems.map((item) => (
                      <div 
                        key={item.id} 
                        className={`flex items-center gap-4 p-3 border rounded-lg ${
                          item.status === "ok" ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800" :
                          item.status === "err" ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800" :
                          item.status === "duplicate" ? "bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800" :
                          item.status === "uploading" ? "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800" :
                          "bg-card border-border"
                        }`}
                      >
                        {/* Preview */}
                        <img 
                          src={item.previewUrl} 
                          alt={item.name}
                          className="w-16 h-16 object-cover rounded border"
                        />

                        {/* Label Input */}
                        <div className="flex-1 space-y-1">
                          <input
                            type="text"
                            value={item.label}
                            onChange={(e) => updateBulkItemLabel(item.id, e.target.value)}
                            disabled={bulkRunning || item.status === "ok"}
                            className="w-full px-2 py-1 text-sm border rounded bg-background border-border"
                            placeholder="Label"
                          />
                          <p className={`text-xs ${
                            item.status === "ok" ? "text-green-600 dark:text-green-400" :
                            item.status === "err" ? "text-red-600 dark:text-red-400" :
                            item.status === "duplicate" ? "text-yellow-600 dark:text-yellow-400" :
                            item.status === "uploading" ? "text-blue-600 dark:text-blue-400" :
                            "text-muted-foreground"
                          }`}>
                            {item.message}
                          </p>
                        </div>

                        {/* Status Icon */}
                        <div className="text-center w-8">
                          {item.status === "ok" && <Icon name="CheckCircle2" className="h-5 w-5 text-green-600 dark:text-green-400" />}
                          {item.status === "err" && <Icon name="XCircle" className="h-5 w-5 text-red-600 dark:text-red-400" />}
                          {item.status === "duplicate" && <Icon name="AlertCircle" className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />}
                          {item.status === "uploading" && <Icon name="Loader2" className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-spin" />}
                        </div>

                        {/* Remove Button */}
                        {!bulkRunning && item.status !== "uploading" && (
                          <button
                            onClick={() => removeBulkItem(item.id)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Icon name="Trash2" className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {bulkItems.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">
                  {t("adminListMembers.bulk.empty", "Belum ada file yang dipilih")}
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between p-6 border-t border-border">
              <div className="text-sm text-muted-foreground">
                {bulkItems.length > 0 && (
                  <span>
                    {t("adminListMembers.bulk.totalFiles", "{count} file siap diupload", { count: bulkItems.length })}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={closeBulkUploadModal}
                  variant="outline"
                  disabled={bulkRunning}
                >
                  {t("adminListMembers.bulk.cancel", "Tutup")}
                </Button>
                <Button
                  onClick={startBulkUpload}
                  disabled={bulkItems.length === 0 || bulkRunning}
                >
                  {bulkRunning ? (
                    <>
                      <Icon name="Loader2" className="h-4 w-4 mr-2 animate-spin" />
                      {t("adminListMembers.bulk.uploading", "Mengunggah...")}
                    </>
                  ) : (
                    <>
                      <Icon name="Upload" className="h-4 w-4 mr-2" />
                      {t("adminListMembers.bulk.start", "Mulai Upload")}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
