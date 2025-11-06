// app/page.tsx
// Root route "/" - Halaman beranda dengan face detection & emotion analysis

"use client";
import { useRouter } from "next/navigation";
import React, { useState, useRef, useEffect } from "react";
import { useI18n } from "@/components/providers/I18nProvider";
import { useSettings } from "@/components/providers/SettingsProvider";
import { useWs } from "@/components/providers/WsProvider";
import { toast } from "@/lib/toast";
import Image from "next/image";

// Rotating ad images (from public/images). Exclude footer.png which is used as footer.
const adImages = [
  "/images/upskilling.png",
  "/images/nobox.jpg",
  "/images/karyasmk.jpg",
  "/images/expo.jpg",
  "/images/eschool.png",
];

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

  // Header edge colors and 1px strips (match absensi-fun-meter header style)
  const [headerEdgeColors, setHeaderEdgeColors] = useState({ left: '#1e3a8a', right: '#1e3a8a' });
  const [headerStrips, setHeaderStrips] = useState<{ left: string; right: string }>({ left: '', right: '' });
  // Footer edge colors and 1px strips
  const [footerEdgeColors, setFooterEdgeColors] = useState({ left: '#1e3a8a', right: '#1e3a8a' });
  const [footerStrips, setFooterStrips] = useState<{ left: string; right: string }>({ left: '', right: '' });

  // Ads rotation every 3 seconds
  const [adIndex, setAdIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setAdIndex((i) => (i + 1) % adImages.length);
    }, 3000);
    return () => clearInterval(id);
  }, []);

  // Extract edge colors + 1px strips from header image
  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      try {
        const leftPixels: string[] = [];
        for (let y = 0; y < img.height; y += 10) {
          const p = ctx.getImageData(0, y, 1, 1).data;
          leftPixels.push(`rgb(${p[0]}, ${p[1]}, ${p[2]})`);
        }
        const rightPixels: string[] = [];
        for (let y = 0; y < img.height; y += 10) {
          const p = ctx.getImageData(img.width - 1, y, 1, 1).data;
          rightPixels.push(`rgb(${p[0]}, ${p[1]}, ${p[2]})`);
        }
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
      } catch {
        // ignore, fallbacks will be used
      }
    };
    img.src = '/images/header.png';
  }, []);

  // Extract edge colors + 1px strips from footer image
  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      try {
        const leftPixels: string[] = [];
        for (let y = 0; y < img.height; y += 10) {
          const p = ctx.getImageData(0, y, 1, 1).data;
          leftPixels.push(`rgb(${p[0]}, ${p[1]}, ${p[2]})`);
        }
        const rightPixels: string[] = [];
        for (let y = 0; y < img.height; y += 10) {
          const p = ctx.getImageData(img.width - 1, y, 1, 1).data;
          rightPixels.push(`rgb(${p[0]}, ${p[1]}, ${p[2]})`);
        }
        const leftColor = leftPixels[Math.floor(leftPixels.length / 2)] || '#1e3a8a';
        const rightColor = rightPixels[Math.floor(rightPixels.length / 2)] || '#1e3a8a';
        setFooterEdgeColors({ left: leftColor, right: rightColor });

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
      } catch {
        // ignore
      }
    };
    img.src = '/images/footer.png';
  }, []);

  // Measure marquee segment width and store as CSS variable for seamless loop
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
    if (!lastAttResults.results.length || now - lastAttResults.t > 1800) return null;
    let best: { label?: string; bbox?: number[]; box?: number[] } | null = null, bestIoU = 0;
    for (const r of lastAttResults.results) {
      const i = iou(funBox, r.bbox || r.box || [0, 0, 0, 0]);
      if (i > bestIoU) {
        bestIoU = i;
        best = r;
      }
    }
    return best && best.label && bestIoU >= 0.25 ? best.label : null;
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
    if (!sendHeightRef.current) return;
    const overlay = overlayRef.current;
    const ctx = ctxRef.current;
    if (!overlay || !ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.lineWidth = 3;
    const { sx, sy, ox, oy } = getLetterboxTransform();
    let missingName = false;
    (results || []).forEach((r) => {
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
  
  const pushFunFrame = async () => {
    if (!socket || !socket.socket?.connected || sendingFun || !ensureSnapSize()) return;
    setSendingFun(true);
    try {
      const snapCanvas = snapCanvasRef.current;
      const video = videoRef.current;
      if (!snapCanvas || !video) return;
      const sctx = snapCanvas.getContext("2d");
      if (!sctx) return;
      sctx.drawImage(video, 0, 0, snapCanvas.width, snapCanvas.height);
      const bytes = await toBytes();
      if (bytes && socket) socket.emit("fun_frame", bytes);
    } finally {
      setSendingFun(false);
    }
  };
  
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
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, []);
  
  // Setup frame sending intervals
  useEffect(() => {
    if (!socket) return;
    if (socket.socket?.connected) {
      try {
        socket.emit("att_cfg", { th: 0.4, mark: true });
      } catch (e) {
        console.error("Failed to send att_cfg:", e);
      }
    }
    const funInterval = setInterval(pushFunFrame, Number(funIntervalMs));
    return () => {
      clearInterval(funInterval);
    };
  }, [socket, funIntervalMs]);

  return (
    <div className="overflow-hidden" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="flex-1 flex flex-col" style={{ gap: '0', minHeight: 0 }}>
        <div className="flex-1 flex flex-col" style={{ gap: '0', minHeight: 0 }}>
          {/* Header banner */}
          <section className="relative w-full h-20 overflow-hidden flex-shrink-0">
            {/* Background with pixel edges repeated */}
            <div className="absolute inset-0 flex">
              {/* Left edge */}
              <div
                className="flex-1"
                style={{
                  backgroundImage: `url(${headerStrips.left || '/images/header.png'})`,
                  backgroundPosition: 'right center',
                  backgroundSize: '1px 100%',
                  backgroundRepeat: 'repeat-x',
                  backgroundColor: headerEdgeColors.left,
                }}
              />
              {/* Right edge */}
              <div
                className="flex-1"
                style={{
                  backgroundImage: `url(${headerStrips.left || '/images/header.png'})`,
                  backgroundPosition: 'right center',
                  backgroundSize: '1px 100%',
                  backgroundRepeat: 'repeat-x',
                  backgroundColor: headerEdgeColors.left,
                }}
              />
            </div>
            {/* Center image overlay - not stretched */}
            <div className="absolute inset-0 flex items-center justify-center">
              <Image
                src="/images/header.png"
                alt="Header"
                width={1920}
                height={400}
                priority
                className="max-w-full max-h-full object-contain select-none pointer-events-none"
              />
            </div>
          </section>

          {/* Video */}
          <div ref={hostRef} id="camera-host" className="relative overflow-hidden flex-1" style={{ minHeight: 0, flex: '1 1 0' }}>
            <video
              ref={videoRef}
              id="video"
              autoPlay
              playsInline
              muted
              className="w-full object-fill"
              style={{ height: 'calc(100% - 200px)', width: '100%' }}
            />
            <canvas ref={overlayRef} id="overlay" className="absolute top-0 left-0 w-full pointer-events-none" style={{ height: 'calc(100% - 200px)', width: '100%' }} />
            
            {/* Footer dengan iklan overlay di bagian bawah video */}
            <div id="footer-overlay" style={{ bottom: '0', top: 'calc(100% - 200px)' }}>
              {/* Advertisement - continuous left-to-right marquee */}
              <section id="ads" className="relative w-full overflow-hidden bg-gray-100">
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
              <section id="banner_bottom" className="relative w-full h-20 overflow-hidden">
                <div className="absolute inset-0 flex">
                  <div
                    className="flex-1"
                    style={{
                      backgroundImage: `url(${footerStrips.left || '/images/footer.png'})`,
                      backgroundPosition: 'right center',
                      backgroundSize: '1px 100%',
                      backgroundRepeat: 'repeat-x',
                      backgroundColor: footerEdgeColors.left,
                    }}
                  />
                  <div
                    className="flex-1"
                    style={{
                      backgroundImage: `url(${footerStrips.right || '/images/footer.png'})`,
                      backgroundPosition: 'left center',
                      backgroundSize: '1px 100%',
                      backgroundRepeat: 'repeat-x',
                      backgroundColor: footerEdgeColors.right,
                    }}
                  />
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <Image
                    src="/images/footer.png"
                    alt="Footer"
                    width={1920}
                    height={220}
                    priority
                    className="max-w-full max-h-full object-contain select-none pointer-events-none"
                  />
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
      {/* Scoped styles for marquee and footer overlay */}
      <style jsx>{`
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
        .marquee-segment :global(img) {
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

        /* Footer dengan iklan overlay di bagian bawah video */
        #footer-overlay {
          position: absolute;
          left: 0;
          right: 0;
          z-index: 30;
          display: flex;
          flex-direction: column;
          width: 100%;
        }

        #ads {
          height: 120px;
          flex-shrink: 0;
        }

        #banner_bottom {
          height: 80px;
          flex-shrink: 0;
        }

        /* Prevent scrolling and fill available space */
        #camera-host {
          overflow: hidden;
          flex: 1;
          display: flex;
          flex-direction: column;
        }
        
        #video {
          height: 100%;
          flex: 1;
        }
        
        #overlay {
          height: 100%;
        }
        
        /* Footer overlay positioning */
        #footer-overlay {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 200px;
        }
      `}</style>
    </div>
  );
}
