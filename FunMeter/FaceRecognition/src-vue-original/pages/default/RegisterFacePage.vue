<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from "vue";
import { drawResultsOverlay, fitCanvasToElement, clearCanvas } from "@/utils/overlay";
import { postForm, HttpError } from "@/utils/api";
import { toast } from "@/utils/toast";
import { useI18n } from "@/i18n";
import { useConfirmDialog } from "@/composables/useConfirmDialog";

// shadcn-vue components
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const { t } = useI18n();
const confirmDialog = useConfirmDialog();

// set true kalau mau kamera langsung dimatiin setelah auto-capture

const state = reactive({
  freeze: false,
  label: "",
  detectStatus: t("registerFace.status.noImage", "Tidak ada gambar."),
  registerStatus: "",
  busy: false,
  cameraActive: false, // kamera hidup
  captureVisible: false, // kontrol/hud kamera
  detectedFaces: 0,
});

const fileInput = ref(null);
const previewImg = ref(null);
const overlayCanvas = ref(null);
const videoRef = ref(null);
const captureCanvas = ref(null);
const previewSrc = ref("");
const previewToken = ref("");
const previewFaces = ref([]);
const previewLoading = ref(false);
const previewIsCropped = ref(false);


const labelInputRef = ref(null);
const labelNudge = ref(false);

let capturedBlob = null;
let uploadedFile = null;
let stream = null;
/* ====== UI computed ====== */
const showingImage = computed(() => !!previewSrc.value);
const showingVideo = computed(() => state.cameraActive && (!capturedBlob || state.freeze));

/* ====== Detection helpers ====== */
function trulyResetPreview() {
  try {
    if (previewSrc.value?.startsWith("blob:")) URL.revokeObjectURL(previewSrc.value);
  } catch {}
  previewSrc.value = "";
  previewToken.value = "";
  previewFaces.value = [];
  previewLoading.value = false;
  capturedBlob = null;
  uploadedFile = null;
  // jangan set capturedBlob di sini - biarkan caller yang tangani itu
  state.detectStatus = t("registerFace.status.noImage", "Tidak ada gambar.");
  state.detectedFaces = 0;
  state.freeze = false;
  if (previewImg.value) previewImg.value._sourceBlob = null;
  if (overlayCanvas.value) clearCanvas(overlayCanvas.value);
}

function resetPreview() {
  // cek dulu apakah sebelumnya ada hasil capture (sebelum di-null-kan)
  const hadCaptured = !!capturedBlob;

  // bersihkan preview & state visual
  trulyResetPreview();

  // bersihkan capturedBlob setelah simpan hadCaptured
  capturedBlob = null;
  if (fileInput.value?.$el) fileInput.value.$el.value = "";
  state.registerStatus = "";

  // Kalau kamera semula aktif (mis. user menekan reset saat camera masih aktif),
  // pastikan video diputar kembali
  if (state.cameraActive && videoRef.value) {
    state.detectStatus = t("registerFace.status.cameraReady", "Kamera siap.");
    try {
      videoRef.value.play();
    } catch {}
  }

  // Kalau tadi hasil capture (kamera dimatikan pas capture), buka kamera ulang
  if (hadCaptured) {
    openCamera();
    return;
  }

  // jika tidak ada capture dan kamera tidak aktif, tampilkan text kosong / status default
  if (!state.cameraActive) {
    state.detectStatus = t("registerFace.status.noImage", "Tidak ada gambar.");
  }
}

/* ====== File flow ====== */

async function requestPreviewFromBlob(blob, filename = "preview.jpg") {
  if (!blob) return false;
  previewLoading.value = true;
  try {
    state.detectStatus = t("registerFace.status.detecting", "Mendeteksi...");
    const fd = new FormData();
    fd.append("file", blob, filename);
    const resp = await postForm("/register-face/preview", fd);
    previewToken.value = resp.token || "";
    const facesRaw = Array.isArray(resp.faces) ? resp.faces : [];
    const facesCroppedRaw = Array.isArray(resp.faces_cropped) ? resp.faces_cropped : [];
    const faces = resp.preview_is_cropped ? facesCroppedRaw : facesRaw;
    state.detectedFaces = Number(resp.detected ?? faces.length ?? 0);
    if (state.detectedFaces <= 0) {
      previewToken.value = "";
      faces = [];
      state.detectStatus = t("registerFace.status.noImage", "Tidak ada gambar.");
      toast.warn(t("registerFace.toast.noFaces", "Tidak ada wajah terdeteksi dalam gambar."), { duration: 4000 });
      return false;
    }
    try {
      const prev = previewSrc.value;
      if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
    } catch {}

    previewSrc.value = resp.preview || URL.createObjectURL(blob);
    previewIsCropped.value = Boolean(resp.preview_is_cropped);
    if (previewImg.value) previewImg.value._sourceBlob = resp.preview ? null : blob;
    previewFaces.value = faces;
    previewToken.value = resp.token || "";
    state.detectStatus = t("registerFace.status.faces", "Jumlah wajah: {count}", { count: state.detectedFaces });
    return true;
  } catch (err) {
    previewToken.value = "";
    previewFaces.value = [];
    state.detectedFaces = 0;
    const message = err instanceof HttpError ? err.data?.message : err?.message;
    state.detectStatus = message || t("registerFace.status.error", "Error.");
    toast.error(message || t("registerFace.toast.error", "Kesalahan"));
    return false;
  } finally {
    previewLoading.value = false;
  }
}

async function onFileChange(e) {
  try {
    const file = e.target.files && e.target.files[0];
    state.registerStatus = "";
    if (!file) {
      if (fileInput.value?.$el) fileInput.value.$el.value = "";
      uploadedFile = null;
      trulyResetPreview();
      return;
    }

    trulyResetPreview();
    capturedBlob = file;
    uploadedFile = file;

    const ok = await requestPreviewFromBlob(file, file.name || "upload.jpg");
    if (!ok) {
      capturedBlob = null;
      uploadedFile = null;
      if (fileInput.value?.$el) fileInput.value.$el.value = "";
      return;
    }

    toast.info(t("registerFace.toast.loadedFromFile", "Gambar berhasil dimuat dari file."));
  } catch (err) {
    const message = err?.data?.message || err?.message;
    toast.error(message || t("registerFace.toast.error", "Kesalahan"));
  }
}

async function onPreviewLoad() {
  try {
    if (!previewImg.value) return;
    fitCanvasToElement(overlayCanvas.value, previewImg.value);
    if (previewToken.value && previewFaces.value.length && overlayCanvas.value) {
      drawResultsOverlay(previewImg.value, overlayCanvas.value, previewFaces.value);
      return;
    }
    if (previewToken.value && overlayCanvas.value) {
      clearCanvas(overlayCanvas.value);
      return;
    }
    if (overlayCanvas.value) clearCanvas(overlayCanvas.value);
  } catch (err) {
    const message = err?.data?.message || err?.message;
    toast.error(message || t("registerFace.toast.error", "Kesalahan"));
  }
}

/* ====== Camera flow ====== */
async function openCamera() {
  if (stream) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });

    if (videoRef.value) {
      videoRef.value.srcObject = stream;
      videoRef.value.muted = true; // bantu autoplay policy
      await new Promise((resolve) => {
        if (videoRef.value.readyState >= 2) return resolve();
        videoRef.value.onloadedmetadata = () => resolve();
      });
      await videoRef.value.play().catch(() => {});
    }

    state.cameraActive = true;
    state.captureVisible = true;

    if (fileInput.value?.$el) fileInput.value.$el.value = "";
    uploadedFile = null;
    trulyResetPreview(); // kosongkan preview image, tampilkan video
    state.detectStatus = t("registerFace.status.cameraReady", "Kamera siap.");
    toast.info(t("registerFace.toast.cameraActive", "Kamera aktif. Siap menangkap foto."));
  } catch (err) {
    const message = err?.data?.message || err?.message;
    toast.error(message || t("registerFace.toast.error", "Kesalahan."));
  }
}

function stopCamera() {
  try {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (videoRef.value) videoRef.value.srcObject = null;
  } finally {
    state.cameraActive = false;
    state.captureVisible = false;
  }
}

async function capturePhoto() {
  try {
    if (!videoRef.value) return;
    const canvas = captureCanvas.value;
    const ctx = canvas.getContext("2d");
    canvas.width = videoRef.value.videoWidth || 640;
    canvas.height = videoRef.value.videoHeight || 480;

    // ambil frame + FREEZE
    ctx.drawImage(videoRef.value, 0, 0);
    videoRef.value.pause();
    state.freeze = true;

    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.92));
    if (!blob) return;

    const ok = await requestPreviewFromBlob(blob, "capture.jpg");
    if (!ok) {
      state.freeze = false;
      try {
        await videoRef.value.play();
      } catch {}
      return;
    }

    capturedBlob = blob;
    uploadedFile = null;
    toast.success(t("registerFace.toast.captureSuccess", "Foto berhasil diambil."));
    stopCamera();

    // (3) arahkan perhatian ke input label: fokus + kedip singkat
    await nextTick();
    try {
      labelInputRef.value?.focus();
    } catch {}
    labelNudge.value = true;
    setTimeout(() => (labelNudge.value = false), 1200);

    // // (4) optional: langsung jalankan deteksi di hasil capture; kalau 0 → toast
    // await runPreviewDetection(capturedBlob);
  } catch (err) {
    toast.error(err?.message || t("registerFace.toast.error", "Error"));
  } finally {
    // lepaskan freeze (video akan tersembunyi karena capturedBlob sudah ada)
    state.freeze = false;
  }
}

/* ====== Submit ====== */
function extractDuplicateLabel(message, fallback) {
  if (!message) return fallback;
  const match = message.match(/'([^']+)'/);
  return match && match[1] ? match[1] : fallback;
}

async function submitForm() {
  if (state.busy) return;
  state.registerStatus = "";

  const inputLabel = state.label.trim();
  if (!inputLabel) {
    toast.warn(t("registerFace.toast.labelRequired", "Label wajib diisi."));
    return;
  }

  let currentLabel = inputLabel;

  // prioritas: hasil capture kamera -> preview token atau file upload
  let token = previewToken.value;
  let file = capturedBlob || uploadedFile;

  if (!token && !file) {
    toast.warn(t("registerFace.toast.sourceRequired", "Pilih gambar atau ambil foto terlebih dahulu."));
    return;
  }

  const filename = file
    ? capturedBlob
      ? "camera.jpg"
      : file && file.name
        ? file.name
        : "upload.jpg"
    : "upload.jpg";

  if (!token) {
    if (file) {
      const refreshed = await requestPreviewFromBlob(file, filename);
      if (!refreshed) {
        state.registerStatus = "";
        return;
      }
      token = previewToken.value;
    }

    if (!token) {
      state.registerStatus = "";
      toast.warn(t("registerFace.toast.previewRequired", "Silakan ambil crop wajah sebelum mendaftar."));
      return;
    }
  }

  const submitOnce = async (forceFlag, overrideLabel) => {
    const labelToSend = (overrideLabel ?? currentLabel).trim();
    const fd = new FormData();
    fd.append("label", labelToSend);
    fd.append("force", forceFlag ? "1" : "0");
    if (previewToken.value) {
      fd.append("preview_token", previewToken.value);
    }
    if (file) {
      fd.append("file", file, filename);
    }
    return await postForm(`/register-face`, fd);
  };

  const handleSuccess = (resp, wasForce) => {
    if (resp.status === "ok") {
      const successKey = wasForce ? "registerFace.status.updated" : "registerFace.status.registered";
      const toastKey = wasForce ? "registerFace.toast.updateSuccess" : "registerFace.toast.registerSuccess";
      state.registerStatus = t(successKey, wasForce ? "Diperbarui: {label}" : "Terdaftar: {label}", { label: resp.label });
      toast.success(t(toastKey, wasForce ? "Wajah diperbarui: {label}" : "Terdaftar: {label}", { label: resp.label }));
      state.label = "";
      if (fileInput.value?.$el) fileInput.value.$el.value = "";
      trulyResetPreview();
      stopCamera();
    } else {
      const message = resp?.message;
      state.registerStatus = message || t("registerFace.status.errorGeneric", "Kesalahan");
      toast.error(message || t("registerFace.toast.error", "Kesalahan"));
    }
    previewToken.value = "";
    previewFaces.value = [];
  };

  try {
    state.busy = true;
    state.registerStatus = t("registerFace.status.uploading", "Mengunggah...");

    const data = await submitOnce(false);
    handleSuccess(data, false);
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) {
      const message = err.data?.message || err.message;
      const dupLabel = extractDuplicateLabel(message, currentLabel);
      if (dupLabel && dupLabel !== currentLabel) {
        const mismatchMsg = t(
          "registerFace.toast.labelMustMatch",
          "Wajah terdaftar sebagai {label}. Gunakan label tersebut untuk memperbarui.",
          { label: dupLabel }
        );
        state.registerStatus = mismatchMsg;
        toast.warn(mismatchMsg, { duration: 6000 });
        labelNudge.value = true;
        setTimeout(() => (labelNudge.value = false), 1200);
        return;
      }
      state.registerStatus = message || t("registerFace.status.duplicate", "Wajah sudah terdaftar.");
      const confirmMsg = t(
        "registerFace.confirm.replace",
        "Wajah dengan label {label} sudah ada. Ganti foto dengan gambar ini?",
        { label: dupLabel }
      );
      const confirmed = await confirmDialog({
        title: t("registerFace.confirm.replaceTitle", "Ganti foto?"),
        description: confirmMsg,
        confirmText: t("registerFace.confirm.replaceAction", "Ganti"),
        cancelText: t("common.cancel", "Batal"),
      });
      if (confirmed) {
        try {
          state.registerStatus = t("registerFace.status.replacing", "Mengganti data wajah...");
          const forced = await submitOnce(true, currentLabel);
          handleSuccess(forced, true);
        } catch (forceErr) {
          const msg = forceErr?.data?.message || forceErr?.message;
          const fallback = t("registerFace.status.failure", "Terjadi kesalahan.");
          state.registerStatus = msg || fallback;
          toast.error(msg || t("registerFace.toast.failure", "Terjadi kesalahan."), { duration: 6000 });
        }
      } else if (message) {
        toast.warn(message, { duration: 5000 });
      }
    } else {
      const message = err?.data?.message || err?.message;
      const fallbackMessage = t("registerFace.status.failure", "Terjadi kesalahan.");
      state.registerStatus = message || fallbackMessage;
      toast.error(message || t("registerFace.toast.failure", "Terjadi kesalahan."), { duration: 6000 });
    }
  } finally {
    state.busy = false;
  }
}

/* ====== Resize & lifecycle ====== */
const handleResize = () => {
  try {
    if (previewImg.value?.src) fitCanvasToElement(overlayCanvas.value, previewImg.value);
  } catch {}
};

onMounted(() => window.addEventListener("resize", handleResize));
onBeforeUnmount(() => {
  window.removeEventListener("resize", handleResize);
  stopCamera();
});
</script>
<!-- Template baru: fokus ke tampilan -->
<template>
  <div class="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
    <!-- KIRI: Kamera & Preview -->
    <Card class="h-fit">
      <CardHeader class="flex items-start justify-between space-y-0">
        <div>
          <p class="text-xs tracking-widest text-muted-foreground uppercase">
            {{ t("registerFace.sections.camera.title", "Kamera & Pratinjau") }}
          </p>
          <CardTitle class="text-lg">
            {{ t("registerFace.sections.camera.subtitle", "Tangkap wajah") }}
          </CardTitle>
          <CardDescription class="mt-1">
            {{
              t(
                "registerFace.header.subtitle",
                "Ambil foto dari kamera atau unggah gambar untuk menambahkan identitas baru."
              )
            }}
          </CardDescription>
        </div>

        <Badge v-if="state.registerStatus" variant="outline" class="shrink-0">
          {{ state.registerStatus }}
        </Badge>
      </CardHeader>
      <Separator />

      <CardContent class="space-y-5">
        <!-- Surface kamera yang responsif + overlay -->
        <div class="relative overflow-hidden rounded-2xl border bg-muted/30">
          <div class="">
            <img
              v-show="showingImage"
              ref="previewImg"
              :src="previewSrc"
              @load="onPreviewLoad"
              class="w-full"
              alt="preview" />
            <video
              v-show="showingVideo && !showingImage"
              ref="videoRef"
              autoplay
              playsinline
              muted
              class="w-full"></video>
            <canvas v-show="showingImage" ref="overlayCanvas" class="absolute inset-0 h-full w-full"></canvas>
          </div>

          <div
            v-if="previewLoading"
            class="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-background/75 text-sm text-muted-foreground">
            <div class="flex items-center gap-2">
              <i class="ti ti-loader-2 animate-spin"></i>
              {{ t("registerFace.status.processingCrop", "Memproses foto...") }}
            </div>
          </div>

          <!-- HUD mengambang -->
          <div class="pointer-events-auto absolute bottom-4 right-4 flex flex-wrap items-center gap-2">
            <Button
              v-if="state.cameraActive"
              type="button"
              :disabled="state.busy"
              @click="capturePhoto"
              variant="default">
              <i class="ti ti-camera mr-2"></i>
              {{ t("registerFace.actions.capture", "Tangkap") }}
            </Button>

            <Button
              type="button"
              variant="outline"
              :disabled="state.cameraActive"
              @click="resetPreview"
              class="backdrop-blur-md">
              <i class="ti ti-rotate mr-2"></i>
              {{ t("registerFace.actions.reset", "Reset") }}
            </Button>
          </div>
        </div>

        <!-- Status deteksi -->
        <div class="flex items-center justify-between gap-3">
          <!-- <p class="text-sm text-muted-foreground">
            {{ t("registerFace.status.label", "Status deteksi") }}:
            {{ state.detectStatus || t("registerFace.status.waiting", "Menunggu input wajah.") }}
          </p> -->
          <Button type="button" variant="default" @click="openCamera">
            <i class="ti ti-video mr-2" ></i>{{ t("registerFace.actions.openCamera", "Gunakan Kamera") }}
          </Button>
          <Button v-if="state.cameraActive" type="button" variant="outline" @click="stopCamera">
            <i class="ti ti-video-off mr-2"></i>{{ t("registerFace.actions.stopCamera", "Hentikan Kamera") }}
          </Button>
          <div class="ml-auto text-sm text-muted-foreground">
            {{ state.busy ? t("registerFace.status.processing", "Memproses...") : "" }}
          </div>
          <Badge variant="outline" class="rounded-full">
            <i class="ti ti-user-scan mr-1"></i>{{
              t("registerFace.status.faceBadge", "{count} wajah", { count: state.detectedFaces })
            }}
          </Badge>
        </div>

        <canvas ref="captureCanvas" class="hidden"></canvas>
      </CardContent>

      <CardFooter class="flex-wrap gap-2 hidden"> </CardFooter>
    </Card>

    <!-- KANAN: Panel Aksi & Detail -->
    <!-- Panel tombol besar (masuk/keluar/profil) -->
    <div class="grid gap-6">
      <!-- <Card>
        <CardHeader class="pb-3">
          <p class="text-xs tracking-widest text-muted-foreground uppercase">
            {{ t("registerFace.sections.actions.title", "Aksi Cepat") }}
          </p>
          <CardTitle class="text-lg">
            {{ t("registerFace.sections.actions.subtitle", "Akses Kilat") }}
          </CardTitle>
        </CardHeader>
        <Separator />
        <CardContent class="grid gap-3">
          <Button
            size="lg"
            variant="outline"
            class="h-14 justify-start text-base border-green-500/70 hover:bg-green-500/10">
            <i class="ti ti-login-2 mr-3 text-2xl text-green-600"></i>
            {{ t("registerFace.actions.checkIn", "Masuk") }}
          </Button>

          <Button
            size="lg"
            variant="outline"
            class="h-14 justify-start text-base border-red-500/70 hover:bg-red-500/10">
            <i class="ti ti-logout-2 mr-3 text-2xl text-red-600"></i>
            {{ t("registerFace.actions.checkOut", "Keluar") }}
          </Button>

          <Button size="lg" variant="outline" class="h-14 justify-start text-base">
            <i class="ti ti-user-cog mr-3 text-2xl"></i>
            {{ t("registerFace.actions.profile", "Profil & Pengaturan") }}
          </Button>
        </CardContent>
      </Card> -->

      <!-- Form detail & upload -->
      <Card class="h-fit">
        <CardHeader>
          <p class="text-xs tracking-widest text-muted-foreground uppercase">
            {{ t("registerFace.sections.details.title", "Detail Wajah") }}
          </p>
          <CardTitle class="text-lg">
            {{ t("registerFace.sections.details.subtitle", "Informasi Identitas") }}
          </CardTitle>
        </CardHeader>
        <Separator />
        <CardContent class="space-y-5">
          <div class="space-y-2">
            <Label for="labelInput">{{ t("registerFace.fields.label", "Label / Nama") }}</Label>
            <Input
              id="labelInput"
              v-model="state.label"
              ref="labelInputRef"
              type="text"
              @keydown.enter="submitForm"
              :class="labelNudge ? 'animate-pulse ring-2 ring-primary focus:ring-2' : ''"
              :placeholder="t('registerFace.fields.labelPlaceholder', 'Nama lengkap')"
              required />
          </div>

          <div class="space-y-2">
            <Label for="fileInputEl">{{ t("registerFace.fields.upload", "Unggah Gambar") }}</Label>
            <Input id="fileInputEl" ref="fileInput" type="file" accept="image/*" @change="onFileChange" />
          </div>
        </CardContent>
        <CardFooter class="flex flex-wrap items-center gap-3">
          <Button type="submit" :disabled="state.busy" @click.prevent="submitForm">
            <i class="ti ti-send mr-2"></i>{{ t("registerFace.actions.submit", "Daftarkan") }}
          </Button>
        </CardFooter>
      </Card>
    </div>
  </div>
</template>
