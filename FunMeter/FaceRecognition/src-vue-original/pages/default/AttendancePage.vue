<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, inject } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { drawResultsOverlay, fitCanvasToVideo } from "@/utils/overlay";
import { fmtAttendanceWIB } from "@/utils/format";
import { toast } from "@/utils/toast";
import { useWs } from "@/composables/useWS";
import { apiFetchJSON } from "@/utils/api";
import { useSetting } from "@/composables/useSetting";
import { useI18n } from "@/i18n";

/* shadcn-vue components */
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
} from "@/components/ui/pagination";

const $config = inject("config");
const { t } = useI18n();

// Settings → attendance
const { model: baseInterval } = useSetting("baseInterval", { clamp: { max: 5000, round: true } });
const { model: attSendWidth } = useSetting("attendance.sendWidth", {
  clamp: { min: 160, max: 1920, round: true },
});
const { model: jpegQuality } = useSetting("attendance.jpegQuality", { clamp: { min: 0, max: 1 } });

const TOAST_GAP_OK = 2000;
const TOAST_GAP_BLOCK = 20000;

const videoRef = ref(null);
const snapRef = ref(null);
const overlayRef = ref(null);
const statusText = ref("");
const intervalInput = baseInterval;
const sendingFrame = ref(false);
const cameraActive = ref(false);
const results = ref([]);
const sendHeight = ref(0);

const logItems = ref([]);
const logMeta = reactive({
  page: 1,
  total_pages: 1,
  per_page: 25,
  total: 0,
  has_prev: false,
  has_next: false,
  order: "asc",
});
const pageSize = ref(10);
const order = ref("desc");
let logFetchPromise = null;
let pendingLogPage = null;

const pageSizeStr = computed({
  get: () => String(pageSize.value),
  set: (v) => {
    pageSize.value = Number(v || 10);
    refreshLog(1);
  },
});
const orderStr = computed({
  get: () => order.value,
  set: (v) => {
    order.value = v || "desc";
    refreshLog(1);
  },
});

const displayedRows = computed(() =>
  (logItems.value || []).map((item, idx) => {
    const ts = item.ts;
    const date = new Date(ts);

    // Format lokal: 04.13 Kamis, 23 Oktober 2025
    const time =
      date.toLocaleString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Jakarta",
      }) +
      " " +
      date.toLocaleString("id-ID", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",

        timeZone: "Asia/Jakarta",
      });

    return { ...item, rowNumber: idx + 1, time };
  })
);

const paginationSummary = computed(() => {
  const totalPages = Math.max(1, Number(logMeta.total_pages) || 1);
  const current = Math.min(Math.max(1, Number(logMeta.page) || 1), totalPages);
  return { current, totalPages };
});
const hasPrevPage = computed(() => paginationSummary.value.current > 1);
const hasNextPage = computed(() => paginationSummary.value.current < paginationSummary.value.totalPages);
const paginationDisplay = computed(() => {
  const { current, totalPages } = paginationSummary.value;
  const pagesSet = new Set();
  const addPage = (page) => {
    if (page >= 1 && page <= totalPages) pagesSet.add(page);
  };
  if (totalPages <= 6) {
    for (let page = 1; page <= totalPages; page += 1) addPage(page);
  } else {
    addPage(1);
    addPage(totalPages);
    if (current <= 3) {
      addPage(2);
      addPage(3);
      addPage(4);
    } else if (current >= totalPages - 2) {
      addPage(totalPages - 1);
      addPage(totalPages - 2);
    } else {
      addPage(current - 1);
      addPage(current);
      addPage(current + 1);
    }
  }
  const sorted = Array.from(pagesSet).sort((a, b) => a - b);
  const items = [];
  let prev = 0;
  sorted.forEach((page) => {
    if (prev && page - prev > 1) items.push({ type: "gap", key: `gap-${prev}-${page}` });
    items.push({ type: "page", page, active: page === current, key: `page-${page}` });
    prev = page;
  });
  return items;
});

let stream = null;
let timer = null;
const lastToastOK = new Map();
const lastToastBlocked = new Map();

/* =========================
 * WebSocket via ws()
 * ========================= */
function sendConfig() {
  // const th = Math.max(0, Math.min(1, parseFloat(threshold.value || 0.4)));
  socket.emit("att_cfg", { mark: true });
}

function canToast(map, key, gapMs) {
  const now = Date.now();
  const last = map.get(key) || 0;
  if (now - last < gapMs) return false;
  map.set(key, now);
  return true;
}

function handleResults(payload) {
  const res = payload?.results ?? [];
  results.value = res;
  updateOverlay();

  const marked = Array.isArray(payload?.marked) ? payload.marked : [];
  const markedInfo = Array.isArray(payload?.marked_info) ? payload.marked_info : [];
  const blocked = Array.isArray(payload?.blocked) ? payload.blocked : [];

  const statusBase = t("attendance.status.faces", "Wajah: {count}", { count: res.length });
  const markedTxt = marked.length
    ? t("attendance.status.markedSuffix", " • Ditandai: {labels}", { labels: marked.join(", ") })
    : "";
  statusText.value = `${statusBase}${markedTxt}`;

  let anyToast = false;
  for (const mi of markedInfo) {
    const lab = mi.label || "";
    const msg =
      mi.message ||
      (lab
        ? t("attendance.toast.successWithLabel", "Absen berhasil: {label}", { label: lab })
        : t("attendance.toast.success", "Absen berhasil"));
    if (lab && canToast(lastToastOK, lab, TOAST_GAP_OK)) {
      toast.success(msg);
      anyToast = true;
    }
  }
  if (!markedInfo.length) {
    for (const lab of marked) {
      if (canToast(lastToastOK, lab, TOAST_GAP_OK)) {
        toast.success(t("attendance.toast.successWithLabel", "Absen berhasil: {label}", { label: lab }));
        anyToast = true;
      }
    }
  }
  // if (blocked.length) {
  //   for (const b of blocked) {
  //     const lab = b.label || t("attendance.labels.unknown", "Tidak diketahui");
  //     if (canToast(lastToastBlocked, lab, TOAST_GAP_BLOCK)) {
  //       const reason = b.reason || t("attendance.toast.blockedReasonDefault", "Tidak bisa absen (aturan berlaku).");
  //       const retry = b.until
  //         ? t("attendance.toast.blockedRetry", " • Coba lagi: {time}", { time: fmtTimeLocal(b.until) })
  //         : "";
  //       const msg =
  //         b.message || t("attendance.toast.blockedMessage", "{label}: {reason}{retry}", { label: lab, reason, retry });
  //       toast.warn(msg);
  //       anyToast = true;
  //     }
  //   }
  // }
}

async function refreshLog(page = logMeta.page) {
  pendingLogPage = page;
  if (logFetchPromise) return logFetchPromise;

  const runner = async () => {
    let targetPage = pendingLogPage;
    pendingLogPage = null;

    while (targetPage !== null && targetPage !== undefined) {
      const per = parseInt(pageSize.value || "25", 10);
      const ord = order.value || "desc";
      try {
        const data = await apiFetchJSON(`/attendance-log?page=${targetPage}&per_page=${per}&order=${ord}`, {
          method: "GET",
          baseUrl: $config.HTTP_API,
        });
        const meta = data.meta || {
          page: targetPage,
          total_pages: 1,
          per_page: per,
          order: ord,
          total: (data.items || []).length,
          has_prev: false,
          has_next: false,
        };
        logItems.value = data.items || [];
        Object.assign(logMeta, meta);
        logMeta.order = meta.order || ord;
        logMeta.per_page = meta.per_page || per;
        logMeta.total = meta.total ?? logItems.value.length;
        logMeta.has_prev = Boolean(meta.has_prev);
        logMeta.has_next = Boolean(meta.has_next);
        logMeta.page = meta.page || targetPage;
        logMeta.total_pages = meta.total_pages || 1;
        pageSize.value = logMeta.per_page;
        order.value = logMeta.order;
      } catch {
        toast.error(t("attendance.toast.logError", "Gagal memuat Attendance Log. Coba lagi."));
        break;
      }
      targetPage = pendingLogPage;
      pendingLogPage = null;
    }
  };

  logFetchPromise = runner().finally(() => {
    logFetchPromise = null;
  });

  return logFetchPromise;
}

function updateOverlay() {
  drawResultsOverlay(videoRef.value, overlayRef.value, results.value, {
    mode: "recognize",
    sendWidth: Number(attSendWidth.value),
    sendHeight: sendHeight.value,
    fitMode: "fill",
  });
}

async function sendFrameWS() {
  if (socket.disconnected || sendingFrame.value) return;
  const video = videoRef.value;
  const snap = snapRef.value;
  if (!video || !snap || !video.srcObject) return;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;

  const height = Math.round((Number(attSendWidth.value) * vh) / vw);
  sendHeight.value = height;
  snap.width = Number(attSendWidth.value);
  snap.height = height;

  const ctx = snap.getContext("2d");
  ctx.drawImage(video, 0, 0, snap.width, snap.height);

  sendingFrame.value = true;
  try {
    const blob = await new Promise((resolve) => snap.toBlob(resolve, "image/jpeg", Number(jpegQuality.value)));
    const ab = await blob.arrayBuffer();
    socket.emit("att_frame", new Uint8Array(ab));
  } finally {
    sendingFrame.value = false;
  }
}

function stopCameraInternal(showToast = true) {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (videoRef.value) videoRef.value.srcObject = null;
  cameraActive.value = false;
  statusText.value = t("attendance.status.cameraStopped", "Kamera dihentikan");
  fitCanvasToVideo(overlayRef.value, videoRef.value);
  if (showToast) toast.info(t("attendance.toast.cameraStopped", "Kamera dihentikan."));
}

async function startCamera() {
  if (stream) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    if (videoRef.value) {
      videoRef.value.srcObject = stream;
      await new Promise((resolve) => {
        if (videoRef.value.readyState >= 2) return resolve();
        videoRef.value.onloadedmetadata = () => resolve();
      });
    }
    cameraActive.value = true;
    statusText.value = t("attendance.status.cameraStarted", "Kamera dimulai (WS)");
    fitCanvasToVideo(overlayRef.value, videoRef.value);
    sendConfig();
    const rawInterval = Number(baseInterval.value || 30);
    const iv = Math.max(120, rawInterval || 30);
    if (timer) clearInterval(timer);
    timer = setInterval(sendFrameWS, iv);
  } catch (err) {
    statusText.value = t("attendance.status.error", "Kesalahan: {message}", { message: err?.message || "-" });
    toast.error(t("attendance.toast.cameraError", "Gagal akses kamera: {message}", { message: err?.message || "-" }));
  }
}

/* =========================
 * Init ws() + listeners
 * ========================= */
const AttSock = useWs({
  root: true,
  on: {
    connect: () => {
      statusText.value = t("attendance.status.wsConnected", "WebSocket terhubung");
      toast.success(t("attendance.toast.wsConnected", "Terhubung ke server (WebSocket)."), { delay: 100 });
      sendConfig();
    },
    disconnect: () => {
      statusText.value = t("attendance.status.wsDisconnected", "WebSocket terputus");
      toast.warn(t("attendance.toast.wsDisconnected", "Koneksi WS terputus."), { delay: 100 });
    },
    att_ready: (m) => {
      const markLabel = m?.mark ? t("attendance.status.markOn", "aktif") : t("attendance.status.markOff", "nonaktif");
      statusText.value = t("attendance.status.wsReady", "WS terhubung • th(akurasi)={th} • mark={mode}", {
        th: (m?.th ?? 0).toFixed(1),
        mode: markLabel,
      });
    },
    att_error: (m) => {
      const message = m?.message || t("attendance.labels.unknown", "Tidak diketahui");
      statusText.value = t("attendance.status.error", "Kesalahan: {message}", { message });
      toast.error(t("attendance.toast.attendanceError", "Kesalahan attendance: {message}", { message }));
    },
    att_result: handleResults,
    att_log: (m) => {
      if (m && m.refresh) refreshLog(logMeta.page);
      else if (m && Array.isArray(m.events)) {
        logItems.value = m.events;
        Object.assign(logMeta, {
          page: 1,
          total_pages: 1,
          per_page: m.events.length,
          total: m.events.length,
          has_prev: false,
          has_next: false,
          order: "desc",
        });
      }
    },
  },
});

const socket = AttSock.socket;

watch(
  () => Number(logMeta.page),
  (p, old) => {
    if (Number.isFinite(p) && p !== Number(old)) {
      refreshLog(p);
    }
  }
);

onMounted(() => {
  if (socket.connected) sendConfig();
  window.addEventListener("resize", updateOverlay);
  refreshLog(1);
});
let released = false;
function releaseOnce() {
  released = true;
}
onBeforeUnmount(() => {
  window.removeEventListener("resize", updateOverlay);
  stopCameraInternal(false);
  releaseOnce();
});
onBeforeRouteLeave(() => releaseOnce());
</script>

<template>
  <div class="space-y-8">
    <div class="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start">
      <!-- LEFT: Camera -->
      <Card>
        <CardHeader>
          <div>
            <CardTitle>
              <p class="text-xs uppercase tracking-widest text-muted-foreground">
                {{ t("attendance.sections.camera.title", "Kamera") }}
              </p>
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent class="space-y-5">
          <div class="relative overflow-hidden rounded-2xl border bg-muted">
            <video ref="videoRef" autoplay playsinline muted class="w-full rounded-2xl"></video>
            <canvas ref="snapRef" class="hidden"></canvas>
            <canvas ref="overlayRef" class="absolute inset-0 h-full w-full pointer-events-none"></canvas>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label for="intervalInput">{{ t("attendance.fields.interval", "Interval (ms)") }}</Label>
              <Input id="intervalInput" :model-value="intervalInput" type="number" min="0" max="5000" />
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <Button type="button" @click="startCamera">
              {{ t("attendance.actions.startCamera", "Mulai Kamera") }}
            </Button>
            <Button type="button" variant="outline" @click="() => stopCameraInternal(true)">
              {{ t("attendance.actions.stopCamera", "Hentikan") }}
            </Button>
          </div>

          <p class="text-sm text-muted-foreground">
            {{ statusText || t("attendance.status.waiting", "Tekan mulai untuk mengirim frame ke server attendance.") }}
          </p>
        </CardContent>
      </Card>

      <!-- RIGHT: Log -->
      <Card>
        <CardHeader class="flex flex-row items-center justify-between">
          <div>
            <p class="text-xs uppercase tracking-widest text-muted-foreground">
              {{ t("attendance.sections.log.title", "Log absensi") }}
            </p>
            <CardTitle class="text-lg">
              {{ t("attendance.sections.log.subtitle", "Riwayat kedatangan") }}
            </CardTitle>
          </div>
          <div class="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              @click="
                refreshLog(logMeta.page);
                toast.success(t('attendance.actions.logRefresh', 'Log tersegarkan.'));
              ">
              {{ t("attendance.actions.refresh", "Segarkan") }}
            </Button>
          </div>
        </CardHeader>

        <CardContent class="space-y-5">
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label>{{ t("attendance.fields.perPage", "Jumlah per halaman") }}</Label>
              <Select v-model="pageSizeStr">
                <SelectTrigger class="w-full">
                  <SelectValue :placeholder="String(pageSize)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="space-y-2">
              <Label>{{ t("attendance.fields.order", "Urutan") }}</Label>
              <Select v-model="orderStr">
                <SelectTrigger class="w-full">
                  <SelectValue :placeholder="order" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">
                    {{ t("attendance.order.desc", "Terbaru") }}
                  </SelectItem>
                  <SelectItem value="asc">
                    {{ t("attendance.order.asc", "Terlama") }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <template v-if="displayedRows.length">
              <div class="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{{ t("attendance.table.no", "No") }}</TableHead>
                      <TableHead>{{ t("attendance.table.name", "Nama") }}</TableHead>
                      <TableHead>{{ t("attendance.table.dateTime", "Waktu & tanggal") }}</TableHead>
                      <TableHead class="text-right">{{ t("attendance.table.score", "Skor") }}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow v-for="row in displayedRows" :key="`${row.label}-${row.ts}-${row.rowNumber}`">
                      <TableCell class="font-semibold text-slate-600">{{ row.rowNumber }}</TableCell>
                      <TableCell>{{ row.label }}</TableCell>
                      <TableCell>
                        <div class="flex flex-wrap items-center gap-2 text-sm">
                          <span class="tabular-nums font-semibold">{{ row.time }}</span>
                        </div>
                      </TableCell>
                      <TableCell class="text-right tabular-nums">
                        {{ Number.isFinite(+row.score) ? (+row.score).toFixed(3) : row.score ?? "-" }}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </template>
            <div
              v-else
              class="flex items-center justify-center rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              <span>{{ t("attendance.table.empty", "Belum ada data absensi.") }}</span>
            </div>
          </div>

          <!-- Pagination -->
          <div class="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span class="text-muted-foreground">
              {{ t("attendance.pagination.totalLabel", "Total") }}: {{ logMeta.total }}
            </span>

            <!-- render hanya kalau ada data -->
            <template v-if="Number(logMeta.total) > 0">
              <div class="flex flex-wrap items-center justify-between gap-3 text-sm">
                <!-- Render pagination cuma kalau ada data -->
                <template v-if="Number(logMeta.total) > 0">
                  <Pagination
                    v-model:page="logMeta.page"
                    :items-per-page="Number(pageSize)"
                    :total="Number(logMeta.total)"
                    :sibling-count="0"
                    show-edges
                    class="mx-auto flex w-full justify-end">
                    <!-- Custom pagination window -->
                    <PaginationContent>
                      <PaginationPrevious :disabled="!hasPrevPage" />
                      <template v-for="item in paginationDisplay" :key="item.key">
                        <PaginationItem v-if="item.type === 'page'" :value="item.page" :is-active="item.active" />
                        <PaginationEllipsis v-else />
                      </template>
                      <PaginationNext :disabled="!hasNextPage" />
                    </PaginationContent>
                  </Pagination>
                </template>

                <template v-else>
                  <div class="mx-auto flex w-full justify-end text-muted-foreground">
                    {{ t("attendance.table.empty", "Belum ada data absensi.") }}
                  </div>
                </template>
              </div>
            </template>
            <template v-else>
              <!-- kalau gak ada data, jangan render Pagination biar gak inject error -->
              <div class="mx-auto flex w-full justify-end text-muted-foreground">
                {{ t("attendance.table.empty", "Belum ada data absensi.") }}
              </div>
            </template>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
