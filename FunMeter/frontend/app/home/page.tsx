// app/page.tsx
// Root route "/" - Halaman beranda dengan face detection & emotion analysis

"use client";
import { useRouter } from "next/navigation";
import React, { useState, useRef, useEffect, useCallback } from "react";
import { useI18n } from "@/components/providers/I18nProvider";
import { useSettings } from "@/components/providers/SettingsProvider";
import { useWs } from "@/components/providers/WsProvider";
import { toast } from "@/lib/toast";
import Image from "next/image";

// Dynamic Ads media type
type AdMedia = { src: string; type: 'image' | 'video' };

export default function HomePage() {
  const { t } = useI18n();
  const { useSetting } = useSettings();
  const router = useRouter();
  
  // Settings
  const { model: funSendWidth } = useSetting("funMeter.sendWidth", { clamp: { min: 160, max: 1920, round: true } });
  const { model: jpegQuality } = useSetting("attendance.jpegQuality", { clamp: { min: 0, max: 1 } });
  const { model: funIntervalMs } = useSetting("funMeter.funIntervalMs", { clamp: { min: 100, max: 2000, round: true } });
  const { model: baseInterval } = useSetting("baseInterval", { clamp: { max: 5000, round: true } });

  // Camera states
  const [sendingFun, setSendingFun] = useState(false);
  const [sendingAtt, setSendingAtt] = useState(false);
  const [attendanceResults, setAttendanceResults] = useState<Array<{ bbox?: number[]; box?: number[]; label?: string; name?: string }>>([]);
  const [emotionResults, setEmotionResults] = useState<Array<{ bbox?: number[]; top?: { label?: string }; expression?: string; emotion?: string; label?: string; name?: string }>>([]);
  const [lastAttPush, setLastAttPush] = useState(0);
  const [lastAttResults, setLastAttResults] = useState<{ t: number; results: Array<{ bbox?: number[]; box?: number[]; label?: string }> }>({ t: 0, results: [] });

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  // Marquee refs
  const marqueeTrackRef = useRef<HTMLDivElement>(null);
  const marqueeSegRef = useRef<HTMLDivElement>(null);
  const [marqueeSegW, setMarqueeSegW] = useState(0);
  const measuredRef = useRef(false);
  const snapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sendHeightRef = useRef(0);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const DPRRef = useRef(1);
  const streamRef = useRef<MediaStream | null>(null);

  // Ads list loaded like absensi-fun-meter (from localStorage or index.json)
  const [adMediaList, setAdMediaList] = useState<AdMedia[]>([
    { src: "/assets/advertisements/images/upskilling.png", type: 'image' },
    { src: "/assets/advertisements/images/nobox.jpg", type: 'image' },
    { src: "/assets/advertisements/videos/iklan.mp4", type: 'video' },
    { src: "/assets/advertisements/images/karyasmk.jpg", type: 'image' },
    { src: "/assets/advertisements/images/expo.jpg", type: 'image' },
  ]);
  const [currentAdIndex, setCurrentAdIndex] = useState(0);
  const adVideoRef = useRef<HTMLVideoElement>(null);
  const adTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [repeatCount, setRepeatCount] = useState(3); // Jumlah repeat iklan ke kanan dan kiri (total = 1 center + 3 kiri + 3 kanan = 7)
  
  // Preload semua iklan saat component mount untuk render cepat
  useEffect(() => {
    adMediaList.forEach((ad) => {
      if (ad.type === 'image') {
        // Preload gambar
        const img = new window.Image();
        img.src = ad.src;
        img.decode(); // Decode immediately
      } else if (ad.type === 'video') {
        // Preload video
        const video = document.createElement('video');
        video.src = ad.src;
        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;
        video.load();
      }
    });
  }, [adMediaList]);
  
  // Preload next ad untuk transisi smooth
  useEffect(() => {
    const nextIndex = (currentAdIndex + 1) % adMediaList.length;
    const nextAd = adMediaList[nextIndex];
    
    if (nextAd) {
      if (nextAd.type === 'image') {
        const img = new window.Image();
        img.src = nextAd.src;
        img.decode();
      } else if (nextAd.type === 'video') {
        const video = document.createElement('video');
        video.src = nextAd.src;
        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;
        video.load();
      }
    }
  }, [currentAdIndex, adMediaList]);
  
  useEffect(() => {
    let cancelled = false;
    const LS_KEY = "ads.enabled";
    const load = async () => {
      try {
        const stored = typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
        if (stored) {
          const parsed = JSON.parse(stored) as AdMedia[];
          if (Array.isArray(parsed) && parsed.length) {
            if (!cancelled) setAdMediaList(parsed);
            return;
          }
        }
        const res = await fetch('/assets/advertisements/index.json', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          const images: string[] = Array.isArray(data?.images) ? data.images : [];
          const videos: string[] = Array.isArray(data?.videos) ? data.videos : [];
          const list: AdMedia[] = [
            ...images.map((src) => ({ src, type: 'image' as const })),
            ...videos.map((src) => ({ src, type: 'video' as const })),
          ];
          if (list.length && !cancelled) setAdMediaList(list);
        }
      } catch {
        // ignore
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);
  const goToNextAd = useCallback(() => {
    setCurrentAdIndex((prevIndex) => (prevIndex + 1) % Math.max(1, adMediaList.length));
  }, [adMediaList.length]);
  useEffect(() => {
    const currentAd = adMediaList[currentAdIndex];
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
      // Untuk video, play semua instance sekaligus
      const videoElements = document.querySelectorAll(`video[src="${currentAd.src}"]`);
      videoElements.forEach((video) => {
        const videoEl = video as HTMLVideoElement;
        videoEl.currentTime = 0; // Reset ke awal
        videoEl.play().catch(() => {
          // Retry sekali jika gagal
          setTimeout(() => videoEl.play().catch(() => {}), 100);
        });
      });
    }
    
    return () => {
      if (adTimerRef.current) clearTimeout(adTimerRef.current);
    };
  }, [currentAdIndex, adMediaList, goToNextAd]);

  // (Header/Footer strips removed; use static assets like absensi-fun-meter)

  // Remove marquee measurement (ads now slideshow at bottom)

  // WebSocket connection
  type AttResultPayload = {
    results?: Array<{ bbox?: number[]; box?: number[]; label?: string; name?: string }>;
    marked?: string[];
    marked_info?: Array<{ label?: string; score?: number; message?: string }>;
  };
  type FunResultPayload = {
    results?: Array<{ bbox?: number[]; top?: { label?: string }; expression?: string; emotion?: string; label?: string; name?: string }>;
  };

  const socket = useWs({
    url: "",
    root: true,
    on: {
      connect() {
        console.log("WebSocket connected");
      },
      disconnect(...args: unknown[]) {
        console.log("WebSocket disconnected");
      },
      att_result(data: unknown) {
        const d = (data || {}) as AttResultPayload;
        const results = Array.isArray(d.results) ? d.results : [];
        console.log("[ATT_RESULT] Received:", { results, marked: d.marked, marked_info: d.marked_info });
        setAttendanceResults(results);
        setLastAttResults({ t: Date.now(), results });
        
        // Handle successful attendance notification
        const marked = Array.isArray(d.marked) ? d.marked : [];
        const markedInfo = Array.isArray(d.marked_info) ? d.marked_info : [];
        
        console.log("[ATTENDANCE] Marked:", marked, "MarkedInfo:", markedInfo);
        
        for (const info of markedInfo) {
          const label = info.label || "";
          const score = info.score ? ` (${(info.score * 100).toFixed(1)}%)` : "";
          const message = info.message || `✅ Absen berhasil: ${label}${score}`;
          if (label) {
            console.log("[ATTENDANCE] Showing toast for:", label);
            toast.success(message, { duration: 5000 });
          }
        }
        
        if (!markedInfo.length && marked.length > 0) {
          for (const label of marked) {
            console.log("[ATTENDANCE] Showing toast for (fallback):", label);
            toast.success(`✅ Absen berhasil: ${label}`, { duration: 5000 });
          }
        }
        
        if (emotionResults.length > 0) {
          drawFun(emotionResults);
        }
      },
      fun_result(data: unknown) {
        const d = (data || {}) as FunResultPayload;
        const results = Array.isArray(d.results) ? d.results : [];
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
    let best: { label?: string; bbox?: number[]; box?: number[] } | null = null, bestIoU = 0;
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

  // Canvas sizing functions
  const fitCanvasToVideo = () => {
    const overlay = overlayRef.current;
    const host = hostRef.current || videoRef.current;
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
  
  const ensureSnapSize = useCallback(() => {
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
  }, [funSendWidth]);
  
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
    
    let sx: number, sy: number, ox = 0, oy = 0;
    
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
    const topX = clamp(Math.round(x), 2, Math.round(hostRect.width - topW - 2));
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
    const botX = clamp(Math.round(x), 2, Math.round(hostRect.width - botW - 2));
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
  
  const drawFun = (results: Array<{ bbox?: number[]; top?: { label?: string }; expression?: string; emotion?: string; label?: string; name?: string }>) => {
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
  const toBytes = useCallback(async () => {
    if (!snapCanvasRef.current) return null;
    const canvas = snapCanvasRef.current;
    const preferWebP = !!document.createElement("canvas").toDataURL("image/webp").match("data:image/webp");
    const type = preferWebP ? "image/webp" : "image/jpeg";
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, Number(jpegQuality)));
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  }, [jpegQuality]);
  
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
  }, [socket, sendingFun, toBytes, ensureSnapSize]);
  
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

  // Start camera
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        // Samakan perilaku dengan halaman absensi: gunakan cover agar transform hitbox akurat
        videoRef.current.style.objectFit = 'cover';
        videoRef.current.style.objectPosition = 'center center';
      }
    } catch (err) {
      const msg = (err as { message?: string })?.message || "-";
      console.error("Camera error:", msg);
    }
  };

  // Stop camera
  const stopCamera = () => {
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // Initialize canvas context
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d");
    if (ctx) {
      ctxRef.current = ctx;
      ctx.lineJoin = "miter";
      ctx.lineCap = "butt";
      ctx.miterLimit = 10;
    }
    fitCanvasToVideo();
    const handleResize = () => {
      ensureSnapSize();
      fitCanvasToVideo();
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [ensureSnapSize]);

  // Cleanup on unmount - camera will NOT auto-start, must be started manually
  // This ensures camera stops when navigating away and stays off on mount
  useEffect(() => {
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return (
    <div className="page-root">
      {/* Header banner - same approach as absensi-fun-meter */}
      <section id="banner_top" className="relative w-full overflow-hidden bg-[#006CBB]" style={{ aspectRatio: '40/4' }}>
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

      {/* Video with overlay */}
      <section id="camera" className="relative w-full overflow-hidden">
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
          <div className="absolute bottom-0 left-0 right-0 z-30 flex items-end justify-center pointer-events-none overflow-hidden">
            <div className="flex items-end gap-0">
              {/* Repeat ke kiri */}
              {Array.from({ length: repeatCount }).reverse().map((_, index) => (
                <div key={`left-${index}`} className="ad-overlay-container flex-shrink-0">
                  {adMediaList[currentAdIndex]?.type === 'image' ? (
                    <Image
                      src={adMediaList[currentAdIndex]?.src || ''}
                      alt={`Iklan Kiri ${index + 1}`}
                      width={600}
                      height={400}
                      priority
                      quality={100}
                      unoptimized
                      draggable={false}
                      className="select-none pointer-events-none w-full h-auto object-contain block"
                      style={{ filter: 'drop-shadow(0 20px 25px rgba(0, 0, 0, 0.5))', marginBottom: 0, paddingBottom: 0 }}
                    />
                  ) : (
                    <video
                      src={adMediaList[currentAdIndex]?.src}
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="auto"
                      crossOrigin="anonymous"
                      className="select-none w-full h-auto object-contain block"
                      style={{ filter: 'drop-shadow(0 20px 25px rgba(0, 0, 0, 0.5))', marginBottom: 0, paddingBottom: 0 }}
                      onLoadedData={(e) => {
                        const video = e.currentTarget;
                        video.play().catch(() => {});
                      }}
                    />
                  )}
                </div>
              ))}
              
              {/* Center - iklan utama yang stay still */}
              <div className="ad-overlay-container flex-shrink-0">
                {adMediaList[currentAdIndex]?.type === 'image' ? (
                  <Image
                    src={adMediaList[currentAdIndex]?.src || ''}
                    alt="Iklan Center"
                    width={600}
                    height={400}
                    priority
                    quality={100}
                    unoptimized
                    draggable={false}
                    className="select-none pointer-events-none w-full h-auto object-contain block"
                    style={{ filter: 'drop-shadow(0 20px 25px rgba(0, 0, 0, 0.5))', marginBottom: 0, paddingBottom: 0 }}
                  />
                ) : (
                  <video
                    ref={adVideoRef}
                    src={adMediaList[currentAdIndex]?.src}
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="auto"
                    crossOrigin="anonymous"
                    className="select-none w-full h-auto object-contain block"
                    style={{ filter: 'drop-shadow(0 20px 25px rgba(0, 0, 0, 0.5))', marginBottom: 0, paddingBottom: 0 }}
                    onLoadedData={(e) => {
                      const video = e.currentTarget;
                      video.play().catch(() => {});
                    }}
                    onEnded={goToNextAd}
                  />
                )}
              </div>
              
              {/* Repeat ke kanan */}
              {Array.from({ length: repeatCount }).map((_, index) => (
                <div key={`right-${index}`} className="ad-overlay-container flex-shrink-0">
                  {adMediaList[currentAdIndex]?.type === 'image' ? (
                    <Image
                      src={adMediaList[currentAdIndex]?.src || ''}
                      alt={`Iklan Kanan ${index + 1}`}
                      width={600}
                      height={400}
                      priority
                      quality={100}
                      unoptimized
                      draggable={false}
                      className="select-none pointer-events-none w-full h-auto object-contain block"
                      style={{ filter: 'drop-shadow(0 20px 25px rgba(0, 0, 0, 0.5))', marginBottom: 0, paddingBottom: 0 }}
                    />
                  ) : (
                    <video
                      src={adMediaList[currentAdIndex]?.src}
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="auto"
                      crossOrigin="anonymous"
                      className="select-none w-full h-auto object-contain block"
                      style={{ filter: 'drop-shadow(0 20px 25px rgba(0, 0, 0, 0.5))', marginBottom: 0, paddingBottom: 0 }}
                      onLoadedData={(e) => {
                        const video = e.currentTarget;
                        video.play().catch(() => {});
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
                </div>
              </section>

      {/* Footer banner */}
      <section id="banner_bottom" className="relative w-full overflow-hidden bg-[#A3092E]" style={{ aspectRatio: '40 / 2' }}>
        <div className="relative w-full h-full">
                  <Image
            src="/assets/footer/footer.png" 
                    alt="Footer"
            fill
                    priority
            className="object-contain select-none pointer-events-none"
            sizes="100vw" />
                </div>
              </section>

      {/* Scoped styles matching absensi-fun-meter */}
      <style jsx>{`
        .page-root {
          color: white;
          width: 70vw;
          height: 80vh;
          overflow: hidden;
          display: grid;
          grid-template-rows: auto 1fr auto;
          position: relative;
          background: #000;
          margin: 0 auto;
        }
        #overlay { border-radius: 0 !important; overflow: visible !important; }
        #video { object-fit: cover; object-position: center center; background: #000; }
        #camera-host { background: #000; }
        .ad-overlay-container { width: 280px; min-width: 280px; }
        @media (orientation: portrait) { .ad-overlay-container { width: 240px; min-width: 240px; } }
        @media (orientation: landscape) { .ad-overlay-container { width: 350px; min-width: 350px; } }
        @media (orientation: landscape) and (min-width: 1024px) { .ad-overlay-container { width: 450px; min-width: 450px; } }
        @media (min-width: 1920px) { .ad-overlay-container { width: 600px; min-width: 600px; } }
      `}</style>
    </div>
  );
}
