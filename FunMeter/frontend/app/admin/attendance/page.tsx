// app/admin/attendance/page.tsx
// Migrasi dari src-vue-original/pages/admin/AdminAttendancePage.vue (UI identik)

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/components/providers/I18nProvider";
import { request } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/common/Icon";
import { Pagination } from "@/components/common/Pagination";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface AttendanceMember {
  id: string;
  name: string;
  avatar?: string;
}

interface AttendanceSchedule {
  label: string;
  preset?: "workday" | "halfday" | "evening" | "wfh" | "off";
  overridden?: boolean;
}

interface AttendanceLog {
  id: string;
  // Backend shape (Vue original):
  person_id?: string;
  label?: string;
  // Local nested member (mock compatibility):
  member?: AttendanceMember;
  date: string; // YYYY-MM-DD
  check_in: string | null; // ISO timestamp or null
  check_out: string | null; // ISO timestamp or null
  schedule: AttendanceSchedule;
  status: "present" | "late" | "left_early" | "late_left_early" | "off";
  has_override: boolean;
}

interface AttendanceMeta { page: number; total_pages: number; total: number; per_page: number; order?: "asc" | "desc" }

interface ScheduleDetail {
  check_in?: string | null;
  check_out?: string | null;
  grace_in_min?: number;
  grace_out_min?: number;
  day?: string;
  [key: string]: unknown;
}

interface RawAttendanceRow {
  id?: string | number;
  person_id?: string | number;
  label?: string;
  date?: string;
  check_in?: string | null;
  check_out?: string | null;
  schedule?: string;
  schedule_detail?: ScheduleDetail;
  status?: string;
  schedule_override?: unknown;
  schedule_source?: string;
  [key: string]: unknown;
}

interface AttendanceResponse { items: RawAttendanceRow[]; meta: Partial<AttendanceMeta> }

interface AttendanceFilters {
  search?: string;
  status?: string;
  per_page?: number;
  order?: "asc" | "desc";
  date_from?: string;
  date_to?: string;
}

export default function AdminAttendancePage() {
  const { t, locale } = useI18n();
  
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<AttendanceFilters>({
    per_page: 10,
    order: "desc"
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  
  // Modal states
  const [showViewModal, setShowViewModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AttendanceLog | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteType, setDeleteType] = useState<'log' | 'override'>('log');
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Helper: normalize server row like Vue normalizeDailyRow
  const normalizeDailyRow = (row: RawAttendanceRow): AttendanceLog => {
    const detail: ScheduleDetail = {
      ...(row?.schedule_detail || {}),
    };
    const check_in = row?.check_in || detail?.check_in || null;
    const check_out = row?.check_out || detail?.check_out || null;
    return {
      id: String(row?.id ?? `${row?.date || ''}::${row?.person_id || row?.label || Math.random()}`),
      person_id: row?.person_id ? String(row.person_id) : undefined,
      label: row?.label ? String(row.label) : undefined,
      date: String(row?.date || ""),
      check_in: check_in || null,
      check_out: check_out || null,
      schedule: { label: String(row?.schedule || detail?.day || "") },
      status: (String(row?.status || "present") as AttendanceLog['status']),
      has_override: Boolean(row?.schedule_override || row?.schedule_source === "override"),
    } as AttendanceLog & { schedule_source?: string; schedule_detail?: ScheduleDetail; schedule_override?: unknown };
  };

  const fetchLogs = useCallback(async (page = 1, filterParams = filters) => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = {
        page,
        per_page: filterParams.per_page || 10,
        order: filterParams.order || "desc",
      };
      if (filterParams.search?.trim()) params.q = filterParams.search.trim();
      if (filterParams.date_from?.trim()) params.start = filterParams.date_from.trim();
      if (filterParams.date_to?.trim()) params.end = filterParams.date_to.trim();
      if (filterParams.status && filterParams.status !== "") params.status = filterParams.status === "late_left_early" ? "mixed" : filterParams.status;

      const query = new URLSearchParams(Object.entries(params).reduce((acc, [k, v]) => ({ ...acc, [k]: String(v) }), {} as Record<string, string>)).toString();
      const data = await request<AttendanceResponse>(`/admin/attendance/daily?${query}`, { method: "GET" });
      const items = Array.isArray(data?.items) ? data.items : [];
      const mapped = items.map(normalizeDailyRow);
      const meta = data?.meta || {};
      setLogs(mapped as AttendanceLog[]);
      const tp = Number(meta.total_pages || 1);
      setCurrentPage(Number(meta.page || page));
      setTotalPages(tp);
      setTotalRecords(Number(meta.total || mapped.length));
      
    } catch (error) {
      toast.error(t("adminAttendance.error.fetch", "Gagal memuat data absensi"));
    } finally {
      setLoading(false);
    }
  }, [filters, t]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh when filters change (e.g., order newest/oldest, per_page, status, search)
  useEffect(() => {
    fetchLogs(1, filters);
  }, [filters, fetchLogs]);

  const clearFilters = () => {
    setFilters({
      per_page: 10,
      order: "desc"
    });
    setCurrentPage(1);
  };

  // Export functionality
  const exportData = async () => {
    try {
      // Simulasi export - ganti dengan API call sebenarnya
      const csvContent = [
        [
          t("adminAttendance.csv.member", "Member"),
          t("adminAttendance.csv.date", "Date"),
          t("adminAttendance.csv.checkIn", "Check In"),
          t("adminAttendance.csv.checkOut", "Check Out"),
          t("adminAttendance.csv.schedule", "Schedule"),
          t("adminAttendance.csv.status", "Status"),
        ].join(','),
        ...logs.map(log => [
          (log.label || log.member?.name || ''),
          log.date,
          formatTime(log.check_in),
          formatTime(log.check_out),
          log.schedule.label,
          log.status
        ].join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      toast.success(t("adminAttendance.toast.exportSuccess", "Data berhasil diekspor"));
    } catch (error) {
      toast.error(t("adminAttendance.toast.exportError", "Gagal mengekspor data"));
    }
  };

  // Action handlers
  const handleView = (log: AttendanceLog) => {
    setSelectedLog(log);
    setShowViewModal(true);
  };

  const handleCustomSchedule = (log: AttendanceLog) => {
    setSelectedLog(log);
    setShowScheduleModal(true);
  };

  const handleEditOverride = (log: AttendanceLog) => {
    setSelectedLog(log);
    setShowScheduleModal(true);
  };

  const handleDeleteLog = (log: AttendanceLog) => {
    setSelectedLog(log);
    setDeleteType('log');
    setShowDeleteConfirm(true);
  };

  const handleDeleteOverride = (log: AttendanceLog) => {
    setSelectedLog(log);
    setDeleteType('override');
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!selectedLog) return;
    
    try {
      // Simulasi delete - ganti dengan API call sebenarnya
      if (deleteType === 'log') {
        setLogs(prev => prev.filter(log => log.id !== selectedLog.id));
        toast.success(t("adminAttendance.toast.logDeleted", "Log absensi berhasil dihapus"));
      } else {
        // Update log to remove override
        setLogs(prev => prev.map(log => 
          log.id === selectedLog.id 
            ? { ...log, has_override: false, schedule: { ...log.schedule, overridden: false } }
            : log
        ));
        toast.success(t("adminAttendance.toast.overrideDeleted", "Override berhasil dihapus"));
      }
    } catch (error) {
      toast.error(t("adminAttendance.toast.deleteError", "Gagal menghapus data"));
    } finally {
      setShowDeleteConfirm(false);
      setSelectedLog(null);
    }
  };

  const formatTime = (value: string | null) => {
    if (!value) return "-";
    // Support "HH:MM" strings from backend; display as HH.MM
    const m = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (m) return `${m[1]}.${m[2]}`;
    // Fallback ISO handling
    try {
      const userLocale = locale || (typeof navigator !== "undefined" ? navigator.language : "id-ID");
      return new Date(value).toLocaleTimeString(userLocale, { hour: "2-digit", minute: "2-digit", hour12: false });
    } catch {
      return value;
    }
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const userLocale = locale || (typeof navigator !== "undefined" ? navigator.language : "id-ID");
      
      // Get day name (multilingual)
      const dayName = date.toLocaleDateString(userLocale, { weekday: "long" });
      
      // Get day, month short, year
      const day = date.getDate().toString().padStart(2, '0');
      const monthShort = date.toLocaleDateString(userLocale, { month: "short" });
      const year = date.getFullYear();
      
      // Format: <Day Name> dd/MMM/yyyy
      return `${dayName} ${day}/${monthShort}/${year}`;
    } catch {
      return dateString;
    }
  };

  const mapStatusKey = (status: string) => {
    switch (status) {
      case "present":
        return "present";
      case "late":
        return "late";
      case "left_early":
        return "early"; // locale uses "early"
      case "late_left_early":
        return "mixed"; // locale uses "mixed"
      case "off":
        return "off";
      default:
        return status;
    }
  };

  const getStatusBadge = (status: string) => {
    const key = mapStatusKey(status);
    switch (key) {
      case "present":
        return <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-medium">{t("adminAttendance.table.status.present", "Hadir")}</span>;
      case "late":
        return <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs font-medium">{t("adminAttendance.table.status.late", "Terlambat")}</span>;
      case "early":
        return <span className="bg-orange-100 text-orange-800 px-2 py-1 rounded text-xs font-medium">{t("adminAttendance.table.status.early", "Pulang Awal")}</span>;
      case "mixed":
        return <span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-medium">{t("adminAttendance.table.status.mixed", "Terlambat & Pulang Awal")}</span>;
      case "off":
        return <span className="bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-2 py-1 rounded text-xs font-medium">{t("adminAttendance.table.status.off", "Libur")}</span>;
      default:
        return <span className="bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-2 py-1 rounded text-xs font-medium">{key}</span>;
    }
  };

  const getScheduleBadge = (row: AttendanceLog & { schedule_source?: string; schedule_detail?: ScheduleDetail; day?: string }) => {
    const src = row?.schedule_source;
    if (src === "override") {
      return (
        <span className="inline-block rounded-full bg-indigo-50 text-indigo-700 px-3 py-1 text-[11px] font-medium">
          {t("adminAttendance.table.scheduleSource.override", "Override")}
        </span>
      );
    }
    const day = row?.schedule_detail?.day || row?.day;
    if (day) {
      return (
        <span className="inline-block rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-foreground/80">
          {t(`adminSchedule.week.${day}`, String(day))}
        </span>
      );
    }
    return null;
  };

  const handlePageChange = (page: number) => {
    const clamped = Math.min(Math.max(1, page), totalPages);
    fetchLogs(clamped, filters);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        {/* header action buttons removed as requested */}
      </div>

      {/* Filters */}
      <div className="bg-card rounded-lg border p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-1">{t("adminAttendance.filters.searchName", "Search")}</label>
            <div className="relative">
              <Icon name="Search" className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder={t("adminAttendance.filters.searchPlaceholder", "Search member name...")}
                value={filters.search || ""}
                onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                className="w-full pl-10 pr-3 py-2 border rounded-md text-sm"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">{t("adminAttendance.filters.status", "Status")}</label>
            <select
              value={filters.status || ""}
              onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
              className="w-full px-3 py-2 border rounded-md text-sm"
            >
              <option value="">{t("adminAttendance.filters.allStatuses", "All statuses")}</option>
              <option value="present">{t("adminAttendance.status.present", "Present")}</option>
              <option value="late">{t("adminAttendance.status.late", "Late")}</option>
              <option value="left_early">{t("adminAttendance.status.leftEarly", "Left Early")}</option>
              <option value="late_left_early">{t("adminAttendance.status.lateLeftEarly", "Late & Left Early")}</option>
              <option value="off">{t("adminAttendance.status.off", "Off")}</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">{t("adminAttendance.filters.perPage", "Per page")}</label>
            <select
              value={filters.per_page || 10}
              onChange={(e) => setFilters(prev => ({ ...prev, per_page: Number(e.target.value) }))}
              className="w-full px-3 py-2 border rounded-md text-sm"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">{t("adminAttendance.filters.order", "Order")}</label>
            <select
              value={filters.order || "desc"}
              onChange={(e) => setFilters(prev => ({ ...prev, order: e.target.value as "asc" | "desc" }))}
              className="w-full px-3 py-2 border rounded-md text-sm"
            >
              <option value="desc">{t("adminAttendance.filters.newest", "Newest")}</option>
              <option value="asc">{t("adminAttendance.filters.oldest", "Oldest")}</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">{t("adminAttendance.filters.dateRange", "Date Range")}</label>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="w-15 px-0 inline-flex items-center justify-center"
                onClick={() => setShowDatePicker(true)}
                title={t("adminAttendance.filters.pickDateRange", "Pick date range")}
                aria-label={t("adminAttendance.filters.pickDateRange", "Pick date range")}
              >
                <Icon name="Calendar" className="h-4 w-4" />
                <Icon name="ChevronDown" className="h-4 w-4 ml-1" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFilters(prev => ({ ...prev, date_from: undefined, date_to: undefined }))}
                disabled={!filters.date_from && !filters.date_to}
              >
                {t("common.clear", "Clear")}
              </Button>
            </div>
          </div>
        </div>
        
      </div>

      {/* Table */}
      <div className="bg-card rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="text-left p-4 font-medium text-sm">{t("adminAttendance.table.columns.member", "Member")}</th>
                <th className="text-left p-4 font-medium text-sm">{t("adminAttendance.table.columns.date", "Date")}</th>
                <th className="text-left p-4 font-medium text-sm">{t("adminAttendance.table.columns.checkIn", "Check In")}</th>
                <th className="text-left p-4 font-medium text-sm">{t("adminAttendance.table.columns.checkOut", "Check Out")}</th>
                <th className="text-left p-4 font-medium text-sm">{t("adminAttendance.table.columns.schedule", "Schedule")}</th>
                <th className="text-left p-4 font-medium text-sm">{t("adminAttendance.table.columns.status", "Status")}</th>
                <th className="text-right p-4 font-medium text-sm">{t("adminAttendance.table.columns.actions", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center">
                    <Icon name="Loader2" className="h-6 w-6 animate-spin mx-auto" />
                  </td>
                </tr>
              ) : logs.length > 0 ? (
                logs.map((log, index) => (
                  <tr key={log.id} className="border-b hover:bg-muted/40">
                    <td className="p-4">
                      <div className="flex items-center">
                        <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center mr-3 text-xs font-medium">
                          {index + 1}
                        </div>
                        <div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <Icon name="UserRound" className="h-3.5 w-3.5" />
                            <span>{t("common.idLabel", "ID:")} {log.person_id || log.member?.id || "-"}</span>
                          </div>
                          <div className="font-medium text-sm">{log.label || log.member?.name || "-"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-sm">{formatDate(log.date)}</td>
                    <td className="p-4 text-sm">{formatTime(log.check_in)}</td>
                    <td className="p-4 text-sm">{formatTime(log.check_out)}</td>
                    <td className="p-4 text-sm align-top">
                      <div className="space-y-1">
                        <div className="text-sm font-semibold leading-tight">
                          {String(log?.schedule?.label || t("adminAttendance.table.scheduleFallback", "Jam Kerja Normal"))}
                        </div>
                        <div>{getScheduleBadge(log as AttendanceLog & { schedule_source?: string; schedule_detail?: ScheduleDetail })}</div>
                        <div className="text-xs text-muted-foreground">
                          {(() => {
                            const detail: ScheduleDetail = (log as AttendanceLog & { schedule_detail?: ScheduleDetail })?.schedule_detail || {};
                            const gIn = Number.isFinite(detail.grace_in_min) ? detail.grace_in_min : 10;
                            const gOut = Number.isFinite(detail.grace_out_min) ? detail.grace_out_min : 5;
                            return t("adminAttendance.table.graceSummary", "Grace: {in}/{out} min", { in: gIn, out: gOut });
                          })()}
                        </div>
                      </div>
                    </td>
                    <td className="p-4">{getStatusBadge(log.status)}</td>
                    <td className="p-4">
                      <div className="flex flex-col items-end gap-2">
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleView(log)}
                            title={t("common.view", "View")}
                            aria-label={t("common.view", "View")}
                          >
                            <Icon name="Eye" className="h-4 w-4" />
                          </Button>
                          {log.has_override ? (
                            <Button
                              size="sm"
                              onClick={() => handleEditOverride(log)}
                              className="bg-orange-500 hover:bg-orange-600 text-white"
                              title={t("adminAttendance.actions.editOverride", "Edit Override")}
                              aria-label={t("adminAttendance.actions.editOverride", "Edit Override")}
                            >
                              <Icon name="Pencil" className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => handleCustomSchedule(log)}
                              className="bg-orange-500 hover:bg-orange-600 text-white"
                              title={t("adminAttendance.actions.customSchedule", "Custom Schedule")}
                              aria-label={t("adminAttendance.actions.customSchedule", "Custom Schedule")}
                            >
                              <Icon name="CalendarPlus" className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                        <div className="flex gap-2">
                          {log.has_override && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleDeleteOverride(log)}
                              title={t("adminAttendance.actions.deleteOverride", "Delete Override")}
                              aria-label={t("adminAttendance.actions.deleteOverride", "Delete Override")}
                            >
                              <Icon name="CalendarX" className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDeleteLog(log)}
                            title={t("adminAttendance.actions.deleteLog", "Delete Log")}
                            aria-label={t("adminAttendance.actions.deleteLog", "Delete Log")}
                          >
                            <Icon name="Trash2" className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    <Icon name="ClipboardList" className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>{t("adminAttendance.table.empty", "Belum ada data absensi")}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={totalRecords}
          itemsPerPage={filters.per_page || 10}
          itemLabel="records"
          onPageChange={handlePageChange}
        />
      </div>

      {/* View Modal */}
      <Dialog open={showViewModal && !!selectedLog} onOpenChange={(open)=> !open && setShowViewModal(false)}>
        <DialogContent hideOverlay className="max-w-md max-h-[85vh] overflow-auto bg-background rounded-xl m-auto" onEscapeKeyDown={() => setShowViewModal(false)} onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            setShowViewModal(false);
          }
        }}>
          <DialogHeader>
            <DialogTitle>{t("adminAttendance.view.title", "Detail Absensi")}</DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">{t("adminAttendance.view.member", "Member")}</label>
                <p className="text-sm">ID: {selectedLog.person_id || selectedLog.member?.id || "-"}</p>
                <p className="text-sm font-medium">{selectedLog.label || selectedLog.member?.name || "-"}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">{t("adminAttendance.view.date", "Tanggal")}</label>
                <p className="text-sm">{formatDate(selectedLog.date)}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">{t("adminAttendance.view.checkIn", "Check In")}</label>
                  <p className="text-sm">{formatTime(selectedLog.check_in)}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">{t("adminAttendance.view.checkOut", "Check Out")}</label>
                  <p className="text-sm">{formatTime(selectedLog.check_out)}</p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">{t("adminAttendance.view.schedule", "Schedule")}</label>
                <div className="mt-1">{getScheduleBadge(selectedLog as AttendanceLog & { schedule_source?: string; schedule_detail?: ScheduleDetail; day?: string })}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">{t("adminAttendance.view.status", "Status")}</label>
                <div className="mt-1">{getStatusBadge(selectedLog.status)}</div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowViewModal(false)}>{t("common.close", "Tutup")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Schedule Modal */}
      <Dialog open={showScheduleModal && !!selectedLog} onOpenChange={(open)=> !open && setShowScheduleModal(false)}>
        <DialogContent hideOverlay className="max-w-lg max-h-[85vh] overflow-auto bg-background rounded-xl m-auto" onEscapeKeyDown={() => setShowScheduleModal(false)} onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            toast.success(t("adminAttendance.schedule.saved", "Schedule berhasil disimpan"));
            setShowScheduleModal(false);
          }
        }}>
          <DialogHeader>
            <DialogTitle>{selectedLog?.has_override ? t("adminAttendance.schedule.editOverride", "Edit Override") : t("adminAttendance.schedule.custom", "Custom Schedule")}</DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t("adminAttendance.view.member", "Member")}</label>
                <div className="text-sm bg-muted p-2 rounded">
                  <div className="text-xs text-muted-foreground">ID: {selectedLog.person_id || selectedLog.member?.id || "-"}</div>
                  <div className="font-medium">{selectedLog.label || selectedLog.member?.name || "-"}</div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t("adminAttendance.view.date", "Tanggal")}</label>
                <p className="text-sm bg-muted p-2 rounded">{formatDate(selectedLog.date)}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t("adminAttendance.view.checkIn", "Check In")}</label>
                  <input type="time" className="w-full px-3 py-2 border rounded-md text-sm bg-muted" defaultValue={selectedLog.check_in ? formatTime(selectedLog.check_in) : ""} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t("adminAttendance.view.checkOut", "Check Out")}</label>
                  <input type="time" className="w-full px-3 py-2 border rounded-md text-sm bg-muted" defaultValue={selectedLog.check_out ? formatTime(selectedLog.check_out) : ""} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t("adminAttendance.schedule.type", "Schedule Type")}</label>
                <select className="w-full px-3 py-2 border rounded-md text-sm bg-muted">
                  <option value="workday">{t("adminAttendance.schedule.workday", "Jam Kerja Normal")}</option>
                  <option value="halfday">{t("adminAttendance.schedule.halfday", "Shift Pagi")}</option>
                  <option value="evening">{t("adminAttendance.schedule.evening", "Shift Sore")}</option>
                  <option value="wfh">{t("adminAttendance.schedule.wfh", "WFH Fleksibel")}</option>
                  <option value="off">{t("adminAttendance.schedule.off", "Libur")}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t("adminAttendance.schedule.note", "Catatan")}</label>
                <textarea className="w-full px-3 py-2 border rounded-md text-sm bg-muted" rows={3} placeholder="Catatan opsional..." />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => { toast.success(t("adminAttendance.schedule.saved", "Schedule berhasil disimpan")); setShowScheduleModal(false); }} className="flex-1">{t("common.save", "Simpan")}</Button>
            <Button variant="outline" onClick={() => setShowScheduleModal(false)} className="flex-1">{t("common.cancel", "Batal")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={showDeleteConfirm && !!selectedLog} onOpenChange={(open)=> !open && setShowDeleteConfirm(false)}>
        <DialogContent hideOverlay className="max-w-md max-h-[85vh] overflow-auto bg-background rounded-xl m-auto" onEscapeKeyDown={() => setShowDeleteConfirm(false)} onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            confirmDelete();
          }
        }}>
          <DialogHeader>
            <DialogTitle>{t("common.confirmDelete", "Konfirmasi Hapus")}</DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="mb-6">
              <p className="text-sm text-gray-600">
                {t(
                  "adminAttendance.confirm.deleteText",
                  "Apakah Anda yakin ingin menghapus {what} untuk {name} (ID: {id}) pada tanggal {date}?",
                  {
                    what: deleteType === 'log' ? t("adminAttendance.confirm.log", "log absensi") : t("adminAttendance.confirm.override", "override"),
                    name: selectedLog.label || selectedLog.member?.name || '-',
                    id: selectedLog.person_id || selectedLog.member?.id || '-',
                    date: formatDate(selectedLog.date),
                  }
                )}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="destructive" onClick={confirmDelete} className="flex-1">{t("common.delete", "Hapus")}</Button>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)} className="flex-1">{t("common.cancel", "Batal")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Date Range Picker Modal */}
      <Dialog open={showDatePicker} onOpenChange={(open)=> !open && setShowDatePicker(false)}>
        <DialogContent hideOverlay className="max-w-md max-h-[85vh] overflow-auto bg-background rounded-xl m-auto" onEscapeKeyDown={() => setShowDatePicker(false)} onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            setCurrentPage(1);
            fetchLogs(1, filters);
            setShowDatePicker(false);
          }
        }}>
          <DialogHeader>
            <DialogTitle>{t("adminAttendance.filters.pickTitle", "Pilih Rentang Tanggal")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t("adminAttendance.filters.startDate", "Tanggal Mulai")}</label>
              <input type="date" value={filters.date_from || ""} onChange={(e) => setFilters(prev => ({ ...prev, date_from: e.target.value }))} className="w-full px-3 py-2 border rounded-md text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t("adminAttendance.filters.endDate", "Tanggal Akhir")}</label>
              <input type="date" value={filters.date_to || ""} onChange={(e) => setFilters(prev => ({ ...prev, date_to: e.target.value }))} className="w-full px-3 py-2 border rounded-md text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => { setCurrentPage(1); fetchLogs(1, filters); setShowDatePicker(false); }} className="flex-1">{t("common.apply", "Terapkan")}</Button>
            <Button variant="outline" onClick={() => { setFilters(prev => ({ ...prev, date_from: "", date_to: "" })); setShowDatePicker(false); }} className="flex-1">{t("common.reset", "Reset")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
