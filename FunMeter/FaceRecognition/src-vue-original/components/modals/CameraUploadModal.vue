<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "../../i18n";
import { Dialog, DialogContent, DialogTitle, DialogClose } from "@/components/ui/dialog";
// Use direct toBlob to avoid extra compression layer

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: "" },
  accept: { type: String, default: "image/*" },
  busy: { type: Boolean, default: false },
});
const emit = defineEmits(["close", "submit"]);

const { t } = useI18n();

const text = computed(() => ({
  title: t("cameraUpload.title", "Upload Foto"),
  close: t("cameraUpload.actions.close", "Tutup"),
  fromFile: t("cameraUpload.fromFile", "Dari File"),
  fromCamera: t("cameraUpload.fromCamera", "Dari Kamera"),
  startCamera: t("cameraUpload.actions.startCamera", "Mulai Kamera"),
  stopCamera: t("cameraUpload.actions.stopCamera", "Matikan"),
  capture: t("cameraUpload.actions.capture", "Tangkap"),
  preview: t("cameraUpload.preview", "Pratinjau"),
  cancel: t("cameraUpload.actions.cancel", "Batal"),
  upload: t("cameraUpload.actions.upload", "Unggah"),
}));

const resolvedTitle = computed(() => props.title || text.title);

const videoRef = ref(null);
const snapRef = ref(null);
const cameraActive = ref(false);
const previewUrl = ref("");
let stream = null;
let fileBlob = null;

function revokePreview() {
  try {
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  } catch {}
  previewUrl.value = "";
}

async function openCamera() {
  if (cameraActive.value) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    const v = videoRef.value;
    if (v) {
      v.srcObject = stream;
      await new Promise((res) => {
        if (v.readyState >= 2) return res();
        v.onloadedmetadata = () => res();
      });
      await v.play().catch(() => {});
    }
    cameraActive.value = true;
  } catch (e) {
    console.error(e);
  }
}

function stopCamera() {
  try {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
  } catch {}
  stream = null;
  const v = videoRef.value;
  if (v) v.srcObject = null;
  cameraActive.value = false;
}

async function captureFrame() {
  try {
    const v = videoRef.value;
    const c = snapRef.value;
    if (!v || !c) return;
    const vw = v.videoWidth || 640;
    const vh = v.videoHeight || 480;
    c.width = vw;
    c.height = vh;
    const ctx = c.getContext("2d");
    ctx.drawImage(v, 0, 0, vw, vh);
    fileBlob = await new Promise((resolve) => c.toBlob(resolve, "image/jpeg", 0.92));
    revokePreview();
    previewUrl.value = URL.createObjectURL(fileBlob);
  } catch (e) {
    console.error(e);
  }
}

function onFileChange(e) {
  const f = e.target.files && e.target.files[0];
  fileBlob = f || null;
  revokePreview();
  if (f) previewUrl.value = URL.createObjectURL(f);
}

function onClose() {
  stopCamera();
  revokePreview();
  fileBlob = null;
  emit("close");
}

async function onSubmit() {
  if (!fileBlob) return;
  emit("submit", fileBlob);
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      stopCamera();
      revokePreview();
      fileBlob = null;
    }
  }
);

onBeforeUnmount(() => {
  stopCamera();
  revokePreview();
});
</script>

<template>
  <Dialog  :open="open" @update:open="(v) => { if (!v) onClose() }">
      <DialogContent class="fixed left-1/2 top-1/2 z-50 grid w-full max-w-5xl -translate-x-1/2 -translate-y-1/2 gap-4 border bg-background p-6 shadow-lg duration-200 focus:outline-none">
        <div class="flex items-center justify-between">
          <DialogTitle as="h3" class="text-lg font-semibold">{{ resolvedTitle }}</DialogTitle>
        </div>
        <div class="space-y-5">
            <div class="grid gap-4 md:grid-cols-2">
              <div class="space-y-2">
                <label class="text-sm font-medium">{{ text.fromFile }}</label>
                <input :accept="accept" type="file" class="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm" @change="onFileChange" />
              </div>
              <div class="space-y-2">
                <label class="text-sm font-medium">{{ text.fromCamera }}</label>
                <div class="flex flex-wrap items-center gap-2">
                  <button v-if="!cameraActive" type="button" class="inline-flex items-center justify-center rounded-md border bg-background px-4 py-2 text-sm font-medium" @click="openCamera">{{ text.startCamera }}</button>
                  <button v-else type="button" class="inline-flex items-center justify-center rounded-md border bg-background px-4 py-2 text-sm font-medium" @click="stopCamera">{{ text.stopCamera }}</button>
                </div>
                <div class="relative overflow-hidden rounded-md border bg-muted/40">
                  <video ref="videoRef" autoplay playsinline class="w-full max-h-64 object-contain"></video>
                  <canvas ref="snapRef" class="hidden"></canvas>
                  <div class="pointer-events-none absolute inset-0 flex items-end justify-end p-3">
                    <button type="button" class="pointer-events-auto inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:opacity-90" :disabled="!cameraActive" @click="captureFrame">{{ text.capture }}</button>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="previewUrl" class="flex flex-col items-center gap-2">
              <label class="text-sm font-medium">{{ text.preview }}</label>
              <img :src="previewUrl" class="h-60 rounded-md object-contain" />
            </div>
            <div class="flex justify-end gap-2">
              <button type="button" class="inline-flex items-center justify-center rounded-md border bg-background px-4 py-2 text-sm font-medium" @click="onClose">{{ text.cancel }}</button>
              <button type="button" class="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:opacity-90 disabled:opacity-60" :disabled="!fileBlob || busy" @click="onSubmit">{{ text.upload }}</button>
            </div>
        </div>
      </DialogContent>
  </Dialog>
</template>
