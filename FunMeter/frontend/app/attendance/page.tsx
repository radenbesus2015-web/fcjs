"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import { useI18n } from "@/components/providers/I18nProvider";
import { useSettings } from "@/components/providers/SettingsProvider";
import { useWs } from "@/components/providers/WsProvider";
import { toast } from "@/toast";
import { request } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/common/Icon";
import { RefreshCw, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from "lucide-react";
import * as Cam from "@/lib/cameraManager";

interface AttendanceRecord {
  label: string;
  person_id?: string;
  ts: string;
  score: number;
}

interface AttendanceResult {
  bbox?: [number, number, number, number];
  box?: [number, number, number, number];
  label?: string;
  name?: string;
  score?: number;
  [key: string]: unknown;
}

interface AttResultData {
  results?: AttendanceResult[];
  marked?: string[];
  marked_info?: Array<{
    label?: string;
    name?: string;
    score?: number;
    message?: string;
  }>;
  blocked?: Array<{
    message?: string;
  }>;
  [key: string]: unknown;
}

interface AttLogSnapshotData {
  [key: string]: unknown;
}

type AttendancePaginationItem =
  | { type: "page"; page: number }
  | { type: "ellipsis"; key: "left" | "right" }
  | { type: "last"; page: number };

export default function AttendancePage() {
  const { t, locale } = useI18n();
  const { useSetting } = useSettings();
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const DPRRef = useRef(1);
  const snapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sendHeightRef = useRef(0);
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const refreshLogRef = useRef<((page?: number) => Promise<void>) | null>(null);
  const logMetaRef = useRef({ page: 1 });
  const [lastResults, setLastResults] = useState<AttendanceResult[]>([]);
  const [sending, setSending] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  
  const [cameraActive, setCameraActive] = useState(false);
  // simplified state for this page (no realtime results shown)
  const [logItems, setLogItems] = useState<AttendanceRecord[]>([]);
  const [logMeta, setLogMeta] = useState({
    page: 1,
    total_pages: 1,
    per_page: 25,
    total: 0,
    has_prev: false,
    has_next: false,
  });
  const [perPage, setPerPage] = useState<number>(10);
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Pagination calculations
  const { startItem, endItem } = useMemo(() => {
    if (logMeta.total === 0) {
      return { startItem: 0, endItem: 0 };
    }
    const start = (logMeta.page - 1) * logMeta.per_page + 1;
    const end = Math.min(logMeta.total, start + logMeta.per_page - 1);
    return { startItem: start, endItem: end };
  }, [logMeta.page, logMeta.per_page, logMeta.total]);

  const paginationItems = useMemo<AttendancePaginationItem[]>(() => {
    if (logMeta.total_pages <= 1) {
      return [];
    }

    const items: AttendancePaginationItem[] = [
      { type: "page", page: 1 },
    ];

    if (logMeta.page > 1) {
      items.push({ type: "ellipsis", key: "left" });
    }

    if (logMeta.page > 1 && logMeta.page < logMeta.total_pages) {
      items.push({ type: "page", page: logMeta.page });
    }

    if (logMeta.page < logMeta.total_pages) {
      items.push({ type: "ellipsis", key: "right" });
    }

    if (logMeta.total_pages > 1) {
      items.push({ type: "last", page: logMeta.total_pages });
    }

    return items;
  }, [logMeta.page, logMeta.total_pages]);

  // Settings
  type SettingBinding = { model: number; setModel: (v: number) => void };
  const baseInterval = useSetting("baseInterval", { clamp: { max: 5000, round: true } }) as unknown as SettingBinding;
  const { model: attSendWidth } = useSetting("attendance.sendWidth", { clamp: { min: 160, max: 1920, round: true } });
  const { model: jpegQuality } = useSetting("attendance.jpegQuality", { clamp: { min: 0, max: 1 } });
  // other settings omitted in this compact view

  // WebSocket for attendance
  const socket = useWs({
    url: "",
    root: true,
    on: {
      att_result(...args: unknown[]) {
        const data = args[0] as AttResultData;
        const results = Array.isArray(data?.results) ? data.results : [];
        setLastResults(results);
        draw(results);
        
        // Handle successful attendance notification and refresh log
        const marked = Array.isArray(data?.marked) ? data.marked : [];
        const markedInfo = Array.isArray(data?.marked_info) ? data.marked_info : [];
        const blocked = Array.isArray(data?.blocked) ? data.blocked : [];
        
        console.log("[ATT_RESULT] Received:", { 
          resultsCount: results.length, 
          marked, 
          markedInfo, 
          blocked 
        });
        
        // Show toast notifications for marked attendance
        for (const info of markedInfo) {
          // Use name if available, otherwise fallback to label
          const name = info.name || info.label || "";
          const now = new Date();
          // Format tanggal singkat: hari singkat/bulan singkat/tahun 2 digit
          const dayNames = locale === 'id' 
            ? ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']
            : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const monthNames = locale === 'id'
            ? ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
            : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const day = dayNames[now.getDay()];
          const month = monthNames[now.getMonth()];
          const year = String(now.getFullYear()).slice(-2);
          const time = now.toLocaleTimeString(locale === 'id' ? 'id-ID' : 'en-US', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
          });
          const dateTime = `${day}/${month}/${year} ${time}`;
          
          // Build message with date and time
          let message = t("attendance.toast.attendanceSuccess", "Attendance recorded: {name}", { name });
          const details: string[] = [];
          
          if (dateTime) details.push(t("attendance.toast.dateTime", "Date & Time: {dateTime}", { dateTime }));
          
          if (details.length > 0) {
            message += `\n${details.join(' • ')}`;
          }
          
          if (name) {
            console.log("[ATTENDANCE] Backend message (ignored):", info.message);
            console.log("[ATTENDANCE] Using translated message:", message);
            toast.success(message, { duration: 5000 });
          }
        }
        
        // Fallback: show toast for marked labels without detailed info
        if (!markedInfo.length && marked.length > 0) {
          const now = new Date();
          // Format tanggal singkat: hari singkat/bulan singkat/tahun 2 digit
          const dayNames = locale === 'id' 
            ? ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']
            : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const monthNames = locale === 'id'
            ? ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
            : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const day = dayNames[now.getDay()];
          const month = monthNames[now.getMonth()];
          const year = String(now.getFullYear()).slice(-2);
          const time = now.toLocaleTimeString(locale === 'id' ? 'id-ID' : 'en-US', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
          });
          const dateTime = `${day}/${month}/${year} ${time}`;
          
          for (const label of marked) {
            console.log("[ATTENDANCE] Showing success toast for (fallback):", label);
            let message = t("attendance.toast.attendanceMarked", "Attendance marked: {name}", { name: label });
            message += `\n${t("attendance.toast.dateTime", "Date & Time: {dateTime}", { dateTime })}`;
            toast.success(message, { duration: 5000 });
          }
        }
        
        // Show blocked messages if any
        for (const block of blocked) {
          if (block.message) {
            console.log("[ATTENDANCE] Blocked:", block.message);
            // Use block message directly (might need translation in future)
            toast.info(block.message, { duration: 4000 });
          }
        }
        
        // Refresh log when attendance is marked - always go to page 1 to see latest entries
        if (marked.length > 0 || markedInfo.length > 0) {
          console.log("[ATTENDANCE] Refreshing log after marked attendance");
          // Small delay to ensure backend has saved the attendance
          setTimeout(() => {
            const refresh = refreshLogRef.current;
            if (refresh) {
              // Refresh to page 1 to show latest attendance (since order is desc)
              refresh(1);
            }
          }, 500);
        }
      },
      att_log_snapshot(...args: unknown[]) {
        const data = args[0] as AttLogSnapshotData;
        // Refresh log when server sends snapshot update
        const refresh = refreshLogRef.current;
        const currentPage = logMetaRef.current.page;
        if (refresh) {
          refresh(currentPage);
        }
      },
    },
  });

  // Camera functions
  const startCamera = async () => {
    if (!videoRef.current) {
      console.log("[CAMERA] Cannot start: videoRef is null");
      return;
    }
    
    setCameraLoading(true);
    toast.info(t("attendance.toast.cameraStarting", "Starting camera..."), { duration: 2000 });
    
    try {
      console.log("[CAMERA] Starting camera...");
      const video = videoRef.current;
      
      // Ensure video element is ready - clear any existing stream first
      if (video.srcObject) {
        console.log("[CAMERA] Video already has srcObject, clearing first");
        video.pause();
        video.srcObject = null;
        // Small delay to ensure cleanup completes
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Load video element
      video.load();
      
      await Cam.attach(video);
      
      // Wait for video to be ready
      if (video.readyState < 2) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            video.removeEventListener("loadedmetadata", onLoadedMetadata);
            video.removeEventListener("error", onError);
            reject(new Error("Timeout waiting for video metadata"));
          }, 5000);
          
          const onLoadedMetadata = () => {
            clearTimeout(timeout);
            video.removeEventListener("loadedmetadata", onLoadedMetadata);
            video.removeEventListener("error", onError);
            resolve();
          };
          
          const onError = (e: Event) => {
            clearTimeout(timeout);
            video.removeEventListener("loadedmetadata", onLoadedMetadata);
            video.removeEventListener("error", onError);
            reject(new Error("Video load error"));
          };
          
          video.addEventListener("loadedmetadata", onLoadedMetadata);
          video.addEventListener("error", onError);
          
          // If already loaded, resolve immediately
          if (video.readyState >= 2) {
            clearTimeout(timeout);
            video.removeEventListener("loadedmetadata", onLoadedMetadata);
            video.removeEventListener("error", onError);
            resolve();
          }
        });
      }
      
      // Ensure video plays
      try {
        await video.play();
        console.log("[CAMERA] Video playing");
      } catch (playError: unknown) {
        console.warn("[CAMERA] Auto-play failed:", playError);
        // Try again after a short delay
        setTimeout(async () => {
          try {
            await video.play();
            console.log("[CAMERA] Video playing after retry");
          } catch (retryError) {
            console.error("[CAMERA] Retry play also failed:", retryError);
          }
        }, 200);
      }
      
      setCameraActive(true);
      fitCanvasToVideo();
      toast.success(t("attendance.toast.cameraStarted", "Camera started successfully"), { duration: 3000 });
    } catch (error: unknown) {
      console.error("[CAMERA] Error starting camera:", error);
      setCameraActive(false);
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      toast.error(t("attendance.toast.cameraError", "Failed to access camera: {error}", { error: errorMsg }), { duration: 5000 });
    } finally {
      setCameraLoading(false);
    }
  };

  // Format datetime with multilingual day name: <Day Name> dd/MMM/yyyy HH:mm
  const formatDateTime = (dateTimeString: string) => {
    try {
      const date = new Date(dateTimeString);
      const userLocale = locale || (typeof navigator !== "undefined" ? navigator.language : "id-ID");
      
      // Get day name (multilingual)
      const dayName = date.toLocaleDateString(userLocale, { weekday: "long" });
      
      // Get day, month short, year
      const day = date.getDate().toString().padStart(2, '0');
      const monthShort = date.toLocaleDateString(userLocale, { month: "short" });
      const year = date.getFullYear();
      
      // Get time HH:mm
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      
      // Format: HH:mm - <Day Name> dd/MMM/yyyy
      return `${hours}:${minutes} - ${dayName} ${day}/${monthShort}/${year}`;
    } catch {
      return dateTimeString;
    }
  };

  const stopCamera = () => {
    toast.info(t("attendance.toast.cameraStopping", "Stopping camera..."), { duration: 1500 });
    
    
    const video = videoRef.current;
    if (video) {
      // Pause video first
      video.pause();
      // Clear srcObject
      video.srcObject = null;
    }
    
    Cam.detach(video);
    
    // Always set to false when stopping
    setCameraActive(false);
    
    toast.success(t("attendance.toast.cameraStopped", "Camera stopped successfully"), { duration: 2000 });
    
    // Clear canvas and reset results
    const overlay = overlayRef.current;
    const ctx = ctxRef.current;
    if (overlay && ctx) {
      ctx.clearRect(0, 0, overlay.width, overlay.height);
    }
    setLastResults([]);
    console.log("[CAMERA] Camera stopped");
  };

  // Helpers for drawing and sending (inside component)
  const fitCanvasToVideo = () => {
    const overlay = overlayRef.current;
    const host = videoRef.current;
    if (!overlay || !host) return;
    const rect = host.getBoundingClientRect();
    const DPR = window.devicePixelRatio || 1;
    DPRRef.current = DPR;
    overlay.width = Math.round(rect.width * DPR);
    overlay.height = Math.round(rect.height * DPR);
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
    const ctx = ctxRef.current;
    if (ctx) {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, overlay.width, overlay.height);
    }
  };

  const ensureSnapSize = () => {
    const v = videoRef.current;
    if (!v) return false;
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return false;
    sendHeightRef.current = Math.round((Number(attSendWidth) * vh) / vw);
    if (!snapCanvasRef.current) snapCanvasRef.current = document.createElement("canvas");
    snapCanvasRef.current.width = Number(attSendWidth);
    snapCanvasRef.current.height = sendHeightRef.current;
    return true;
  };

  const toBytes = async () => {
    if (!snapCanvasRef.current) return null;
    const canvas = snapCanvasRef.current;
    const preferWebP = !!document.createElement("canvas").toDataURL("image/webp").match("data:image/webp");
    const type = preferWebP ? "image/webp" : "image/jpeg";
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, Number(jpegQuality)));
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  };

  const pushAttFrame = async () => {
    if (!socket || !socket.socket?.connected) {
      console.log("[PUSH_ATT_FRAME] Skipped: WebSocket not connected");
      return;
    }
    if (sending) {
      console.log("[PUSH_ATT_FRAME] Skipped: Already sending");
      return;
    }
    if (!ensureSnapSize()) {
      console.log("[PUSH_ATT_FRAME] Skipped: Cannot ensure snap size");
      return;
    }
    if (!isMountedRef.current) {
      console.log("[PUSH_ATT_FRAME] Skipped: Component not mounted");
      return;
    }
    
    setSending(true);
    try {
      const snapCanvas = snapCanvasRef.current;
      const video = videoRef.current;
      if (!snapCanvas || !video || !isMountedRef.current) {
        console.log("[PUSH_ATT_FRAME] Skipped: Missing canvas or video");
        return;
      }
      const sctx = snapCanvas.getContext("2d");
      if (!sctx) {
        console.log("[PUSH_ATT_FRAME] Skipped: Cannot get canvas context");
        return;
      }
      sctx.drawImage(video, 0, 0, snapCanvas.width, snapCanvas.height);
      const bytes = await toBytes();
      if (bytes && socket && isMountedRef.current) {
        console.log("[PUSH_ATT_FRAME] Sending frame, size:", bytes.length, "bytes");
        socket.emit("att_frame", bytes);
      } else {
        console.log("[PUSH_ATT_FRAME] Skipped: No bytes or socket disconnected");
      }
    } catch (error) {
      console.error("[PUSH_ATT_FRAME] Error:", error);
    } finally {
      if (isMountedRef.current) {
        setSending(false);
      }
    }
  };

  const getLetterboxTransform = () => {
    const overlay = overlayRef.current;
    const host = overlay?.parentElement || videoRef.current;
    if (!overlay || !host || !snapCanvasRef.current) return { sx: 1, sy: 1, ox: 0, oy: 0 };
    
    const rect = host.getBoundingClientRect();
    const dispW = rect.width;
    const dispH = rect.height;
    
    // Account for DPR since canvas uses DPR scaling
    const DPR = DPRRef.current;
    const canvasW = overlay.width / DPR;
    const canvasH = overlay.height / DPR;
    
    // Bounding box dari server menggunakan koordinat snapCanvas
    const snapW = snapCanvasRef.current.width; // attSendWidth
    const snapH = snapCanvasRef.current.height; // sendHeightRef.current
    
    // Calculate letterbox offset for object-contain behavior
    const video = videoRef.current;
    if (!video) {
      // Fallback: simple scale without letterbox
      return { sx: canvasW / snapW, sy: canvasH / snapH, ox: 0, oy: 0 };
    }
    
    const vw = video.videoWidth || 1;
    const vh = video.videoHeight || 1;
    const videoAspect = vw / vh;
    const displayAspect = dispW / dispH;
    
    // Calculate how video is displayed in container (object-contain scaling)
    let videoDisplayW = 0, videoDisplayH = 0;
    if (videoAspect > displayAspect) {
      // Video is wider - fit to width, letterbox on top/bottom
      videoDisplayW = dispW;
      videoDisplayH = dispW / videoAspect;
    } else {
      // Video is taller - fit to height, letterbox on left/right
      videoDisplayH = dispH;
      videoDisplayW = dispH * videoAspect;
    }
    
    // Letterbox offset in canvas coordinates
    const ox = ((canvasW - videoDisplayW) / 2);
    const oy = ((canvasH - videoDisplayH) / 2);
    
    // Scale from snapCanvas to video display area (not full container)
    const sx = videoDisplayW / snapW;
    const sy = videoDisplayH / snapH;
    
    return { sx, sy, ox, oy };
  };

  const draw = (results: AttendanceResult[]) => {
    const overlay = overlayRef.current;
    const ctx = ctxRef.current;
    if (!overlay || !ctx) return;
    
    // Always clear canvas first
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    
    // Only draw if camera is active and there are results
    if (!cameraActive || !results || results.length === 0) {
      return;
    }
    
    const video = videoRef.current;
    if (!video) return;
    
    const { sx, sy, ox, oy } = getLetterboxTransform();
    
    results.forEach((r) => {
      const [bx, by, bw, bh] = r.bbox || r.box || [0, 0, 0, 0];
      
      // Transform bounding box coordinates with letterbox offset
      const x = ox + bx * sx;
      const y = oy + by * sy;
      const w = bw * sx;
      const h = bh * sy;
      
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, w, h);
      const label = r.label || r.name || t("attendance.labels.unknown", "Unknown");
      ctx.font = "bold 12px sans-serif";
      const pad = 4;
      const textW = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(2,6,23,0.88)";
      ctx.fillRect(x, y - 20, textW + pad * 2, 18);
      ctx.fillStyle = "#e5e7eb";
      ctx.fillText(label, x + pad, y - 6);
    });
  };

  // Clear canvas when camera becomes inactive
  useEffect(() => {
    if (!cameraActive) {
      const overlay = overlayRef.current;
      const ctx = ctxRef.current;
      if (overlay && ctx) {
        ctx.clearRect(0, 0, overlay.width, overlay.height);
      }
      setLastResults([]);
    }
  }, [cameraActive]);

  // Send frames periodically
  useEffect(() => {
    if (!cameraActive || !isMountedRef.current) {
      console.log("[ATT_INTERVAL] Not starting: cameraActive=", cameraActive, "isMounted=", isMountedRef.current);
      return;
    }
    const interval = Number(baseInterval.model ?? 2000);
    console.log("[ATT_INTERVAL] Starting interval:", interval, "ms");
    const id = setInterval(() => {
      if (isMountedRef.current && cameraActive) {
        void pushAttFrame();
      }
    }, interval);
    return () => {
      console.log("[ATT_INTERVAL] Clearing interval");
      clearInterval(id);
    };
  }, [cameraActive, baseInterval.model]);

  // Fetch attendance log
  type LogResponse = { items: AttendanceRecord[]; meta: typeof logMeta };
  const refreshLog = React.useCallback(async (page = 1, showToast = false) => {
    // Cancel previous request if exists
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    // Create new AbortController
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    
    // Set loading state
    setIsRefreshing(true);
    
    try {
      const response = await request<LogResponse>(`/attendance-log?page=${page}&per_page=${perPage}&order=${order}`, {
        signal: abortController.signal,
      });
      
      // Check if component is still mounted and request wasn't aborted
      if (!isMountedRef.current || abortController.signal.aborted) return;
      
      setLogItems(response.items || []);
      const meta = response.meta || logMeta;
      const total = Number(meta.total ?? 0);
      const totalPages = Math.max(1, Number(meta.total_pages ?? (total > 0 ? Math.ceil(total / perPage) : 1)));
      const pageSafe = Math.max(1, Math.min(Number(meta.page ?? page), totalPages));
      const computed = {
        ...meta,
        page: pageSafe,
        per_page: perPage,
        total_pages: totalPages,
        total: total,
        has_prev: pageSafe > 1,
        has_next: pageSafe < totalPages,
      };
      setLogMeta(computed);
      // Update ref for WebSocket handler
      logMetaRef.current = { page: pageSafe };
      
      // Show success notification after refresh completes (only for manual refresh)
      if (showToast) {
        toast.success(t("attendance.toast.refreshSuccess", "Attendance data refreshed successfully"), { duration: 2000 });
      }
    } catch (error: unknown) {
      // Ignore errors if request was aborted or component unmounted
      const isAborted = error && typeof error === 'object' && ('name' in error) && error.name === 'AbortError';
      if (isAborted || abortController.signal.aborted || !isMountedRef.current) {
        // Clear loading state even on abort
        if (isMountedRef.current) {
          setIsRefreshing(false);
        }
        return;
      }
      toast.error(t("attendance.toast.fetchError", "Failed to load attendance data"));
    } finally {
      // Clear loading state
      if (isMountedRef.current) {
        setIsRefreshing(false);
      }
    }
  }, [order, perPage, t]);

  // Update refreshLog ref whenever refreshLog changes
  useEffect(() => {
    refreshLogRef.current = refreshLog;
  }, [refreshLog]);

  // Update logMetaRef whenever logMeta changes
  useEffect(() => {
    logMetaRef.current = { page: logMeta.page };
  }, [logMeta.page]);

  // Load initial data and react to perPage/order changes
  useEffect(() => {
    void refreshLog(1);
  }, [refreshLog, perPage, order]);

  // Cleanup on unmount and load camera state
  useEffect(() => {
    isMountedRef.current = true;
    
    // Capture refs at mount time
    const video = videoRef.current;
    const overlay = overlayRef.current;
    
    // init canvas ctx
    if (overlay) {
      ctxRef.current = overlay.getContext("2d");
      fitCanvasToVideo();
    }
    
    // Camera will NOT auto-start - user must click button to start
    // This ensures camera stops when navigating away and stays off on mount
    
    const onResize = () => {
      if (!isMountedRef.current) return;
      ensureSnapSize();
      fitCanvasToVideo();
      if (lastResults.length) draw(lastResults);
    };
    
    const onVideoLoadedMetadata = () => {
      if (!isMountedRef.current) return;
      ensureSnapSize();
      fitCanvasToVideo();
      if (lastResults.length) draw(lastResults);
    };
    
    window.addEventListener("resize", onResize);
    if (video) {
      video.addEventListener("loadedmetadata", onVideoLoadedMetadata);
    }
    
    return () => {
      // Mark as unmounted immediately to prevent any state updates
      isMountedRef.current = false;
      
      // Cancel any pending requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      
      // Reset loading state
      setIsRefreshing(false);
      
      // Clean up event listeners
      window.removeEventListener("resize", onResize);
      if (video) {
        video.removeEventListener("loadedmetadata", onVideoLoadedMetadata);
      }
      
      // Stop camera immediately (non-blocking) - use captured refs
      const currentCameraActive = cameraActive;
      if (currentCameraActive && video) {
        Cam.detach(video);
        // Use captured overlay ref
        if (overlay) {
          const ctx = overlay.getContext("2d");
          if (ctx) {
            ctx.clearRect(0, 0, overlay.width, overlay.height);
          }
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount/unmount

  //

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left: Camera card */}
        <div className="bg-card rounded-lg border p-6 self-start">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {t("attendance.sections.camera.title", "Camera")}
          </p>
          <h3 className="text-lg font-semibold mb-4">{t("attendance.sections.camera.subtitle", "Attendance streaming")}</h3>
          <div className="relative rounded-lg border bg-muted/30 overflow-hidden mb-4">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-auto object-contain block"
            />
            <canvas
              ref={overlayRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />
          </div>

          <div className="mt-2">
            <label className="text-sm font-medium block mb-1">{t("attendance.fields.interval", "Interval (ms)")}</label>
            <input
              type="number"
              value={baseInterval.model as number}
              onChange={(e) => baseInterval.setModel(Number(e.target.value))}
              className="w-full px-3 py-2 border rounded-md"
              min="200"
              max="5000"
            />
          </div>
          <p className="m-4 text-sm text-muted-foreground">
            {t("attendance.status.waiting", "Press start to send frames to attendance server.")}
          </p>
          <div className="mb-2">
            <Button
              onClick={cameraActive ? stopCamera : startCamera}
              variant={cameraActive ? "destructive" : "default"}
              disabled={cameraLoading}
              className={`flex items-center gap-2 ${
                cameraActive 
                  ? "bg-red-600 hover:bg-red-700 text-white" 
                  : "bg-primary hover:bg-primary/90 text-primary-foreground"
              } ${cameraLoading ? "opacity-75 cursor-not-allowed" : ""}`}
            >
              {cameraLoading ? (
                <>
                  <Icon name="Loader2" className="h-4 w-4 animate-spin" />
                  <span>{t("attendance.actions.loading", "Loading...")}</span>
                </>
              ) : cameraActive ? (
                <>
                  <Icon name="Square" className="h-4 w-4" />
                  <span>{t("attendance.actions.stopCamera", "Stop Camera")}</span>
                </>
              ) : (
                <>
                  <Icon name="Play" className="h-4 w-4" />
                  <span>{t("attendance.actions.startCamera", "Start Camera")}</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Right: Attendance log card */}
        <div className="bg-card rounded-lg border p-6 self-start">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground">{t("attendance.sections.log.title", "Attendance log")}</p>
              <div className="text-lg font-semibold">{t("attendance.sections.log.subtitle", "Arrival history")}</div>
            </div>
            <Button 
              onClick={() => refreshLog(logMeta.page, true)} 
              size="sm" 
              variant="outline"
              className="aspect-square p-2"
              title={t("attendance.actions.refresh", "Refresh")}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <label className="space-y-1">
              <span className="text-sm font-medium">{t("attendance.fields.perPage", "Items per page")}</span>
              <select
                value={perPage}
                onChange={(e) => { setPerPage(Number(e.target.value)); refreshLog(1); }}
                className="h-9 w-full rounded-md border px-3 py-1 text-sm"
              >
                {[10, 25, 50].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">{t("attendance.fields.order", "Order")}</span>
              <select
                value={order}
                onChange={(e) => { const v = e.target.value as "asc" | "desc"; setOrder(v); refreshLog(1); }}
                className="h-9 w-full rounded-md border px-3 py-1 text-sm"
              >
                <option value="desc">{t("attendance.order.desc", "Newest")}</option>
                <option value="asc">{t("attendance.order.asc", "Oldest")}</option>
              </select>
            </label>
          </div>
          <div className="rounded-lg border p-0 text-sm overflow-x-auto">
            {logItems.length === 0 ? (
              <div className="p-6">
                <p className="text-muted-foreground">{t("attendance.table.empty", "No attendance data yet.")}</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left p-3 font-medium w-16">{t("attendance.table.no", "No")}</th>
                    <th className="text-left p-3 font-medium">{t("attendance.table.name", "Name")}</th>
                    <th className="text-left p-3 font-medium">{t("attendance.table.dateTime", "Date & Time")}</th>
                    <th className="text-right p-3 font-medium w-24">{t("attendance.table.score", "Score")}</th>
                  </tr>
                </thead>
                <tbody>
                  {logItems.map((item, idx) => {
                    const no = (logMeta.page - 1) * perPage + idx + 1;
                    return (
                      <tr key={`${item.ts}-${idx}`} className="border-b last:border-0">
                        <td className="p-3">{no}</td>
                        <td className="p-3">{item.label || "-"}</td>
                        <td className="p-3">{formatDateTime(item.ts)}</td>
                        <td className="p-3 text-right font-mono">{((item.score || 0) * 100).toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {logMeta.total > 0 && logMeta.total_pages > 1 && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t pt-4 mt-4">
              <div className="text-sm text-muted-foreground">
                {t("adminAttendance.pagination.range", "{start}-{end} {records}", {
                  start: startItem,
                  end: endItem,
                  records: t("adminAttendance.pagination.recordsLabel", "records"),
                })}
              </div>
              <div className="flex items-center gap-0.5 self-end sm:self-auto">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refreshLog(1)}
                  disabled={logMeta.page <= 1}
                  title={t("adminAttendance.pagination.first", "First page")}
                  aria-label={t("adminAttendance.pagination.first", "First page")}
                  className="h-7 px-1.5"
                >
                  <ChevronsLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refreshLog(Math.max(1, logMeta.page - 1))}
                  disabled={logMeta.page <= 1}
                  title={t("adminAttendance.pagination.prev", "Previous")}
                  aria-label={t("adminAttendance.pagination.prev", "Previous")}
                  className="h-7 px-1.5"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                {paginationItems.map((item, idx) => {
                  if (item.type === "ellipsis") {
                    return (
                      <span
                        key={`ellipsis-${item.key}-${idx}`}
                        className="px-1 text-xs text-muted-foreground select-none"
                      >
                        ...
                      </span>
                    );
                  }

                  if (item.type === "page") {
                    const isActive = item.page === logMeta.page;
                    return (
                      <Button
                        key={`page-${item.page}`}
                        variant={isActive ? "default" : "outline"}
                        size="sm"
                        onClick={() => refreshLog(item.page)}
                        disabled={isActive}
                        title={t("adminAttendance.pagination.goToPage", "Go to page {page}", { page: item.page })}
                        aria-label={t("adminAttendance.pagination.goToPage", "Go to page {page}", { page: item.page })}
                        aria-current={isActive ? "page" : undefined}
                        className="h-7 min-w-7 px-2 text-xs"
                      >
                        {item.page}
                      </Button>
                    );
                  }

                  const isLastActive = logMeta.page === item.page;
                  return (
                    <Button
                      key={`last-${item.page}`}
                      variant={isLastActive ? "default" : "outline"}
                      size="sm"
                      onClick={() => refreshLog(item.page)}
                      disabled={isLastActive}
                      title={t("adminAttendance.pagination.goToLast", "Go to last page")}
                      aria-label={t("adminAttendance.pagination.goToLast", "Go to last page")}
                      aria-current={isLastActive ? "page" : undefined}
                      className="h-7 min-w-7 px-2 text-xs"
                    >
                      {item.page}
                    </Button>
                  );
                })}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refreshLog(Math.min(logMeta.total_pages, logMeta.page + 1))}
                  disabled={logMeta.page >= logMeta.total_pages}
                  title={t("adminAttendance.pagination.next", "Next")}
                  aria-label={t("adminAttendance.pagination.next", "Next")}
                  className="h-7 px-1.5"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refreshLog(logMeta.total_pages)}
                  disabled={logMeta.page >= logMeta.total_pages}
                  title={t("adminAttendance.pagination.last", "Last page")}
                  aria-label={t("adminAttendance.pagination.last", "Last page")}
                  className="h-7 px-1.5"
                >
                  <ChevronsRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
