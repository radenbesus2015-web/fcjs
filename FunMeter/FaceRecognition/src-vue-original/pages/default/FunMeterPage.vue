<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, inject } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { fitCanvasToVideo, drawResultsOverlay } from "@/utils/overlay";
import { toast } from "@/utils/toast";
import { useWs } from "@/composables/useWS";
import { useSetting } from "@/composables/useSetting";
import { useI18n } from "@/i18n";

/* shadcn-vue */
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const $config = inject("config");
const { t } = useI18n();

/* ===== settings ===== */
const { model: funSendWidth } = useSetting("funMeter.sendWidth", { clamp: { min: 160, max: 1920, round: true } });
const { model: funJpegQuality } = useSetting("funMeter.jpegQuality", { clamp: { min: 0, max: 1 } });
const { model: baseInterval } = useSetting("baseInterval", { clamp: { min: 0, max: 5000 } });

/* ===== refs ===== */
/** @type {import('vue').Ref<HTMLVideoElement|null>} */
const videoRef = ref(null);
/** @type {import('vue').Ref<HTMLCanvasElement|null>} */
const snapRef = ref(null);
/** @type {import('vue').Ref<HTMLCanvasElement|null>} */
const overlayRef = ref(null);

const statusText = ref("");
const funResults = ref([]);
const legendLabels = ref([]);
const modelName = ref("");
const sendHeight = ref(0);

/** @type {MediaStream|null} */
let stream = null;
/** @type {number|null} */
let timer = null;
let sending = false;

/* ===== sockets ===== */
const funSock = useWs({
  root: true,
  on: {
    connect() {
      statusText.value = t("fun.status.wsConnected", "WebSocket terhubung");
      toast.success(t("fun.toast.wsConnected", "Terhubung ke server (WebSocket)."), { delay: 100 });
    },
    disconnect() {
      statusText.value = t("fun.status.wsDisconnected", "WebSocket terputus");
      toast.info(t("fun.toast.wsDisconnected", "Koneksi WS terputus."), { delay: 100 });
    },
    fun_ready(m) {
      statusText.value = t("fun.status.wsReady", "WebSocket siap");
      if (Array.isArray(m?.labels)) legendLabels.value = m.labels.slice();
      if (m?.model) {
        modelName.value = m.model;
        updateTitle();
      }
    },
    fun_error(m) {
      const message = m?.message || t("fun.labels.unknown", "Tidak diketahui");
      statusText.value = t("fun.status.error", "Kesalahan: {message}", { message });
    },
    fun_result: handleResult,
  },
});
const socket = funSock.socket;

/* ===== computed ===== */
const legendChips = computed(() => legendLabels.value.slice());
const miniCards = computed(() =>
  (funResults.value || []).map((r, idx) => {
    const probs = r.probs || {};
    const labels = legendLabels.value.length ? legendLabels.value : Object.keys(probs);
    const rows = labels.map((lab) => ({ label: lab, prob: Number(probs[lab] || 0) }));
    return { id: idx, top: r.top || null, fun: Number(r.fun || 0), rows };
  })
);

/* ===== helpers ===== */
function updateTitle() {
  const base = t("pages.funMeter.title", "Fun Meter");
  document.title = modelName.value ? `${base} • ${modelName.value}` : base;
}

function drawOverlay() {
  const video = videoRef.value;
  const canvas = overlayRef.value;
  if (!video || !canvas) return;
  fitCanvasToVideo(canvas, video);
  if (!sendHeight.value) return;
  drawResultsOverlay(video, canvas, funResults.value, {
    mode: "funmeter",
    sendWidth: Number(funSendWidth.value),
    sendHeight: sendHeight.value,
    fitMode: "fill",
    showFunBar: true,
  });
}

async function sendFrameWS() {
  if (!socket || socket.disconnected) {
    statusText.value = t("fun.status.socketDisconnected", "Socket tidak terhubung");
    return;
  }
  if (sending) return;
  if (!videoRef.value?.srcObject || !snapRef.value) return;

  const video = videoRef.value;
  const snap = snapRef.value;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;

  const height = Math.round((Number(funSendWidth.value) * vh) / vw);
  sendHeight.value = height;
  snap.width = Number(funSendWidth.value);
  snap.height = height;

  const ctx = snap.getContext("2d");
  ctx.drawImage(video, 0, 0, snap.width, snap.height);

  try {
    sending = true;
    const blob = await new Promise((res) =>
      snap.toBlob(res, "image/jpeg", Number(funJpegQuality.value))
    );
    if (!blob) return;
    const ab = await blob.arrayBuffer();
    socket.emit("fun_frame", new Uint8Array(ab));
  } catch (err) {
    statusText.value = t("fun.status.error", "Kesalahan: {message}", { message: err?.message || String(err) });
  } finally {
    sending = false;
  }
}

function restartTimer() {
  const raw = parseInt(String(baseInterval.value ?? "20"), 10);
  const iv = Number.isFinite(raw) ? Math.max(20, raw) : 20;
  if (timer) clearInterval(timer);
  timer = setInterval(sendFrameWS, iv);
}

async function startCamera() {
  if (stream) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: "user" },
      audio: false,
    });
    if (videoRef.value) {
      videoRef.value.srcObject = stream;
      await new Promise((resolve) => {
        if (videoRef.value.readyState >= 2) return resolve();
        videoRef.value.onloadedmetadata = () => resolve();
      });
      await videoRef.value.play().catch(() => {});
    }
    if (overlayRef.value && videoRef.value) fitCanvasToVideo(overlayRef.value, videoRef.value);

    statusText.value = socket?.connected
      ? t("fun.status.cameraStartedWs", "Kamera aktif (WS terhubung)")
      : t("fun.status.cameraStartedPending", "Kamera aktif (menyambungkan WS…)");

    restartTimer();
  } catch (err) {
    statusText.value = t("fun.status.error", "Kesalahan: {message}", { message: err?.message || String(err) });
    toast.error(t("fun.toast.cameraError", "Gagal membuka kamera. Cek permission & device."));
  }
}

function stopCamera() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (videoRef.value) videoRef.value.srcObject = null;
  statusText.value = t("fun.status.cameraStopped", "Kamera dihentikan");
  if (overlayRef.value && videoRef.value) fitCanvasToVideo(overlayRef.value, videoRef.value);
  sendHeight.value = 0;
}

function handleResult(payload) {
  funResults.value = Array.isArray(payload?.results) ? payload.results : [];
  if (Array.isArray(payload?.labels)) legendLabels.value = payload.labels.slice();
  if (payload?.model) {
    modelName.value = payload.model;
    updateTitle();
  }
  statusText.value = t("fun.status.faces", "Wajah: {count}", { count: funResults.value.length });
  requestAnimationFrame(drawOverlay);
}

/* ===== watches & lifecycle ===== */
watch(baseInterval, restartTimer);
watch(funResults, () => requestAnimationFrame(drawOverlay));

onMounted(() => {
  if (!$config?.WS_API) {
    statusText.value = t("fun.status.wsMissing", "Endpoint WS belum dikonfigurasi");
  }
  window.addEventListener("resize", drawOverlay);
  updateTitle();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", drawOverlay);
  stopCamera();
});
onBeforeRouteLeave(() => {
  stopCamera();
});
</script>

<template>
  <div class="space-y-8">
    <section class="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start">
      <!-- LEFT: Camera -->
      <Card>
        <CardHeader class="flex flex-row items-center justify-between">
          <div>
            <p class="text-xs uppercase tracking-widest text-muted-foreground">
              {{ t("fun.sections.camera.title", "Kamera") }}
            </p>
            <CardTitle class="text-lg">
              {{ t("fun.sections.camera.subtitle", "Streaming fun meter") }}
            </CardTitle>
          </div>
          <Badge v-if="statusText" variant="outline">{{ statusText }}</Badge>
        </CardHeader>

        <CardContent class="space-y-5">
          <div class="relative overflow-hidden rounded-2xl border bg-muted">
            <video ref="videoRef" autoplay playsinline class="w-full rounded-2xl"></video>
            <canvas ref="snapRef" class="hidden"></canvas>
            <canvas ref="overlayRef" class="absolute inset-0 h-full w-full pointer-events-none"></canvas>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label for="intervalInput">{{ t("fun.fields.interval", "Interval (ms)") }}</Label>
              <Input
                id="intervalInput"
                v-model="baseInterval"
                type="number"
                min="0"
                max="5000"
                step="10"
              />
            </div>

            <div class="space-y-2">
              <Label>{{ t("fun.fields.model", "Model") }}</Label>
              <div class="text-sm text-muted-foreground">
                {{ modelName || t("fun.fields.modelLoading", "Menunggu metadata…") }}
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <Button type="button" @click="startCamera">
              {{ t("fun.actions.startCamera", "Mulai Kamera") }}
            </Button>
            <Button type="button" variant="outline" @click="stopCamera">
              {{ t("fun.actions.stopCamera", "Hentikan") }}
            </Button>
          </div>

          <p class="text-sm text-muted-foreground">
            {{ statusText || t("fun.status.waiting", "Tekan mulai untuk mengirim frame fun meter.") }}
          </p>
        </CardContent>
      </Card>

      <!-- RIGHT: Summary -->
      <Card>
        <CardHeader class="flex flex-row items-center justify-between">
          <div>
            <p class="text-xs uppercase tracking-widest text-muted-foreground">
              {{ t("fun.sections.summary.title", "Ringkasan") }}
            </p>
            <CardTitle class="text-lg">
              {{ t("fun.sections.summary.subtitle", "Label & hasil terakhir") }}
            </CardTitle>
          </div>
          <Badge variant="outline">
            {{
              legendChips.length === 1
                ? t("fun.summary.labelCount.one", "1 label")
                : t("fun.summary.labelCount.other", "{count} label", { count: legendChips.length })
            }}
          </Badge>
        </CardHeader>

        <CardContent class="space-y-5">
          <p class="text-sm text-muted-foreground">
            {{
              t(
                "fun.summary.copy",
                "Fun merepresentasikan probabilitas kebahagiaan (0–100%). Daftar label diperoleh langsung dari model di server."
              )
            }}
          </p>

          <div class="flex flex-wrap gap-2">
            <Badge v-for="lab in legendChips" :key="lab" variant="outline">
              {{ lab }}
            </Badge>
          </div>

          <div class="grid gap-4 lg:grid-cols-2">
            <article
              v-for="card in miniCards"
              :key="card.id"
              class="rounded-2xl border bg-card p-4 shadow-sm">
              <header class="flex items-center justify-between gap-3">
                <div>
                  <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {{ t("fun.cards.faceNumber", "Face #{num}", { num: card.id + 1 }) }}
                  </p>
                  <p class="text-sm font-semibold">{{ card.top?.label || "-" }}</p>
                </div>
                <Badge>
                  {{ t("fun.cards.funValue", "Fun {value}%", { value: (card.fun * 100).toFixed(1) }) }}
                </Badge>
              </header>

              <div class="mt-3 space-y-1 text-sm">
                <div v-for="row in card.rows" :key="row.label" class="flex items-center justify-between">
                  <span>{{ row.label }}</span>
                  <span class="tabular-nums">{{ (row.prob * 100).toFixed(1) }}%</span>
                </div>
              </div>
            </article>
          </div>

          <div v-if="!miniCards.length" class="flex items-center justify-center rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            <span>{{ t("fun.summary.empty", "Belum ada hasil dari kamera.") }}</span>
          </div>
        </CardContent>
      </Card>
    </section>
  </div>
</template>
