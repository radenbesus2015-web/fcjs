// utils/overlay.js
// One-stop overlay util (HiDPI aware) — 3 modes:
// 1) recognize-funmeter  2) recognize  3) funmeter

// --- bagian atas modul (internal helpers) ---
const _savedOverlays = new WeakMap();
const _savedCanvasSet = new Set();
let _resizeInstalled = false;
let _resizeTimer = 0;

function _saveInternal(el, canvas, results, opts = {}) {
  if (!canvas) return;
  _savedOverlays.set(canvas, { el, results: results || [], opts });
  _savedCanvasSet.add(canvas);

  // enable resize listener lazily on first save
  if (!_resizeInstalled && typeof window !== "undefined") {
    _installResizeHandler();
  }
}

function _clearInternal(canvas) {
  if (!canvas) return;
  _savedOverlays.delete(canvas);
  _savedCanvasSet.delete(canvas);
}

/* debounced redraw */
function _redrawSavedOverlay(canvas) {
  const entry = _savedOverlays.get(canvas);
  if (!entry) return;
  const { el, results, opts } = entry;
  try {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      requestAnimationFrame(() => {
        const r2 = el.getBoundingClientRect();
        if (!r2.width || !r2.height) return;
        fitCanvasToElement(canvas, el);
        drawResultsOverlay(el, canvas, results, opts); // will re-save, but that's ok
      });
      return;
    }
    fitCanvasToElement(canvas, el);
    // drawRecognize/others are internal; call public drawResultsOverlay to reuse logic.
    // Use a special flag to avoid infinite save loop (see note below).
    _drawWithoutSaving(el, canvas, results, opts);
  } catch (e) {}
}

function _redrawAll() {
  for (const canvas of Array.from(_savedCanvasSet)) {
    _redrawSavedOverlay(canvas);
  }
}

/* resize install */
function _onResizeDebounced() {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => _redrawAll(), 120);
}
function _installResizeHandler() {
  if (typeof window === "undefined" || _resizeInstalled) return;
  window.addEventListener("resize", _onResizeDebounced);
  window.addEventListener("orientationchange", _onResizeDebounced);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", _onResizeDebounced);
  _resizeInstalled = true;
}

/* --- small internal variant of draw that does NOT auto-save to avoid loops --- */
function _drawWithoutSaving(el, canvas, results, opts = {}) {
  // call the internal drawing switch (reuse existing functions)
  const mode = (opts && opts.mode) || "recognize";
  if (mode === "recognize-funmeter") return drawRecognizeFunmeter(el, canvas, results, opts);
  if (mode === "funmeter") return drawFunmeter(el, canvas, results, opts);
  return drawRecognize(el, canvas, results, opts);
}


// END AUTOMATIC SAVE AND RESIZE

/** Clear all drawings on a canvas */
export function clearCanvas(canvas) {
  const ctx = canvas?.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // hapus saved overlay bila ada
  _clearInternal(canvas);
}

/** Resize canvas to match a media element's CSS box, HiDPI-aware */
export function fitCanvasToElement(canvas, el) {
  if (!canvas || !el) return;
  const rect = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));

  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;

  const ctx = canvas.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** Backward-compatible aliases */
export const fitCanvasToVideo = fitCanvasToElement;
export const fitCanvasToMedia = fitCanvasToElement;

/** Simple progress bar 0..1 */
export function drawBar(ctx, x, y, w, h, pct) {
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);

  const ww = Math.max(0, Math.min(1, pct)) * w;
  ctx.fillStyle = "rgba(34,197,94,0.9)";
  ctx.fillRect(x, y, ww, h);
}

/* =========================
 * Recognize/FunMeter helpers
 * ========================= */

/** Warna ekspresi (lokal + en) */
export const EXP_COLORS = {
  Marah: "#ef4444",
  Sedih: "#3b82f6",
  Senang: "#22c55e",
  Biasa: "#9ca3af",
  Kaget: "#f97316",
  Takut: "#9333ea",
  Jijik: "#8CA42B",
  happy: "#22c55e",
  sadness: "#3b82f6",
  neutral: "#9ca3af",
  surprise: "#f97316",
  anger: "#ef4444",
  fearful: "#9333ea",
  disgust: "#8CA42B",
};
EXP_COLORS.happiness = EXP_COLORS.happy;
EXP_COLORS.sad = EXP_COLORS.sadness;
EXP_COLORS.surprised = EXP_COLORS.surprise;
EXP_COLORS.angry = EXP_COLORS.anger;
EXP_COLORS.fear = EXP_COLORS.fearful;

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
function cap1(str) {
  return typeof str === "string" && str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function roundRect(ctx, x, y, w, h, r = 10) {
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.stroke();
  } else {
    ctx.strokeRect(x, y, w, h);
  }
}
function pick(obj, path) {
  return path.split(".").reduce((a, k) => (a && a[k] != null ? a[k] : undefined), obj);
}
function norm01(p) {
  const x = Number(p);
  if (!Number.isFinite(x)) return 0;
  if (x > 1.000001) return Math.min(1, Math.max(0, x / 100));
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
function pickFunValue(r) {
  const cands = [
    r.fun,
    pick(r, "probs.happiness"),
    pick(r, "probs.happy"),
    pick(r, "probs.Senang"),
    pick(r, "top.prob"),
  ];
  for (const v of cands) {
    const n = norm01(v);
    if (n > 0) return n;
  }
  return 0;
}

/** Letterbox transform (cover/contain/fill) berbasis sendWidth/sendHeight */
function getTransform(el, sendWidth, sendHeight, fitMode = "fill") {
  const rect = el.getBoundingClientRect();
  const vw = el?.videoWidth || el?.naturalWidth || rect.width || 1;
  const vh = el?.videoHeight || el?.naturalHeight || rect.height || 1;

  // Pastikan aspek rasio sumber sama dengan frame kiriman
  const srcW = sendWidth || vw;
  const srcH = sendHeight || Math.round((srcW * vh) / vw);

  // Auto dari classList kalau gak dikasih
  if (!fitMode) {
    const cl = el?.classList || { contains: () => false };
    if (cl.contains("object-cover")) fitMode = "cover";
    else if (cl.contains("object-contain")) fitMode = "contain";
    else fitMode = "fill";
  }

  if (fitMode === "fill") {
    return { sx: rect.width / srcW, sy: rect.height / srcH, ox: 0, oy: 0, dw: rect.width, dh: rect.height };
  }

  const scale =
    fitMode === "cover"
      ? Math.max(rect.width / srcW, rect.height / srcH)
      : Math.min(rect.width / srcW, rect.height / srcH);

  const dispW = srcW * scale;
  const dispH = srcH * scale;
  const offX = (rect.width - dispW) / 2;
  const offY = (rect.height - dispH) / 2;
  return { sx: scale, sy: scale, ox: offX, oy: offY, dw: dispW, dh: dispH };
}

/** IoU & fuse ke hasil attendance (untuk nama) */
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
function fuseName(funBox, attResults = [], th = 0.25) {
  let best = null,
    bestIoU = 0;
  for (const r of attResults) {
    const bb = r.bbox || r.box || [0, 0, 0, 0];
    const v = iou(funBox, bb);
    if (v > bestIoU) {
      bestIoU = v;
      best = r;
    }
  }
  return best && best.label && bestIoU >= th ? best.label : null;
}

// ===== Defaults style & flags
const DEFAULT_STYLE = Object.freeze({
  boxRadius: 10,
  boxLineWidth: 3,
  tagHeight: 24,
  tagPadX: 10,
  tagBg: "rgba(2,6,23,0.88)", // chip gelap (recognize / gabungan)
  tagText: "#e5e7eb",
  classicTagBg: "rgba(56,189,248,0.9)", // chip biru muda (funmeter klasik)
  classicTagText: "#0b1220",
});
const DEFAULT_FLAGS = Object.freeze({
  showName: false, // chip atas: nama
  showExpr: false, // chip bawah: ekspresi
  showTopLabel: false, // chip atas: "label (prob%)" klasik
  showFunBar: false, // progress bar + "Fun XX%"
});

// === formatter untuk "label (prob%)" klasik
function formatTopLabelProb(r) {
  const best = r?.top?.label
    ? { label: r.top.label, prob: Number(r.top.prob || 0) }
    : (() => {
        const probs = r?.probs || {};
        let lab = null,
          p = 0;
        for (const [k, v] of Object.entries(probs)) {
          const vv = Number(v) || 0;
          if (vv > p) {
            p = vv;
            lab = k;
          }
        }
        return { label: lab || "", prob: p };
      })();
  if (!best.label) return null;
  const pct = (Math.max(0, Math.min(1, best.prob)) * 100).toFixed(1);
  return `${best.label} (${pct}%)`;
}

// === renderer serbaguna untuk 1 deteksi
function drawBoxWithChips(ctx, hostW, hostH, rectXYWH, color, payload, flags = {}, style = {}) {
  const s = { ...DEFAULT_STYLE, ...style };
  const f = { ...DEFAULT_FLAGS, ...flags };
  const [x, y, w, h] = rectXYWH;

  // Box
  ctx.lineWidth = s.boxLineWidth;
  ctx.strokeStyle = color;
  if (s.boxRadius) roundRect(ctx, x, y, w, h, s.boxRadius);
  else ctx.strokeRect(x, y, w, h);

  // chip helper
  const drawChip = ({ text, top = true, classic = false }) => {
    if (!text) return;
    const padX = s.tagPadX,
      tagH = s.tagHeight;
    const tagW = Math.ceil(ctx.measureText(text).width) + padX * 2;

    let chipX = clamp(Math.round(x), 2, Math.round(hostW - tagW - 2));
    let chipY = top ? Math.round(y - tagH - 6) : Math.round(y + h + 6);
    if (top && chipY < 0) chipY = Math.max(2, Math.round(y + 2));
    if (!top && chipY + tagH > hostH) chipY = Math.max(Math.round(y + h - tagH - 2), Math.round(y + 2));

    ctx.fillStyle = classic ? s.classicTagBg : s.tagBg;
    ctx.fillRect(chipX, chipY, tagW, tagH);
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.strokeRect(chipX, chipY, tagW, tagH);
    ctx.restore();
    ctx.fillStyle = classic ? s.classicTagText : s.tagText;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, chipX + tagW / 2, chipY + tagH / 2);
  };

  // Chips
  if (f.showTopLabel && payload.topLabel) {
    // gaya klasik funmeter: chip atas "label (prob%)"
    drawChip({ text: payload.topLabel, top: true, classic: true });
  } else if (f.showName && payload.name) {
    drawChip({ text: cap1(payload.name), top: true, classic: false });
  }

  if (f.showExpr && payload.expr) {
    drawChip({ text: cap1(payload.expr), top: false, classic: false });
  }

  // Fun bar
  if (f.showFunBar) {
    const fun = norm01(payload.fun ?? 0);
    const barW = w,
      barH = 10,
      barX = x,
      barY = Math.min(hostH - 12, y + h + 6);
    drawBar(ctx, barX, barY, barW, barH, fun);
    const pctText = `Fun ${Math.round(fun * 100)}%`;
    const tw = ctx.measureText(pctText).width;
    ctx.fillStyle = "#e2e8f0";
    ctx.textAlign = "left";
    ctx.fillText(pctText, barX + barW - tw, barY - 4);
  }
}

/** 1) recognize-funmeter (gabungan: nama + ekspresi + fun bar) */
function drawRecognizeFunmeter(el, canvas, results, opts = {}) {
  if (!el || !canvas) return;
  fitCanvasToElement(canvas, el);

  const ctx = canvas.getContext("2d");
  const rect = el.getBoundingClientRect();
  if (!ctx || !rect.width || !rect.height) return;

  const { sx, sy, ox, oy } = getTransform(el, opts.sendWidth, opts.sendHeight, opts.fitMode);
  const attFuse = opts.attFuse?.results || [];
  const iouThresh = Number(opts.attFuse?.iouThresh) || 0.25;
  const showFunBar = opts.showFunBar !== undefined ? !!opts.showFunBar : false; // default ON

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.miterLimit = 10;
  ctx.font = "14px ui-sans-serif";

  for (const r of results || []) {
    const bb = r.bbox || r.box || [0, 0, 0, 0];
    const [bx, by, bw, bh] = bb;
    const x = ox + bx * sx,
      y = oy + by * sy,
      w = bw * sx,
      h = bh * sy;

    // derive fields
    const top = r?.top?.label
      ? { label: r.top.label, prob: Number(r.top.prob || 0) }
      : (() => {
          const probs = r?.probs || {};
          let bestL = null,
            bestP = -1;
          for (const [k, v] of Object.entries(probs)) {
            const p = Number(v) || 0;
            if (p > bestP) {
              bestP = p;
              bestL = k;
            }
          }
          return { label: bestL || r.expression || r.emotion || "Biasa", prob: Math.max(0, bestP) };
        })();
    const expr = mapExprLabel(top.label);
    const name = r.label || r.name || fuseName(bb, attFuse, iouThresh) || "Unknown";
    const fun = pickFunValue({ ...r, top });
    const color = EXP_COLORS[expr] || "#38bdf8";

    drawBoxWithChips(
      ctx,
      rect.width,
      rect.height,
      [x, y, w, h],
      color,
      { name, expr, fun },
      { showName: true, showExpr: true, showFunBar },
      {}
    );
  }
}

/** 2) recognize (nama + box cyan, tanpa expr/bar) */
function drawRecognize(el, canvas, results, opts = {}) {
  if (!el || !canvas) return;
  fitCanvasToElement(canvas, el);

  const ctx = canvas.getContext("2d");
  const rect = el.getBoundingClientRect();
  if (!ctx || !rect.width || !rect.height) return;

  const { sx, sy, ox, oy } = getTransform(el, opts.sendWidth, opts.sendHeight, opts.fitMode);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "14px ui-sans-serif";

  for (const r of results || []) {
    const bb = r.bbox || r.box || [0, 0, 0, 0];
    const [bx, by, bw, bh] = bb;
    const x = ox + bx * sx,
      y = oy + by * sy,
      w = bw * sx,
      h = bh * sy;
    const name = r.label || r.name || "Unknown";
    const color = "#38bdf8";

    drawBoxWithChips(ctx, rect.width, rect.height, [x, y, w, h], color, { name }, { showName: true }, {});
  }
}

/** 3) funmeter (top label+prob klasik + bar ON) */
function drawFunmeter(el, canvas, results, opts = {}) {
  if (!el || !canvas) return;
  fitCanvasToElement(canvas, el);

  const ctx = canvas.getContext("2d");
  const rect = el.getBoundingClientRect();
  if (!ctx || !rect.width || !rect.height) return;

  const { sx, sy, ox, oy } = getTransform(el, opts.sendWidth, opts.sendHeight, opts.fitMode);
  const showFunBar = opts.showFunBar !== undefined ? !!opts.showFunBar : true; // default ON

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 2; // gaya lama
  ctx.font = "14px ui-sans-serif";

  for (const r of results || []) {
    const bb = r.bbox || r.box || [0, 0, 0, 0];
    const [bx, by, bw, bh] = bb;
    const x = ox + bx * sx,
      y = oy + by * sy,
      w = bw * sx,
      h = bh * sy;

    const topLabel = formatTopLabelProb(r); // "label (prob%)"
    const fun = pickFunValue(r);
    const color = "#38bdf8"; // cyan klasik

    drawBoxWithChips(
      ctx,
      rect.width,
      rect.height,
      [x, y, w, h],
      color,
      { topLabel, fun },
      { showTopLabel: !!topLabel, showFunBar },
      {}
    );
  }
}

/**
 * Draw detection results on top of a media element.
 * @param {HTMLVideoElement|HTMLImageElement} el
 * @param {HTMLCanvasElement} canvas
 * @param {Array} results
 * @param {{
 *   mode?:"recognize-funmeter"|"recognize"|"funmeter",
 *   sendWidth?:number, sendHeight?:number,
 *   fitMode?:"fill"|"cover"|"contain",
 *   attFuse?:{results:Array, iouThresh?:number},
 *   showFunBar?:boolean
 * }} [opts]
 */
export function drawResultsOverlay(el, canvas, results, opts = {}) {
  const mode = opts.mode || "recognize";
  if (mode === "recognize-funmeter") drawRecognizeFunmeter(el, canvas, results, opts);
  else if (mode === "funmeter") drawFunmeter(el, canvas, results, opts);
  else drawRecognize(el, canvas, results, opts);
  _saveInternal(el, canvas, results, opts);
}

/** Convert a canvas to JPEG Blob with a fallback */
export async function toImageBlob(canvas, type = "image/jpeg", quality = 1) {
  const blob = await new Promise((res) => canvas.toBlob(res, type, quality));
  if (blob) return blob;
  const dataUrl = canvas.toDataURL(type, quality);
  const bin = atob(dataUrl.split(",")[1]);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type });
}

/* ===== Back-compat aliases (biar import lama gak pecah) ===== */
export const drawResultsOverMedia = drawResultsOverlay;
export const drawResultsOnOverlay = drawResultsOverlay;
export const drawResultsOnMedia = drawResultsOverlay;
export async function toJpegBlob(canvas, quality = 0.92) {
  return toImageBlob(canvas, "image/jpeg", quality);
}
/* -------------------------
 * Saved-overlay helpers (improved)
 * ------------------------- */

// const _savedOverlays = new WeakMap();
// const _savedCanvasSet = new Set();

// export function saveOverlayResults(el, canvas, results, opts = {}) {
//   if (!canvas) return;
//   _savedOverlays.set(canvas, { el, results: results || [], opts });
//   _savedCanvasSet.add(canvas);
// }

// export function clearSavedOverlay(canvas) {
//   if (!canvas) return;
//   _savedOverlays.delete(canvas);
//   _savedCanvasSet.delete(canvas);
//   clearCanvas(canvas);
// }

// /** redraw single canvas, but retry next frame if el has no size yet */
// export function redrawSavedOverlay(canvas) {
//   const entry = _savedOverlays.get(canvas);
//   if (!entry) return;
//   const { el, results, opts } = entry;

//   try {
//     const rect = el.getBoundingClientRect();
//     if (!rect.width || !rect.height) {
//       // elemen belum ter-render / sedang transit → coba lagi next rAF
//       requestAnimationFrame(() => {
//         const r2 = el.getBoundingClientRect();
//         if (!r2.width || !r2.height) return; // still not ready
//         fitCanvasToElement(canvas, el);
//         drawResultsOverlay(el, canvas, results, opts);
//       });
//       return;
//     }

//     fitCanvasToElement(canvas, el);
//     drawResultsOverlay(el, canvas, results, opts);
//   } catch (e) {
//     // swallow — jangan crash app karena overlay
//   }
// }

// /** iterate saved canvases and redraw (uses safe per-canvas routine) */
// export function redrawAllSavedOverlays() {
//   for (const canvas of Array.from(_savedCanvasSet)) {
//     redrawSavedOverlay(canvas);
//   }
// }

// /* Debounced resize handler + some extra events (orientation / visualViewport) */
// let _resizeInstalled = false;
// let _resizeTimer = 0;
// function _onResizeDebounced() {
//   // wait for resize to settle (120ms). Adjust if your layout is slow.
//   clearTimeout(_resizeTimer);
//   _resizeTimer = setTimeout(() => {
//     redrawAllSavedOverlays();
//   }, 120);
// }

// export function enableSavedOverlayResize() {
//   if (typeof window === "undefined" || _resizeInstalled) return;
//   window.addEventListener("resize", _onResizeDebounced);
//   window.addEventListener("orientationchange", _onResizeDebounced);
//   // visualViewport helps for mobile keyboard / split-screen resize
//   if (window.visualViewport) {
//     window.visualViewport.addEventListener("resize", _onResizeDebounced);
//   }
//   _resizeInstalled = true;
// }

// export function disableSavedOverlayResize() {
//   if (typeof window === "undefined" || !_resizeInstalled) return;
//   window.removeEventListener("resize", _onResizeDebounced);
//   window.removeEventListener("orientationchange", _onResizeDebounced);
//   if (window.visualViewport) {
//     window.visualViewport.removeEventListener("resize", _onResizeDebounced);
//   }
//   _resizeInstalled = false;
// }

// /** force redraw now (useful for testing) */
// export function forceRedrawAllSavedOverlays() {
//   redrawAllSavedOverlays();
// }
