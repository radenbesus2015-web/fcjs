<script setup>
import { ref, watch, nextTick, onBeforeUnmount, inject, computed } from "vue";
import { drawResultsOverMedia, clearCanvas, fitCanvasToMedia } from "@/utils/overlay";
import { postForm } from "@/utils/api";
import { formatScore } from "@/utils/format";
import { useI18n } from "@/i18n";

const $config = inject("config");
const { t } = useI18n();

const activeTab = ref("recognize");
const threshold = ref(0.6);
const recognizeInput = ref(null);
const recognizeImage = ref(null);
const recognizeOverlay = ref(null);
const recognizePreview = ref("");
const recognizeResults = ref([]);
const recognizeStatus = ref("");
const recognizeBusy = ref(false);
const recognizeFile = ref(null);

const videoEl = ref(null);
const snapCanvas = ref(null);
const captureImage = ref(null);
const captureOverlay = ref(null);
const capturePreview = ref("");
const captureResults = ref([]);
const cameraStatus = ref("");

let recognizeObjectUrl = null;
let captureObjectUrl = null;
let stream = null;

function setTab(tab) {
  activeTab.value = tab;
}

function revokeRecognizeUrl() {
  if (recognizeObjectUrl) {
    URL.revokeObjectURL(recognizeObjectUrl);
    recognizeObjectUrl = null;
  }
}

function revokeCaptureUrl() {
  if (captureObjectUrl) {
    URL.revokeObjectURL(captureObjectUrl);
    captureObjectUrl = null;
  }
}

function updateRecognizeOverlay() {
  nextTick(() => {
    const img = recognizeImage.value;
    const canvas = recognizeOverlay.value;
    if (!canvas) return;
    if (!img || !img.src) {
      clearCanvas(canvas);
      return;
    }
    if (!img.complete) return;
    if (recognizeResults.value.length) {
      drawResultsOverMedia(img, canvas, recognizeResults.value);
    } else {
      fitCanvasToMedia(canvas, img);
      clearCanvas(canvas);
    }
  });
}

let rafId = 0;
function scheduleOverlayUpdate() {
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    const canvas = captureOverlay.value;
    const media = capturePreview.value ? captureImage.value : videoEl.value;
    if (!canvas || !media) return;
    // Untuk IMG pastikan sudah siap
    if (media.tagName === "IMG" && !media.complete) return;
    fitCanvasToMedia(canvas, media);
    if (capturePreview.value && captureResults.value.length) {
      drawResultsOverMedia(media, canvas, captureResults.value);
    } else {
      clearCanvas(canvas);
    }
  });
}

async function resetCapture() {
  // bersihin hasil & balik ke live tanpa matiin kamera
  captureResults.value = [];
  revokeCaptureUrl();
  capturePreview.value = "";
  await nextTick();
  scheduleOverlayUpdate(); // sinkron ulang overlay ke <video>
}

function onRecognizeFileChange(event) {
  const file = event.target.files && event.target.files[0];
  recognizeFile.value = file || null;
  recognizeResults.value = [];
  recognizeStatus.value = "";
  if (!file) {
    revokeRecognizeUrl();
    recognizePreview.value = "";
    clearCanvas(recognizeOverlay.value);
    return;
  }
  revokeRecognizeUrl();
  recognizeObjectUrl = URL.createObjectURL(file);
  recognizePreview.value = recognizeObjectUrl;
}

function onRecognizeImageLoad() {
  updateRecognizeOverlay();
}

async function submitRecognize() {
  if (!recognizeFile.value) {
    recognizeStatus.value = t("home.recognize.status.noImage", "Pilih gambar terlebih dahulu");
    return;
  }
  const th = Number.isFinite(threshold.value) ? threshold.value : 0.6;
  const fd = new FormData();
  fd.append("file", recognizeFile.value);
  recognizeBusy.value = true;
  recognizeStatus.value = t("home.recognize.status.running", "Memproses…");
  try {
    const data = await postForm(`${$config.HTTP_API}/recognize-image?th=${th}`, fd);
    recognizeResults.value = data.results || [];
    recognizeStatus.value = t("home.recognize.status.faces", "Jumlah wajah: {count}", {
      count: recognizeResults.value.length,
    });
  } catch (err) {
    recognizeResults.value = [];
    recognizeStatus.value = t("home.recognize.status.error", "Kesalahan: {message}", {
      message: err?.message || "-",
    });
    clearCanvas(recognizeOverlay.value);
  } finally {
    recognizeBusy.value = false;
    updateRecognizeOverlay();
  }
}

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    if (videoEl.value) {
      videoEl.value.srcObject = stream;
      await videoEl.value.play?.();
    }
    cameraStatus.value = t("home.camera.status.started", "Kamera aktif");
    scheduleOverlayUpdate();
  } catch (err) {
    cameraStatus.value = t("home.camera.status.error", "Kesalahan: {message}", { message: err?.message || "-" });
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
  }
  if (videoEl.value) {
    videoEl.value.srcObject = null;
  }
  cameraStatus.value = t("home.camera.status.stopped", "Kamera dihentikan");
}

async function captureAndRecognize() {
  const video = videoEl.value;
  const canvas = snapCanvas.value;
  if (!video || !canvas || !video.srcObject) {
    cameraStatus.value = t("home.camera.status.startFirst", "Aktifkan kamera terlebih dahulu");
    return;
  }
  const width = video.videoWidth || video.clientWidth || 640;
  const height = video.videoHeight || video.clientHeight || 480;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) {
    cameraStatus.value = t("home.camera.status.captureFailed", "Gagal mengambil gambar");
    return;
  }
  revokeCaptureUrl();
  captureObjectUrl = URL.createObjectURL(blob);
  capturePreview.value = captureObjectUrl;

  const fd = new FormData();
  fd.append("file", blob, "capture.jpg");
  cameraStatus.value = t("home.camera.status.recognizing", "Memproses…");
  try {
    const data = await postForm(`${$config.HTTP_API}/recognize-image`, fd);
    captureResults.value = data.results || [];
    cameraStatus.value = t("home.camera.status.faces", "Jumlah wajah: {count}", {
      count: captureResults.value.length,
    });
  } catch (err) {
    captureResults.value = [];
    cameraStatus.value = t("home.camera.status.error", "Kesalahan: {message}", { message: err?.message || "-" });
    clearCanvas(captureOverlay.value);
  } finally {
    scheduleOverlayUpdate();
  }
}

watch(recognizeResults, updateRecognizeOverlay);
watch(recognizePreview, updateRecognizeOverlay);
watch(captureResults, scheduleOverlayUpdate);
watch(capturePreview, scheduleOverlayUpdate);

onBeforeUnmount(() => {
  stopCamera();
  revokeRecognizeUrl();
  revokeCaptureUrl();
});
</script>

<template>
  <Tabs v-model="activeTab" class="space-y-8">
    <TabsList>
      <TabsTrigger value="recognize">{{ t("home.tabs.fromImage", "Dari Gambar") }}</TabsTrigger>
      <TabsTrigger value="camera">{{ t("home.tabs.fromCamera", "Dari Kamera") }}</TabsTrigger>
    </TabsList>

    <!-- TAB: RECOGNIZE -->
    <TabsContent value="recognize">
      <div class="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start">
        <Card>
          <CardHeader class="flex flex-row items-center justify-between">
            <div>
              <p class="text-xs uppercase tracking-widest text-muted-foreground">
                {{ t("home.sections.results.title", "Hasil") }}
              </p>
              <CardTitle class="text-lg">{{ t("home.sections.results.subtitle", "Deteksi wajah") }}</CardTitle>
            </div>
            <Badge v-if="recognizeStatus" variant="outline">{{ recognizeStatus }}</Badge>
          </CardHeader>
          <CardContent class="space-y-5">
            <div class="relative overflow-hidden rounded-2xl border bg-muted">
              <img
                v-if="recognizePreview"
                ref="recognizeImage"
                :src="recognizePreview"
                @load="onRecognizeImageLoad"
                class="w-full rounded-2xl" />
              <canvas ref="recognizeOverlay" class="absolute inset-0 h-full w-full pointer-events-none"></canvas>
              <div
                v-if="!recognizePreview"
                class="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                <span>{{ t("home.results.previewEmpty", "Pratinjau gambar akan tampil di sini.") }}</span>
              </div>
            </div>

            <div>
              <template v-if="recognizeResults.length">
                <div class="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>{{ t("home.table.label", "Label") }}</TableHead>
                        <TableHead>{{ t("home.table.score", "Skor") }}</TableHead>
                        <TableHead>{{ t("home.table.bbox", "Kotak Pembatas") }}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow v-for="(row, idx) in recognizeResults" :key="idx">
                        <TableCell>{{ idx + 1 }}</TableCell>
                        <TableCell>{{ row.label }}</TableCell>
                        <TableCell>{{ formatScore(row.score) }}</TableCell>
                        <TableCell>[{{ row.bbox.join(", ") }}]</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </template>
              <div
                v-else
                class="flex items-center justify-center rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                <span>{{ t("home.results.empty", "Belum ada wajah terdeteksi.") }}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <p class="text-xs uppercase tracking-widest text-muted-foreground">
                {{ t("home.sections.input.title", "Input") }}
              </p>
              <CardTitle class="text-lg">{{ t("home.sections.input.subtitle", "Unggah gambar") }}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <form class="space-y-5" @submit.prevent="submitRecognize">
              <div class="space-y-2">
                <Label for="recognize-file">{{ t("home.fields.image", "Gambar") }}</Label>
                <Input
                  id="recognize-file"
                  ref="recognizeInput"
                  type="file"
                  accept="image/*"
                  required
                  @change="onRecognizeFileChange" />
              </div>

              <div class="flex flex-wrap items-center gap-3">
                <Button type="submit" :disabled="recognizeBusy">
                  {{
                    recognizeBusy
                      ? t("home.actions.processing", "Memproses…")
                      : t("home.actions.runRecognition", "Jalankan")
                  }}
                </Button>
                <span class="text-sm text-muted-foreground">
                  {{ recognizeStatus || t("home.results.waitingForImage", "Menunggu gambar.") }}
                </span>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </TabsContent>

    <!-- TAB: CAMERA -->
    <TabsContent value="camera">
      <div class="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start">
        <Card>
          <CardHeader class="flex flex-row items-center justify-between">
            <div>
              <p class="text-xs uppercase tracking-widest text-muted-foreground">
                {{ t("home.sections.cameraResults.title", "Hasil") }}
              </p>
              <CardTitle class="text-lg">{{ t("home.sections.cameraResults.subtitle", "Deteksi wajah") }}</CardTitle>
            </div>
            <Badge v-if="cameraStatus" variant="outline">{{ cameraStatus }}</Badge>
          </CardHeader>
          <CardContent class="space-y-5">
            <div class="relative overflow-hidden rounded-2xl border bg-muted dark:bg-black">
              <!-- Kalau SUDAH capture -> IMG; kalau BELUM -> VIDEO live stream di sini -->
              <video
                v-show="!capturePreview"
                ref="videoEl"
                autoplay
                playsinline
                @loadedmetadata="scheduleOverlayUpdate"
                class="w-full h-auto rounded-2xl"></video>
              <img
                v-show="capturePreview"
                ref="captureImage"
                :src="capturePreview"
                @load="scheduleOverlayUpdate"
                class="w-full h-auto rounded-2xl" />
              <canvas ref="captureOverlay" class="absolute inset-0 h-full w-full pointer-events-none"></canvas>
              <!-- tombol di pojok kanan bawah -->
              <div class="pointer-events-none absolute inset-0 z-10 flex items-end justify-end p-3 sm:p-4">
                <div class="pointer-events-auto flex gap-2">
                  <!-- Saat LIVE: tampilkan Capture -->
                  <Button v-if="!capturePreview" type="button" @click="captureAndRecognize">
                    {{ t("home.actions.capture", "Ambil Foto") }}
                  </Button>
                  <!-- Saat SUDAH capture: tampilkan Reset -->
                  <Button v-else type="button" variant="outline" @click="resetCapture">
                    {{ t("home.actions.reset", "Reset") }}
                  </Button>
                </div>
              </div>
            </div>

            <!-- Kanvas bantu buat snapshot -->
            <canvas ref="snapCanvas" class="hidden"></canvas>

            <div>
              <template v-if="captureResults.length">
                <div class="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>{{ t("home.table.label", "Label") }}</TableHead>
                        <TableHead>{{ t("home.table.score", "Skor") }}</TableHead>
                        <TableHead>{{ t("home.table.bbox", "Kotak Pembatas") }}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow v-for="(row, idx) in captureResults" :key="idx">
                        <TableCell>{{ idx + 1 }}</TableCell>
                        <TableCell>{{ row.label }}</TableCell>
                        <TableCell>{{ formatScore(row.score) }}</TableCell>
                        <TableCell>[{{ row.bbox.join(", ") }}]</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </template>
              <div
                v-else
                class="flex items-center justify-center rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                <span>{{ t("home.results.empty", "Belum ada wajah terdeteksi.") }}</span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <p class="text-xs uppercase tracking-widest text-muted-foreground">
                {{ t("home.sections.camera.title", "Kamera") }}
              </p>
              <CardTitle class="text-lg">{{ t("home.sections.camera.subtitle", "Kontrol") }}</CardTitle>
            </div>
          </CardHeader>
          <CardContent class="space-y-5">
            <div class="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" @click="startCamera">
                {{ t("home.actions.startCamera", "Mulai") }}
              </Button>
              <Button type="button" variant="outline" @click="stopCamera">
                {{ t("home.actions.stopCamera", "Berhenti") }}
              </Button>
            </div>
            <p class="text-sm text-muted-foreground">
              {{ cameraStatus || t("home.camera.waiting", "Aktifkan kamera untuk memulai.") }}
            </p>
          </CardContent>
        </Card>
      </div>
    </TabsContent>
  </Tabs>
</template>
