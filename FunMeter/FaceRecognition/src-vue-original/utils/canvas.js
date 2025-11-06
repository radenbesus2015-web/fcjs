export function fitCanvasToMedia(canvas, mediaEl) {
  if (!canvas || !mediaEl) return;
  const rect = mediaEl.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  clearCanvas(canvas);
}

export function clearCanvas(canvas) {
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

export function naturalSize(el) {
  return {
    w: el?.naturalWidth || el?.videoWidth || el?.width || 1,
    h: el?.naturalHeight || el?.videoHeight || el?.height || 1,
  };
}

export function drawResultsOverMedia(mediaEl, canvas, results) {
  if (!mediaEl?.src || !canvas) return;
  fitCanvasToMedia(canvas, mediaEl);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const rect = mediaEl.getBoundingClientRect();
  const { w, h } = naturalSize(mediaEl);
  const scaleX = rect.width / w;
  const scaleY = rect.height / h;

  ctx.lineWidth = 2;
  ctx.font = '14px ui-sans-serif';

  (results || []).forEach((r) => {
    const [x, y, rw, rh] = r.bbox || [0, 0, 0, 0];
    const cx = x * scaleX;
    const cy = y * scaleY;
    const cw = rw * scaleX;
    const ch = rh * scaleY;
    ctx.strokeStyle = '#22c55e';
    ctx.strokeRect(cx, cy, cw, ch);

    const scoreText = r.score != null ? ` (${Number(r.score).toFixed(3)})` : '';
    const label = `${r.label ?? 'Face'}${scoreText}`;
    const pad = 4;
    const th = 20;
    const tw = ctx.measureText(label).width + pad * 2;
    ctx.fillStyle = 'rgba(34,197,94,0.9)';
    ctx.fillRect(cx, Math.max(0, cy - th - 4), tw, th);
    ctx.fillStyle = '#0b1220';
    ctx.fillText(label, cx + pad, Math.max(14, cy - 8));
  });
}
