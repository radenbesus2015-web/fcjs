// app/absensi-fun-meter/page.tsx
// Port dari src-vue-original/pages/default/AttendanceFunMeterPage.vue

"use client";

// Rotating ad media (images and videos)
interface AdMedia {
  src: string;
  type: 'image' | 'video';
}

import React, { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/providers/I18nProvider";
import { useSettings } from "@/components/providers/SettingsProvider";
import { useWs } from "@/components/providers/WsProvider";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/common/Icon";
import { fetchActiveAdvertisements } from "@/lib/supabase-advertisements";

interface AttendanceFunResult {
  // Attendance data
  attendance?: {
    name: string;
    confidence: number;
    bbox?: [number, number, number, number];
  }[];
  marked?: string[];
  marked_info?: Array<{
    label: string;
    message: string;
  }>;
  
  // Fun meter data
  emotions?: Array<{
    emotion: string;
    confidence: number;
    bbox?: [number, number, number, number];
  }>;
}

interface AttendanceResult {
  bbox?: [number, number, number, number];
  box?: [number, number, number, number];
  label?: string;
  name?: string;
  score?: number;
  [key: string]: unknown;
}

interface EmotionResult {
  bbox: [number, number, number, number];
  expr?: string;
  emotion?: string;
  score?: number;
  probs?: Record<string, number>;
  [key: string]: unknown;
}

interface AttResultData {
  results?: AttendanceResult[];
  marked?: string[];
  marked_info?: Array<{
    label?: string;
    score?: number;
    message?: string;
  }>;
  [key: string]: unknown;
}

interface FunResultData {
  results?: EmotionResult[];
  [key: string]: unknown;
}

interface LastAttResults {
  t: number;
  results: AttendanceResult[];
}

export default function AttendanceFunMeterPage() {
  // Dynamic Ads: load from localStorage override or public index.json, fallback to defaults
  const [adMediaList, setAdMediaList] = useState<AdMedia[]>([
    { src: "/assets/advertisements/images/upskilling.png", type: 'image' },
    { src: "/assets/advertisements/images/nobox.jpg", type: 'image' },
    { src: "/assets/advertisements/videos/iklan.mp4", type: 'video' },
    { src: "/assets/advertisements/images/karyasmk.jpg", type: 'image' },
    { src: "/assets/advertisements/images/expo.jpg", type: 'image' },
  ]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // Load active advertisements from backend API
        const data = await fetchActiveAdvertisements();
        if (cancelled) return;
        
        // Convert backend Advertisement to AdMedia
        const list: AdMedia[] = data
          .filter((ad) => ad.enabled) // Only enabled ads
          .sort((a, b) => (a.display_order || 0) - (b.display_order || 0)) // Sort by display_order
          .map((ad) => ({
            src: ad.src,
            type: ad.type as 'image' | 'video',
          }));
        
        if (list.length && !cancelled) {
          setAdMediaList(list);
        } else if (!cancelled) {
          // Fallback to default ads if no active ads found
          setAdMediaList([
            { src: "/assets/advertisements/images/upskilling.png", type: 'image' },
            { src: "/assets/advertisements/images/nobox.jpg", type: 'image' },
            { src: "/assets/advertisements/videos/iklan.mp4", type: 'video' },
            { src: "/assets/advertisements/images/karyasmk.jpg", type: 'image' },
            { src: "/assets/advertisements/images/expo.jpg", type: 'image' },
          ]);
        }
      } catch (e) {
        console.warn('[ADS] Failed to load ads from backend, using defaults', e);
        if (!cancelled) {
          // Fallback to default ads on error
          setAdMediaList([
            { src: "/assets/advertisements/images/upskilling.png", type: 'image' },
            { src: "/assets/advertisements/images/nobox.jpg", type: 'image' },
            { src: "/assets/advertisements/videos/iklan.mp4", type: 'video' },
            { src: "/assets/advertisements/images/karyasmk.jpg", type: 'image' },
            { src: "/assets/advertisements/images/expo.jpg", type: 'image' },
          ]);
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);
  const { t } = useI18n();
  const { useSetting } = useSettings();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  // Responsive canvas handling
  const fitCanvasToVideo = useCallback(() => {
    const overlay = overlayRef.current;
    const host = hostRef.current || videoRef.current;
    if (!overlay || !host) return;
    
    const rect = host.getBoundingClientRect();
    const DPR = window.devicePixelRatio || 1;

    overlay.width = Math.round(rect.width * DPR);
    overlay.height = Math.round(rect.height * DPR);
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";

    const ctx = overlay.getContext("2d");
    if (ctx) {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, overlay.width, overlay.height);
    }
  }, []);

  // Responsive alignment
  const alignOverlay = useCallback(() => {
    fitCanvasToVideo();
  }, [fitCanvasToVideo]);
  
  const [cameraActive, setCameraActive] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [sendingFun, setSendingFun] = useState(false);
  const [sendingAtt, setSendingAtt] = useState(false);
  const [attendanceResults, setAttendanceResults] = useState<AttendanceResult[]>([]);
  const [emotionResults, setEmotionResults] = useState<EmotionResult[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lastAttPush, setLastAttPush] = useState(0);
  const [lastAttResults, setLastAttResults] = useState<LastAttResults>({ t: 0, results: [] });
  
  const snapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sendHeightRef = useRef(0);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const DPRRef = useRef(1);

  // Settings
  const { model: baseInterval } = useSetting("baseInterval", { clamp: { max: 5000, round: true } });
  const { model: attSendWidth } = useSetting("attendance.sendWidth", { 
    clamp: { min: 160, max: 1920, round: true } 
  });
  const { model: funSendWidth } = useSetting("funMeter.sendWidth", { 
    clamp: { min: 160, max: 1920, round: true } 
  });
  const { model: jpegQuality } = useSetting("attendance.jpegQuality", { clamp: { min: 0, max: 1 } });
  const { model: funIntervalMs } = useSetting("funMeter.funIntervalMs", { clamp: { min: 100, max: 2000, round: true } });

  // WebSocket connection
  const socket = useWs({
    url: "",
    root: true,
    on: {
      connect() {
        setStatusText("WS connected");
        toast.success(t("attendanceFunMeter.toast.wsConnected", "Terhubung ke server WebSocket"), { duration: 3000 });
      },
      disconnect(...args: unknown[]) {
        setStatusText("WS disconnected");
        toast.warn(t("attendanceFunMeter.toast.wsDisconnected", "Koneksi WebSocket terputus"), { duration: 3000 });
      },
      att_result(...args: unknown[]) {
        const data = args[0] as AttResultData;
        const results = Array.isArray(data?.results) ? data.results : [];
        console.log("[ATT_RESULT] Received:", { results, marked: data?.marked, marked_info: data?.marked_info });
        setAttendanceResults(results);
        setLastAttResults({ t: Date.now(), results });
        
        // Handle successful attendance
        const marked = Array.isArray(data?.marked) ? data.marked : [];
        const markedInfo = Array.isArray(data?.marked_info) ? data.marked_info : [];
        
        console.log("[ATTENDANCE] Marked:", marked, "MarkedInfo:", markedInfo);
        
        for (const info of markedInfo) {
          const label = info.label || "";
          const score = info.score ? ` (${(info.score * 100).toFixed(1)}%)` : "";
          const message = info.message || t("attendanceFunMeter.toast.attendanceSuccess", "✅ Absen berhasil: {label}{score}", { label, score });
          if (label) {
            console.log("[ATTENDANCE] Showing toast for:", label);
            toast.success(message, { duration: 5000 });
          }
        }
        
        if (!markedInfo.length && marked.length > 0) {
          for (const label of marked) {
            console.log("[ATTENDANCE] Showing toast for (fallback):", label);
            toast.success(t("attendanceFunMeter.toast.attendanceSuccess", "✅ Absen berhasil: {label}", { label }), {
              duration: 5000,
            });
          }
        }
        
        // Redraw with latest emotion results
        if (emotionResults.length > 0) {
          drawFun(emotionResults);
        }
      },
      fun_result(...args: unknown[]) {
        const data = args[0] as FunResultData;
        const results = Array.isArray(data?.results) ? data.results : [];
        console.log("[FUN_RESULT] Received", results.length, "emotion results:", results);
        setEmotionResults(results);
        drawFun(results);
      },
    },
  });

  // Helper functions
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  
  const mapExprLabel = (s: string): string => {
    const k = String(s || "").toLowerCase().trim();
    if (["happiness", "happy", "senang"].includes(k)) return "Senang";
    if (["sadness", "sad", "sedih"].includes(k)) return "Sedih";
    if (["surprise", "surprised", "kaget"].includes(k)) return "Kaget";
    if (["anger", "angry", "marah"].includes(k)) return "Marah";
    if (["fear", "fearful", "takut"].includes(k)) return "Takut";
    if (["disgust", "disgusted", "jijik"].includes(k)) return "Jijik";
    if (["neutral", "biasa"].includes(k)) return "Biasa";
    return "Biasa";
  };
  
  const capitalizeFirstLetter = (str: string) => {
    return typeof str === "string" && str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
  };
  
  const iou = (a: number[], b: number[]) => {
    const ax2 = a[0] + a[2], ay2 = a[1] + a[3];
    const bx2 = b[0] + b[2], by2 = b[1] + b[3];
    const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
    const x2 = Math.min(ax2, bx2), y2 = Math.min(ay2, by2);
    const iw = Math.max(0, x2 - x1), ih = Math.max(0, y2 - y1);
    const inter = iw * ih, ua = a[2] * a[3] + b[2] * b[3] - inter;
    return ua > 0 ? inter / ua : 0;
  };
  
  const fuseName = (funBox: number[]) => {
    const now = Date.now();
    if (!lastAttResults.results.length || now - lastAttResults.t > 1800) {
      console.log("[FUSION] No att results or too old"); // DEBUG LOG
      return null;
    }
    let best: AttendanceResult | null = null, bestIoU = 0;
    for (const r of lastAttResults.results) {
      const i = iou(funBox, r.bbox || r.box || [0, 0, 0, 0]);
      if (i > bestIoU) {
        bestIoU = i;
        best = r;
      }
    }
    const result = best && best.label && bestIoU >= 0.25 ? best.label : null;
    console.log("[FUSION] Best match:", best?.label, "IoU:", bestIoU.toFixed(3), "-> Result:", result); // DEBUG LOG
    return result;
  };
  
  const EXP_COLORS: Record<string, string> = {
    Marah: "#ef4444", Sedih: "#3b82f6", Senang: "#22c55e", Biasa: "#9ca3af",
    Kaget: "#f97316", Takut: "#9333ea", Jijik: "#8CA42B",
  };
  
  
  const ensureSnapSize = () => {
    const v = videoRef.current;
    if (!v) return false;
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return false;
    sendHeightRef.current = Math.round((Number(funSendWidth) * vh) / vw);
    if (!snapCanvasRef.current) {
      snapCanvasRef.current = document.createElement("canvas");
    }
    snapCanvasRef.current.width = Number(funSendWidth);
    snapCanvasRef.current.height = sendHeightRef.current;
    return true;
  };
  
  const getLetterboxTransform = () => {
    const overlay = overlayRef.current;
    const video = videoRef.current;
    const host = overlay?.parentElement || video;
    if (!host || !video) return { sx: 1, sy: 1, ox: 0, oy: 0 };
    
    const rect = host.getBoundingClientRect();
    const dispW = rect.width, dispH = rect.height;
    
    // Bbox dari server menggunakan koordinat snapCanvas (yang dikirim ke server)
    // SnapCanvas dibuat dengan: drawImage(video, 0, 0, snapW, snapH)
    // Jadi koordinat di snapCanvas proporsional dengan video asli
    
    // Dimensi snapCanvas (yang dikirim ke server)
    const snapW = Number(funSendWidth);
    const snapH = sendHeightRef.current;
    
    // Dimensi video asli
    const videoW = video.videoWidth;
    const videoH = video.videoHeight;
    
    if (!snapW || !snapH || !videoW || !videoH) {
      // Fallback: langsung dari snapCanvas ke display
      return { sx: dispW / snapW, sy: dispH / snapH, ox: 0, oy: 0 };
    }
    
    // Transformasi: snapCanvas -> video asli -> display
    // Karena snapCanvas diambil dari video dengan drawImage, koordinatnya proporsional
    // Scale factor dari snapCanvas ke video asli
    const scaleX = videoW / snapW;
    const scaleY = videoH / snapH;
    
    // Transform dari video asli ke display (dengan object-fit: cover)
    const videoAspect = videoW / videoH;
    const displayAspect = dispW / dispH;
    
    let sx, sy, ox = 0, oy = 0;
    
    if (displayAspect > videoAspect) {
      // Display lebih lebar - video mengisi lebar, crop atas/bawah
      // Video di-scale ke lebar display
      const displayScale = dispW / videoW;
      sx = displayScale * scaleX; // dari snapCanvas langsung ke display
      sy = displayScale * scaleY;
      // Offset vertikal untuk letterbox (crop atas/bawah)
      const scaledVideoH = videoH * displayScale;
      oy = (dispH - scaledVideoH) / 2;
    } else {
      // Display lebih tinggi - video mengisi tinggi, crop kiri/kanan
      // Video di-scale ke tinggi display
      const displayScale = dispH / videoH;
      sx = displayScale * scaleX; // dari snapCanvas langsung ke display
      sy = displayScale * scaleY;
      // Offset horizontal untuk letterbox (crop kiri/kanan)
      const scaledVideoW = videoW * displayScale;
      ox = (dispW - scaledVideoW) / 2;
    }
    
    return { sx, sy, ox, oy };
  };
  
  // Drawing functions
  const drawBoxWithLabels = (x: number, y: number, w: number, h: number, name: string, expr: string, color: string) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
    const overlay = overlayRef.current;
    const hostRect = (overlay?.parentElement || videoRef.current)?.getBoundingClientRect();
    if (!hostRect) return;
    const padX = 10, padY = 4, th = 24, gap = 6;
    ctx.font = "14px ui-sans-serif";
    ctx.textBaseline = "middle";
    
    // TOP name
    const topText = capitalizeFirstLetter(name || "Unknown");
    const topW = Math.ceil(ctx.measureText(topText).width) + padX * 2;
    let topX = clamp(Math.round(x), 2, Math.round(hostRect.width - topW - 2));
    let topY = Math.round(y - th - gap);
    if (topY < 0) topY = Math.max(Math.round(y + 2), Math.round(y + 2));
    ctx.fillStyle = "rgba(2,6,23,0.88)";
    ctx.fillRect(topX, topY, topW, th);
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.strokeRect(topX, topY, topW, th);
    ctx.restore();
    ctx.fillStyle = "#e5e7eb";
    ctx.textAlign = "center";
    ctx.fillText(topText, topX + topW / 2, topY + th / 2);
    
    // BOTTOM expr
    const botText = capitalizeFirstLetter(expr || "Biasa");
    const botW = Math.ceil(ctx.measureText(botText).width) + padX * 2;
    let botX = clamp(Math.round(x), 2, Math.round(hostRect.width - botW - 2));
    let botY = Math.round(y + h + gap);
    if (botY + th > hostRect.height) botY = Math.max(Math.round(y + h - th - 2), Math.round(y + 2));
    ctx.fillStyle = "rgba(2,6,23,0.88)";
    ctx.fillRect(botX, botY, botW, th);
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.strokeRect(botX, botY, botW, th);
    ctx.restore();
    ctx.fillStyle = "#e5e7eb";
    ctx.textAlign = "center";
    ctx.fillText(botText, botX + botW / 2, botY + th / 2);
  };
  
  const drawFun = (results: EmotionResult[]) => {
    // Ensure snap size is calculated
    if (!ensureSnapSize()) {
      console.log("[DRAW_FUN] Cannot ensure snap size");
      return;
    }
    
    const overlay = overlayRef.current;
    const ctx = ctxRef.current;
    if (!overlay || !ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.lineWidth = 3;
    const { sx, sy, ox, oy } = getLetterboxTransform();
    
    // Debug logging (bisa di-disable setelah fix)
    if (results && results.length > 0) {
      const video = videoRef.current;
      const snapW = Number(funSendWidth);
      const snapH = sendHeightRef.current;
      console.log('[DRAW_FUN] Transform:', { 
        snapW, snapH, 
        videoW: video?.videoWidth, 
        videoH: video?.videoHeight,
        sx, sy, ox, oy,
        resultsCount: results.length 
      });
    }
    
    let missingName = false;
    (results || []).forEach((r) => {
      const [bx, by, bw, bh] = r.bbox || [0, 0, 0, 0];
      // Transform dari koordinat snapCanvas ke koordinat display
      // Bbox dari server dalam koordinat snapCanvas, transform ke display
      const x = ox + bx * sx;
      const y = oy + by * sy;
      const w = bw * sx;
      const h = bh * sy;
      
      const exprRaw = (r.top?.label || r.expression || r.emotion || "Biasa").trim();
      const expr = mapExprLabel(exprRaw);
      const fused = fuseName([bx, by, bw, bh]);
      const name = fused || r.label || r.name || "Unknown";
      if (!fused) missingName = true;
      const color = EXP_COLORS[expr] || "#38bdf8";
      drawBoxWithLabels(x, y, w, h, name, expr, color);
    });
    const now = Date.now();
    if (missingName && now - lastAttPush > 400) {
      pushAttFrame();
    } else if (now - lastAttPush > Number(baseInterval)) {
      pushAttFrame();
    }
  };
  
  // Frame encoding and sending
  const toBytes = async () => {
    if (!snapCanvasRef.current) return null;
    const canvas = snapCanvasRef.current;
    const preferWebP = !!document.createElement("canvas").toDataURL("image/webp").match("data:image/webp");
    const type = preferWebP ? "image/webp" : "image/jpeg";
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, Number(jpegQuality)));
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  };
  
  const pushFunFrame = useCallback(async () => {
    if (!socket) {
      console.log("[PUSH_FUN_FRAME] No socket");
      return;
    }
    if (!socket.socket?.connected) {
      console.log("[PUSH_FUN_FRAME] Socket not connected");
      return;
    }
    if (sendingFun) {
      console.log("[PUSH_FUN_FRAME] Already sending");
      return;
    }
    if (!ensureSnapSize()) {
      console.log("[PUSH_FUN_FRAME] Cannot ensure snap size");
      return;
    }
    
    setSendingFun(true);
    try {
      const snapCanvas = snapCanvasRef.current;
      const video = videoRef.current;
      if (!snapCanvas || !video) {
        console.log("[PUSH_FUN_FRAME] Missing canvas or video");
        return;
      }
      const sctx = snapCanvas.getContext("2d");
      if (!sctx) {
        console.log("[PUSH_FUN_FRAME] Cannot get canvas context");
        return;
      }
      sctx.drawImage(video, 0, 0, snapCanvas.width, snapCanvas.height);
      const bytes = await toBytes();
      if (bytes && socket) {
        console.log("[PUSH_FUN_FRAME] Sending frame, size:", bytes.length);
        socket.emit("fun_frame", bytes);
      }
    } catch (error) {
      console.error("[PUSH_FUN_FRAME] Error:", error);
    } finally {
      setSendingFun(false);
    }
  }, [socket, sendingFun]);
  
  const pushAttFrame = async () => {
    if (!socket || !socket.socket?.connected || sendingAtt || !ensureSnapSize()) return;
    setSendingAtt(true);
    try {
      const snapCanvas = snapCanvasRef.current;
      const video = videoRef.current;
      if (!snapCanvas || !video) return;
      const sctx = snapCanvas.getContext("2d");
      if (!sctx) return;
      sctx.drawImage(video, 0, 0, snapCanvas.width, snapCanvas.height);
      const bytes = await toBytes();
      if (bytes && socket) {
        console.log("[PUSH_ATT_FRAME] Sending frame, size:", bytes.length); // DEBUG LOG
        socket.emit("att_frame", bytes);
        setLastAttPush(Date.now());
      }
    } finally {
      setSendingAtt(false);
    }
  };

  // Camera functions (direct implementation like Vue original)
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraActiveRef = useRef(false);
  
  // Simple ad slideshow state
  const [currentAdIndex, setCurrentAdIndex] = useState(0);
  const adVideoRef = useRef<HTMLVideoElement>(null);
  const adTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [repeatCount, setRepeatCount] = useState(3); // Jumlah repeat iklan ke kanan dan kiri (total = 1 center + 3 kiri + 3 kanan = 7)

  // Optimized preload: hanya preload current dan next ad
  const preloadedVideos = useRef<Map<string, HTMLVideoElement>>(new Map());
  
  useEffect(() => {
    const currentAd = adMediaList[currentAdIndex];
    const nextIndex = (currentAdIndex + 1) % adMediaList.length;
    const nextAd = adMediaList[nextIndex];
    
    // Preload current ad
    if (currentAd && currentAd.type === 'video' && !preloadedVideos.current.has(currentAd.src)) {
      const video = document.createElement('video');
      video.src = currentAd.src;
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      video.load();
      preloadedVideos.current.set(currentAd.src, video);
    }
    
    // Preload next ad
    if (nextAd && nextAd.type === 'video' && !preloadedVideos.current.has(nextAd.src)) {
      const video = document.createElement('video');
      video.src = nextAd.src;
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      video.load();
      preloadedVideos.current.set(nextAd.src, video);
    }
    
    // Cleanup old preloaded videos (keep only current and next)
    const keepSources = new Set([currentAd?.src, nextAd?.src]);
    preloadedVideos.current.forEach((video, src) => {
      if (!keepSources.has(src)) {
        video.src = '';
        preloadedVideos.current.delete(src);
      }
    });
  }, [currentAdIndex, adMediaList]);

  const startCamera = async () => {
    const video = videoRef.current;
    if (!video) return;
    
    try {
      console.log("Starting camera..."); // DEBUG
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: false 
      });
      
      video.srcObject = mediaStream;
      setStream(mediaStream);
      streamRef.current = mediaStream;
      
      // Wait for video to load
      await new Promise<void>((resolve) => {
        if (video.readyState >= 2) {
          resolve();
        } else {
          video.onloadedmetadata = () => resolve();
        }
      });
      
      console.log("Camera started successfully"); // DEBUG
      console.log("Video dimensions:", video.videoWidth, "x", video.videoHeight); // DEBUG
      setCameraActive(true);
      cameraActiveRef.current = true;
      setStatusText("Camera active");
      
      // Smart video fit: ensure responsive and compatible with various cameras
      const videoAspectRatio = video.videoWidth / video.videoHeight;
      const container = hostRef.current;
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const containerAspectRatio = containerRect.width / containerRect.height;
        
        // If aspect ratios are very different, use cover to avoid black bars
        // If similar, can use fill for exact fit (but cover is safer)
        const ratioDiff = Math.abs(videoAspectRatio - containerAspectRatio);
        if (ratioDiff > 0.3) {
          // Very different aspect ratio - use cover to avoid distortion and black bars
          video.style.objectFit = 'cover';
          console.log("[VIDEO] Using cover mode (aspect ratio difference:", ratioDiff.toFixed(2), ")");
        } else {
          // Similar aspect ratio - can use cover or fill
          video.style.objectFit = 'cover';
          console.log("[VIDEO] Using cover mode (aspect ratio similar)");
        }
      }
      
      // Ensure canvas sizing after video loads
      ensureSnapSize();
      fitCanvasToVideo();
      
    } catch (error) {
      console.error("Camera error:", error); // DEBUG
      setStatusText("Camera blocked");
      toast.error(t("attendanceFunMeter.toast.cameraAccessError", "Gagal mengakses kamera."), { duration: 4000 });
    }
  };

  const stopCamera = () => {
    const currentStream = streamRef.current || stream;
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
      setStream(null);
      streamRef.current = null;
    }
    
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }
    
    setCameraActive(false);
    cameraActiveRef.current = false;
    setStatusText("Camera stopped");
  };

  // Fullscreen functions
  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Setup canvas and responsive listeners
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    ctxRef.current = ctx;
    if (ctx) {
      ctx.lineJoin = "miter";
      ctx.lineCap = "butt";
      ctx.miterLimit = 10;
    }

    // Setup canvas/context (ensure NO rounded CSS)
    overlay.style.borderRadius = "0";
    overlay.classList.remove("rounded", "rounded-md", "rounded-lg", "rounded-xl", "overflow-hidden");

    fitCanvasToVideo();

    // Camera will NOT auto-start - user must click button to start
    // This ensures camera stops when navigating away and stays off on mount

    // Responsive event listeners (like Vue original)
    const handleResize = () => {
      ensureSnapSize();
      alignOverlay();
    };

    const handleOrientationChange = () => {
      setTimeout(alignOverlay, 80);
    };

    const handleVisualViewportResize = () => {
      setTimeout(alignOverlay, 30);
    };

    const handleVisualViewportScroll = () => {
      setTimeout(alignOverlay, 30);
    };

    // ResizeObserver for host element
    let resizeObserver: ResizeObserver | null = null;
    if (hostRef.current) {
      resizeObserver = new ResizeObserver(() => alignOverlay());
      resizeObserver.observe(hostRef.current);
    }

    // Event listeners
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleOrientationChange);
    
    if (window.visualViewport) {
      const vv = window.visualViewport;
      vv.addEventListener("resize", handleVisualViewportResize);
      vv.addEventListener("scroll", handleVisualViewportScroll);
    }

    const video = videoRef.current;
    if (video) {
      video.addEventListener("loadedmetadata", alignOverlay);
      video.addEventListener("resize", alignOverlay);
    }

    // Watch videoWidth/Height changes and update video fit responsively
    let prevVw = 0;
    let prevVh = 0;
    const videoWatchInterval = setInterval(() => {
      const v = videoRef.current;
      if (!v) return;
      const vw = v.videoWidth | 0;
      const vh = v.videoHeight | 0;
      if (!prevVw || vw !== prevVw || vh !== prevVh) {
        prevVw = vw;
        prevVh = vh;
        
        // Update video fit when dimensions change (for different cameras)
        if (vw > 0 && vh > 0) {
          const videoAspectRatio = vw / vh;
          const container = hostRef.current;
          if (container) {
            const containerRect = container.getBoundingClientRect();
            const containerAspectRatio = containerRect.width / containerRect.height;
            const ratioDiff = Math.abs(videoAspectRatio - containerAspectRatio);
            
            // Ensure video always fills container without black bars
            v.style.objectFit = 'cover';
            v.style.objectPosition = 'center center';
            
            if (ratioDiff > 0.3) {
              console.log("[VIDEO] Aspect ratio changed, using cover mode (diff:", ratioDiff.toFixed(2), ")");
            }
          }
        }
        
        alignOverlay();
      }
    }, 400);

    return () => {
      // Cleanup all listeners
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleOrientationChange);
      
      if (window.visualViewport) {
        const vv = window.visualViewport;
        vv.removeEventListener("resize", handleVisualViewportResize);
        vv.removeEventListener("scroll", handleVisualViewportScroll);
      }

      if (video) {
        video.removeEventListener("loadedmetadata", alignOverlay);
        video.removeEventListener("resize", alignOverlay);
      }

      resizeObserver?.disconnect();
      clearInterval(videoWatchInterval);
    };
  }, [alignOverlay]);

  // Auto-start camera on mount and keep it active
  useEffect(() => {
    let isMounted = true;
    
    // Auto-start camera when component mounts
    const initCamera = async () => {
      if (!cameraActiveRef.current && videoRef.current && isMounted) {
        await startCamera();
      }
    };
    initCamera();
    
    // Handle visibility change - keep camera active when tab becomes visible again
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !cameraActiveRef.current && videoRef.current && isMounted) {
        // Restart camera if it was stopped while tab was hidden
        console.log("[CAMERA] Tab visible again, restarting camera");
        startCamera();
      }
    };
    
    // Handle pagehide - only stop camera when actually leaving the page
    const handlePageHide = () => {
      const currentStream = streamRef.current;
      if (currentStream) {
        console.log("[CAMERA] Page hiding, stopping camera");
        currentStream.getTracks().forEach(track => track.stop());
        setStream(null);
        streamRef.current = null;
        setCameraActive(false);
        cameraActiveRef.current = false;
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    
    return () => {
      isMounted = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      // Only stop camera on unmount (when navigating away from this page)
      const currentStream = streamRef.current;
      if (currentStream) {
        console.log("[CAMERA] Component unmounting, stopping camera");
        currentStream.getTracks().forEach(track => track.stop());
        setStream(null);
        streamRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run on mount/unmount

  // Setup fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);
  
  // Setup frame sending intervals
  useEffect(() => {
    if (!socket) {
      console.log("[WS_SETUP] No socket available");
      return;
    }
    
    console.log("[WS_SETUP] Socket available, connected:", socket.socket?.connected);
    
    // Send attendance config when socket connects
    const handleConnect = () => {
      console.log("[WS] Socket connected, sending att_cfg");
      try {
        socket.emit("att_cfg", { th: 0.4, mark: true });
      } catch (e) {
        console.error("Failed to send att_cfg:", e);
      }
    };
    
    // Send config immediately if already connected
    if (socket.socket?.connected) {
      handleConnect();
    }
    
    // Listen for connect event
    socket.on("connect", handleConnect);
    
    // Setup interval for sending fun frames
    console.log("[WS_SETUP] Setting up fun frame interval:", funIntervalMs, "ms");
    const funInterval = setInterval(() => {
      pushFunFrame();
    }, Number(funIntervalMs));
    
    return () => {
      console.log("[WS_SETUP] Cleaning up");
      socket.off("connect", handleConnect);
      clearInterval(funInterval);
    };
  }, [socket, funIntervalMs, pushFunFrame]);

    useEffect(() => {
    const handleEsc = (event : KeyboardEvent) => {
      if (event.key === "Escape") {
        router.back(); // fungsi sama seperti klik tombol
      }
    };

    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [router]);

  // Emotion color mapping
  const getEmotionColor = (emotion: string): string => {
    const colors: Record<string, string> = {
      happy: "text-green-400",
      sad: "text-blue-400",
      angry: "text-red-400",
      surprised: "text-yellow-400",
      fear: "text-purple-400",
      disgust: "text-orange-400",
      neutral: "text-gray-400",
    };
    return colors[emotion] || "text-gray-400";
  };
  
  // Ad rotation logic: 5 detik untuk foto, auto-advance untuk video setelah selesai
  const goToNextAd = useCallback(() => {
    setCurrentAdIndex((prevIndex) => (prevIndex + 1) % Math.max(1, adMediaList.length));
  }, [adMediaList.length]);

  useEffect(() => {
    const currentAd = adMediaList[currentAdIndex];
    
    // Clear any existing timer
    if (adTimerRef.current) {
      clearTimeout(adTimerRef.current);
      adTimerRef.current = null;
    }
    
    if (!currentAd) return;
    
    if (currentAd.type === 'image') {
      // Untuk gambar, langsung set timer tanpa delay
      adTimerRef.current = setTimeout(() => {
        goToNextAd();
      }, 5000);
    } else if (currentAd.type === 'video') {
      // Untuk video, hanya play center video (CSS akan handle clone visual)
      const centerVideo = adVideoRef.current;
      if (centerVideo) {
        centerVideo.currentTime = 0;
        centerVideo.play().catch(() => {
          // Retry sekali jika gagal
          setTimeout(() => centerVideo.play().catch(() => {}), 100);
        });
      }
    }
    
    return () => {
      if (adTimerRef.current) {
        clearTimeout(adTimerRef.current);
      }
    };
  }, [currentAdIndex, adMediaList, goToNextAd]);

  // Preload next ad for seamless transition
  useEffect(() => {
    const nextIndex = adMediaList.length ? (currentAdIndex + 1) % adMediaList.length : 0;
    const nextAd = adMediaList[nextIndex];
    
    if (nextAd && nextAd.type === 'video') {
      // Preload next video
      const preloadVideo = document.createElement('video');
      preloadVideo.src = nextAd.src;
      preloadVideo.preload = 'auto';
      preloadVideo.load();
      
      return () => {
        preloadVideo.src = '';
      };
    } else if (nextAd && nextAd.type === 'image') {
      // Preload next image
      const preloadImage = new window.Image();
      preloadImage.src = nextAd.src;
    }
  }, [currentAdIndex]);

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        /* Layout grid: 3 bagian - header, video+iklan overlay, footer */
        .page-root {
          /* Aspect ratio based layout - menyesuaikan exact dengan image dimensions */
          /* Header dan Footer menggunakan aspect ratio inline style */
          /* Video: menggunakan sisa space yang ada dengan iklan overlay */
          
          color: white;
          width: 100vw;
          height: 100vh;
          overflow: hidden;
          display: grid;
          grid-template-rows: auto 1fr auto;
          position: relative;
          background: #000;
        }

        /* Anti rounded di overlay + object-fill video */
        #overlay {
          border-radius: 0 !important;
          overflow: visible !important;
        }
        
        #video {
          object-fit: cover;
          object-position: center center;
          background: #000;
        }
        
        #camera-host {
          background: #000;
        }

        /* Section styles - masing-masing independent */
        #banner_top,
        #camera,
        #ads,
        #banner_bottom {
          width: 100%;
          overflow: hidden;
          position: relative;
        }

        #banner_top {
          z-index: 100;
        }

        /* Landscape mode - header lebih pendek dan lebar */
        @media (orientation: landscape) {
          #banner_top {
            aspect-ratio: 24 / 3 !important;
            min-height: 50px;
            max-height: 80px;
          }
        }

        /* Portrait mode - height mengikuti proporsi image header (40:4 = 10:1) */
        @media (orientation: portrait) {
          #banner_top {
            aspect-ratio: 40 / 4 !important;
            min-height: auto;
            max-height: none;
          }
        }

        /* Narrow screens - tetap proporsi image header */
        @media (orientation: portrait) and (max-width: 640px) {
          #banner_top {
            aspect-ratio: 40 / 4 !important;
          }
        }

        /* Very narrow screens - tetap proporsi image header */
        @media (orientation: portrait) and (max-width: 480px) {
          #banner_top {
            aspect-ratio: 40 / 4 !important;
          }
        }

        /* Extra narrow screens - tetap proporsi image header */
        @media (orientation: portrait) and (max-width: 360px) {
          #banner_top {
            aspect-ratio: 40 / 4 !important;
          }
        }

        /* Header image styling - always contain untuk menampilkan semua konten */
        #banner_top img {
          object-fit: contain !important;
          object-position: center !important;
        }
        
        #camera {
          z-index: 10;
        }

        #ads {
          height: var(--ads-height);
        }

        #banner_bottom {
          z-index: 100;
        }

        /* Landscape mode - footer lebih pendek dan lebar, sama dengan header */
        @media (orientation: landscape) {
          #banner_bottom {
            aspect-ratio: 24 / 2 !important;
            min-height: 50px;
            max-height: 50px;
          }
        }

        /* Portrait mode - footer mengikuti proporsi image footer (40:2 = 20:1) */
        @media (orientation: portrait) {
          #banner_bottom {
            aspect-ratio: 40 / 2 !important;
            min-height: auto;
            max-height: none;
          }
        }


        /* Simple ad display - no animation */
        .ad-container {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          width: 100%;
        }
        .ad-container img {
          max-height: 100%;
          max-width: 100%;
          object-fit: contain;
          display: block;
        }


        /* Background colors for sections */
        #ads {
          background-color: transparent;
        }
        
        /* Advertisement overlay responsive sizing - fixed width untuk repeat */
        .ad-overlay-container {
          width: 280px;
          min-width: 280px;
          /* Hardware acceleration untuk smooth rendering */
          will-change: transform;
          transform: translateZ(0);
          backface-visibility: hidden;
        }
        
        /* Video optimization */
        .ad-overlay-container video {
          will-change: transform, opacity;
          transform: translateZ(0);
          backface-visibility: hidden;
          /* Disable anti-aliasing untuk performa */
          image-rendering: -webkit-optimize-contrast;
          image-rendering: crisp-edges;
        }
        
        /* Portrait mode - smaller ads */
        @media (orientation: portrait) {
          .ad-overlay-container {
            width: 240px;
            min-width: 240px;
          }
        }
        
        /* Landscape mode - medium ads */
        @media (orientation: landscape) {
          .ad-overlay-container {
            width: 350px;
            min-width: 350px;
          }
        }
        
        /* Large landscape screens */
        @media (orientation: landscape) and (min-width: 1024px) {
          .ad-overlay-container {
            width: 450px;
            min-width: 450px;
          }
        }
        
        /* Extra large screens */
        @media (min-width: 1920px) {
          .ad-overlay-container {
            width: 600px;
            min-width: 600px;
          }
        }

        /* Responsive - aspect ratio calculation otomatis untuk semua device */
        /* Tidak perlu media queries karena calculation sudah proporsional */

        /* Toast responsive styling */
        .toast-container {
          position: fixed !important;
          top: 20px !important;
          right: 20px !important;
          z-index: 9999 !important;
          max-width: 400px !important;
          width: auto !important;
        }

        .toast {
          max-width: 400px !important;
          min-width: 280px !important;
          font-size: 14px !important;
          padding: 12px 16px !important;
          border-radius: 8px !important;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
          backdrop-filter: blur(8px) !important;
        }

        /* Portrait mode - smaller toast */
        @media (orientation: portrait) {
          .toast-container {
            top: 8px !important;
            right: 8px !important;
            left: 8px !important;
            max-width: calc(100vw - 16px) !important;
          }
          
          .toast {
            max-width: 100% !important;
            min-width: auto !important;
            font-size: 11px !important;
            padding: 8px 10px !important;
          }
        }

        /* Responsive toast for different screen sizes */
        @media (max-width: 768px) {
          .toast-container {
            top: 10px !important;
            right: 10px !important;
            left: 10px !important;
            max-width: calc(100vw - 20px) !important;
          }
          
          .toast {
            max-width: 100% !important;
            min-width: auto !important;
            font-size: 13px !important;
            padding: 10px 14px !important;
          }
        }

        @media (max-width: 480px) {
          .toast {
            font-size: 12px !important;
            padding: 8px 12px !important;
          }
        }

        /* Large display toast adjustments */
        @media (min-width: 1920px) {
          .toast-container {
            top: 30px !important;
            right: 30px !important;
            max-width: 450px !important;
          }
          
          .toast {
            font-size: 16px !important;
            padding: 14px 18px !important;
            max-width: 450px !important;
            min-width: 320px !important;
          }
        }

        /* 4K display toast */
        @media (min-width: 3840px) {
          .toast-container {
            top: 40px !important;
            right: 40px !important;
            max-width: 500px !important;
          }
          
          .toast {
            font-size: 18px !important;
            padding: 16px 20px !important;
            max-width: 500px !important;
            min-width: 350px !important;
          }
        }
      `}} />
      <div className="page-root">
      {/* Header banner - Section 1 */}
      <section id="banner_top" className="relative w-screen overflow-hidden bg-[#006CBB]">
        <div className="relative w-full h-full">
          <Image 
            src="/assets/header/header.png"
            alt="Header"
            fill
            priority
            className="object-contain select-none pointer-events-none"
            sizes="100vw" />
        </div>
      </section>
      
      {/* Video Section with Advertisement Overlay - Section 2 */}
      <section id="camera" className="relative w-screen overflow-hidden">
        <div ref={hostRef} id="camera-host" className="relative w-full h-full flex items-center justify-center">
          <video 
            ref={videoRef} 
            id="video" 
            autoPlay 
            playsInline 
            muted 
            className="block w-full h-full object-cover"
          />
          <canvas ref={overlayRef} id="overlay" className="absolute inset-0 w-full h-full z-20 pointer-events-none" />
          
          {/* Advertisement Overlay - 1 center stay still + repeat kanan kiri */}
          {adMediaList.length > 0 && adMediaList[currentAdIndex] && (
          <div className="absolute bottom-0 left-0 right-0 z-30 flex items-end justify-center pointer-events-none overflow-hidden">
            <div className="flex items-end gap-0">
              {/* Repeat ke kiri */}
              {Array.from({ length: repeatCount }).reverse().map((_, index) => (
                <div key={`left-${index}`} className="ad-overlay-container flex-shrink-0">
                  {adMediaList[currentAdIndex].type === 'image' ? (
                    <Image 
                      src={adMediaList[currentAdIndex].src} 
                      alt={`Iklan Kiri ${index + 1}`}
                      width={600}
                      height={400}
                      priority
                      quality={100}
                      unoptimized
                      draggable={false} 
                      className="select-none pointer-events-none w-full h-auto object-contain block" 
                      style={{ filter: 'drop-shadow(0 20px 25px rgba(0, 0, 0, 0.5))', marginBottom: 0, paddingBottom: 0 }}
                      onError={(e) => {
                        console.error('[AD_IMAGE] Failed to load:', adMediaList[currentAdIndex].src);
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <video
                      src={adMediaList[currentAdIndex].src}
                      autoPlay
                      muted
                      playsInline
                      preload="auto"
                      crossOrigin="anonymous"
                      className="select-none w-full h-auto object-contain block"
                      style={{ filter: 'drop-shadow(0 20px 25px rgba(0, 0, 0, 0.5))', marginBottom: 0, paddingBottom: 0 }}
                      onLoadedData={(e) => {
                        const video = e.currentTarget;
                        video.play().catch(() => {});
                      }}
                      onError={(e) => {
                        console.error('[AD_VIDEO] Failed to load:', adMediaList[currentAdIndex].src);
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  )}
                </div>
              ))}
              
              {/* Center - iklan utama yang stay still */}
              <div className="ad-overlay-container flex-shrink-0">
                {adMediaList[currentAdIndex].type === 'image' ? (
                  <Image 
                    src={adMediaList[currentAdIndex].src} 
                    alt="Iklan Center"
                    width={600}
                    height={400}
                    priority
                    quality={100}
                    unoptimized
                    draggable={false} 
                    className="select-none pointer-events-none w-full h-auto object-contain block" 
                    style={{ filter: 'drop-shadow(0 20px 25px rgba(0, 0, 0, 0.5))', marginBottom: 0, paddingBottom: 0 }}
                    onError={(e) => {
                      console.error('[AD_IMAGE] Failed to load:', adMediaList[currentAdIndex].src);
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <video
                    ref={adVideoRef}
                    src={adMediaList[currentAdIndex].src}
                    autoPlay
                    muted
                    playsInline
                    preload="metadata"
                    crossOrigin="anonymous"
                    className="select-none w-full h-auto object-contain block"
                    style={{ filter: 'drop-shadow(0 20px 25px rgba(0, 0, 0, 0.5))', marginBottom: 0, paddingBottom: 0 }}
                    onLoadedMetadata={(e) => {
                      const video = e.currentTarget;
                      video.play().catch(() => {
                        setTimeout(() => video.play().catch(() => {}), 100);
                      });
                    }}
                    onEnded={goToNextAd}
                    onError={(e) => {
                      console.error('[AD_VIDEO] Failed to load:', adMediaList[currentAdIndex].src);
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )}
              </div>
              
              {/* Repeat ke kanan */}
              {Array.from({ length: repeatCount }).map((_, index) => (
                <div key={`right-${index}`} className="ad-overlay-container flex-shrink-0">
                  {adMediaList[currentAdIndex].type === 'image' ? (
                    <Image 
                      src={adMediaList[currentAdIndex].src} 
                      alt={`Iklan Kanan ${index + 1}`}
                      width={600}
                      height={400}
                      priority
                      quality={100}
                      unoptimized
                      draggable={false} 
                      className="select-none pointer-events-none w-full h-auto object-contain block" 
                      style={{ filter: 'drop-shadow(0 20px 25px rgba(0, 0, 0, 0.5))', marginBottom: 0, paddingBottom: 0 }}
                      onError={(e) => {
                        console.error('[AD_IMAGE] Failed to load:', adMediaList[currentAdIndex].src);
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <video
                      src={adMediaList[currentAdIndex].src}
                      autoPlay
                      muted
                      playsInline
                      preload="auto"
                      crossOrigin="anonymous"
                      className="select-none w-full h-auto object-contain block"
                      style={{ filter: 'drop-shadow(0 20px 25px rgba(0, 0, 0, 0.5))', marginBottom: 0, paddingBottom: 0 }}
                      onLoadedData={(e) => {
                        const video = e.currentTarget;
                        video.play().catch(() => {});
                      }}
                      onError={(e) => {
                        console.error('[AD_VIDEO] Failed to load:', adMediaList[currentAdIndex].src);
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
          )}
        </div>
      </section>
      
      {/* Footer Section - Section 4 */}
      <section id="banner_bottom" className="relative w-screen overflow-hidden bg-[#A3092E]">
        <div className="relative w-full h-full">
          <Image 
            src="/assets/footer/footer.png" 
            alt="Footer" 
            fill
            priority 
            className="object-contain select-none pointer-events-none"
            sizes="20vw" />
        </div>
      </section>
      </div>
    </>
  );
}
