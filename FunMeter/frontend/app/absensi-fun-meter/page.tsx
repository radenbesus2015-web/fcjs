// app/absensi-fun-meter/page.tsx
// Port dari src-vue-original/pages/default/AttendanceFunMeterPage.vue

"use client";

// Rotating ad images
const adImages = [
  "/images/upskilling.png",
  "/images/nobox.jpg",
  "/images/karyasmk.jpg",
  "/images/expo.jpg",
  "/images/eschool.png",
];

import React, { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/providers/I18nProvider";
import { useSettings } from "@/components/providers/SettingsProvider";
import { useWs } from "@/components/providers/WsProvider";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/common/Icon";

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

export default function AttendanceFunMeterPage() {
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
  const [attendanceResults, setAttendanceResults] = useState<any[]>([]);
  const [emotionResults, setEmotionResults] = useState<any[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lastAttPush, setLastAttPush] = useState(0);
  const [lastAttResults, setLastAttResults] = useState<any>({ t: 0, results: [] });
  
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
      att_result(data: any) {
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
      fun_result(data: any) {
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
    let best: any = null, bestIoU = 0;
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
    const host = overlay?.parentElement || videoRef.current;
    if (!host) return { sx: 1, sy: 1, ox: 0, oy: 0 };
    const rect = host.getBoundingClientRect();
    const dispW = rect.width, dispH = rect.height;
    return { sx: dispW / Number(funSendWidth), sy: dispH / sendHeightRef.current, ox: 0, oy: 0 };
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
  
  const drawFun = (results: any[]) => {
    if (!sendHeightRef.current) return;
    const overlay = overlayRef.current;
    const ctx = ctxRef.current;
    if (!overlay || !ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.lineWidth = 3;
    const { sx, sy, ox, oy } = getLetterboxTransform();
    let missingName = false;
    (results || []).forEach((r: any) => {
      const [bx, by, bw, bh] = r.bbox || [0, 0, 0, 0];
      const x = ox + bx * sx, y = oy + by * sy, w = bw * sx, h = bh * sy;
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
  const [headerEdgeColors, setHeaderEdgeColors] = useState({ left: '#1e3a8a', right: '#1e3a8a' });
  const [footerEdgeColors, setFooterEdgeColors] = useState({ left: '#1e3a8a', right: '#1e3a8a' });
  const [headerStrips, setHeaderStrips] = useState<{ left: string; right: string }>({ left: '', right: '' });
  const [footerStrips, setFooterStrips] = useState<{ left: string; right: string }>({ left: '', right: '' });
  
  // Marquee refs for ads
  const marqueeTrackRef = useRef<HTMLDivElement>(null);
  const marqueeSegRef = useRef<HTMLDivElement>(null);
  const [marqueeSegW, setMarqueeSegW] = useState(0);
  const measuredRef = useRef(false);

  // Extract edge colors + 1px strips from header image
  const extractHeaderEdgeColors = useCallback(() => {
    const img = new (window as any).Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      try {
        // Get left edge pixel (average of left column)
        const leftPixels = [];
        for (let y = 0; y < img.height; y += 10) {
          const pixel = ctx.getImageData(0, y, 1, 1).data;
          leftPixels.push(`rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`);
        }
        
        // Get right edge pixel (average of right column)
        const rightPixels = [];
        for (let y = 0; y < img.height; y += 10) {
          const pixel = ctx.getImageData(img.width - 1, y, 1, 1).data;
          rightPixels.push(`rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`);
        }
        
        // Use most common color or first pixel
        const leftColor = leftPixels[Math.floor(leftPixels.length / 2)] || '#1e3a8a';
        const rightColor = rightPixels[Math.floor(rightPixels.length / 2)] || '#1e3a8a';
        
        setHeaderEdgeColors({ left: leftColor, right: rightColor });

        // Build 1px vertical strips from edges
        const stripL = document.createElement('canvas');
        stripL.width = 1; stripL.height = img.height;
        const stripLCtx = stripL.getContext('2d');
        if (stripLCtx) {
          stripLCtx.drawImage(img, 0, 0, 1, img.height, 0, 0, 1, img.height);
        }
        const leftStripUrl = stripL.toDataURL('image/png');

        const stripR = document.createElement('canvas');
        stripR.width = 1; stripR.height = img.height;
        const stripRCtx = stripR.getContext('2d');
        if (stripRCtx) {
          stripRCtx.drawImage(img, img.width - 1, 0, 1, img.height, 0, 0, 1, img.height);
        }
        const rightStripUrl = stripR.toDataURL('image/png');

        setHeaderStrips({ left: leftStripUrl, right: rightStripUrl });
      } catch (error) {
        console.log('Could not extract edge colors, using defaults');
      }
    };
    img.src = '/images/header.png';
  }, []);

  // Extract edge colors + 1px strips from footer image
  const extractFooterEdgeColors = useCallback(() => {
    const img = new (window as any).Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      try {
        // Get left edge pixel (average of left column)
        const leftPixels = [];
        for (let y = 0; y < img.height; y += 10) {
          const pixel = ctx.getImageData(0, y, 1, 1).data;
          leftPixels.push(`rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`);
        }
        
        // Get right edge pixel (average of right column)
        const rightPixels = [];
        for (let y = 0; y < img.height; y += 10) {
          const pixel = ctx.getImageData(img.width - 1, y, 1, 1).data;
          rightPixels.push(`rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`);
        }
        
        // Use most common color or first pixel
        const leftColor = leftPixels[Math.floor(leftPixels.length / 2)] || '#1e3a8a';
        const rightColor = rightPixels[Math.floor(rightPixels.length / 2)] || '#1e3a8a';
        
        setFooterEdgeColors({ left: leftColor, right: rightColor });

        // Build 1px vertical strips from edges
        const stripL = document.createElement('canvas');
        stripL.width = 1; stripL.height = img.height;
        const stripLCtx = stripL.getContext('2d');
        if (stripLCtx) {
          stripLCtx.drawImage(img, 0, 0, 1, img.height, 0, 0, 1, img.height);
        }
        const leftStripUrl = stripL.toDataURL('image/png');

        const stripR = document.createElement('canvas');
        stripR.width = 1; stripR.height = img.height;
        const stripRCtx = stripR.getContext('2d');
        if (stripRCtx) {
          stripRCtx.drawImage(img, img.width - 1, 0, 1, img.height, 0, 0, 1, img.height);
        }
        const rightStripUrl = stripR.toDataURL('image/png');

        setFooterStrips({ left: leftStripUrl, right: rightStripUrl });
      } catch (error) {
        console.log('Could not extract footer edge colors, using defaults');
      }
    };
    img.src = '/images/footer.png';
  }, []);

  useEffect(() => {
    extractHeaderEdgeColors();
    extractFooterEdgeColors();
  }, [extractHeaderEdgeColors, extractFooterEdgeColors]);


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
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }
    
    setCameraActive(false);
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

    // Auto-start camera like Vue original
    const initCamera = async () => {
      await startCamera();
      fitCanvasToVideo();
    };
    initCamera();

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

  // Cleanup camera stream on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream]);

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
  // Measure marquee segment width for seamless loop
  useEffect(() => {
    const measure = () => {
      const el = marqueeSegRef.current;
      if (el) {
        const w = el.scrollWidth || el.offsetWidth || 0;
        if (w > 0) {
          setMarqueeSegW(w);
          measuredRef.current = true;
          return true;
        }
      }
      return false;
    };
    
    // Try multiple times to ensure measurement happens
    const tryMeasure = () => {
      if (!measure()) {
        // Retry with requestAnimationFrame
        requestAnimationFrame(() => {
          if (!measure()) {
            // Retry with setTimeout
            setTimeout(() => {
              if (!measure()) {
                // Final retry after images load
                setTimeout(() => measure(), 200);
              }
            }, 100);
          }
        });
      }
    };
    
    // Immediate measure
    tryMeasure();
    
    // Also try after a short delay
    const tm1 = setTimeout(tryMeasure, 50);
    const tm2 = setTimeout(tryMeasure, 150);
    const tm3 = setTimeout(tryMeasure, 300);
    
    // Force start animation after max delay if still not measured
    const forceStart = setTimeout(() => {
      if (!measuredRef.current && marqueeSegRef.current) {
        // Use a default width estimate based on number of images
        const estimatedWidth = adImages.length * 300; // Rough estimate
        setMarqueeSegW(estimatedWidth);
        measuredRef.current = true;
      }
    }, 500);
    
    // Handle image load events
    const handleImageLoad = () => {
      tryMeasure();
    };
    
    // Preload images and measure when loaded
    adImages.forEach((src) => {
      const img = new window.Image();
      img.onload = handleImageLoad;
      img.onerror = handleImageLoad;
      img.src = src;
    });
    
    window.addEventListener("resize", tryMeasure);
    
    return () => {
      clearTimeout(tm1);
      clearTimeout(tm2);
      clearTimeout(tm3);
      clearTimeout(forceStart);
      window.removeEventListener("resize", tryMeasure);
    };
  }, []);

  return (
    <>
      <style jsx>{`
        /* Layout grid: 3 bagian - header, video, footer dengan iklan overlay */
        .page-root {
          --top: 12svh;
          --footer: 20svh;
          color: white;
          width: 100vw;
          height: 100vh;
          overflow: hidden;
          display: grid;
          grid-template-rows: var(--top) 1fr;
          position: relative;
        }

        /* Anti rounded di overlay + object-fill video */
        #overlay {
          border-radius: 0 !important;
          overflow: visible !important;
        }
        
        #video {
          /* Responsive video: fill container, stretch jika perlu, no black bars */
          object-fit: cover;
          width: 100%;
          height: 100%;
          min-width: 100%;
          min-height: 100%;
          background: #000;
          /* Fallback: jika aspect ratio sangat berbeda, gunakan fill */
          object-position: center center;
        }
        
        /* Smart fallback untuk kamera dengan aspect ratio ekstrem */
        #video:not([style*="object-fit"]) {
          object-fit: fill;
        }
        
        /* Debug styling */
        #camera-host {
          background: #000;
          position: relative;
          overflow: hidden;
        }
        
        /* Ensure video container always fills space */
        #camera {
          position: relative;
          width: 100%;
          height: 100%;
          overflow: hidden;
        }

        /* Footer dengan iklan overlay di bagian bawah video */
        #footer-overlay {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: var(--footer);
          z-index: 30;
          display: flex;
          flex-direction: column;
        }

        #banner_bottom {
          height: calc(var(--footer) * 0.4);
          flex-shrink: 0;
        }

        #ads {
          height: calc(var(--footer) * 0.6);
          flex-shrink: 0;
        }

        /* Video section harus full height */
        #camera {
          position: relative;
          width: 100%;
          height: 100%;
        }

        /* Pixel-perfect edge rendering for all sections */
        #banner_top .flex > div,
        #ads .flex > div,
        #banner_bottom .flex > div {
          height: 100%;
          image-rendering: pixelated;
          image-rendering: -moz-crisp-edges;
          image-rendering: crisp-edges;
          image-rendering: -webkit-optimize-contrast;
        }

        /* Marquee styles for ads */
        .marquee-track {
          display: flex;
          flex-wrap: nowrap;
          height: 100%;
          animation: marquee-right var(--marqueeDur, 30s) linear infinite;
          animation-play-state: var(--marqueePlay, paused);
          will-change: transform;
        }
        .marquee-segment {
          display: flex;
          flex-wrap: nowrap;
          align-items: center;
          height: 100%;
          flex: 0 0 auto;
        }
        .marquee-segment img {
          height: 100% !important;
          width: auto !important;
          flex: 0 0 auto;
          display: block;
          object-fit: contain;
        }
        @keyframes marquee-right {
          0% { transform: translateX(calc(-1 * var(--segW))); }
          100% { transform: translateX(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .marquee-track { animation: none; }
        }

        /* Ensure no gaps between background sections */
        #banner_top .flex,
        #ads .flex,
        #banner_bottom .flex {
          margin: 0;
          padding: 0;
          gap: 0;
        }

        /* Force full coverage */
        #banner_top .flex-1,
        #ads .flex-1,
        #banner_bottom .flex-1 {
          flex: 1;
          min-width: 50%;
        }

        /* Fallback background colors */
        #banner_top {
          background-color: #1e40af;
        }
        
        #ads {
          background-color: #f3f4f6;
        }
        
        #banner_bottom {
          background-color: #1e40af;
        }

        /* Responsive breakpoints */
        @media (max-width: 768px) {
          .page-root {
            --top: 10svh;
            --footer: 22svh;
          }
        }

        @media (max-width: 480px) {
          .page-root {
            --top: 8svh;
            --footer: 24svh;
          }
        }

        /* Landscape orientation adjustments */
        @media (orientation: landscape) and (max-height: 600px) {
          .page-root {
            --top: 8svh;
            --footer: 18svh;
          }
        }

        /* Large display optimizations (TV/Projector) */
        @media (min-width: 1920px) {
          .page-root {
            --top: 10svh;
            --footer: 18svh;
          }
        }

        /* Ultra-wide display support */
        @media (min-aspect-ratio: 21/9) {
          .page-root {
            --top: 8svh;
            --footer: 15svh;
          }
        }

        /* 4K and higher resolution displays */
        @media (min-width: 3840px) {
          .page-root {
            --top: 8svh;
            --footer: 14svh;
          }
        }

        /* Toast responsive styling */
        :global(.toast-container) {
          position: fixed !important;
          top: 20px !important;
          right: 20px !important;
          z-index: 9999 !important;
          max-width: 400px !important;
          width: auto !important;
        }

        :global(.toast) {
          max-width: 400px !important;
          min-width: 280px !important;
          font-size: 14px !important;
          padding: 12px 16px !important;
          border-radius: 8px !important;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
          backdrop-filter: blur(8px) !important;
        }

        /* Responsive toast for different screen sizes */
        @media (max-width: 768px) {
          :global(.toast-container) {
            top: 10px !important;
            right: 10px !important;
            left: 10px !important;
            max-width: calc(100vw - 20px) !important;
          }
          
          :global(.toast) {
            max-width: 100% !important;
            min-width: auto !important;
            font-size: 13px !important;
            padding: 10px 14px !important;
          }
        }

        @media (max-width: 480px) {
          :global(.toast) {
            font-size: 12px !important;
            padding: 8px 12px !important;
          }
        }

        /* Large display toast adjustments */
        @media (min-width: 1920px) {
          :global(.toast-container) {
            top: 30px !important;
            right: 30px !important;
            max-width: 450px !important;
          }
          
          :global(.toast) {
            font-size: 16px !important;
            padding: 14px 18px !important;
            max-width: 450px !important;
            min-width: 320px !important;
          }
        }

        /* 4K display toast */
        @media (min-width: 3840px) {
          :global(.toast-container) {
            top: 40px !important;
            right: 40px !important;
            max-width: 500px !important;
          }
          
          :global(.toast) {
            font-size: 18px !important;
            padding: 16px 20px !important;
            max-width: 500px !important;
            min-width: 350px !important;
          }
        }
      `}</style>
      <div className="page-root">
      {/* Header banner */}
      <section id="banner_top" className="relative w-screen h-[var(--top)] overflow-hidden pt-[env(safe-area-inset-top)]">
        {/* Background dengan pixel edge yang di-repeat */}
        <div className="absolute inset-0 flex">
          {/* Left edge - repeat leftmost pixel strip toward the left */}
          <div className="flex-1" 
               style={{
                 backgroundImage: `url(${headerStrips.left || '/images/header.png'})`,
                 backgroundPosition: 'right center',
                 backgroundSize: '1px 100%',
                 backgroundRepeat: 'repeat-x',
                 backgroundColor: headerEdgeColors.left
               }}>
          </div>
          
          {/* Right edge - repeat leftmost pixel strip (same as left) */}
          <div className="flex-1"
               style={{
                 backgroundImage: `url(${headerStrips.left || '/images/header.png'})`,
                 backgroundPosition: 'right center',
                 backgroundSize: '1px 100%',
                 backgroundRepeat: 'repeat-x',
                 backgroundColor: headerEdgeColors.left
               }}>
          </div>
        </div>
        
        {/* Center image overlay - tidak stretch */}
        <div className="absolute inset-0 flex items-center justify-center">
          <Image 
            src="/images/header.png"
            alt="Header"
            width={1920}
            height={400}
            priority
            className="max-w-full max-h-full object-contain select-none pointer-events-none" />
        </div>
      </section>
      
      {/* Video Section (center) - full height */}
      <section id="camera" className="relative w-screen h-full overflow-hidden">
        <div ref={hostRef} id="camera-host" className="relative w-screen h-full flex items-center justify-center">
          <video 
            ref={videoRef} 
            id="video" 
            autoPlay 
            playsInline 
            muted 
            className="block h-full w-full" 
            style={{
              objectFit: 'cover',
              width: '100%',
              height: '100%',
              minWidth: '100%',
              minHeight: '100%',
            }}
          />
          <canvas ref={overlayRef} id="overlay" className="absolute inset-0 w-full h-full z-20 pointer-events-none" />
        </div>
        
        {/* Footer dengan iklan overlay di bagian bawah video */}
        <div id="footer-overlay">
          {/* Advertisement - continuous left-to-right marquee */}
          <section id="ads" className="relative w-screen overflow-hidden bg-gray-100">
            <div className="absolute inset-0">
              <div
                className="marquee-track"
                ref={marqueeTrackRef}
                style={{ 
                  ["--segW" as unknown as string]: `${marqueeSegW}px`,
                  ["--marqueePlay" as unknown as string]: marqueeSegW > 0 ? 'running' : 'paused'
                } as React.CSSProperties}
                aria-label="Iklan"
              >
                <div className="marquee-segment" ref={marqueeSegRef}>
                  {adImages.map((src) => (
                    <img key={`seg1-${src}`} src={src} alt="Iklan" draggable={false} loading="eager" decoding="async" className="h-full w-auto select-none pointer-events-none block" style={{ flex: '0 0 auto' }} />
                  ))}
                </div>
                <div className="marquee-segment">
                  {adImages.map((src) => (
                    <img key={`seg2-${src}`} src={src} alt="Iklan" draggable={false} loading="eager" decoding="async" className="h-full w-auto select-none pointer-events-none block" style={{ flex: '0 0 auto' }} />
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Footer image */}
          <section id="banner_bottom" className="relative w-screen overflow-hidden pb-[env(safe-area-inset-bottom)]">
        {/* Background dengan pixel edge yang di-repeat */}
        <div className="absolute inset-0 flex">
          {/* Left edge - repeat leftmost pixel strip toward the left */}
          <div className="flex-1" 
               style={{
                 backgroundImage: `url(${footerStrips.left || '/images/footer.png'})`,
                 backgroundPosition: 'right center',
                 backgroundSize: '1px 100%',
                 backgroundRepeat: 'repeat-x',
                 backgroundColor: footerEdgeColors.left
               }}>
          </div>
          
          {/* Right edge - repeat rightmost pixel strip toward the right */}
          <div className="flex-1"
               style={{
                 backgroundImage: `url(${footerStrips.right || '/images/footer.png'})`,
                 backgroundPosition: 'left center',
                 backgroundSize: '1px 100%',
                 backgroundRepeat: 'repeat-x',
                 backgroundColor: footerEdgeColors.right
               }}>
          </div>
        </div>
        
        {/* Center footer image overlay - tidak stretch */}
        <div className="absolute inset-0 flex items-center justify-center">
          <Image 
            src="/images/footer.png" 
            alt="Footer" 
            width={1920} 
            height={220} 
            priority 
            className="max-w-full max-h-full object-contain select-none pointer-events-none" />
        </div>
      </section>
        </div>
      </section>
      </div>
    </>
  );
}
