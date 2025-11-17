// app/attendance-fun-meter/page.tsx
// Port dari src-vue-original/pages/default/AttendanceFunMeterPage.vue

"use client";

// Rotating ad media (images and videos)
interface AdMedia {
  src: string;
  type: 'image' | 'video';
}

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/providers/I18nProvider";
import { useSettings } from "@/components/providers/SettingsProvider";
import { useWs } from "@/components/providers/WsProvider";
import { toast } from "@/toast";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/common/Icon";
import { fetchActiveAdvertisements } from "@/lib/supabase-advertisements";
import { ClientOnly } from "@/components/providers/ClientOnly";

// Lazy Cache Implementation
class LazyCache<T> {
  private cache = new Map<string, { data: T; timestamp: number; ttl: number }>();
  private maxSize: number;
  private defaultTTL: number;

  constructor(maxSize = 100, defaultTTL = 5 * 60 * 1000) { // 5 minutes default TTL
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
  }

  set(key: string, data: T, ttl?: number): void {
    // Remove oldest entries if cache is full
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL
    });
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check if entry has expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  // Get or set with lazy loading
  async getOrSet(key: string, factory: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }

    const data = await factory();
    this.set(key, data, ttl);
    return data;
  }
}

// Cache instances for different data types
const adMediaCache = new LazyCache<AdMedia[]>(10, 10 * 60 * 1000); // 10 minutes for ads
const attendanceResultsCache = new LazyCache<AttendanceResult[]>(50, 30 * 1000); // 30 seconds for attendance
const emotionResultsCache = new LazyCache<EmotionResult[]>(50, 15 * 1000); // 15 seconds for emotions
const videoFrameCache = new LazyCache<Uint8Array>(20, 5 * 1000); // 5 seconds for video frames
const settingsCache = new LazyCache<Record<string, unknown>>(20, 60 * 1000); // 1 minute for settings
const videoLoadCache = new LazyCache<boolean>(50, 5 * 60 * 1000); // 5 minutes for video load status

// Debounce utility for performance optimization
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

// Throttle utility for frame processing
function useThrottle<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number
): T {
  const lastRun = useRef(0);

  const throttledFn = useCallback(
    (...args: unknown[]) => {
      const now = Date.now();
      if (now - lastRun.current >= delay) {
        callback(...args);
        lastRun.current = now;
      }
    },
    [callback, delay]
  );

  return throttledFn as T;
}

// Memoized computation hook
function useMemoizedComputation<T>(
  computation: () => T,
  deps: React.DependencyList,
  cacheKey?: string
): T {
  return useMemo(() => {
    if (cacheKey) {
      const cached = settingsCache.get(cacheKey);
      if (cached !== null) {
        return cached as T;
      }
    }

    const result = computation();
    
    if (cacheKey) {
      settingsCache.set(cacheKey, result as Record<string, unknown>);
    }

    return result;
  }, deps);
}

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

function AttendanceFunMeterPageContent() {
  const [adMediaList, setAdMediaList] = useState<AdMedia[]>([]);
  
  // Cache-aware state management
  const [cacheStats, setCacheStats] = useState({
    adMediaHits: 0,
    attendanceHits: 0,
    emotionHits: 0,
    frameHits: 0,
    totalRequests: 0
  });

  // Debounced values for performance
  const debouncedAdIndex = useDebounce(0, 100);
  
  // Cache statistics updater
  const updateCacheStats = useCallback((type: keyof typeof cacheStats) => {
    setCacheStats(prev => ({
      ...prev,
      [type]: prev[type] + 1,
      totalRequests: prev.totalRequests + 1
    }));
  }, []);

  // Cached advertisement loading with lazy cache and video optimization
  useEffect(() => {
    let cancelled = false;
    
    const loadAdsWithCache = async () => {
      try {
        const cacheKey = 'active-advertisements';
        
        // Try to get from cache first
        const cachedAds = adMediaCache.get(cacheKey);
        if (cachedAds && !cancelled) {
          console.log('[ADS CACHE] Using cached advertisements');
          setAdMediaList(cachedAds);
          updateCacheStats('adMediaHits');
          
          // Start aggressive preloading for videos immediately
          setTimeout(() => {
            cachedAds.forEach((ad, index) => {
              if (ad.type === 'video') {
                // Preload first few videos immediately
                if (index < 3) {
                  const video = document.createElement('video');
                  video.src = ad.src;
                  video.preload = 'auto';
                  video.muted = true;
                  video.playsInline = true;
                  video.crossOrigin = 'anonymous';
                  video.load();
                  
                  preloadedVideos.current.set(ad.src, video);
                  preloadCache.current.set(ad.src, true);
                  
                  console.log('[IMMEDIATE PRELOAD] Started loading video:', ad.src);
                }
              }
            });
          }, 100);
          
          return;
        }

        // Load from backend API with cache
        const data = await adMediaCache.getOrSet(
          cacheKey,
          async () => {
            console.log('[ADS CACHE] Loading fresh advertisements from API');
            const apiData = await fetchActiveAdvertisements();
            
            // Convert backend Advertisement to AdMedia
            const processedAds = apiData
              .filter((ad) => ad.enabled) // Only enabled ads
              .sort((a, b) => (a.display_order || 0) - (b.display_order || 0)) // Sort by display_order
              .map((ad) => ({
                src: ad.src,
                type: ad.type as 'image' | 'video',
              }));
            
            // Immediately start preloading first video
            const firstVideo = processedAds.find(ad => ad.type === 'video');
            if (firstVideo) {
              setTimeout(() => {
                const video = document.createElement('video');
                video.src = firstVideo.src;
                video.preload = 'auto';
                video.muted = true;
                video.playsInline = true;
                video.crossOrigin = 'anonymous';
                video.load();
                
                preloadedVideos.current.set(firstVideo.src, video);
                preloadCache.current.set(firstVideo.src, true);
                
                console.log('[FIRST VIDEO PRELOAD] Started loading:', firstVideo.src);
              }, 50);
            }
            
            return processedAds;
          },
          10 * 60 * 1000 // 10 minutes TTL
        );
        
        if (!cancelled) {
          setAdMediaList(data);
        }
      } catch (e) {
        console.warn('[ADS CACHE] Failed to load ads from backend, using defaults', e);
        if (!cancelled) {
          setAdMediaList([]);
        }
      }
    };
    
    loadAdsWithCache();
    return () => { cancelled = true; };
  }, [updateCacheStats]);
  const { t, locale } = useI18n();
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
  
  // Cached results with memoization
  const cachedAttendanceResults = useMemo(() => {
    const cacheKey = `attendance-${Date.now()}`;
    return attendanceResultsCache.get(cacheKey) || attendanceResults;
  }, [attendanceResults]);
  
  const cachedEmotionResults = useMemo(() => {
    const cacheKey = `emotions-${Date.now()}`;
    return emotionResultsCache.get(cacheKey) || emotionResults;
  }, [emotionResults]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lastAttPush, setLastAttPush] = useState(0);
  const [lastAttResults, setLastAttResults] = useState<LastAttResults>({ t: 0, results: [] });
  
  const snapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sendHeightRef = useRef(0);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const DPRRef = useRef(1);

  // Cached Settings with memoization
  const { model: baseInterval } = useSetting("baseInterval", { clamp: { max: 5000, round: true } });
  const { model: attSendWidth } = useSetting("attendance.sendWidth", { 
    clamp: { min: 160, max: 1920, round: true } 
  });
  const { model: funSendWidth } = useSetting("funMeter.sendWidth", { 
    clamp: { min: 160, max: 1920, round: true } 
  });
  const { model: jpegQuality } = useSetting("attendance.jpegQuality", { clamp: { min: 0, max: 1 } });
  const { model: funIntervalMs } = useSetting("funMeter.funIntervalMs", { clamp: { min: 100, max: 2000, round: true } });
  
  // Memoized settings for performance
  const memoizedSettings = useMemoizedComputation(
    () => ({
      baseInterval: Number(baseInterval),
      attSendWidth: Number(attSendWidth),
      funSendWidth: Number(funSendWidth),
      jpegQuality: Number(jpegQuality),
      funIntervalMs: Number(funIntervalMs)
    }),
    [baseInterval, attSendWidth, funSendWidth, jpegQuality, funIntervalMs],
    'app-settings'
  );

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
        
        // Cache attendance results
        const cacheKey = `att-result-${Date.now()}`;
        attendanceResultsCache.set(cacheKey, results, 30 * 1000); // 30 seconds TTL
        updateCacheStats('attendanceHits');
        
        setAttendanceResults(results);
        setLastAttResults({ t: Date.now(), results });
        
        // Handle successful attendance
        const marked = Array.isArray(data?.marked) ? data.marked : [];
        const markedInfo = Array.isArray(data?.marked_info) ? data.marked_info : [];
        
        console.log("[ATTENDANCE] Marked:", marked, "MarkedInfo:", markedInfo);
        
        for (const info of markedInfo) {
          const label = info.label || "";
          const score = typeof info.score === "number" ? (info.score * 100).toFixed(1) : null;
          
          // Create compact timestamp format like reference: "Wed/Nov/25 01:19:14 PM"
          const now = new Date();
          const currentLocale = locale === 'id' ? 'id-ID' : 'en-US';
          const dayShort = now.toLocaleDateString(currentLocale, { weekday: 'short' });
          const monthShort = now.toLocaleDateString(currentLocale, { month: 'short' });
          const day = now.getDate().toString().padStart(2, '0');
          const timeStr = now.toLocaleTimeString(currentLocale, { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit',
            hour12: locale !== 'id' 
          });
          
          // Format like reference: "Wed/Nov/25 01:19:14 PM"
          const compactDateTime = `${dayShort}/${monthShort}/${day} ${timeStr}`;
          
          if (label) {
            const details: string[] = [];
            if (score) {
              details.push(t("attendanceFunMeter.toast.score", "Score: {score}", { score: `${score}%` }));
            }
            details.push(t("attendanceFunMeter.toast.dateTime", "Date & Time: {dateTime}", { dateTime: compactDateTime }));

            let message = t("attendanceFunMeter.toast.attendanceSuccess", "Attendance success: {label}", { label });
            if (details.length > 0) {
              message += `\n${details.join(" • ")}`;
            }

            console.log("[ATTENDANCE] Showing compact toast for:", label, info);
            toast.success(message, { 
              duration: 6000,
              title: t("attendanceFunMeter.toast.title", "Success"),
            });
          }
        }
        
        if (!markedInfo.length && marked.length > 0) {
          // Fallback with compact format
          const now = new Date();
          const currentLocale = locale === 'id' ? 'id-ID' : 'en-US';
          const dayShort = now.toLocaleDateString(currentLocale, { weekday: 'short' });
          const monthShort = now.toLocaleDateString(currentLocale, { month: 'short' });
          const day = now.getDate().toString().padStart(2, '0');
          const timeStr = now.toLocaleTimeString(currentLocale, { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit',
            hour12: locale !== 'id' 
          });
          
          const compactDateTime = `${dayShort}/${monthShort}/${day} ${timeStr}`;
          
          for (const label of marked) {
            console.log("[ATTENDANCE] Showing compact toast for (fallback):", label);
            const messageLines = [
              t("attendanceFunMeter.toast.attendanceSuccess", "Attendance success: {label}", { label }),
              t("attendanceFunMeter.toast.dateTime", "Date & Time: {dateTime}", { dateTime: compactDateTime }),
            ];
            toast.success(messageLines.join("\n"), {
              duration: 5000,
              title: t("attendanceFunMeter.toast.title", "Success"),
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
        
        // Cache emotion results
        const cacheKey = `emotion-result-${Date.now()}`;
        emotionResultsCache.set(cacheKey, results, 15 * 1000); // 15 seconds TTL
        updateCacheStats('emotionHits');
        
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
  
  
  // Memoized snap size calculation
  const ensureSnapSize = useCallback(() => {
    const v = videoRef.current;
    if (!v) return false;
    
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return false;
    
    const newHeight = Math.round((memoizedSettings.funSendWidth * vh) / vw);
    
    // Only update if dimensions changed
    if (sendHeightRef.current !== newHeight) {
      sendHeightRef.current = newHeight;
      
      if (!snapCanvasRef.current) {
        snapCanvasRef.current = document.createElement("canvas");
      }
      
      snapCanvasRef.current.width = memoizedSettings.funSendWidth;
      snapCanvasRef.current.height = newHeight;
      
      console.log('[SNAP_SIZE] Updated canvas size:', memoizedSettings.funSendWidth, 'x', newHeight);
    }
    
    return true;
  }, [memoizedSettings.funSendWidth]);
  
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
const clampBoundingBox = (
  x: number,
  y: number,
  w: number,
  h: number,
  displayWidth: number,
  displayHeight: number,
) => {
  let nx = x;
  let ny = y;
  let nw = w;
  let nh = h;

  if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nw) || !Number.isFinite(nh)) {
    return null;
  }

  if (nx < 0) {
    nw += nx;
    nx = 0;
  }
  if (ny < 0) {
    nh += ny;
    ny = 0;
  }
  if (nx + nw > displayWidth) {
    nw = displayWidth - nx;
  }
  if (ny + nh > displayHeight) {
    nh = displayHeight - ny;
  }

  if (nw < 2 || nh < 2) {
    return null;
  }

  return { x: nx, y: ny, w: nw, h: nh };
};

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
    const overlayRect = overlay.getBoundingClientRect();
    const displayWidth = overlayRect.width || 0;
    const displayHeight = overlayRect.height || 0;
    
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
      const clamped = clampBoundingBox(x, y, w, h, displayWidth, displayHeight);
      if (!clamped) {
        return;
      }
      
      // Type-safe access to r.top.label
      const top = r.top as { label?: string } | undefined;
      const exprRaw = String(top?.label || r.expression || r.emotion || "Biasa").trim();
      const expr = mapExprLabel(exprRaw);
      const fused = fuseName([bx, by, bw, bh]);
      const name = String(fused || r.label || r.name || "Unknown");
      if (!fused) missingName = true;
      const color = EXP_COLORS[expr] || "#38bdf8";
      drawBoxWithLabels(clamped.x, clamped.y, clamped.w, clamped.h, name, expr, color);
    });
    const now = Date.now();
    if (missingName && now - lastAttPush > 400) {
      pushAttFrame();
    } else if (now - lastAttPush > memoizedSettings.baseInterval) {
      pushAttFrame();
    }
  };
  
  // Cached frame encoding and sending
  const toBytes = useCallback(async (): Promise<Uint8Array | null> => {
    if (!snapCanvasRef.current) return null;
    
    const canvas = snapCanvasRef.current;
    const frameKey = `frame-${canvas.width}x${canvas.height}-${Date.now()}`;
    
    // Check cache first
    const cachedFrame = videoFrameCache.get(frameKey);
    if (cachedFrame) {
      console.log('[FRAME CACHE] Using cached frame');
      updateCacheStats('frameHits');
      return cachedFrame;
    }
    
    const preferWebP = !!document.createElement("canvas").toDataURL("image/webp").match("data:image/webp");
    const type = preferWebP ? "image/webp" : "image/jpeg";
    const blob = await new Promise<Blob | null>((res) => 
      canvas.toBlob(res, type, memoizedSettings.jpegQuality)
    );
    
    if (!blob) return null;
    
    const bytes = new Uint8Array(await blob.arrayBuffer());
    
    // Cache the frame
    videoFrameCache.set(frameKey, bytes, 5 * 1000); // 5 seconds TTL
    
    return bytes;
  }, [memoizedSettings.jpegQuality, updateCacheStats]);
  
  // Throttled frame pushing with cache
  const pushFunFrame = useThrottle(
    useCallback(async () => {
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
          console.log("[PUSH_FUN_FRAME] Sending cached frame, size:", bytes.length);
          socket.emit("fun_frame", bytes);
        }
      } catch (error) {
        console.error("[PUSH_FUN_FRAME] Error:", error);
      } finally {
        setSendingFun(false);
      }
    }, [socket, sendingFun, toBytes]),
    memoizedSettings.funIntervalMs / 2 // Throttle at half the interval
  );
  
  // Cached attendance frame pushing
  const pushAttFrame = useCallback(async () => {
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
        console.log("[PUSH_ATT_FRAME] Sending cached frame, size:", bytes.length);
        socket.emit("att_frame", bytes);
        setLastAttPush(Date.now());
      }
    } finally {
      setSendingAtt(false);
    }
  }, [socket, sendingAtt, toBytes]);

  // Camera functions (direct implementation like Vue original)
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraActiveRef = useRef(false);
  
  // Simple ad slideshow state
  const [currentAdIndex, setCurrentAdIndex] = useState(0);
  const adVideoRef = useRef<HTMLVideoElement>(null);
  const adTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [repeatCount, setRepeatCount] = useState(3); // Jumlah repeat iklan ke kanan dan kiri (total = 1 center + 3 kiri + 3 kanan = 7)

  // Optimized preload with cache: hanya preload current dan next ad
  const preloadedVideos = useRef<Map<string, HTMLVideoElement>>(new Map());
  const preloadCache = useRef<Map<string, boolean>>(new Map());
  
  // Aggressive video preloading with immediate loading
  useEffect(() => {
    const currentAd = adMediaList[currentAdIndex];
    const nextIndex = (currentAdIndex + 1) % adMediaList.length;
    const nextAd = adMediaList[nextIndex];
    const prevIndex = currentAdIndex > 0 ? currentAdIndex - 1 : adMediaList.length - 1;
    const prevAd = adMediaList[prevIndex];
    
    const preloadVideo = async (ad: AdMedia, priority: 'high' | 'medium' | 'low' = 'medium') => {
      if (ad.type !== 'video' || preloadCache.current.has(ad.src)) {
        // If already cached, ensure it's ready
        const existingVideo = preloadedVideos.current.get(ad.src);
        if (existingVideo && existingVideo.readyState < 3) {
          console.log('[VIDEO CACHE] Ensuring video is ready:', ad.src);
          existingVideo.load();
        }
        return;
      }
      
      console.log(`[VIDEO CACHE] Preloading video (${priority}):`, ad.src);
      preloadCache.current.set(ad.src, true);
      
      const video = document.createElement('video');
      video.src = ad.src;
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      
      // Aggressive preloading based on priority
      if (priority === 'high') {
        video.preload = 'auto';
        // Force immediate loading for current video
        video.load();
        
        // Wait for video to be ready
        const loadPromise = new Promise<void>((resolve) => {
          const checkReady = () => {
            if (video.readyState >= 3) { // HAVE_FUTURE_DATA
              console.log('[VIDEO CACHE] High priority video ready:', ad.src);
              resolve();
            } else {
              setTimeout(checkReady, 100);
            }
          };
          
          video.addEventListener('canplay', () => resolve(), { once: true });
          video.addEventListener('loadeddata', () => resolve(), { once: true });
          checkReady();
        });
        
        // Timeout after 10 seconds
        Promise.race([
          loadPromise,
          new Promise(resolve => setTimeout(resolve, 10000))
        ]).then(() => {
          console.log('[VIDEO CACHE] High priority video load completed or timed out:', ad.src);
        });
      } else if (priority === 'medium') {
        video.preload = 'metadata';
        // Load metadata first, then full video after short delay
        setTimeout(() => {
          if (preloadCache.current.has(ad.src)) {
            video.preload = 'auto';
            video.load();
          }
        }, 1000);
      } else {
        video.preload = 'none';
        // Only load on demand
      }
      
      // Error handling
      video.addEventListener('error', (e) => {
        console.error('[VIDEO CACHE] Video load error:', ad.src, e);
        preloadCache.current.delete(ad.src);
        preloadedVideos.current.delete(ad.src);
      });
      
      // Progress tracking
      video.addEventListener('progress', () => {
        if (video.buffered.length > 0) {
          const bufferedEnd = video.buffered.end(video.buffered.length - 1);
          const duration = video.duration || 0;
          if (duration > 0) {
            const bufferedPercent = (bufferedEnd / duration) * 100;
            console.log(`[VIDEO CACHE] Buffered ${bufferedPercent.toFixed(1)}% of ${ad.src}`);
          }
        }
      });
      
      preloadedVideos.current.set(ad.src, video);
      
      // Extended cleanup time for better caching
      setTimeout(() => {
        if (preloadedVideos.current.has(ad.src) && !document.body.contains(video)) {
          video.src = '';
          preloadedVideos.current.delete(ad.src);
          preloadCache.current.delete(ad.src);
          console.log('[VIDEO CACHE] Cleaned up unused video:', ad.src);
        }
      }, 120000); // 2 minutes instead of 30 seconds
    };
    
    // Preload with priorities: current (high), next (medium), previous (low)
    if (currentAd) preloadVideo(currentAd, 'high');
    if (nextAd && nextAd.src !== currentAd?.src) preloadVideo(nextAd, 'medium');
    if (prevAd && prevAd.src !== currentAd?.src && prevAd.src !== nextAd?.src) {
      preloadVideo(prevAd, 'low');
    }
    
    // Preload all videos in background with low priority
    adMediaList.forEach((ad, index) => {
      if (ad.type === 'video' && 
          index !== currentAdIndex && 
          index !== nextIndex && 
          index !== prevIndex) {
        setTimeout(() => preloadVideo(ad, 'low'), 5000 + (index * 2000)); // Staggered loading
      }
    });
    
    // Cleanup old preloaded videos (keep current, next, and previous)
    const keepSources = new Set([currentAd?.src, nextAd?.src, prevAd?.src]);
    preloadedVideos.current.forEach((video, src) => {
      if (!keepSources.has(src)) {
        // Don't immediately remove, let timeout handle it for better caching
        console.log('[VIDEO CACHE] Marking for cleanup:', src);
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
    console.log("[WS_SETUP] Setting up fun frame interval:", memoizedSettings.funIntervalMs, "ms");
    const funInterval = setInterval(() => {
      pushFunFrame();
    }, memoizedSettings.funIntervalMs);
    
    return () => {
      console.log("[WS_SETUP] Cleaning up");
      socket.off("connect", handleConnect);
      clearInterval(funInterval);
    };
  }, [socket, memoizedSettings.funIntervalMs, pushFunFrame]);

    useEffect(() => {
    const handleKeyPress = (event : KeyboardEvent) => {
      if (event.key === "Escape") {
        router.back(); // fungsi sama seperti klik tombol
      } else if (event.key === "1") {
        router.push("/home"); // redirect ke home saat tekan tombol 1
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
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
  
  // Optimized ad rotation with preloading
  const goToNextAd = useCallback(() => {
    const nextIndex = (currentAdIndex + 1) % Math.max(1, adMediaList.length);
    const nextAd = adMediaList[nextIndex];
    
    // Ensure next video is ready before switching
    if (nextAd && nextAd.type === 'video') {
      const preloadedVideo = preloadedVideos.current.get(nextAd.src);
      if (preloadedVideo && preloadedVideo.readyState < 3) {
        console.log('[AD ROTATION] Waiting for video to be ready:', nextAd.src);
        // Force load if not ready
        preloadedVideo.load();
        
        // Wait a bit for video to load before switching
        setTimeout(() => {
          setCurrentAdIndex(nextIndex);
        }, 500);
        return;
      }
    }
    
    setCurrentAdIndex(nextIndex);
  }, [currentAdIndex, adMediaList]);

  // Optimized ad timing with better video handling
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
      // Untuk video, gunakan preloaded video jika tersedia
      const centerVideo = adVideoRef.current;
      const preloadedVideo = preloadedVideos.current.get(currentAd.src);
      
      if (centerVideo) {
        // Copy dari preloaded video jika tersedia dan ready
        if (preloadedVideo && preloadedVideo.readyState >= 3) {
          console.log('[AD VIDEO] Using preloaded video:', currentAd.src);
          centerVideo.src = preloadedVideo.src;
          centerVideo.currentTime = 0;
          
          // Play immediately since it's preloaded
          centerVideo.play().catch((error) => {
            console.error('[AD VIDEO] Play error:', error);
            // Fallback: try to load and play
            centerVideo.load();
            setTimeout(() => {
              centerVideo.play().catch(() => {
                console.error('[AD VIDEO] Fallback play failed');
              });
            }, 500);
          });
        } else {
          // Fallback to normal loading
          console.log('[AD VIDEO] Fallback loading:', currentAd.src);
          centerVideo.src = currentAd.src;
          centerVideo.currentTime = 0;
          centerVideo.load();
          
          // Wait for video to be ready before playing
          const playWhenReady = () => {
            if (centerVideo.readyState >= 3) {
              centerVideo.play().catch(() => {
                setTimeout(() => centerVideo.play().catch(() => {}), 100);
              });
            } else {
              setTimeout(playWhenReady, 100);
            }
          };
          
          centerVideo.addEventListener('canplay', () => {
            centerVideo.play().catch(() => {});
          }, { once: true });
          
          playWhenReady();
        }
      }
    }
    
    return () => {
      if (adTimerRef.current) {
        clearTimeout(adTimerRef.current);
      }
    };
  }, [currentAdIndex, adMediaList, goToNextAd]);

  // Enhanced preload for seamless transitions
  useEffect(() => {
    const nextIndex = adMediaList.length ? (currentAdIndex + 1) % adMediaList.length : 0;
    const nextAd = adMediaList[nextIndex];
    
    if (nextAd && nextAd.type === 'video') {
      // Ensure next video is aggressively preloaded
      const existingVideo = preloadedVideos.current.get(nextAd.src);
      if (!existingVideo) {
        console.log('[SEAMLESS PRELOAD] Loading next video:', nextAd.src);
        const preloadVideo = document.createElement('video');
        preloadVideo.src = nextAd.src;
        preloadVideo.preload = 'auto';
        preloadVideo.muted = true;
        preloadVideo.playsInline = true;
        preloadVideo.crossOrigin = 'anonymous';
        preloadVideo.load();
        
        preloadedVideos.current.set(nextAd.src, preloadVideo);
        preloadCache.current.set(nextAd.src, true);
        
        return () => {
          if (!preloadCache.current.has(nextAd.src)) {
            preloadVideo.src = '';
          }
        };
      } else if (existingVideo.readyState < 3) {
        // Ensure existing video is fully loaded
        console.log('[SEAMLESS PRELOAD] Ensuring next video is ready:', nextAd.src);
        existingVideo.load();
      }
    } else if (nextAd && nextAd.type === 'image') {
      // Preload next image with cache
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.src = nextAd.src;
      
      img.onload = () => {
        console.log('[SEAMLESS PRELOAD] Image preloaded:', nextAd.src);
      };
      
      img.onerror = () => {
        console.error('[SEAMLESS PRELOAD] Image preload failed:', nextAd.src);
      };
    }
  }, [currentAdIndex, adMediaList]);

  // Cache cleanup on unmount
  useEffect(() => {
    return () => {
      console.log('[CACHE CLEANUP] Clearing all caches on unmount');
      adMediaCache.clear();
      attendanceResultsCache.clear();
      emotionResultsCache.clear();
      videoFrameCache.clear();
      settingsCache.clear();
      
      // Cleanup preloaded videos
      preloadedVideos.current.forEach((video) => {
        if (document.body.contains(video)) {
          document.body.removeChild(video);
        }
        video.src = '';
      });
      preloadedVideos.current.clear();
      preloadCache.current.clear();
    };
  }, []);
  
  // Cache statistics logging (development only)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      const logInterval = setInterval(() => {
        const hitRate = cacheStats.totalRequests > 0 
          ? ((cacheStats.adMediaHits + cacheStats.attendanceHits + cacheStats.emotionHits + cacheStats.frameHits) / cacheStats.totalRequests * 100).toFixed(1)
          : '0';
        
        console.log('[CACHE STATS]', {
          hitRate: `${hitRate}%`,
          adMedia: `${adMediaCache.size()}/${10}`,
          attendance: `${attendanceResultsCache.size()}/${50}`,
          emotions: `${emotionResultsCache.size()}/${50}`,
          frames: `${videoFrameCache.size()}/${20}`,
          settings: `${settingsCache.size()}/${20}`,
          stats: cacheStats
        });
      }, 30000); // Log every 30 seconds
      
      return () => clearInterval(logInterval);
    }
  }, [cacheStats]);

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        /* Aspect Ratio Utility Classes - Padding-Top Hack Implementation */
        .aspect-ratio-container {
          position: relative;
          width: 100%;
          height: 0;
          overflow: hidden;
        }
        
        .aspect-ratio-content {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
        }
        
        /* Common aspect ratios using padding-top hack */
        .aspect-1-1 { padding-top: 100%; }      /* 1:1 = 1/1 = 100% */
        .aspect-4-3 { padding-top: 75%; }       /* 4:3 = 3/4 = 75% */
        .aspect-3-2 { padding-top: 66.67%; }    /* 3:2 = 2/3 = 66.67% */
        .aspect-16-9 { padding-top: 56.25%; }   /* 16:9 = 9/16 = 56.25% */
        .aspect-21-9 { padding-top: 42.86%; }   /* 21:9 = 9/21 = 42.86% */
        .aspect-40-4 { padding-top: 10%; }      /* 40:4 = 4/40 = 10% (header) */
        .aspect-40-2 { padding-top: 5%; }       /* 40:2 = 2/40 = 5% (footer) */
        .aspect-24-3 { padding-top: 12.5%; }    /* 24:3 = 3/24 = 12.5% (landscape header) */
        .aspect-24-2 { padding-top: 8.33%; }    /* 24:2 = 2/24 = 8.33% (landscape footer) */
        
        /* Layout grid: 3 bagian - header, video+iklan overlay, footer */
        .page-root {
          /* Aspect ratio based layout - menyesuaikan exact dengan image dimensions */
          /* Header dan Footer menggunakan aspect ratio containers */
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
          background: #000 !important;
          background-color: #000 !important;
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

        /* Banner Top - Responsive Aspect Ratio Implementation */
        .banner-top-container {
          width: 100%;
          position: relative;
        }
        
        /* Landscape mode - header aspect ratio 24:3 */
        @media (orientation: landscape) {
          .banner-top-container {
            padding-top: 8%; /* 24:3 = 3/24 = 12.5% */
          }
          
          .banner-top-container::after {
            content: '';
            display: block;
            padding-top: 0;
          }
        }

        /* Portrait mode - header aspect ratio 40:4 */
        @media (orientation: portrait) {
          .banner-top-container {
            padding-top: 10%; /* 40:4 = 4/40 = 10% */
          }
        }

        /* Responsive breakpoints for different screen sizes */
        @media (orientation: portrait) and (max-width: 640px) {
          .banner-top-container {
            padding-top: 10%; /* Maintain 40:4 ratio */
          }
        }

        @media (orientation: portrait) and (max-width: 480px) {
          .banner-top-container {
            padding-top: 10%; /* Maintain 40:4 ratio */
          }
        }

        @media (orientation: portrait) and (max-width: 360px) {
          .banner-top-container {
            padding-top: 10%; /* Maintain 40:4 ratio */
          }
        }

        /* Header image styling - always contain untuk menampilkan semua konten */
        .banner-top-container img {
          object-fit: contain !important;
          object-position: center !important;
        }
        
        #camera {
          z-index: 10;
          background: #000 !important;
          background-color: #000 !important;
          /* Video section menggunakan flex-grow untuk mengisi sisa ruang */
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        /* Video container dengan aspect ratio responsif */
        .video-container {
          position: relative;
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #000;
        }
        
        /* Video responsive sizing dengan maintain aspect ratio */
        .video-container video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center center;
          background: #000;
        }
        
        /* Landscape mode - video optimal untuk landscape */
        @media (orientation: landscape) {
          .video-container {
            /* Maintain 16:9 aspect ratio untuk landscape */
            aspect-ratio: 16 / 9;
          }
        }
        
        /* Portrait mode - video optimal untuk portrait */
        @media (orientation: portrait) {
          .video-container {
            /* Maintain 9:16 aspect ratio untuk portrait */
            aspect-ratio: 9 / 16;
          }
        }
        
        /* Ultra-wide screens */
        @media (min-aspect-ratio: 21/9) {
          .video-container {
            aspect-ratio: 21 / 9;
          }
        }

        #ads {
          height: var(--ads-height);
        }

        #banner_bottom {
          z-index: 100;
        }

        /* Banner Bottom - Responsive Aspect Ratio Implementation */
        .banner-bottom-container {
          width: 100%;
          position: relative;
        }
        
        /* Landscape mode - footer aspect ratio 24:2 */
        @media (orientation: landscape) {
          .banner-bottom-container {
            padding-top: 3%; /* 24:2 = 2/24 = 8.33% */
          }
          
          .banner-bottom-container::after {
            content: '';
            display: block;
            padding-top: 0;
          }
        }

        /* Portrait mode - footer aspect ratio 40:2 */
        @media (orientation: portrait) {
          .banner-bottom-container {
            padding-top: 5%; /* 40:2 = 2/40 = 5% */
          }
        }
        
        /* Footer image styling */
        .banner-bottom-container img {
          object-fit: contain !important;
          object-position: center !important;
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


        /* Background colors for sections - ensure no white backgrounds */
        #ads {
          background-color: transparent;
        }
        
        /* Ensure no white backgrounds anywhere */
        .ad-overlay-container,
        .ad-overlay-container *,
        #camera-host,
        #camera-host * {
          background-color: transparent !important;
          background: transparent !important;
        }
        
        /* Advertisement positioning - tepat di atas footer */
        /* Advertisement overlay wrapper positioning */
        .ad-overlay-wrapper {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          z-index: 30;
          display: flex;
          align-items: end;
          justify-content: center;
          pointer-events: none;
          overflow: hidden;
          /* Padding dari bottom untuk memberikan space */
          padding-bottom: 0px;
        }
        
        @media (orientation: portrait) {
          .ad-overlay-wrapper {
            /* Di portrait, iklan lebih dekat ke footer */
            padding-bottom: 0px;
          }
        }
        
        @media (orientation: landscape) {
          .ad-overlay-wrapper {
            /* Di landscape, iklan sedikit lebih tinggi */
            padding-bottom: 0px;
          }
        }
        
        /* Mobile adjustments untuk ad wrapper */
        @media (max-width: 768px) {
          .ad-overlay-wrapper {
            padding-bottom: 0px;
          }
        }
        
        
        /* Advertisement overlay responsive sizing - praktis dan responsif */
        .ad-overlay-container {
          position: relative;
          width: 280px;
          min-width: 280px;
          /* Height yang praktis berdasarkan viewport */
          height: clamp(120px, 15vh, 200px);
          max-height: 200px;
          /* Hardware acceleration untuk smooth rendering */
          will-change: transform;
          transform: translateZ(0);
          backface-visibility: hidden;
          /* Ensure no white background */
          background: transparent !important;
          background-color: transparent !important;
          /* Flex untuk centering content */
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        /* Content positioning dalam container */
        .ad-overlay-container > * {
          width: 100%;
          height: 100%;
          object-fit: contain;
          object-position: center;
        }
        
        /* Video optimization */
        .ad-overlay-container video {
          will-change: transform, opacity;
          transform: translateZ(0);
          backface-visibility: hidden;
          /* Disable anti-aliasing untuk performa */
          image-rendering: -webkit-optimize-contrast;
          image-rendering: crisp-edges;
          /* Ensure no white background */
          background: transparent !important;
          background-color: transparent !important;
        }
        
        /* Image optimization - no white backgrounds */
        .ad-overlay-container img {
          background: transparent !important;
          background-color: transparent !important;
        }
        
        /* Portrait mode - smaller ads dengan height responsif */
        @media (orientation: portrait) {
          .ad-overlay-container {
            width: 200px;
            min-width: 200px;
            height: clamp(100px, 12vh, 150px);
            max-height: 150px;
          }
        }
        
        /* Landscape mode - medium ads dengan height responsif */
        @media (orientation: landscape) {
          .ad-overlay-container {
            width: 320px;
            min-width: 320px;
            height: clamp(120px, 15vh, 180px);
            max-height: 180px;
          }
        }
        
        /* Large landscape screens */
        @media (orientation: landscape) and (min-width: 1024px) {
          .ad-overlay-container {
            width: 400px;
            min-width: 400px;
            height: clamp(150px, 18vh, 220px);
            max-height: 220px;
          }
        }
        
        /* Extra large screens */
        @media (min-width: 1920px) {
          .ad-overlay-container {
            width: 500px;
            min-width: 500px;
            height: clamp(180px, 20vh, 280px);
            max-height: 280px;
          }
        }
        
        /* Alternative sizes untuk different ad formats */
        .ad-overlay-container.compact {
          height: clamp(80px, 10vh, 120px);
          max-height: 120px;
        }
        
        .ad-overlay-container.large {
          height: clamp(200px, 25vh, 300px);
          max-height: 300px;
        }
        
        .ad-overlay-container.square {
          width: clamp(150px, 15vh, 200px);
          height: clamp(150px, 15vh, 200px);
          max-width: 200px;
          max-height: 200px;
        }
        
        /* Auto height untuk content yang tidak memerlukan fixed aspect ratio */
        .ad-overlay-container.auto-height {
          height: auto;
          min-height: 80px;
          max-height: 250px;
        }
        
        .ad-overlay-container.auto-height > * {
          width: 100%;
          height: auto;
          max-height: 100%;
        }
        
        /* Responsive adjustments untuk mobile devices */
        @media (max-width: 480px) {
          .ad-overlay-container {
            width: 180px;
            min-width: 180px;
            height: clamp(80px, 10vh, 120px);
            max-height: 120px;
          }
        }
        
        /* Very small screens */
        @media (max-width: 360px) {
          .ad-overlay-container {
            width: 150px;
            min-width: 150px;
            height: clamp(70px, 8vh, 100px);
            max-height: 100px;
          }
        }
        
        /* Fallback untuk browser yang tidak support clamp() */
        @supports not (width: clamp(1px, 1vh, 1px)) {
          .ad-overlay-container {
            height: 150px;
          }
          
          @media (orientation: portrait) {
            .ad-overlay-container {
              height: 120px;
            }
          }
        }

        /* Advanced responsive optimizations */
        
        /* Prevent layout shift dengan aspect ratio containers */
        .aspect-ratio-container,
        .banner-top-container,
        .banner-bottom-container,
        .ad-overlay-container {
          contain: layout style;
          will-change: auto;
        }
        
        /* Performance optimizations untuk smooth rendering */
        .page-root {
          contain: layout;
          transform: translateZ(0);
          backface-visibility: hidden;
        }
        
        /* Optimize untuk different pixel densities */
        @media (-webkit-min-device-pixel-ratio: 2), (min-resolution: 192dpi) {
          .banner-top-container img,
          .banner-bottom-container img {
            image-rendering: -webkit-optimize-contrast;
            image-rendering: crisp-edges;
          }
        }
        
        /* Reduce motion untuk accessibility */
        @media (prefers-reduced-motion: reduce) {
          .ad-overlay-container,
          .video-container {
            will-change: auto;
            transform: none;
          }
        }
        
        /* High contrast mode support */
        @media (prefers-contrast: high) {
          .page-root {
            background: #000;
          }
          
          #banner_top {
            border-bottom: 2px solid #fff;
          }
          
          #banner_bottom {
            border-top: 2px solid #fff;
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
        
        /* Video loading optimization */
        .ad-overlay-container video {
          /* Optimize video loading */
          will-change: transform, opacity;
          transform: translateZ(0);
          backface-visibility: hidden;
          /* Disable anti-aliasing untuk performa */
          image-rendering: -webkit-optimize-contrast;
          image-rendering: crisp-edges;
          /* Network optimization hints */
          loading: eager;
        }
        
        /* Loading indicator untuk video ads - Removed */
        
        /* Preload hints untuk browser */
        .preload-hint {
          position: absolute;
          top: -9999px;
          left: -9999px;
          width: 1px;
          height: 1px;
          opacity: 0;
          pointer-events: none;
        }
      `}} />
      
      {/* Preload hints untuk browser */}
      {adMediaList.map((ad, index) => (
        ad.type === 'video' && index < 5 ? (
          <link key={ad.src} rel="preload" as="video" href={ad.src} className="preload-hint" />
        ) : null
      ))}
      
      <div className="page-root">
      {/* Header banner - Section 1 */}
      <section id="banner_top" className="relative w-screen overflow-hidden bg-[#006CBB]">
        <div className="banner-top-container">
          <div className="aspect-ratio-content">
            <Image 
              src="/assets/header/header.png"
              alt="Header"
              fill
              priority
              className="object-contain select-none pointer-events-none"
              sizes="100vw" />
          </div>
        </div>
      </section>
      
      {/* Video Section with Advertisement Overlay - Section 2 */}
      <section id="camera" className="relative w-screen overflow-hidden bg-black">
        <div ref={hostRef} id="camera-host" className="relative w-full h-full flex items-center justify-center bg-black">
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
          <div className="ad-overlay-wrapper">
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
                    preload="auto"
                    crossOrigin="anonymous"
                    className="select-none w-full h-auto object-contain block"
                    style={{ filter: 'drop-shadow(0 20px 25px rgba(0, 0, 0, 0.5))', marginBottom: 0, paddingBottom: 0 }}
                    onLoadStart={() => {
                      // Loading indicator removed
                    }}
                    onLoadedData={() => {
                      // Loading indicator removed
                    }}
                    onCanPlay={() => {
                      // Loading indicator removed
                    }}
                    onLoadedMetadata={(e) => {
                      const video = e.currentTarget;
                      // Use preloaded video if available
                      const preloadedVideo = preloadedVideos.current.get(adMediaList[currentAdIndex].src);
                      if (preloadedVideo && preloadedVideo.readyState >= 3) {
                        console.log('[CENTER VIDEO] Using preloaded video for immediate play');
                        video.currentTime = 0;
                      }
                      
                      video.play().catch(() => {
                        setTimeout(() => video.play().catch(() => {}), 100);
                      });
                    }}
                    onEnded={goToNextAd}
                    onError={(e) => {
                      console.error('[AD_VIDEO] Failed to load:', adMediaList[currentAdIndex].src);
                      e.currentTarget.style.display = 'none';
                      // Try next ad if current fails
                      setTimeout(goToNextAd, 1000);
                    }}
                    onWaiting={() => {
                      // Loading indicator removed
                    }}
                    onPlaying={() => {
                      // Loading indicator removed
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
        <div className="banner-bottom-container">
          <div className="aspect-ratio-content">
            <Image 
              src="/assets/footer/footer.png" 
              alt="Footer" 
              fill
              priority 
              quality={100}
              unoptimized={false}
              className="object-contain select-none pointer-events-none"
              sizes="100vw" />
          </div>
        </div>
      </section>
      </div>
    </>
  );
}

// Export cache instances for external access (optional)
export { 
  adMediaCache, 
  attendanceResultsCache, 
  emotionResultsCache, 
  videoFrameCache, 
  settingsCache 
};

export default function AttendanceFunMeterPage() {
  const { t, locale } = useI18n();
  
  return (
    <ClientOnly loaderText={t("common.loading", "Memuat...")}>
      <AttendanceFunMeterPageContent />
    </ClientOnly>
  );
}
