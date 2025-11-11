// app/fun-meter/page.tsx
// Port dari src-vue-original/pages/default/FunMeterPage.vue

"use client";

import React, { useState, useRef, useEffect } from "react";
import { useI18n } from "@/components/providers/I18nProvider";
import { useSettings } from "@/components/providers/SettingsProvider";
import { useWs } from "@/components/providers/WsProvider";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";

interface FunMeterResult {
  bbox: [number, number, number, number];
  expr?: string;
  score?: number;
  fun?: number;
  probs?: Record<string, number>;
}

interface FunMetadataData {
  model?: string;
  [key: string]: unknown;
}

interface FunResultData {
  results?: FunMeterResult[];
  [key: string]: unknown;
}

export default function FunMeterPage() {
  const { t, locale } = useI18n();
  const { useSetting } = useSettings();
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const snapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sendHeightRef = useRef(0);
  
  const [cameraActive, setCameraActive] = useState(false);
  const cameraActiveRef = useRef(false);
  const [statusText, setStatusText] = useState("");
  const [results, setResults] = useState<FunMeterResult[]>([]);
  const [facesCount, setFacesCount] = useState(0);
  const [emotionLabels, setEmotionLabels] = useState<string[]>([]);
  const [emotionData, setEmotionData] = useState<Array<{face: number; probs: Record<string, number>}>>([]);
  const [modelName, setModelName] = useState<string>("");

  // Settings
  const { model: funSendWidth } = useSetting("funMeter.sendWidth", { 
    clamp: { min: 160, max: 1920, round: true } 
  });
  const { model: jpegQuality } = useSetting("funMeter.jpegQuality", { clamp: { min: 0, max: 1 } });
  const { model: funIntervalMs } = useSetting("funMeter.funIntervalMs", { clamp: { min: 100, max: 2000, round: true } });

  // WebSocket connection
  const socket = useWs({
    url: "",
    root: true,
    on: {
      connect() {
        setStatusText(t("funMeter.status.wsConnected", "WS terhubung"));
        toast.success(t("funMeter.toast.wsConnected", "Terhubung ke server WebSocket"));
      },
      disconnect(..._args: unknown[]) {
        setStatusText(t("funMeter.status.wsDisconnected", "WS terputus"));
        toast.warn(t("funMeter.toast.wsDisconnected", "Koneksi WebSocket terputus"));
      },
      fun_metadata(...args: unknown[]) {
        // Receive model metadata from server
        const data = args[0] as FunMetadataData;
        if (data?.model) {
          console.log("[FUN_METADATA] Received model:", data.model);
          setModelName(data.model);
        }
      },
      fun_result(...args: unknown[]) {
        const data = args[0] as FunResultData;
        const funResults = Array.isArray(data?.results) ? data.results : [];
        console.log("[FUN_RESULT] Received", funResults.length, "faces:", funResults);
        
        if (funResults.length === 0) {
          console.log("[FUN_RESULT] No faces detected");
          setResults([]);
          setFacesCount(0);
          setEmotionData([]);
          return;
        }
        
        setResults(funResults);
        setFacesCount(funResults.length);
        
        // Extract emotion data for summary
        const emotionDataArray: Array<{face: number; probs: Record<string, number>}> = [];
        const allLabels = new Set<string>();
        
        funResults.forEach((r: FunMeterResult, idx: number) => {
          console.log(`[FUN_RESULT] Face ${idx + 1}:`, {
            bbox: r.bbox,
            expr: r.expr,
            fun: r.fun,
            score: r.score,
            probs: r.probs
          });
          
          if (r.probs) {
            emotionDataArray.push({ face: idx + 1, probs: r.probs });
            Object.keys(r.probs).forEach(k => allLabels.add(k));
          }
        });
        
        console.log("[FUN_RESULT] Emotion data:", emotionDataArray);
        setEmotionData(emotionDataArray);
        setEmotionLabels(Array.from(allLabels).sort());
        
        // Draw on canvas
        console.log("[FUN_RESULT] Drawing", funResults.length, "faces on canvas");
        drawFun(funResults);
      },
    },
  });

  // Camera functions
  const startCamera = async () => {
    if (!videoRef.current) return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: false 
      });
      if (!videoRef.current) return;
      const video = videoRef.current;
      video.srcObject = stream;
      setCameraActive(true);
      setStatusText(t("funMeter.status.cameraActive", "Kamera aktif"));
      
      await new Promise((resolve) => {
        if (video.readyState >= 2) resolve(undefined);
        else video.onloadedmetadata = () => resolve(undefined);
      });
      
    } catch (error) {
      setStatusText(t("funMeter.status.cameraDenied", "Akses kamera ditolak"));
      toast.error(t("funMeter.toast.cameraError", "Gagal mengakses kamera"));
    }
  };

  const toggleCamera = () => {
    if (cameraActive) {
      stopCamera();
    } else {
      void startCamera();
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setStatusText(t("funMeter.status.cameraStopped", "Kamera dihentikan"));
    // Clear detection states and overlay when camera is stopped
    setResults([]);
    setFacesCount(0);
    setEmotionData([]);
    const canvas = overlayRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  // Canvas drawing helpers
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  
  const mapExprLabel = React.useCallback((s: string): string => {
    const k = String(s || "").toLowerCase().trim();
    if (["happiness", "happy", "senang"].includes(k)) return t("funMeter.emotions.happy", "Senang");
    if (["sadness", "sad", "sedih"].includes(k)) return t("funMeter.emotions.sad", "Sedih");
    if (["surprise", "surprised", "kaget"].includes(k)) return t("funMeter.emotions.surprised", "Kaget");
    if (["anger", "angry", "marah"].includes(k)) return t("funMeter.emotions.angry", "Marah");
    if (["fear", "fearful", "takut"].includes(k)) return t("funMeter.emotions.fear", "Takut");
    if (["disgust", "disgusted", "jijik"].includes(k)) return t("funMeter.emotions.disgust", "Jijik");
    if (["neutral", "biasa"].includes(k)) return t("funMeter.emotions.neutral", "Biasa");
    
    // Fallback: capitalize first letter untuk emotion tidak dikenal
    return k ? k.charAt(0).toUpperCase() + k.slice(1) : t("funMeter.emotions.neutral", "Biasa");
  }, [t]);

  const getLetterboxTransform = () => {
    const overlay = overlayRef.current;
    const host = hostRef.current;
    if (!overlay || !host || !snapCanvasRef.current) return { sx: 1, sy: 1, ox: 0, oy: 0 };
    
    const rect = host.getBoundingClientRect();
    const dispW = rect.width;
    const dispH = rect.height;
    
    // Account for DPR since canvas uses DPR scaling
    const dpr = window.devicePixelRatio || 1;
    const canvasW = overlay.width / dpr;
    const canvasH = overlay.height / dpr;
    
    // Bounding box dari server menggunakan koordinat snapCanvas (frame yang dikirim)
    const snapW = snapCanvasRef.current.width; // funSendWidth
    const snapH = snapCanvasRef.current.height; // sendHeightRef.current
    
    // Calculate letterbox offset for object-cover behavior
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
    // object-contain preserves aspect ratio and adds letterbox if needed
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

  const drawFun = React.useCallback((funResults: FunMeterResult[]) => {
    const funLabel = t("funMeter.canvas.fun", "Fun");
    const video = videoRef.current;
    const canvas = overlayRef.current;
    const host = hostRef.current;
    if (!video || !canvas || !host || !cameraActiveRef.current) {
      console.log("[DRAW_FUN] Missing refs:", { video: !!video, canvas: !!canvas, host: !!host });
      return;
    }

    const rect = host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const { sx, sy, ox, oy } = getLetterboxTransform();

    console.log("[DRAW_FUN] Drawing", funResults.length, "faces. Transform:", { sx, sy, ox, oy });

    funResults.forEach((r, idx) => {
      const [bx, by, bw, bh] = r.bbox || [0, 0, 0, 0];
      
      // Transform bounding box coordinates with letterbox offset
      const rx = ox + bx * sx;
      const ry = oy + by * sy;
      const rw = bw * sx;
      const rh = bh * sy;

      console.log(`[DRAW_FUN] Face ${idx + 1} bbox:`, { bx, by, bw, bh }, "→", { rx, ry, rw, rh });

      // Draw bounding box
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 3;
      ctx.strokeRect(rx, ry, rw, rh);

      // Draw emotion label - use DOMINANT emotion (highest probability)
      let dominantEmotion = r.expr || "neutral";
      let maxProb = 0;
      
      if (r.probs) {
        // Find emotion with highest probability
        for (const [emotion, prob] of Object.entries(r.probs)) {
          if (prob > maxProb) {
            maxProb = prob;
            dominantEmotion = emotion;
          }
        }
      }
      
      const expr = mapExprLabel(dominantEmotion);
      if (expr) {
        ctx.font = "bold 14px sans-serif";
        const txtW = ctx.measureText(expr).width;
        const pad = 6;
        const labelX = rx;
        const labelY = ry - 8;

        ctx.fillStyle = "rgba(56, 189, 248, 0.9)";
        ctx.fillRect(labelX, labelY - 18, txtW + pad * 2, 24);

        ctx.fillStyle = "#fff";
        ctx.fillText(expr, labelX + pad, labelY - 2);
        
        console.log(`[DRAW_FUN] Face ${idx + 1} dominant emotion:`, dominantEmotion, `(${(maxProb * 100).toFixed(1)}%)`);
      }

      // Draw fun score
      const funScore = r.fun !== undefined ? r.fun : (r.score || 0);
      const funText = `${funLabel} ${Math.round(funScore * 100)}%`;
      ctx.font = "bold 12px sans-serif";
      const funW = ctx.measureText(funText).width;
      const pad = 4;
      const funX = rx;
      const funY = ry + rh + 4;

      ctx.fillStyle = "rgba(34, 197, 94, 0.9)";
      ctx.fillRect(funX, funY, funW + pad * 2, 20);

      ctx.fillStyle = "#fff";
      ctx.fillText(funText, funX + pad, funY + 14);
      
      console.log(`[DRAW_FUN] Face ${idx + 1} drawn:`, { expr, funScore });
    });
  }, [t, mapExprLabel]);

  // Frame sending logic (wrapped with useCallback to ensure fresh values)
  const pushFunFrame = React.useCallback(async () => {
    const video = videoRef.current;
    if (!video || !socket || video.readyState < 2) return;

    const w = Number(funSendWidth) || 640;
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    const ratio = vh / vw;
    const h = Math.round(w * ratio);
    
    // Store snap canvas dimensions for transform calculation
    if (!snapCanvasRef.current) {
      snapCanvasRef.current = document.createElement("canvas");
    }
    snapCanvasRef.current.width = w;
    snapCanvasRef.current.height = h;
    sendHeightRef.current = h;
    
    const canvas = snapCanvasRef.current;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);

    try {
      const quality = clamp(Number(jpegQuality) || 0.8, 0.1, 1.0);
      
      // Convert canvas to blob (like Vue version)
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality)
      );
      
      if (!blob) {
        console.error("[PUSH_FUN_FRAME] Failed to create blob");
        return;
      }
      
      // Convert blob to ArrayBuffer then Uint8Array (like Vue version!)
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Send binary data (NOT base64!)
      socket.emit("fun_frame", uint8Array);
      console.log("[PUSH_FUN_FRAME] Sent binary frame to backend, size:", uint8Array.length, "bytes");
    } catch (err) {
      console.error("[PUSH_FUN_FRAME] Error:", err);
    }
  }, [socket, funSendWidth, jpegQuality]);

  // Setup interval for frame sending
  useEffect(() => {
    if (!cameraActive || !socket) return;

    const interval = Number(funIntervalMs) || 100;
    console.log(`[INTERVAL] Starting frame sending every ${interval}ms`);
    
    const timer = setInterval(() => {
      void pushFunFrame();
    }, interval);

    return () => {
      console.log("[INTERVAL] Stopping frame sending");
      clearInterval(timer);
    };
  }, [cameraActive, socket, funIntervalMs, pushFunFrame]);

  // Setup canvas resize handler
  useEffect(() => {
    const handleResize = () => {
      console.log("[RESIZE] Window resized, redrawing", results.length, "faces");
      if (cameraActiveRef.current && results.length > 0) {
        drawFun(results);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [results, drawFun]);

  // Re-draw when locale changes to update emotion labels
  useEffect(() => {
    if (cameraActiveRef.current && results.length > 0) {
      drawFun(results);
    }
  }, [locale, results, drawFun]);

  // Keep ref in sync with state
  useEffect(() => {
    cameraActiveRef.current = cameraActive;
  }, [cameraActive]);

  // Cleanup: stop camera on unmount (when navigating away)
  useEffect(() => {
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Emotion color mapping
  const getEmotionColor = (emotion: string): string => {
    const colors: Record<string, string> = {
      happy: "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200",
      sad: "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200",
      angry: "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200",
      surprised: "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200",
      fear: "bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200",
      disgust: "bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200",
      neutral: "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200",
    };
    return colors[emotion] || "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200";
  };

  return (
    <div className="space-y-6" key={locale}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Camera Card */}
        <div className="bg-card rounded-lg border p-6">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {t("funMeter.camera.title", "Kamera")}
          </p>
          <h3 className="text-lg font-semibold mb-4">{t("funMeter.camera.subtitle", "Streaming Fun Meter")}</h3>

          <div ref={hostRef} className="relative aspect-video rounded-lg border bg-muted/30 overflow-hidden mb-4">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-full object-contain"
            />
            <canvas
              ref={overlayRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />
            {facesCount > 0 && (
              <div className="absolute top-2 right-2 bg-black/70 text-white px-3 py-1 rounded-full text-sm font-semibold">
                {t("funMeter.camera.faces", "Wajah: {count}", { count: facesCount })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-sm font-medium block mb-1">
                {t("funMeter.form.interval", "Interval (ms)")}
              </label>
              <input
                type="number"
                value={funIntervalMs as number}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  // Note: funIntervalMs is read-only from useSetting, use SettingsProvider to change
                }}
                className="w-full px-3 py-2 border rounded-md bg-background text-foreground"
                min={100}
                max={2000}
                disabled
              />
              <p className="text-xs text-muted-foreground mt-1">{t("funMeter.form.changeViaSettings", "Ubah melalui Pengaturan")}</p>
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">
                {t("funMeter.form.model", "Model")}
              </label>
              <div className="h-10 flex items-center px-3 border rounded-md text-sm text-muted-foreground bg-background">
                {modelName || t("funMeter.model.waiting", "Menunggu metadata...")}
              </div>
            </div>
          </div>

          <div className="flex gap-2 mb-2">
            <Button onClick={toggleCamera}>
              {cameraActive
                ? t("funMeter.actions.stopCamera", "Hentikan Kamera")
                : t("funMeter.actions.startCamera", "Mulai Kamera")}
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            {t("funMeter.camera.help", "Tekan mulai untuk mengirim frame ke server.")}
          </p>
        </div>

        {/* Right: Summary Card */}
        <div className="bg-card rounded-lg border p-6 self-start">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                {t("funMeter.summary.title", "Ringkasan")}
              </p>
              <h3 className="text-lg font-semibold">{t("funMeter.summary.subtitle", "Label & Hasil Terakhir")}</h3>
            </div>
            <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold">
              {emotionLabels.length} {emotionLabels.length === 1 ? t("funMeter.summary.label", "label") : t("funMeter.summary.labels", "labels")}
            </span>
          </div>

          <p className="text-sm text-muted-foreground mb-4">
            {t(
              "funMeter.summary.description",
              "Fun merepresentasikan probabilitas kebahagiaan (0–100%). Daftar label diambil langsung dari model di server."
            )}
          </p>

          {/* Emotion probabilities table - Only show when camera is active */}
          {cameraActive && (
            <>
              {emotionData.length > 0 && (
                <div className="space-y-4">
                  {emotionData.map((faceData, faceIdx) => (
                    <div key={faceIdx} className="rounded-lg border p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold text-sm">{t("funMeter.summary.faceLabel", "WAJAH #{n}", { n: faceData.face })}</h4>
                        <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-semibold">
                          Fun {Math.round((faceData.probs["happy"] || faceData.probs["happiness"] || 0) * 100)}%
                        </span>
                      </div>
                      <div className="space-y-2">
                        {Object.entries(faceData.probs)
                          .sort((a, b) => b[1] - a[1])
                          .map(([emotion, prob]) => (
                            <div key={emotion} className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground capitalize">{mapExprLabel(emotion)}</span>
                              <div className="flex items-center gap-2">
                                <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-primary"
                                    style={{ width: `${prob * 100}%` }}
                                  />
                                </div>
                                <span className="text-xs font-mono w-12 text-right">
                                  {(prob * 100).toFixed(1)}%
                                </span>
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {emotionData.length === 0 && (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground text-center">
                  {results.length === 0
                    ? t("funMeter.summary.empty", "Belum ada hasil dari kamera.")
                    : t("funMeter.summary.nonEmpty", "Menerima hasil…")}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
