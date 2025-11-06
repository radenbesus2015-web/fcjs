<script setup>
import { ref, onMounted, onBeforeUnmount, inject } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { toast } from "@/utils/toast";
import { useWs } from "@/composables/useWS";
import { useSetting } from "@/composables/useSetting";
import { useI18n } from "@/i18n";

// ===== Refs =====
const hostRef = ref(null);
const videoRef = ref(null);
const overlayRef = ref(null);

const { t } = useI18n();

// ===== State (module-scoped) =====
let socket = null;
let AttFunSock = null; // <-- wrapper ws() utk komponen ini (share koneksi via pool)
let ctx = null;
let DPR = 1;
let tFun = null;
let lastFunResults = [];
let lastAtt = { t: 0, results: [] };
let lastAttPush = 0;
let sendingFun = false;
let sendingAtt = false;
let stream = null;
let vwTick = null;

// ===== Snap canvas (encode & send) =====
const snapCanvas = document.createElement("canvas");
let sendHeight = 0;

// ===== Pacing & quality =====
const { model: funSendWidth } = useSetting("funMeter.sendWidth", { clamp: { min: 160, max: 1920, round: true } });
const { model: funJpegQuality } = useSetting("funMeter.jpegQuality", { clamp: { min: 0, max: 1 } });
const { model: funIntervalMs } = useSetting("funMeter.funIntervalMs", { clamp: { min: 20, max: 5000, round: true } });
const { model: baseInterval } = useSetting("funMeter.baseInterval", {
  clamp: { min: 200, max: 10000, round: true },
});

// ===== Colors (emotion/expr) =====
const EXP_COLORS = {
  Marah: "#ef4444",
  Sedih: "#3b82f6",
  Senang: "#22c55e",
  Biasa: "#9ca3af",
  Kaget: "#f97316",
  Takut: "#9333ea",
  Jijik: "#8CA42B",
  happy: "#22c55e",
  sad: "#3b82f6",
  neutral: "#9ca3af",
  surprised: "#f97316",
  anger: "#ef4444",
  fearful: "#9333ea",
  disgust: "#8CA42B",
};
EXP_COLORS.happiness = EXP_COLORS.happy;
EXP_COLORS.sadness = EXP_COLORS.sad;
EXP_COLORS.surprise = EXP_COLORS.surprised;
EXP_COLORS.angry = EXP_COLORS.anger;
EXP_COLORS.fear = EXP_COLORS.fearful;

// ===== Utils =====
const $ = (s) => document.querySelector(s);
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function mapExprLabel(s) {
  const k = String(s || "")
    .toLowerCase()
    .trim();
  if (["happiness", "happy", "senang"].includes(k)) return "Senang";
  if (["sadness", "sad", "sedih"].includes(k)) return "Sedih";
  if (["surprise", "surprised", "kaget"].includes(k)) return "Kaget";
  if (["anger", "angry", "marah"].includes(k)) return "Marah";
  if (["fear", "fearful", "takut"].includes(k)) return "Takut";
  if (["disgust", "disgusted", "jijik"].includes(k)) return "Jijik";
  if (["neutral", "biasa"].includes(k)) return "Biasa";
  return "Biasa";
}
function capitalizeFirstLetter(str) {
  return typeof str === "string" && str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}
function roundRect(x, y, w, h, r = 10) {
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.stroke();
  } else {
    ctx.strokeRect(x, y, w, h);
  }
}
function iou(a, b) {
  const ax2 = a[0] + a[2],
    ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2],
    by2 = b[1] + b[3];
  const x1 = Math.max(a[0], b[0]),
    y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(ax2, bx2),
    y2 = Math.min(ay2, by2);
  const iw = Math.max(0, x2 - x1),
    ih = Math.max(0, y2 - y1);
  const inter = iw * ih,
    ua = a[2] * a[3] + b[2] * b[3] - inter;
  return ua > 0 ? inter / ua : 0;
}
function fuseName(funBox) {
  const now = Date.now();
  if (!lastAtt.results.length || now - lastAtt.t > 1800) return null;
  let best = null,
    bestIoU = 0;
  for (const r of lastAtt.results) {
    const i = iou(funBox, r.bbox || r.box || [0, 0, 0, 0]);
    if (i > bestIoU) {
      bestIoU = i;
      best = r;
    }
  }
  return best && best.label && bestIoU >= 0.25 ? best.label : null;
}

// ===== Canvas sizing / mapping =====
function fitCanvasToVideo() {
  const overlay = overlayRef.value;
  const host = hostRef.value || videoRef.value;
  if (!overlay || !host) return;
  const rect = host.getBoundingClientRect();
  DPR = window.devicePixelRatio || 1;

  overlay.width = Math.round(rect.width * DPR);
  overlay.height = Math.round(rect.height * DPR);
  overlay.style.width = rect.width + "px";
  overlay.style.height = rect.height + "px";

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, overlay.width, overlay.height);
}
function ensureSnapSize() {
  const v = videoRef.value;
  if (!v) return false;
  const vw = v.videoWidth,
    vh = v.videoHeight;
  if (!vw || !vh) return false;
  sendHeight = Math.round((Number(funSendWidth.value) * vh) / vw);
  snapCanvas.width = Number(funSendWidth.value);
  snapCanvas.height = sendHeight;
  return true;
}
function getLetterboxTransform() {
  const overlay = overlayRef.value;
  const host = overlay?.parentElement || videoRef.value;
  const rect = host.getBoundingClientRect();
  const v = videoRef.value;
  const vw = v?.videoWidth || 0,
    vh = v?.videoHeight || 0;
  if (!vw || !vh || !sendHeight) {
    return { sx: rect.width / Number(funSendWidth.value), sy: rect.height / (sendHeight || 1), ox: 0, oy: 0 };
  }
  const isCover = v.classList.contains("object-cover");
  const isFill = v.classList.contains("object-fill");
  let dispW,
    dispH,
    offX = 0,
    offY = 0;
  if (isFill) {
    dispW = rect.width;
    dispH = rect.height;
  } else {
    const scale = isCover ? Math.max(rect.width / vw, rect.height / vh) : Math.min(rect.width / vw, rect.height / vh);
    dispW = vw * scale;
    dispH = vh * scale;
    offX = (rect.width - dispW) / 2;
    offY = (rect.height - dispH) / 2;
  }
  return { sx: dispW / Number(funSendWidth.value), sy: dispH / sendHeight, ox: offX, oy: offY };
}

// ===== Drawing =====
function drawBoxWithLabels(x, y, w, h, name, expr, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  roundRect(x, y, w, h, 10);

  const hostRect = (overlayRef.value?.parentElement || videoRef.value).getBoundingClientRect();
  const padX = 10,
    padY = 4,
    th = 24,
    gap = 6;
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
}

function drawFun(results) {
  lastFunResults = results || [];
  if (!sendHeight) return;
  const overlay = overlayRef.value;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.lineWidth = 3;

  const { sx, sy, ox, oy } = getLetterboxTransform();
  let missingName = false;

  (results || []).forEach((r) => {
    const [bx, by, bw, bh] = r.bbox || [0, 0, 0, 0];
    const x = ox + bx * sx,
      y = oy + by * sy,
      w = bw * sx,
      h = bh * sy;

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
  } else if (now - lastAttPush > Number(baseInterval.value)) {
    pushAttFrame();
  }
}

// ===== Camera =====
async function startVideo() {
  const video = videoRef.value;
  const statusEl = $("#camera-status") || $("#status") || { textContent: "" };
  if (!video) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    video.srcObject = stream;
    await new Promise((r) => {
      if (video.readyState >= 2) r();
      else video.onloadedmetadata = r;
    });
    ensureSnapSize();
    fitCanvasToVideo();
    if (lastFunResults.length) drawFun(lastFunResults);
  } catch (e) {
    statusEl.textContent = "Camera blocked";
    toast?.error(t("attendanceFunMeter.toast.cameraAccessError", "Gagal mengakses kamera."));
  }
}

// ===== Encoding =====
async function toBytes() {
  const preferWebP = !!document.createElement("canvas").toDataURL("image/webp").match("data:image/webp");
  const type = preferWebP ? "image/webp" : "image/jpeg";
  const blob = await new Promise((res) => snapCanvas.toBlob(res, type, Number(funJpegQuality.value)));
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

async function pushFunFrame() {
  if (!AttFunSock || !AttFunSock.socket || AttFunSock.socket.disconnected || sendingFun || !ensureSnapSize()) return;
  sendingFun = true;
  try {
    const sctx = snapCanvas.getContext("2d");
    sctx.drawImage(videoRef.value, 0, 0, snapCanvas.width, snapCanvas.height);
    const bytes = await toBytes();
    if (bytes) AttFunSock.emit("fun_frame", bytes);
  } finally {
    sendingFun = false;
  }
}

async function pushAttFrame() {
  if (!AttFunSock || !AttFunSock.socket || AttFunSock.socket.disconnected || sendingAtt || !ensureSnapSize()) return;
  sendingAtt = true;
  try {
    const sctx = snapCanvas.getContext("2d");
    sctx.drawImage(videoRef.value, 0, 0, snapCanvas.width, snapCanvas.height);
    const bytes = await toBytes();
    if (bytes) {
      socket.emit("att_frame", bytes);
      lastAttPush = Date.now();
    }
  } finally {
    sendingAtt = false;
  }
}

// ===== Attendance stabilizer & toast utils =====
const TOAST_GAP_OK = 4000;
const TOAST_GAP_BLOCK = 20000;
const lastToastOK = new Map();
const lastToastBlocked = new Map();
function canToast(map, key, gapMs) {
  const now = Date.now();
  const last = map.get(key) || 0;
  if (now - last < gapMs) return false;
  map.set(key, now);
  return true;
}

function fmtTimeLocal(iso) {
  if (!iso) return "-";
  try {
    let s = String(iso).trim().replace(" ", "T");
    if (!/[zZ]|[+\-]\d{2}:\d{2}$/.test(s)) s += "+07:00";
    return new Date(s).toLocaleTimeString("id-ID", {
      timeZone: "Asia/Jakarta",
      weekday: "long",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return String(iso);
  }
}

// ===== Socket wiring (via ws.js) =====
let lastExprByName = new Map();
let lastExprToastAt = new Map();

const statusEl = $("#camera-status") || $("#status") || { textContent: "" };
AttFunSock = useWs({
  root: true,
  on: {
    connect() {
      statusEl.textContent = "WS connected";
      toast?.success(t("attendanceFunMeter.toast.wsConnected", "Terhubung ke server (WebSocket)."));
      try {
        AttFunSock.emit("att_cfg", { th: 0.4, mark: true });
      } catch {}
    },
    connect_error(err) {
      console.error("[WS] connect_error", err?.message || err);
      statusEl.textContent = "WS connect error";
    },
    disconnect(reason) {
      statusEl.textContent = "WS disconnected";
      console.warn("[WS] disconnected:", reason);
      toast?.warn(t("attendanceFunMeter.toast.wsDisconnected", "Koneksi WebSocket terputus."));
    },
    fun_ready() {
      statusEl.textContent = "WS ready";
    },
    fun_error(m) {
      toast?.error(
        t("attendanceFunMeter.toast.funError", "Kesalahan Fun: {message}", { message: m?.message || "unknown" })
      );
    },
    fun_result(m) {
      const results = Array.isArray(m?.results) ? m.results : [];
      drawFun(results);
      const canToastExpr = (key) => {
        const now = Date.now(),
          last = lastExprToastAt.get(key) || 0;
        if (now - last < 4000) return false;
        lastExprToastAt.set(key, now);
        return true;
      };

      for (const r of results) {
        const [bx, by, bw, bh] = r.bbox || [0, 0, 0, 0];
        const name = fuseName([bx, by, bw, bh]) || r.label || r.name || "Unknown";
        const expr = (r.top?.label || r.expression || r.emotion || "Biasa").trim();
        if (name) {
          const prev = lastExprByName.get(name);
          if (expr && expr !== prev && canToastExpr(`${name}:${expr}`)) {
            // toast?.info(`${name}: ${expr}`);
            lastExprByName.set(name, expr);
          }
        }
      }
    },
    att_result(m) {
      lastAtt = { t: Date.now(), results: Array.isArray(m?.results) ? m.results : [] };

      const results = lastAtt.results;

      const marked = Array.isArray(m?.marked) ? m.marked : [];
      const markedInfo = Array.isArray(m?.marked_info) ? m.marked_info : [];
      const blocked = Array.isArray(m?.blocked) ? m.blocked : [];

      const markedTxt = marked.length ? ` • Marked: ${marked.join(", ")}` : "";
      statusEl.textContent = `Faces: ${results.length}${markedTxt}`;

      for (const mi of markedInfo) {
        const lab = mi.label || "";
        const msg =
          mi.message || t("attendanceFunMeter.toast.attendanceSuccess", "Absen berhasil: {label}", { label: lab });
        if (lab && canToast(lastToastOK, lab, TOAST_GAP_OK))
          toast?.success(msg, {
            duration: 5000,
          });
      }
      if (!markedInfo.length) {
        for (const lab of marked)
          if (canToast(lastToastOK, lab, TOAST_GAP_OK))
            toast?.success(t("attendanceFunMeter.toast.attendanceSuccess", "Absen berhasil: {label}", { label: lab }), {
              duration: 5000,
            });
      }

      // if (blocked.length) {
      //   for (const b of blocked) {
      //     const lab = b.label || "Unknown";
      //     if (canToast(lastToastBlocked, lab, TOAST_GAP_BLOCK)) {
      //       const msg =
      //         b.message ||
      //         t("attendance.toast.blockedMessage", "{label}: {reason}{retry}", { label: lab, reason, retry });
      //       toast?.warn(msg);
      //     }
      //   }
      // }

      if (lastFunResults.length) drawFun(lastFunResults);
    },
  },
});
socket = AttFunSock.socket;

// ===== Overlay alignment (watchers) =====
function alignOverlay() {
  ensureSnapSize();
  fitCanvasToVideo();
  if (lastFunResults.length) drawFun(lastFunResults);
}
function startHostWatcher() {
  let _lastW = -1,
    _lastH = -1;
  const loop = () => {
    const host = hostRef.value || videoRef.value;
    if (host) {
      const r = host.getBoundingClientRect();
      const w = Math.round(r.width),
        h = Math.round(r.height);
      if (w !== _lastW || h !== _lastH) {
        _lastW = w;
        _lastH = h;
        alignOverlay();
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// keep refs for cleanup
let ro = null;
const winResize = () => alignOverlay();
const orientationHandler = () => setTimeout(alignOverlay, 80);
const vvResize = () => setTimeout(alignOverlay, 30);
const vvScroll = () => setTimeout(alignOverlay, 30);

onMounted(async () => {
  // ==== Setup canvas/context (ensure NO rounded CSS) ====
  const overlay = overlayRef.value;
  overlay.style.borderRadius = "0";
  overlay.classList.remove("rounded", "rounded-md", "rounded-lg", "rounded-xl", "overflow-hidden");

  ctx = overlay.getContext("2d");
  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";
  ctx.miterLimit = 10;

  // Resize responders
  ro = new ResizeObserver(() => alignOverlay());
  if (hostRef.value) ro.observe(hostRef.value);
  window.addEventListener("resize", winResize);
  window.addEventListener("orientationchange", orientationHandler);
  if (window.visualViewport) {
    const vv = window.visualViewport;
    vv.addEventListener("resize", vvResize);
    vv.addEventListener("scroll", vvScroll);
  }
  videoRef.value?.addEventListener("loadedmetadata", alignOverlay);
  videoRef.value?.addEventListener("resize", alignOverlay);

  // watch videoWidth/Height changes
  vwTick = setInterval(() => {
    const v = videoRef.value;
    if (!v) return;
    const vw = v.videoWidth | 0,
      vh = v.videoHeight | 0;
    if (!startHostWatcher._vw || vw !== startHostWatcher._vw || vh !== startHostWatcher._vh) {
      startHostWatcher._vw = vw;
      startHostWatcher._vh = vh;
      alignOverlay();
    }
  }, 400);

  // Boot camera + socket + frame pump
  await startVideo();
  fitCanvasToVideo();
  if (lastFunResults.length) drawFun(lastFunResults);

  if (AttFunSock?.socket?.connected) {
    // koneksi sudah hidup (reused dari root/pool), kirim config sekarang
    try {
      socket.emit("att_cfg", { th: 0.4, mark: true });
    } catch {}
  }
  if (!tFun) tFun = setInterval(pushFunFrame, Number(funIntervalMs.value));

  startHostWatcher();
});

onBeforeUnmount(() => {
  if (vwTick) clearInterval(vwTick);
  if (tFun) clearInterval(tFun);

  // cleanup listeners
  try {
    videoRef.value?.removeEventListener("loadedmetadata", alignOverlay);
    videoRef.value?.removeEventListener("resize", alignOverlay);
    window.removeEventListener("resize", winResize);
    window.removeEventListener("orientationchange", orientationHandler);
    if (window.visualViewport) {
      const vv = window.visualViewport;
      vv.removeEventListener("resize", vvResize);
      vv.removeEventListener("scroll", vvScroll);
    }
    ro?.disconnect();
  } catch {}

  // stop stream
  try {
    stream?.getTracks()?.forEach((tr) => tr.stop());
  } catch {}

  // release ws listeners (TIDAK memutus koneksi global/root)
  releaseOnce();
});
// Satu aja, jangan dobel
let released = false;
function releaseOnce() {
  released;
}
onBeforeRouteLeave(() => releaseOnce());

// ===== ADS ROTATOR =====
const carouselRef = ref(null);
let adList = [];
let adIdx = -1;
let adTimer = null;
let pageHidden = false;

function clearAdTimer() {
  if (adTimer) {
    clearTimeout(adTimer);
    adTimer = null;
  }
}
function hideAllAds() {
  for (const a of adList) a.el.classList.add("hidden");
}
function nextAd() {
  if (!adList.length) return;
  adIdx = (adIdx + 1) % adList.length;
  showAd(adIdx);
}

function showAd(i) {
  if (!adList.length) return;
  clearAdTimer();
  hideAllAds();

  const ad = adList[i];
  ad.el.classList.remove("hidden");

  if (ad.isVideo) {
    const v = /** @type {HTMLVideoElement} */ (ad.el);
    try {
      v.currentTime = 0;
      v.muted = false; // start muted
      v.playsInline = true;
      v.autoplay = false;
      v.loop = false;
    } catch {}

    const fallbackMs = Number(v.dataset.duration) || 15000;

    // tunggu klik pertama
    const handleClick = () => {
      v.muted = false;
      v.play()
        .then(() => {
          // setelah mulai, aktifkan listener ended dan timer fallback
          const onEnded = () => {
            v.removeEventListener("ended", onEnded);
            if (!pageHidden) nextAd();
          };
          v.addEventListener("ended", onEnded);

          adTimer = setTimeout(() => {
            v.removeEventListener("ended", onEnded);
            if (!pageHidden) nextAd();
          }, fallbackMs);
        })
        .catch(console.warn);

      v.removeEventListener("click", handleClick); // hapus supaya gak double
    };

    v.addEventListener("click", handleClick);
  } else {
    const dur = Number(ad.el.dataset.duration) || 6000;
    adTimer = setTimeout(() => !pageHidden && nextAd(), dur);
  }
}

function buildAdList() {
  const root = carouselRef.value;
  if (!root) return [];
  const nodes = Array.from(root.children);
  return nodes.map((el) => ({
    el,
    isVideo: el.tagName.toUpperCase() === "VIDEO",
  }));
}
function startAds() {
  adList = buildAdList();
  if (!adList.length) return;
  adIdx = -1;
  nextAd();
}
function stopAds() {
  clearAdTimer();
  hideAllAds();
}

function onVisibility() {
  pageHidden = document.visibilityState !== "visible";
  if (pageHidden) {
    // pause semua video + stop timer
    clearAdTimer();
    for (const a of adList) if (a.isVideo) a.el.pause?.();
  } else {
    // resume rotasi dari item berikutnya
    nextAd();
  }
}

onMounted(() => {
  // pastikan semua mulai hidden, rotator yang kontrol
  hideAllAds();
  document.addEventListener("visibilitychange", onVisibility);
  startAds();
});

onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", onVisibility);
  stopAds();
});
</script>

<template>
  <div class="page-root">
    <!-- 1) BANNER TOP — stretch penuh -->
    <section id="banner_top" class="relative w-screen h-[var(--top)] overflow-hidden pt-[env(safe-area-inset-top)]">
      <img
        src="/images/header.png"
        class="absolute inset-0 w-full h-full object-fill select-none pointer-events-none" />
    </section>

    <!-- 2) CAMERA (fit, bukan crop) -->
    <section id="camera" class="relative w-screen h-full overflow-hidden">
      <div ref="hostRef" id="camera-host" class="relative w-screen h-full flex items-center justify-center">
        <video ref="videoRef" id="video" autoplay playsinline class="block h-full w-screen object-fill"></video>
        <canvas ref="overlayRef" id="overlay" class="absolute inset-0 w-full h-full z-20 pointer-events-none"></canvas>
      </div>
    </section>

    <!-- 3) ADS — stretch penuh -->
    <section id="ads" class="relative w-screen h-[var(--ads)] overflow-hidden bg-gray-100 text-black">
      <div id="carousel" ref="carouselRef" class="absolute inset-0">
        <!-- Video: pakai dataset duration sebagai fallback (ms) -->
        <video
          id="nobox"
          class="absolute inset-0 w-full h-full object-fill hidden"
          playsinline
          muted
          data-duration="15000">
          <source src="/videos/iklan.mp4" type="video/mp4" />
        </video>

        <!-- Image ads: set durasi tampil (ms). Ganti angkanya sesukamu -->
        <img
          id="iklan1"
          src="/images/expo.jpg"
          class="absolute inset-0 w-full h-full object-fill hidden"
          data-duration="6000" />
        <img
          id="iklan2"
          src="/images/eschool.png"
          class="absolute inset-0 w-full h-full object-fill hidden"
          data-duration="6000" />
        <img
          id="iklan3"
          src="/images/upskilling.png"
          class="absolute inset-0 w-full h-full object-fill hidden"
          data-duration="6000" />
        <img
          id="iklan4"
          src="/images/karyasmk.jpg"
          class="absolute inset-0 w-full h-full object-fill hidden"
          data-duration="6000" />
        <img
          id="iklan5"
          src="/images/nobox.jpg"
          class="absolute inset-0 w-full h-full object-fill hidden"
          data-duration="6000" />
      </div>
    </section>

    <!-- 4) BANNER BOTTOM — opsional (default: tidak ditampilkan) -->
    <section
      id="banner_bottom"
      v-if="true"
      class="relative w-screen h-[var(--bottom)] overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <img
        src="/images/footer.png"
        class="absolute inset-0 w-full h-full object-fill select-none pointer-events-none" />
    </section>
  </div>
</template>

<style scoped>
/* Layout grid persis HTML: 4 baris default */
.page-root {
  --top: 12svh;
  --ads: 18svh;
  --bottom: 8svh;
  color: white;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  display: grid;
  grid-template-rows: var(--top) 1fr var(--ads) var(--bottom);
}

/* Kalau footer nggak ada → jadi 3 baris (HTML pakai :has) */
.page-root:not(:has(#banner_bottom)) {
  --ads-without-bottom: calc(var(--ads) + var(--bottom)) !important;
  grid-template-rows: var(--top) 1fr var(--ads-without-bottom);
}
#ads:not(:has(#banner_bottom)) {
  height: var(--ads-without-bottom);
}

/* Anti rounded di overlay + object-fill video (match HTML) */
#overlay {
  border-radius: 0 !important;
  overflow: visible !important;
}
#video {
  object-fit: fill;
}
</style>
