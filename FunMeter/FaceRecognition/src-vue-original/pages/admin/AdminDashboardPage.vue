<script setup>
import { computed, inject, onMounted, reactive, ref } from "vue";
import { toast } from "@/utils/toast";
import { apiFetch } from "@/utils/api";
import { useI18n } from "@/i18n";
import { useConfirmDialog } from "@/composables/useConfirmDialog";

// shadcn-vue UI
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
import { Badge } from "@/components/ui/badge";

const auth = inject("auth", null);
const { t, locale } = useI18n();
const confirmDialog = useConfirmDialog();
const ft = (path, fallback, values) => t(`adminDashboard.${path}`, fallback, values);

const state = reactive({
  loading: true,
  error: "",
  generatedAt: "",
  stats: { users: 0, labels: 0, attendance_events: 0 },
  modelSummary: {},
  currentUser: null,
});

const showApiKey = ref(false);
const copyingApiKey = ref(false);
const rotatingUser = ref("");
const jsonModal = reactive({ open: false, title: "", content: "" });

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

async function loadDashboard() {
  state.loading = true;
  state.error = "";
  try {
    const data = await apiFetch("/admin/dashboard-data", { method: "GET" });
    state.generatedAt = data?.generated_at || "";
    state.stats = data?.stats || { users: 0, labels: 0, attendance_events: 0 };
    state.modelSummary = data?.model_summary || {};
    state.currentUser = data?.current_user || null;
    if (auth?.state?.user && state.currentUser?.username === auth.state.user.username) {
      auth.state.user = { ...auth.state.user, api_key: state.currentUser.api_key };
    }
    if (!state.currentUser) showApiKey.value = false;
  } catch (err) {
    console.error(err);
    state.error =
      err?.status === 401 || err?.status === 403
        ? ft("error.unauthorized", "Masuk sebagai admin untuk membuka dashboard.")
        : err?.message || ft("error.generic", "Gagal memuat dashboard.");
  } finally {
    state.loading = false;
  }
}

async function withReload(action) {
  try {
    await action();
    await loadDashboard();
  } catch (err) {
    console.error(err);
    toast.error(err?.message || ft("error.generic", "Gagal memuat dashboard."));
  }
}

async function reloadModel() {
  await withReload(async () => {
    await apiFetch("/admin/actions/reload-model", { method: "POST", body: {} });
    toast.success(ft("toast.modelReloaded", "Model berhasil dimuat ulang."));
  });
}

async function reloadServer() {
  const confirmed = await confirmDialog({
    title: ft("confirm.reloadServerTitle", "Muat ulang server?"),
    description: ft("confirm.reloadServer", "Memuat ulang server akan menerapkan ulang konfigurasi. Lanjutkan?"),
    confirmText: ft("confirm.reloadAction", "Muat ulang"),
    cancelText: t("common.cancel", "Batal"),
  });
  if (!confirmed) return;
  await withReload(async () => {
    await apiFetch("/admin/actions/reload-server", { method: "POST", body: {} });
    toast.success(ft("toast.serverReloaded", "Server dimuat ulang."));
  });
}

async function rotateApiKey(user) {
  if (!user?.id) return;
  const confirmed = await confirmDialog({
    title: t("confirm.rotateKeyTitle", "Putar API key?"),
    description: t(
      "confirm.rotateKey",
      "Generate API key baru untuk akun kamu? Kamu harus memperbarui token header setelah ini."
    ),
    confirmText: t("confirm.rotateAction", "Generate"),
    cancelText: t("common.cancel", "Batal"),
  });
  if (!confirmed) return;
  rotatingUser.value = user.username;
  try {
    const data = await apiFetch(`/admin/users/${encodeURIComponent(user.id)}/api-key`, {
      method: "POST",
      body: {},
    });
    toast.success(ft("toast.apiKeyRotated", "API key diperbarui."));
    await loadDashboard();
    if (auth?.state?.user) {
      auth.state.user = { ...auth.state.user, api_key: data?.user?.api_key || "" };
      try {
        localStorage.setItem("api_key", data?.user?.api_key || "");
      } catch {}
    }
  } catch (err) {
    console.error(err);
    toast.error(err?.message || ft("error.rotateKey", "Gagal memutar API key."));
  } finally {
    rotatingUser.value = "";
  }
}

const quickStats = computed(() => [
  {
    label: ft("stats.users.label", "Pengguna"),
    value: state.stats.users,
    caption: ft("stats.users.caption", "Akun terdaftar"),
  },
  {
    label: ft("stats.faces.label", "Wajah Terdaftar"),
    value: state.stats.labels,
    caption: ft("stats.faces.caption", "Embedding di memori"),
  },
  {
    label: ft("stats.attendance.label", "Catatan Absensi"),
    value: state.stats.attendance_events,
    caption: ft("stats.attendance.caption", "Total entri log"),
  },
]);

const currentApiKey = computed(() => state.currentUser?.api_key || "");
const maskedApiKey = computed(() => {
  const key = currentApiKey.value;
  if (!key) return ft("apiKey.empty", "Belum ada API key");
  if (showApiKey.value) return key;
  if (key.length <= 4) return "•".repeat(Math.max(4, key.length));
  const visibleTail = key.slice(-4);
  return `${"•".repeat(Math.max(4, key.length - 4))}${visibleTail}`;
});

function toggleApiKeyVisibility() {
  showApiKey.value = !showApiKey.value;
}

async function copyCurrentApiKey() {
  const key = currentApiKey.value;
  if (!key) {
    toast.error(ft("apiKey.notAvailable", "API key tidak tersedia."));
    return;
  }
  copyingApiKey.value = true;
  try {
    await navigator.clipboard.writeText(key);
    toast.success(ft("apiKey.copied", "API key disalin ke clipboard."));
  } catch (err) {
    console.error(err);
    toast.error(ft("apiKey.copyError", "Gagal menyalin API key."));
  } finally {
    copyingApiKey.value = false;
  }
}

onMounted(loadDashboard);
</script>

<template>
  <div class="space-y-6" :key="locale">
    <!-- Loading -->
    <Card v-if="state.loading">
      <CardContent class="py-12 text-center text-sm text-muted-foreground">
        {{ ft("state.loading", "Memuat dashboard…") }}
      </CardContent>
    </Card>

    <!-- Error -->
    <Alert v-else-if="state.error" variant="destructive" class="border-rose-300/60">
      <AlertTitle>{{ ft("error.title", "Terjadi kesalahan") }}</AlertTitle>
      <AlertDescription>{{ state.error }}</AlertDescription>
    </Alert>

    <!-- Content -->
    <template v-else>
      <!-- Header / Actions -->
      <div>
        <p class="text-xs tracking-widest text-muted-foreground uppercase">
          {{ ft("breadcrumb", "Konsol Admin") }}
        </p>
        <div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle class="text-2xl">
              {{
                ft("greeting", "Halo, {name}", {
                  name: state.currentUser?.username || ft("fallbackName", "Admin"),
                })
              }}
            </CardTitle>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button variant="outline" @click="reloadModel">
              <i class="ti ti-rotate-2 mr-2"></i>{{ ft("actions.reloadModel", "Muat Ulang Model") }}
            </Button>
            <Button @click="reloadServer">
              <i class="ti ti-rocket mr-2"></i>{{ ft("actions.reloadServer", "Muat Ulang Server") }}
            </Button>
          </div>
        </div>
      </div>
      <!-- Quick stats -->
      <div class="grid gap-4 sm:grid-cols-3">
        <Card v-for="card in quickStats" :key="card.label">
          <CardContent class="p-4">
            <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {{ card.label }}
            </p>
            <p class="mt-2 text-3xl font-semibold">{{ card.value }}</p>
            <p class="text-xs text-muted-foreground">{{ card.caption }}</p>
          </CardContent>
        </Card>
      </div>

      <!-- API Key -->
      <Card v-if="state.currentUser">
        <CardHeader class="pb-2">
          <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {{ ft("apiKey.title", "API Key Kamu") }}
          </p>
          <CardTitle class="text-base">{{ ft("apiKey.subtitle", "Kredensial pribadi") }}</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div class="space-y-2 w-full sm:w-auto">
            <Label class="sr-only">API Key</Label>
            <div class="flex flex-wrap sm:flex-nowrap gap-2">
              <Input :value="maskedApiKey" readonly class="font-mono font-semibold tracking-wide" />
              <Button variant="outline" size="sm" @click="toggleApiKeyVisibility">
                {{ showApiKey ? ft("apiKey.hide", "Sembunyikan") : ft("apiKey.show", "Tampilkan") }}
              </Button>
             <Button variant="outline" size="sm" :disabled="copyingApiKey" @click="copyCurrentApiKey">
                {{ copyingApiKey ? ft("apiKey.copying", "Menyalin…") : ft("apiKey.copy", "Salin API Key") }}
              </Button>
              <Button
                size="sm"
                :disabled="rotatingUser === state.currentUser?.username"
                @click="rotateApiKey(state.currentUser)">
                {{
                  rotatingUser === state.currentUser?.username
                    ? ft("actions.processing", "Memproses…")
                    : ft("actions.rotateKey", "Putar API Key")
                }}
              </Button>
            </div>
            <p class="text-[11px] text-muted-foreground">
              {{ ft("apiKey.hint", "Kirim lewat header token: Bearer <API_KEY>") }}
            </p>
          </div>
        </CardContent>
      </Card>

      <!-- Model Summary -->
      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0">
          <CardTitle class="text-lg">{{ ft("model.title", "Model Aktif") }}</CardTitle>

        </CardHeader>
        <Separator />

        <CardContent class="space-y-6 text-sm p-6">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {{ ft("model.backendLabel", "Backend") }}
            </p>
            <p class="font-semibold uppercase">
              {{ state.modelSummary.backend || ft("model.unknown", "tidak diketahui") }}
            </p>
            <p class="text-xs text-muted-foreground">
              {{
                ft("model.backendMeta", "ID backend {backendId} • target {targetId}", {
                  backendId: state.modelSummary.backend_id ?? "—",
                  targetId: state.modelSummary.target_id ?? "—",
                })
              }}
            </p>
          </div>

          <Separator />

          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {{ ft("model.emotionLabel", "Model Emosi") }}
            </p>
            <p class="font-semibold">
              {{ state.modelSummary.emotion_model || ft("model.none", "Tidak ada") }}
            </p>
            <p class="text-xs text-muted-foreground">
              {{
                ft("model.emotionCount", "Label: {count}", {
                  count: (state.modelSummary.emotion_labels || []).length,
                })
              }}
            </p>
            <!-- Chip list (kayak Registered Labels) -->
            <div class="mt-2 flex flex-wrap gap-2">
              <Badge
                variant="default"
                v-for="lbl in state.modelSummary.emotion_labels || []"
                :key="lbl"
                >
                {{ lbl }}
              </Badge>
              <Badge variant="default" v-if="!(state.modelSummary.emotion_labels || []).length">
                {{ ft("model.noEmotionLabels", "Tidak ada label emosi") }}
              </Badge>
            </div>
          </div>

          <Separator />

          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {{ ft("model.registeredLabels", "Label Terdaftar") }}
            </p>
            <div class="mt-2 flex flex-wrap gap-2">
              <Badge
              variant="default" 
                v-for="label in state.modelSummary.labels || []"
                :key="label">
                {{ label }}
              </Badge>
              <Badge 
              variant="default" v-if="!(state.modelSummary.labels || []).length">
                {{ ft("model.noLabels", "Tidak ada label") }}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </template>

    <!-- JSON Modal -->
    <Dialog v-model:open="jsonModal.open">
      <DialogContent class="max-w-3xl" @open-auto-focus.prevent @close-auto-focus.prevent>
        <DialogHeader>
          <DialogTitle>{{ jsonModal.title }}</DialogTitle>
          <DialogDescription>{{ ft("model.jsonHint", "Dump konfigurasi mentah untuk debugging") }}</DialogDescription>
        </DialogHeader>
        <div class="max-h-[60vh] overflow-auto rounded-md bg-muted p-4">
          <pre class="text-xs leading-relaxed">{{ jsonModal.content }}</pre>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="closeJsonModal">{{ ft("common.close", "Tutup") }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
