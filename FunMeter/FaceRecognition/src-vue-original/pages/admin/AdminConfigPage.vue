<script setup>
import { inject, onMounted, reactive, ref } from "vue";
import { apiFetch } from "@/utils/api";
import { toast } from "@/utils/toast";
import { useI18n } from "@/i18n";
import { useConfirmDialog } from "@/composables/useConfirmDialog";

const auth = inject("auth", null);
const { t, locale } = useI18n();
const confirmDialog = useConfirmDialog();

// shadcn-vue
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

const state = reactive({
  loading: true,
  error: "",
  config: { face_engine: {}, attendance: {} },
  defaults: { face_engine: {}, attendance: {} },
});

const faceForm = reactive({
  min_cosine_accept: "",
  fun_ws_min_interval: "",
  att_ws_min_interval: "",
  yunet_score_threshold: "",
  yunet_nms_threshold: "",
  yunet_top_k: "",
});

const attendanceForm = reactive({
  cooldown_str: "",
  min_cosine_accept: "",
});

const savingConfig = ref(false);
const jsonModal = reactive({ open: false, title: "", content: "" });

// helpers for mm:ss or seconds parsing/formatting (cooldown only)
function formatDuration(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) {
    const m = Math.floor(n / 60);
    const s = Math.max(0, Math.round(n % 60));
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  const s = String(value || "").trim();
  if (!s) return "";
  if (/^\d{1,}:[0-5]\d$/.test(s)) return s;
  const x = Number(s);
  if (Number.isFinite(x) && x >= 0) {
    const m = Math.floor(x / 60);
    const sec = Math.max(0, Math.round(x % 60));
    return `${m}:${String(sec).padStart(2, "0")}`;
  }
  return s;
}

function parseDuration(input) {
  const s = String(input ?? "").trim();
  if (!s) return null;
  if (/^\d{1,}:[0-5]\d$/.test(s)) {
    const [m, sec] = s.split(":");
    return Math.max(0, Number(m) * 60 + Number(sec));
  }
  const n = Number(s);
  if (Number.isFinite(n) && n >= 0) return Math.round(n);
  throw new Error(t("adminConfig.errors.mustDuration", "Cooldown harus berupa mm:ss atau jumlah detik."));
}

function openJsonModal(title, payload) {
  jsonModal.title = title;
  try {
    jsonModal.content = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  } catch (err) {
    jsonModal.content = String(payload ?? "");
  }
  jsonModal.open = true;
}
function closeJsonModal() {
  jsonModal.open = false;
}

function toInputValue(value) {
  if (value === undefined || value === null) return "";
  return String(value);
}

function hydrateForms() {
  const face = state.config?.face_engine || {};
  faceForm.min_cosine_accept = toInputValue(face.min_cosine_accept);
  faceForm.fun_ws_min_interval = toInputValue(face.fun_ws_min_interval);
  faceForm.att_ws_min_interval = toInputValue(face.att_ws_min_interval);
  faceForm.yunet_score_threshold = toInputValue(face.yunet_score_threshold);
  faceForm.yunet_nms_threshold = toInputValue(face.yunet_nms_threshold);
  faceForm.yunet_top_k = toInputValue(face.yunet_top_k);

  const attendance = state.config?.attendance || {};
  attendanceForm.cooldown_str = formatDuration(attendance.cooldown_sec);
  attendanceForm.min_cosine_accept = toInputValue(attendance.min_cosine_accept);
}

async function loadConfig() {
  state.loading = true;
  state.error = "";
  try {
    const data = await apiFetch("/admin/dashboard-data", { method: "GET" });
    state.config = data?.config || { face_engine: {}, attendance: {} };
    state.defaults = data?.config_defaults || { face_engine: {}, attendance: {} };
    if (auth?.state?.user && data?.current_user?.username === auth.state.user.username) {
      auth.state.user = { ...auth.state.user, api_key: data.current_user.api_key };
    }
    hydrateForms();
  } catch (err) {
    console.error(err);
    state.error = err?.message || t("adminConfig.error.fetch", "Gagal memuat konfigurasi.");
  } finally {
    state.loading = false;
  }
}

function buildConfigPayload(scope) {
  if (scope === "face_engine") {
    const payload = {};
    const parseNumber = (key, value) => {
      if (value === "" || value === null || value === undefined) return;
      const num = Number(value);
      if (Number.isNaN(num)) {
        throw new Error(t("adminConfig.errors.mustNumber", "{field} harus berupa angka.", { field: key }));
      }
      payload[key] = num;
    };
    parseNumber("min_cosine_accept", faceForm.min_cosine_accept);
    parseNumber("fun_ws_min_interval", faceForm.fun_ws_min_interval);
    parseNumber("att_ws_min_interval", faceForm.att_ws_min_interval);
    parseNumber("yunet_score_threshold", faceForm.yunet_score_threshold);
    parseNumber("yunet_nms_threshold", faceForm.yunet_nms_threshold);
    parseNumber("yunet_top_k", faceForm.yunet_top_k);
    if (Object.keys(payload).length === 0) return null;
    return { face_engine: payload };
  }

  if (scope === "attendance") {
    const payload = {};
    const parseFloatField = (key, value) => {
      if (value === "" || value === null || value === undefined) return;
      const num = parseFloat(value);
      if (Number.isNaN(num)) {
        throw new Error(t("adminConfig.errors.mustNumber", "{field} harus berupa angka.", { field: key }));
      }
      payload[key] = num;
    };
    const cooldownRaw = String(attendanceForm.cooldown_str ?? "").trim();
    if (cooldownRaw !== "") {
      const cooldownTotal = parseDuration(cooldownRaw);
      payload.cooldown_sec = cooldownTotal;
    }
    parseFloatField("min_cosine_accept", attendanceForm.min_cosine_accept);
    if (Object.keys(payload).length === 0) return null;
    return { attendance: payload };
  }

  return null;
}

async function submitConfig(scope) {
  try {
    const payload = buildConfigPayload(scope);
    if (!payload) {
      toast.info(t("adminConfig.toast.noChanges", "Tidak ada perubahan untuk disimpan."));
      return;
    }
    savingConfig.value = true;
    await apiFetch("/config", { method: "PUT", body: payload });
    toast.success(t("adminConfig.toast.saved", "Konfigurasi disimpan."));
    await loadConfig();
  } catch (err) {
    console.error(err);
    toast.error(err?.message || t("adminConfig.error.generic", "Gagal menyimpan konfigurasi."));
  } finally {
    savingConfig.value = false;
  }
}

async function resetConfig(scope) {
  const label =
    scope === "face_engine"
      ? t("adminConfig.reset.scopeFace", "konfigurasi face engine")
      : scope === "attendance"
      ? t("adminConfig.reset.scopeAttendance", "konfigurasi attendance")
      : t("adminConfig.reset.scopeAll", "semua konfigurasi");
  const confirmed = await confirmDialog({
    title: t("adminConfig.reset.title", "Konfirmasi Reset"),
    description: t("adminConfig.reset.confirm", "Atur ulang {scope}?", { scope: label }),
    confirmText: t("adminConfig.reset.ok", "Atur ulang"),
    cancelText: t("common.cancel", "Batal"),
  });
  if (!confirmed) return;
  try {
    await apiFetch("/config/reset", { method: "POST", body: { scope } });
    toast.success(t("adminConfig.toast.reset", "Konfigurasi direset."));
    await loadConfig();
  } catch (err) {
    console.error(err);
    toast.error(err?.message || t("adminConfig.error.generic", "Gagal menyimpan konfigurasi."));
  }
}

onMounted(loadConfig);
</script>

<template>
  <div class="space-y-6" :key="locale">
    <!-- Status -->
    <Alert v-if="state.error" variant="destructive">
      <AlertTitle>{{ t("adminConfig.error.title", "Terjadi kesalahan") }}</AlertTitle>
      <AlertDescription>{{ state.error }}</AlertDescription>
    </Alert>

    <div v-if="state.loading" class="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
      {{ t("state.loading", "Memuat data config...") }}
    </div>

    <!-- Face Engine Section -->
    <Card v-if="!state.loading">
      <CardHeader class="flex sm:flex-row sm:justify-between">
        <div>
          <CardTitle>{{ t("adminConfig.sections.faceEngine.title", "Face Engine") }}</CardTitle>
          <CardDescription>
            {{ t("adminConfig.sections.faceEngine.subtitle", "Atur interval WS dan ambang deteksi YuNet.") }}
          </CardDescription>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" @click="resetConfig('face_engine')">
            {{ t("adminConfig.actions.resetFace", "Atur Ulang Face Engine") }}
          </Button>
          <Button variant="outline" size="sm" @click="resetConfig('attendance')">
            {{ t("adminConfig.actions.resetAttendance", "Atur Ulang Absensi") }}
          </Button>
          <Button variant="destructive" size="sm" @click="resetConfig('all')">
            {{ t("adminConfig.actions.resetAll", "Atur Ulang Semua") }}
          </Button>
        </div>
      </CardHeader>
      <Separator />
      <CardContent class="p-6 space-y-6">
        <form class="grid gap-4 sm:grid-cols-2" @submit.prevent="submitConfig('face_engine')">
          <div class="space-y-1">
            <Label class="text-xs font-semibold">{{
              t("adminConfig.fields.minCosine", "Ambang Cosine Minimum")
            }}</Label>
            <Input v-model="faceForm.min_cosine_accept" />
            <p class="text-[11px] text-muted-foreground">
              {{
                t("adminConfig.defaults.value", "Default: {value}", {
                  value: state.defaults.face_engine?.min_cosine_accept ?? "—",
                })
              }}
            </p>
          </div>

          <div class="space-y-1">
            <Label class="text-xs font-semibold">{{
              t("adminConfig.fields.funInterval", "Interval WS Fun (detik)")
            }}</Label>
            <Input v-model="faceForm.fun_ws_min_interval" />
            <p class="text-[11px] text-muted-foreground">
              {{
                t("adminConfig.defaults.value", "Default: {value}", {
                  value: state.defaults.face_engine?.fun_ws_min_interval ?? "—",
                })
              }}
            </p>
          </div>

          <div class="space-y-1">
            <Label class="text-xs font-semibold">{{
              t("adminConfig.fields.attInterval", "Interval WS Attendance (detik)")
            }}</Label>
            <Input v-model="faceForm.att_ws_min_interval" />
            <p class="text-[11px] text-muted-foreground">
              {{
                t("adminConfig.defaults.value", "Default: {value}", {
                  value: state.defaults.face_engine?.att_ws_min_interval ?? "—",
                })
              }}
            </p>
          </div>

          <div class="space-y-1">
            <Label class="text-xs font-semibold">{{
              t("adminConfig.fields.scoreThreshold", "Ambang Skor YuNet")
            }}</Label>
            <Input v-model="faceForm.yunet_score_threshold" />
            <p class="text-[11px] text-muted-foreground">
              {{
                t("adminConfig.defaults.value", "Default: {value}", {
                  value: state.defaults.face_engine?.yunet_score_threshold ?? "—",
                })
              }}
            </p>
          </div>

          <div class="space-y-1">
            <Label class="text-xs font-semibold">{{ t("adminConfig.fields.nmsThreshold", "Ambang NMS YuNet") }}</Label>
            <Input v-model="faceForm.yunet_nms_threshold" />
            <p class="text-[11px] text-muted-foreground">
              {{
                t("adminConfig.defaults.value", "Default: {value}", {
                  value: state.defaults.face_engine?.yunet_nms_threshold ?? "—",
                })
              }}
            </p>
          </div>

          <div class="space-y-1">
            <Label class="text-xs font-semibold">{{ t("adminConfig.fields.topK", "YuNet Top K") }}</Label>
            <Input v-model="faceForm.yunet_top_k" />
            <p class="text-[11px] text-muted-foreground">
              {{
                t("adminConfig.defaults.value", "Default: {value}", {
                  value: state.defaults.face_engine?.yunet_top_k ?? "—",
                })
              }}
            </p>
          </div>

          <div class="sm:col-span-2">
            <Button type="submit" :disabled="savingConfig">
              {{ t("adminConfig.actions.saveFace", "Simpan Face Engine") }}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>

    <!-- Attendance Section -->
    <Card v-if="!state.loading">
      <CardHeader>
        <CardTitle>{{ t("adminConfig.sections.attendance.title", "Absensi") }}</CardTitle>
      </CardHeader>
      <Separator />
      <CardContent class="p-6">
        <form class="grid gap-4 sm:grid-cols-2" @submit.prevent="submitConfig('attendance')">
          <div class="space-y-1">
            <Label class="text-xs font-semibold">{{ t("adminConfig.fields.cooldownSec", "Cooldown") }}</Label>
            <Input
              v-model="attendanceForm.cooldown_str"
              :placeholder="t('adminConfig.help.wsInterval', 'mm:ss atau detik')" />
            <p class="text-[11px] text-muted-foreground">
              {{
                t("adminConfig.defaults.value", "Default: {value}", {
                  value: state.defaults.attendance?.cooldown_sec ?? "—",
                })
              }}
            </p>
          </div>

          <!-- (Optional) Attendance Min Cosine, kalau mau tampilkan tinggal buka:
          <div class="space-y-1">
            <Label class="text-xs font-semibold">{{ t("adminConfig.fields.minCosine", "Min Cosine Accept (Attendance)") }}</Label>
            <Input v-model="attendanceForm.min_cosine_accept" />
            <p class="text-[11px] text-muted-foreground">
              {{ t("adminConfig.defaults.value", "Default: {value}", { value: state.defaults.attendance?.min_cosine_accept ?? "—" }) }}
            </p>
          </div>
          -->

          <div class="sm:col-span-2">
            <Button type="submit" :disabled="savingConfig">
              {{ t("adminConfig.actions.saveAttendance", "Simpan Absensi") }}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>

    <!-- JSON Modal -->
    <Dialog v-model:open="jsonModal.open">
      <DialogContent class="max-w-3xl" @open-auto-focus.prevent @close-auto-focus.prevent>
        <DialogHeader>
          <DialogTitle>{{ jsonModal.title }}</DialogTitle>
        </DialogHeader>
        <div class="max-h-[60vh] overflow-auto rounded-md bg-muted p-4">
          <pre class="text-xs leading-relaxed">{{ jsonModal.content }}</pre>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
