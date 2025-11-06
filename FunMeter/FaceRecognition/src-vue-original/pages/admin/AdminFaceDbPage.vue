<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, inject, watch, nextTick } from "vue";
import { toast } from "@/utils/toast";
// Inline camera capture is implemented directly here (no nested modal)
import { fmtAttendanceWIB, normalizeISOToWIB } from "@/utils/format";
import { apiFetchJSON, resolveApi, api } from "@/utils/api";
import { useI18n } from "@/i18n";
import { useConfirmDialog } from "@/composables/useConfirmDialog";

const $config = inject("config");
const auth = inject("auth", null);
const { t } = useI18n();
const ft = (path, fallback, values) => t(`adminFaceDb.${path}`, fallback, values);
const confirmDialog = useConfirmDialog();

// shadcn-vue
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
} from "@/components/ui/pagination";
import {
  Combobox,
  ComboboxAnchor,
  ComboboxTrigger,
  ComboboxList,
  ComboboxInput,
  ComboboxItem,
  ComboboxViewport,
  ComboboxEmpty,
} from "@/components/ui/combobox";

const UPLOAD_CONCURRENCY = 1;
const UPLOAD_GAP_MS = 400;
const BULK_IMAGE_RE = /\.(jpe?g|png|webp|bmp|gif)$/i;

// Search via combobox (match AdminAttendancePage UX)
const searchOpen = ref(false);
const searchQuery = ref("");
const peopleOptions = ref([]); // list of labels (strings)
const peopleLoading = ref(false);
const peopleLoaded = ref(false);
const peopleError = ref("");

function commitSearchQuery() {
  const s = (searchQuery?.value || "").trim();
  if (!s) return;
  state.filters.q = s;
  searchOpen.value = false;
  loadData(1);
}

const filteredPeopleForSearch = computed(() => {
  const qstr = (searchQuery?.value || "").trim().toLowerCase();
  const base = (peopleOptions.value || []).map((p) => String(p));
  if (!qstr) return base.slice(0, 50);
  return base
    .filter((label) =>
      String(label || "")
        .toLowerCase()
        .includes(qstr)
    )
    .slice(0, 50);
});

async function ensurePeopleOptions(force = false) {
  if ((peopleLoaded.value && !force) || peopleLoading.value) return;
  peopleLoading.value = true;
  peopleError.value = "";
  try {
    const resp = await apiFetchJSON("/register-db-data", {
      method: "GET",
      query: { page: 1, per_page: "all", order: "asc" },
    });
    const items = Array.isArray(resp?.items) ? resp.items : [];
    const labels = items.map((it) => String(it?.label ?? "").trim()).filter(Boolean);
    const seen = new Set();
    const unique = labels.filter((x) => (seen.has(x.toLowerCase()) ? false : (seen.add(x.toLowerCase()), true)));
    unique.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    peopleOptions.value = unique;
    peopleLoaded.value = true;
  } catch (err) {
    console.error(err);
    peopleError.value = err?.message || ft("error.loadPeople", "Gagal memuat daftar wajah.");
  } finally {
    peopleLoading.value = false;
  }
}

let jszipLoader = null;

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

function inferMimeType(filename) {
  const match = filename?.toLowerCase().match(/\.[^.]+$/);
  return (match && MIME_BY_EXT[match[0]]) || "image/jpeg";
}

async function getJsZip() {
  if (!jszipLoader) {
    jszipLoader = import("jszip").then((mod) => mod.default || mod);
  }
  return jszipLoader;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateEmbedding(arr, maxShow = 6) {
  if (!Array.isArray(arr)) return "-";
  const dim = arr.length;
  const head = arr
    .slice(0, maxShow)
    .map((v) => Number(v).toFixed(6))
    .join(", ");
  return dim <= maxShow ? `[${head}]` : `[${head}, (${dim}d)]`;
}

function num(n, d = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(d) : "-";
}

function apiUrl(path = "") {
  return resolveApi(String(path).replace(/^\/+/, ""), $config?.HTTP_API);
}

function photoUrlFrom(path) {
  if (!path) return "";
  let p = String(path).replace(/\\/g, "/");
  if (/^https?:\/\//i.test(p)) return p;
  p = p.replace(/^\/+/, "");
  return apiUrl(p);
}

function idKey(val) {
  if (val == null) return "";
  return String(val);
}

const state = reactive({
  currentUser: null,
  isAdmin: false,
  statusText: "",
  filters: {
    perPage: "10",
    order: "desc",
    q: "",
  },
  page: 1,
  meta: { page: 1, total_pages: 1, has_prev: false, has_next: false, total: 0 },
  items: [],
  loading: false,

  // Modals
  photoModal: { open: false, url: "", label: "" },
  bulkModal: false,
  uploadModal: {
    open: false,
    id: null,
    label: "",
    busy: false,
    prevUrl: "",
    file: null,
    previewUrl: "",
    previewLoading: false,
    previewError: "",
  },
  inlineCam: { open: false, error: "", ready: false },

  // Bulk upload
  bulkForce: false,
  bulkItems: [],
  bulkRunning: false,
  bulkProgress: { done: 0, total: 0 },

  // Inline edit
  editInline: { id: null, value: "", busy: false },
});

const selectedIds = ref(new Set());
const selectedCount = computed(() => selectedIds.value.size);
const allSelected = computed(() => state.items.length > 0 && selectedIds.value.size === state.items.length);
const someSelected = computed(() => selectedIds.value.size > 0 && selectedIds.value.size < state.items.length);

const authUser = computed(() => auth?.state?.user || null);
let authReady = false;

watch(
  authUser,
  (user, prev) => {
    state.currentUser = user || null;
    state.isAdmin = !!user?.is_admin;
    if (!authReady) {
      authReady = true;
      loadData(1);
      return;
    }
    if (user !== prev) loadData(1);
  },
  { immediate: true }
);

// Keep data in sync when page changes via shadcn pagination
watch(
  () => state.page,
  (p, prev) => {
    if (p !== prev) loadData(p);
  }
);

const displayedRows = computed(() =>
  (state.items || []).map((item) => {
    const emb = item.embedding || [];
    const embView = truncateEmbedding(emb, 3);
    const embFull = Array.isArray(emb) ? emb.map((v) => Number(v).toFixed(9)).join(", ") : "";
    const tsRaw = item.ts || item.time || item.timestamp || item.created_at || item.date || null;
    const key = idKey(item.id);
    const rawPersonId = String(
      item.person_id ?? item.personId ?? item.personID ?? ""
    ).trim();
    const personIdDisplay = rawPersonId || key;
    return {
      ...item,
      idKey: key,
      personIdDisplay,
      personId: rawPersonId,
      embeddingView: embView,
      embeddingFull: embFull,
      tsWib: fmtAttendanceWIB(tsRaw),
      tsTitle: normalizeISOToWIB(tsRaw) || "",
      x: num(item.x),
      y: num(item.y),
      width: num(item.width),
      height: num(item.height),
      photoUrl: photoUrlFrom(item.photo_url || item.photoPath || item.photo_path || item.path || ""),
      checked: selectedIds.value.has(key),
      editing: state.editInline.id === item.id,
      editValue: state.editInline.id === item.id ? state.editInline.value : item.label,
    };
  })
);

function updateSelected(fn) {
  const next = new Set(selectedIds.value);
  fn(next);
  selectedIds.value = next;
}
function clearSelection() {
  updateSelected((set) => set.clear());
}

function onHeaderModelChange(checked) {
  if (checked) {
    updateSelected((set) => {
      set.clear();
      state.items.forEach((it) => set.add(idKey(it.id)));
    });
  } else {
    updateSelected((set) => set.clear());
  }
}

// tri-state untuk header checkbox
const headerModel = computed(() => (allSelected.value ? true : someSelected.value ? null : false));
function setHeaderModel(v) {
  // true/null -> pilih semua, false -> kosongkan
  if (v) onHeaderModelChange(true);
  else onHeaderModelChange(false);
}

async function checkAuth() {
  if (auth?.refresh) {
    await auth.refresh();
    state.currentUser = auth?.state?.user || null;
    state.isAdmin = !!state.currentUser?.is_admin;
    return;
  }
  try {
    const data = await apiFetchJSON("auth/me");
    state.currentUser = data.user || null;
    state.isAdmin = !!state.currentUser?.is_admin;
  } catch {
    state.currentUser = null;
    state.isAdmin = false;
  }
}

function tsMs(val) {
  if (val == null) return NaN;
  if (val instanceof Date) return val.getTime();
  if (typeof val === "number") return val > 1e12 ? val : val * 1000;
  if (typeof val === "string") {
    const s = val.trim();
    if (/^\d{10,13}$/.test(s)) {
      const n = Number(s);
      return n > 1e12 ? n : n * 1000;
    }
    let t = Date.parse(s);
    if (Number.isFinite(t)) return t;
    t = Date.parse(s.replace(" ", "T"));
    if (Number.isFinite(t)) return t;
  }
  return NaN;
}

async function loadData(page = state.page) {
  const maxPage = state.meta?.total_pages || 1;
  page = Math.max(1, Math.min(page, maxPage));
  state.loading = true;
  state.statusText = ft("state.loading", "Memuat…");
  try {
    const url = new URL(apiUrl("register-db-data"));
    url.searchParams.set("page", page);
    url.searchParams.set("per_page", state.filters.perPage);
    url.searchParams.set("order", state.filters.order);
    if (state.filters.q.trim()) url.searchParams.set("q", state.filters.q.trim());

    const data = await apiFetchJSON(url.toString(), { method: "GET" });

    const items = (data.items || []).slice();
    const order = state.filters.order || "desc";
    items.sort((a, b) => {
      const pick = (o) => o?.ts ?? o?.time ?? o?.timestamp ?? o?.created_at ?? o?.date;
      let ta = tsMs(pick(a));
      let tb = tsMs(pick(b));
      if (!Number.isFinite(ta)) ta = order === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      if (!Number.isFinite(tb)) tb = order === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      if (ta === tb) return (Number(a.id) || 0) - (Number(b.id) || 0);
      return order === "asc" ? ta - tb : tb - ta;
    });

    state.items = items;
    state.meta = data.meta || {
      page,
      total_pages: 1,
      has_prev: false,
      has_next: false,
      total: state.items.length,
      per_page: state.filters.perPage,
      order: state.filters.order,
    };
    state.page = state.meta.page;
    state.statusText = "";
    state.filters.perPage = state.meta.per_page || state.filters.perPage;
    state.filters.order = state.meta.order || state.filters.order;
    cancelInlineEdit();
    clearSelection();
  } catch (err) {
    const status = err?.status || /\bHTTP\s+(\d{3})/.exec(err?.message || "")?.[1] | 0;
    if (Number(status) === 401) {
      state.statusText = ft("state.loginRequired", "Butuh login.");
      state.items = [];
      state.meta = { page: 1, total_pages: 1, has_prev: false, has_next: false, total: 0 };
      state.currentUser = null;
      state.isAdmin = false;
      auth?.openModal?.("login");
      return;
    }
    if (Number(status) === 403) {
      state.statusText = ft("state.adminRequired", "Harus admin untuk melihat Register DB.");
      state.items = [];
      state.meta = { page: 1, total_pages: 1, has_prev: false, has_next: false, total: 0 };
      return;
    }
    state.statusText = ft("state.error", "Terjadi kesalahan.");
    state.items = [];
    state.meta = { page: 1, total_pages: 1, has_prev: false, has_next: false, total: 0 };
    toast.error(ft("error.fetch", "Gagal memuat Register DB."));
  } finally {
    state.loading = false;
  }
}

function toggleSelectAll() {
  // kalau lagi partial ATAU belum semua kepilih → pilih semua; kalau sudah semua → kosongkan
  if (someSelected.value || !allSelected.value) {
    updateSelected((set) => {
      set.clear();
      state.items.forEach((item) => set.add(idKey(item.id)));
    });
  } else {
    updateSelected((set) => set.clear());
  }
}

function toggleRowSelection(id, checked) {
  updateSelected((set) => {
    const key = idKey(id);
    if (checked) set.add(key);
    else set.delete(key);
  });
}

function openPhotoModal(url, label) {
  state.photoModal.open = true;
  state.photoModal.url = url;
  state.photoModal.label = label;
}
function closePhotoModal() {
  state.photoModal.open = false;
  state.photoModal.url = "";
  state.photoModal.label = "";
}

function startInlineEdit(row) {
  if (!state.isAdmin) return toast.error(ft("error.adminInactive", "Admin mode belum aktif"));
  state.editInline.id = row.id;
  state.editInline.value = row.label || "";
}
function cancelInlineEdit() {
  state.editInline.id = null;
  state.editInline.value = "";
}
async function saveInlineEdit(row) {
  if (!state.isAdmin) return toast.error(ft("error.adminInactive", "Admin mode belum aktif"));
  const value = (state.editInline.value || "").trim();
  if (!value) return toast.error(ft("error.labelEmpty", "Label kosong"));
  try {
    state.editInline.busy = true;
    await apiFetchJSON(`admin/register-db/item/${row.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: value, move_photo: true, reembed: true }),
    });
    toast.success(ft("toast.labelUpdated", "Label diperbarui"));
    cancelInlineEdit();
    loadData(state.page);
  } catch (err) {
    toast.error(err.message || String(err));
  } finally {
    state.editInline.busy = false;
  }
}

// ===== Replace Photo (improved UI)
function openUploadModal(row) {
  if (!state.isAdmin) return toast.error(ft("error.adminInactive", "Admin mode belum aktif"));
  state.uploadModal.open = true;
  state.uploadModal.id = row.id;
  state.uploadModal.label = row.label || `ID ${row.personIdDisplay}`;
  state.uploadModal.prevUrl = row.photoUrl || "";
  // reset selection
  try {
    const prev = state.uploadModal.previewUrl;
    if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
  } catch {}
  state.uploadModal.file = null;
  state.uploadModal.previewUrl = "";
  state.uploadModal.previewLoading = false;
  state.uploadModal.previewError = "";
}
function closeUploadModal() {
  state.uploadModal.open = false;
  state.uploadModal.id = null;
  state.uploadModal.label = "";
  if (state.inlineCam.open) stopInlineCamera();
  try {
    const prev = state.uploadModal.previewUrl;
    if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
  } catch {}
  state.uploadModal.file = null;
  state.uploadModal.previewUrl = "";
  state.uploadModal.previewLoading = false;
  state.uploadModal.previewError = "";
}
const fileInputEl = ref(null);
const camVideoRef = ref(null);
let camStream = null;
function pickReplaceFile() {
  if (fileInputEl.value?.$el) fileInputEl.value.$el.value = "";
  // shadcn Input wraps native; fallback to query
  const input = document.getElementById("adm-replace-file");
  if (input) input.value = "";
  document.getElementById("adm-replace-file")?.click?.();
}
async function setUploadFile(file) {
  try {
    const prev = state.uploadModal.previewUrl;
    if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
  } catch {}
  state.uploadModal.previewError = "";
  state.uploadModal.previewUrl = "";
  state.uploadModal.file = null;
  if (!file) return;
  state.uploadModal.previewLoading = true;
  state.uploadModal.file = file || null;
  try {
    const fd = new FormData();
    fd.append("file", file, file.name || "upload.jpg");
    const resp = await apiFetchJSON("/register-face/preview", {
      method: "POST",
      body: fd,
    });
    state.uploadModal.previewUrl = resp.preview || URL.createObjectURL(file);
  } catch (err) {
    state.uploadModal.file = null;
    state.uploadModal.previewUrl = "";
    const message = err?.data?.message || err?.message || ft("modal.previewFailed", "Gagal membuat preview wajah.");
    state.uploadModal.previewError = message;
    toast.error(message);
  } finally {
    state.uploadModal.previewLoading = false;
  }
}
async function onReplaceFileChange(e) {
  const f = e?.target?.files?.[0];
  if (f) await setUploadFile(f);
}
async function onDropReplace(e) {
  e.preventDefault();
  if (state.inlineCam.open) return; // ignore when camera active
  const f = e.dataTransfer?.files?.[0];
  if (f) await setUploadFile(f);
}
function preventDefault(e) {
  e.preventDefault();
}
async function openInlineCamera() {
  try {
    state.inlineCam.error = "";
    state.inlineCam.open = true;
    await nextTick();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 } },
      audio: false,
    });
    camStream = stream;
    const v = camVideoRef.value;
    if (v) {
      v.srcObject = stream;
      await new Promise((resolve) => {
        v.onloadedmetadata = () => resolve();
      });
      await v.play();
      state.inlineCam.ready = true;
    }
  } catch (e) {
    state.inlineCam.open = false;
    state.inlineCam.error = (e && e.message) || "Kamera tidak bisa dibuka";
    toast.error(state.inlineCam.error);
  }
}
function stopInlineCamera() {
  try {
    const tracks = camStream?.getTracks?.() || [];
    tracks.forEach((t) => t.stop());
  } catch {}
  camStream = null;
  const v = camVideoRef.value;
  if (v) v.srcObject = null;
  state.inlineCam.open = false;
  state.inlineCam.ready = false;
}
async function captureInlineCamera() {
  const v = camVideoRef.value;
  if (!v || !v.videoWidth || !v.videoHeight) return;
  const cw = v.videoWidth;
  const ch = v.videoHeight;
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(v, 0, 0, cw, ch);
  const blob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.95)
  );
  if (blob) {
    const file = new File([blob], "capture.jpg", { type: blob.type || "image/jpeg" });
    await setUploadFile(file);
  }
  stopInlineCamera();
}
const canSubmitReplace = computed(() => !!state.uploadModal.file && !state.uploadModal.busy);
async function submitReplace() {
  if (!state.isAdmin) return toast.error(ft("error.adminInactive", "Admin mode belum aktif"));
  if (!state.uploadModal.file) return toast.info(ft("table.photo.pickFirst", "Pilih foto baru terlebih dulu."));
  await onUploadSubmit(state.uploadModal.file);
}

async function deleteRow(row, deletePhoto = true) {
  if (!state.isAdmin) return toast.error(ft("error.adminInactive", "Admin mode belum aktif"));
  const confirmed = await confirmDialog({
    title: ft("confirm.deleteRowTitle", "Hapus data wajah?"),
    description: ft("confirm.deleteRow", "Hapus {target}?", { target: row.label || row.personIdDisplay }),
    confirmText: t("common.delete", "Hapus"),
    cancelText: t("common.cancel", "Batal"),
  });
  if (!confirmed) return;
  try {
    await apiFetchJSON(`/admin/register-db/item/${row.id}?delete_photo=${deletePhoto ? 1 : 0}`, { method: "DELETE" });
    toast.success(ft("toast.deleteSuccess", "Terhapus"));
    loadData(state.page);
  } catch (err) {
    toast.error(err.message || String(err));
  }
}

async function onUploadSubmit(blob) {
  if (!state.isAdmin) return toast.error(ft("error.adminInactive", "Admin mode belum aktif"));
  if (!blob) return toast.info(ft("info.selectImage", "Pilih gambar atau ambil foto"));
  try {
    state.uploadModal.busy = true;
    const submitOnce = async (forced = false) => {
      const fd = new FormData();
      fd.append("file", blob, "upload.jpg");
      if (forced) fd.append("force", "1");
      return await apiFetchJSON(`/admin/register-db/upload-photo/${state.uploadModal.id}`, {
        method: "POST",
        body: fd,
      });
    };

    try {
      await submitOnce(false);
      toast.success(ft("toast.photoReplaced", "Foto diganti"));
      closeUploadModal();
      loadData(state.page);
    } catch (err) {
      // Jika backend menolak (duplikat 409), tawarkan force
      const msg = err?.data?.message || err?.message || "";
      if (err?.status === 409) {
        const ask = await confirmDialog({
          title: ft("confirm.forceReplaceTitle", "Ganti paksa foto?"),
          description: msg || ft("confirm.forceReplace", "Foto terdeteksi mirip. Ganti paksa foto ini?"),
          confirmText: ft("confirm.forceReplaceAction", "Ganti"),
          cancelText: t("common.cancel", "Batal"),
        });
        if (!ask) throw err;
        await submitOnce(true);
        toast.success(ft("toast.photoReplaced", "Foto diganti"));
        closeUploadModal();
        loadData(state.page);
      } else {
        throw err;
      }
    }
  } catch (err) {
    toast.error(err?.message || String(err));
  } finally {
    state.uploadModal.busy = false;
  }
}

async function bulkAction(action) {
  if (!state.isAdmin) return toast.error(ft("error.adminInactive", "Admin mode belum aktif"));
  const ids = Array.from(selectedIds.value);
  if (!ids.length) return toast.info(ft("info.noSelection", "Tidak ada item yang dipilih"));
  try {
    if (action === "delete") {
      const confirmed = await confirmDialog({
        title: ft("confirm.deleteBulkTitle", "Hapus data terpilih?"),
        description: ft("confirm.deleteBulk", "Hapus {count} item?", { count: ids.length }),
        confirmText: t("common.delete", "Hapus"),
        cancelText: t("common.cancel", "Batal"),
      });
      if (!confirmed) return;
      await apiFetchJSON("/admin/register-db/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", ids: ids.map((x) => Number(x)), delete_photo: true }),
      });
      toast.success(ft("toast.deleteSuccess", "Terhapus"));
      clearSelection();
    } else if (action === "export") {
      const response = await api.request({
        url: resolveApi("/admin/register-db/bulk"),
        method: "POST",
        data: { action: "export", ids: ids.map((x) => Number(x)) },
        responseType: "blob",
      });
      const blob = response.data;
      if (!blob || blob.size === 0) return toast.warn(ft("warn.exportEmpty", "Tidak ada foto yang bisa diekspor."));
      const disposition = response.headers?.["content-disposition"] || "";
      const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
      const filename = match ? match[1] : `register_export_${Date.now()}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.success(ft("toast.exportDone", "Export selesai."));
    }
    loadData(state.page);
  } catch (err) {
    toast.error(err.message || String(err));
  }
}

function revokePreview(item) {
  if (item?.previewUrl) {
    URL.revokeObjectURL(item.previewUrl);
    item.previewUrl = "";
  }
}
function openBulkModal() {
  if (!state.isAdmin) return toast.error(ft("error.adminInactive", "Admin mode belum aktif"));
  state.bulkModal = true;
  state.bulkItems = [];
  state.bulkForce = false;
  state.bulkProgress = { done: 0, total: 0 };
}
function closeBulkModal() {
  state.bulkModal = false;
  state.bulkItems.forEach(revokePreview);
  state.bulkItems = [];
  state.bulkForce = false;
  state.bulkProgress = { done: 0, total: 0 };
}
function clearBulkItems() {
  state.bulkItems.forEach(revokePreview);
  state.bulkItems = [];
  state.bulkProgress = { done: 0, total: 0 };
}
function createBulkItem(file, labelOverride) {
  const id = Date.now() + Math.floor(Math.random() * 100000);
  const previewUrl = URL.createObjectURL(file);
  return {
    id,
    file,
    name: file.name,
    label: (labelOverride ?? file.name).replace(/\.[^.]+$/, ""),
    status: "ready",
    message: ft("bulk.statusLabel.default_message", "Siap diunggah"),
    previewUrl,
  };
}
function addBulkItem(file, labelOverride) {
  const item = createBulkItem(file, labelOverride);
  state.bulkItems.push(item);
  return item;
}

const paginationSummary = computed(() => {
  const meta = state.meta || {};
  const totalPages = Math.max(1, Number(meta.total_pages) || 1);
  const current = Math.min(Math.max(1, Number(meta.page) || 1), totalPages);
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
  const sortedPages = Array.from(pagesSet).sort((a, b) => a - b);
  const items = [];
  let previous = 0;
  sortedPages.forEach((page) => {
    if (previous && page - previous > 1) items.push({ type: "gap", key: `gap-${previous}-${page}` });
    items.push({ type: "page", page, active: page === current, key: `page-${page}` });
    previous = page;
  });
  return items;
});

async function importZipArchive(file) {
  try {
    const JSZip = await getJsZip();
    const zip = await JSZip.loadAsync(file);
    const entries = [];
    zip.forEach((relativePath, entry) => {
      if (!entry.dir && BULK_IMAGE_RE.test(entry.name)) entries.push(entry);
    });
    if (!entries.length)
      return toast.warn(ft("warn.zipNoImages", "ZIP {name} tidak berisi gambar yang valid.", { name: file.name }));

    let added = 0;
    for (const entry of entries) {
      try {
        const blob = await entry.async("blob");
        const baseName = entry.name.split("/").pop() || `face_${Date.now()}`;
        const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const type = blob.type || inferMimeType(safeName);
        const imageFile = new File([blob], safeName, { type });
        const addedItem = addBulkItem(imageFile, safeName);
        if (addedItem) addedItem.message = ft("bulk.messages.fromZip", "Dari {name}", { name: file.name });
        added++;
      } catch (err) {
        console.error("Cannot extract entry from zip:", err);
      }
    }
    if (added)
      toast.success(ft("toast.zipAdded", "ZIP {name} ditambahkan ({count} foto).", { name: file.name, count: added }));
    else toast.warn(ft("warn.zipNone", "Tidak ada foto yang berhasil diambil dari {name}.", { name: file.name }));
  } catch (err) {
    console.error("Failed to read zip:", err);
    toast.error(ft("error.zipFailed", "Gagal membaca ZIP {name}.", { name: file.name }));
  }
}

async function handleBulkFiles(files) {
  const arr = Array.from(files || []);
  if (!arr.length) return;
  for (const file of arr) {
    const nameLower = (file.name || "").toLowerCase();
    if (nameLower.endsWith(".zip")) {
      await importZipArchive(file);
      continue;
    }
    if (file.type.startsWith("image/") || BULK_IMAGE_RE.test(nameLower)) {
      addBulkItem(file);
    } else {
      toast.warn(ft("warn.fileIgnored", "{name} diabaikan (format tidak didukung).", { name: file.name }));
    }
  }
  state.bulkProgress = { done: 0, total: state.bulkItems.length };
}
async function onBulkFileInput(event) {
  await handleBulkFiles(event?.target?.files);
  if (event?.target) event.target.value = "";
}
function removeBulkItem(item) {
  revokePreview(item);
  state.bulkItems = state.bulkItems.filter((it) => it.id !== item.id);
  state.bulkProgress = { done: 0, total: state.bulkItems.length };
}

async function runInBatches(tasks, concurrency = UPLOAD_CONCURRENCY, gapMs = UPLOAD_GAP_MS) {
  let i = 0;
  let running = 0;
  let finished = 0;
  return await new Promise((resolve) => {
    const launch = () => {
      while (running < concurrency && i < tasks.length) {
        const fn = tasks[i++];
        running++;
        Promise.resolve()
          .then(fn)
          .finally(async () => {
            running--;
            finished++;
            state.bulkProgress = { done: finished, total: tasks.length };
            if (finished === tasks.length) resolve();
            else {
              if (gapMs > 0) await sleep(gapMs);
              launch();
            }
          });
      }
    };
    launch();
  });
}

async function startBulkUpload() {
  if (!state.isAdmin) return toast.error(ft("error.adminInactive", "Admin mode belum aktif"));
  if (!state.bulkItems.length) return;
  state.bulkRunning = true;
  state.bulkProgress = { done: 0, total: state.bulkItems.length };
  const tasks = state.bulkItems.map((item) => async () => {
    const label = (item.label || "").trim();
    if (!label) {
      item.status = "skip";
      item.message = ft("bulk.messages.labelEmpty", "Label kosong, dilewati.");
      return;
    }
    item.status = "uploading";
    item.message = ft("bulk.messages.uploading", "Mengunggah...");
    try {
      const fd = new FormData();
      fd.append("label", label);
      fd.append("file", item.file);
      fd.append("force", state.bulkForce ? "1" : "0");
      const result = await apiFetchJSON("/register-face", { method: "POST", body: fd });
      item.status = "ok";
      item.message = result?.label
        ? ft("bulk.messages.registeredAs", "Terdaftar sebagai {label}.", { label: result.label })
        : ft("bulk.messages.uploaded", "Berhasil diunggah.");
      if (result?.label) item.label = result.label;
    } catch (err) {
      const errMessage = err?.data?.message || err?.message || ft("bulk.messages.uploadFailed", "Upload gagal.");
      if (err?.status === 409 || String(err?.message || "").includes("409")) {
        item.status = "duplicate";
        item.message = errMessage;
      } else {
        item.status = "err";
        item.message = errMessage;
      }
    }
  });
  try {
    await runInBatches(tasks);
    const summary = bulkSummary.value;
    const parts = [ft("bulk.summary.success", "Selesai. Sukses: {count}", { count: summary.ok })];
    if (summary.duplicate) parts.push(ft("bulk.summary.duplicate", "Duplikat: {count}", { count: summary.duplicate }));
    if (summary.err) parts.push(ft("bulk.summary.error", "Gagal: {count}", { count: summary.err }));
    if (summary.skip) parts.push(ft("bulk.summary.skip", "Lewati: {count}", { count: summary.skip }));
    toast.success(parts.join(", "));
    loadData(state.page);
  } finally {
    state.bulkRunning = false;
  }
}

function goToPage(page) {
  const { totalPages, current } = paginationSummary.value;
  let target = Number(page);
  if (!Number.isFinite(target)) return;
  target = Math.max(1, Math.min(totalPages, Math.trunc(target)));
  if (target === current) return;
  clearSelection();
  loadData(target);
}
function goToPrevPage() {
  if (hasPrevPage.value) goToPage(paginationSummary.value.current - 1);
}
function goToNextPage() {
  if (hasNextPage.value) goToPage(paginationSummary.value.current + 1);
}

const bulkSummary = computed(() => {
  const counts = { total: state.bulkItems.length, ready: 0, uploading: 0, ok: 0, duplicate: 0, err: 0, skip: 0 };
  state.bulkItems.forEach((item) => {
    const key = item.status || "ready";
    if (counts[key] === undefined) counts[key] = 0;
    counts[key] += 1;
  });
  return counts;
});
const bulkSummaryEntries = computed(() => {
  const s = bulkSummary.value;
  const base = "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium shadow-sm";
  const entries = [
    {
      key: "total",
      label: ft("bulk.summaryLabels.total", "Total"),
      value: s.total,
      class: `${base} bg-muted text-foreground`,
    },
    {
      key: "ready",
      label: ft("bulk.summaryLabels.ready", "Siap"),
      value: s.ready,
      class: `${base} bg-muted text-foreground`,
    },
    {
      key: "uploading",
      label: ft("bulk.summaryLabels.uploading", "Mengunggah"),
      value: s.uploading,
      class: `${base} bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200`,
    },
    {
      key: "ok",
      label: ft("bulk.summaryLabels.success", "Sukses"),
      value: s.ok,
      class: `${base} bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200`,
    },
    {
      key: "duplicate",
      label: ft("bulk.summaryLabels.duplicate", "Duplikat"),
      value: s.duplicate,
      class: `${base} bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200`,
    },
    {
      key: "err",
      label: ft("bulk.summaryLabels.error", "Gagal"),
      value: s.err,
      class: `${base} bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200`,
    },
    {
      key: "skip",
      label: ft("bulk.summaryLabels.skip", "Lewati"),
      value: s.skip,
      class: `${base} bg-muted text-foreground`,
    },
  ];
  return entries.filter((e) => e.value > 0);
});
const bulkProgressPercent = computed(() => {
  if (!state.bulkProgress.total) return 0;
  return Math.min(100, Math.round((state.bulkProgress.done / state.bulkProgress.total) * 100));
});

onMounted(async () => {
  if (auth?.refresh) await auth.refresh();
  else await checkAuth();
});
onBeforeUnmount(() => {});
</script>

<template>
  <div class="space-y-8">
    <!-- Filters & Actions -->
    <Card>
      <CardContent class="p-6 space-y-6">
        <div class="flex flex-wrap justify-between gap-3">
          <div class="flex flex-wrap items-end gap-3">
            <div class="space-y-1">
              <Label class="text-xs font-semibold">{{ ft("filters.searchLabel", "Cari Nama") }}</Label>
              <div class="flex items-center gap-2 w-full">
                <Combobox
                  v-model="state.filters.q"
                  :open="searchOpen"
                  @update:open="
                    (v) => {
                      searchOpen = v;
                      if (v) ensurePeopleOptions();
                    }
                  "
                  @update:model-value="
                    (val) => {
                      searchOpen = false;
                      loadData(1);
                    }
                  ">
                  <ComboboxAnchor>
                    <ComboboxTrigger class="w-full">
                      <Button variant="outline" class="justify-between w-full">
                        {{ state.filters.q || ft("filters.searchPlaceholder", "Cari Nama…") }}
                        <span class="ti ti-selector ml-2 h-4 w-4 shrink-0 opacity-50"></span>
                      </Button>
                    </ComboboxTrigger>
                  </ComboboxAnchor>
                  <ComboboxList v-if="searchOpen">
                    <ComboboxInput
                      v-model="searchQuery"
                      :placeholder="ft('filters.searchPlaceholder', 'Cari Nama…')"
                      @keydown.enter.prevent="commitSearchQuery"
                      autocomplete="off" />
                    <ComboboxEmpty>{{ ft("filters.noMatches", "Tidak ada hasil") }}</ComboboxEmpty>
                    <ComboboxViewport>
                      <ComboboxItem
                        v-if="
                          searchQuery &&
                          !(peopleOptions || []).some(
                            (p) => String(p).toLowerCase() === String(searchQuery).toLowerCase()
                          )
                        "
                        :value="searchQuery">
                        <span>{{ ft("filters.search", "Cari") }}: "{{ searchQuery }}"</span>
                      </ComboboxItem>
                      <ComboboxItem v-for="option in filteredPeopleForSearch" :key="`opt-${option}`" :value="option">
                        <span>{{ option }}</span>
                      </ComboboxItem>
                    </ComboboxViewport>
                  </ComboboxList>
                </Combobox>
                <!-- <Button size="icon" variant="ghost" @click="() => { state.filters.q=''; loadData(1); }">
                  <i class="ti ti-x"></i>
                </Button> -->
              </div>
            </div>

            <div class="space-y-1">
              <Label class="text-xs font-semibold">{{ ft("filters.perPage", "Per halaman") }}</Label>
              <Select
                :model-value="String(state.filters.perPage)"
                @update:model-value="
                  (v) => {
                    state.filters.perPage = String(v);
                    loadData(1);
                  }
                ">
                <SelectTrigger>
                  <SelectValue :placeholder="String(state.filters.perPage)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="all">∞</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="space-y-1">
              <Label class="text-xs font-semibold">{{ ft("filters.order", "Urutan") }}</Label>
              <Select
                :model-value="state.filters.order"
                @update:model-value="
                  (v) => {
                    state.filters.order = v;
                    loadData(1);
                  }
                ">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">{{ ft("filters.orderNewest", "Terbaru") }}</SelectItem>
                  <SelectItem value="asc">{{ ft("filters.orderOldest", "Terlama") }}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <span class="text-sm text-muted-foreground">{{ state.statusText }}</span>
          </div>

          <div v-if="state.isAdmin" class="flex flex-wrap items-center gap-2">
            <Badge variant="outline"
              ><i class="ti ti-checkbox mr-1"></i
              >{{ ft("filters.selected", "Dipilih: {count}", { count: selectedCount }) }}</Badge
            >
            <Button variant="outline" @click="openBulkModal"
              ><i class="ti ti-upload mr-2"></i>{{ ft("actions.bulkUpload", "Bulk Upload") }}</Button
            >
            <Button variant="destructive" @click="() => bulkAction('delete')"
              ><i class="ti ti-trash mr-2"></i>{{ ft("actions.delete", "Hapus") }}</Button
            >
            <Button variant="outline" @click="() => bulkAction('export')"
              ><i class="ti ti-file-export mr-2"></i>{{ ft("actions.export", "Export") }}</Button
            >
          </div>
        </div>

        <!-- Table -->
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead class="w-12">
                  <Checkbox :model-value="headerModel" @update:modelValue="setHeaderModel" />
                </TableHead>
                <TableHead>{{ ft("table.columns.label", "Label") }}</TableHead>
                <TableHead class="w-40">{{ ft("table.columns.photo", "Foto") }}</TableHead>
                <TableHead>{{ ft("table.columns.timestamp", "Timestamp") }}</TableHead>
                <TableHead>{{ ft("table.columns.actions", "Aksi") }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="row in displayedRows" :key="row.id" class="align-top">
                <TableCell class="align-top">
                  <Checkbox
                    :model-value="selectedIds.has(row.idKey)"
                    @update:modelValue="(v) => toggleRowSelection(row.id, v)"
                    :aria-label="`Select ${row.personIdDisplay}`" />
                </TableCell>

                <TableCell class="align-top space-y-2">
                  <template v-if="row.editing">
                    <Input v-model="state.editInline.value" class="w-[250px]"/>
                    <div class="flex gap-2 text-xs">
                      <Button size="sm" :disabled="state.editInline.busy" @click="() => saveInlineEdit(row)">
                        {{ ft("table.inline.save", "Simpan") }}
                      </Button>
                      <Button variant="outline" size="sm" @click="cancelInlineEdit">
                        {{ t("common.cancel", "Batal") }}
                      </Button>
                    </div>
                  </template>
                  <template v-else>
                    <div class="text-xs text-muted-foreground">
                      {{ ft("table.inline.idPrefix", "ID") }}: {{ row.personIdDisplay }}
                    </div>
                    <div class="font-semibold">
                      {{ row.label || ft("table.inline.noLabel", "(tanpa label)") }}
                    </div>
                    <div class="text-xs text-muted-foreground">{{ row.meta || row.extra || "" }}</div>
                    <Button
                      v-if="state.isAdmin"
                      variant="link"
                      class="px-0 h-auto text-sky-600"
                      @click="() => startInlineEdit(row)">
                      <i class="ti ti-pencil mr-1"></i>{{ ft("table.inline.edit", "Edit label") }}
                    </Button>
                  </template>
                </TableCell>

                <TableCell class="align-top">
                  <div class="flex flex-col items-start gap-2">
                    <div
                      v-if="row.photoUrl"
                      class="relative h-40 w-32 overflow-hidden rounded-xl border bg-muted shadow-sm cursor-pointer"
                      @click="() => openPhotoModal(row.photoUrl, row.label)">
                      <img :src="row.photoUrl" class="absolute inset-0 h-full w-full object-cover" />
                    </div>
                    <span v-else class="text-xs text-muted-foreground">
                      {{ ft("table.photo.none", "Tidak ada foto") }}
                    </span>
                    <Button
                      v-if="state.isAdmin"
                      variant="link"
                      class="px-0 h-auto text-sky-600"
                      @click="() => openUploadModal(row)">
                      <i class="ti ti-photo-up mr-1"></i>{{ ft("table.photo.replace", "Ganti foto") }}
                    </Button>
                  </div>
                </TableCell>

                <TableCell class="align-top text-xs text-muted-foreground">
                  <span :title="row.tsTitle">{{ row.tsWib }}</span>
                </TableCell>

                <TableCell class="align-top whitespace-nowrap">
                  <div class="flex flex-col gap-2 text-xs">
                    <Button size="sm" variant="destructive" @click="() => deleteRow(row, true)">
                      <i class="ti ti-trash mr-1"></i>{{ ft("actions.delete", "Hapus") }}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>

              <TableRow v-if="!displayedRows.length && !state.loading">
                <TableCell colspan="7" class="text-center text-muted-foreground">
                  {{ ft("table.empty", "Belum ada data ditemukan.") }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <!-- Pagination -->
        <div class="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span class="text-muted-foreground">
            {{ ft("pagination.total", "Total: {total}", { total: state.meta.total }) }}
          </span>
          <template v-if="Number(state.meta.total) > 0">
            <Pagination
              v-model:page="state.page"
              :items-per-page="Number(state.filters.perPage === 'all' ? state.meta.total : state.filters.perPage)"
              :total="Number(state.meta.total)"
              :sibling-count="0"
              show-edges
              class="mx-auto flex w-full justify-end">
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
        </div>
      </CardContent>
    </Card>
  </div>

  <!-- Bulk Upload Dialog -->
  <Dialog v-model:open="state.bulkModal">
    <DialogContent class="lg:max-w-7xl" @open-auto-focus.prevent @close-auto-focus.prevent>
      <DialogHeader>
        <DialogTitle>{{ ft("bulk.title", "Bulk Upload") }}</DialogTitle>
        <DialogDescription>{{ ft("bulk.hint", "Tambah banyak foto sekaligus. ZIP juga bisa.") }}</DialogDescription>
      </DialogHeader>

      <div class="space-y-6">
        <div class="flex flex-wrap items-center gap-3">
          <Input type="file" accept=".zip,image/*" multiple class="w-fit" @change="onBulkFileInput" />
          <div class="inline-flex items-center gap-2">
            <Checkbox :model-value="state.bulkForce" @update:model-value="(v) => (state.bulkForce = Boolean(v))" />
            <Label class="text-xs">{{ ft("bulk.forceReplace", "Force replace duplicates") }}</Label>
          </div>
          <Button variant="outline" @click="clearBulkItems">{{ ft("bulk.clear", "Kosongkan") }}</Button>
        </div>

        <div v-if="state.bulkItems.length" class="space-y-3 rounded-xl border p-4">
          <div class="flex items-center justify-between text-sm font-medium">
            <span>{{ ft("bulk.progressTitle", "Progress unggahan") }}</span>
            <span>{{ bulkProgressPercent }}% ({{ state.bulkProgress.done }} / {{ state.bulkProgress.total }})</span>
          </div>
          <Progress :model-value="bulkProgressPercent" />
          <div class="flex flex-wrap gap-2">
            <span v-for="chip in bulkSummaryEntries" :key="chip.key" :class="chip.class"
              >{{ chip.label }}: {{ chip.value }}</span
            >
          </div>
          <p v-if="state.bulkRunning" class="text-[11px] text-sky-600 dark:text-sky-200">
            {{ ft("bulk.uploadingWait", "Unggahan berjalan... tunggu sampai semua selesai.") }}
          </p>
        </div>

        <div v-else class="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {{
            ft("bulk.emptyHint", "Belum ada file yang ditambahkan. Pilih beberapa gambar atau ZIP berisi foto wajah.")
          }}
        </div>

        <div v-if="state.bulkItems.length" class="grid max-h-80 grid-cols-1 gap-3 overflow-auto md:grid-cols-3">
          <article
            v-for="item in state.bulkItems"
            :key="item.id"
            class="rounded-2xl border p-3 shadow-sm transition-colors"
            :class="{
              'border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/40 dark:bg-emerald-500/10':
                item.status === 'ok',
              'border-amber-200 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/10':
                item.status === 'duplicate',
              'border-rose-200 bg-rose-50/60 dark:border-rose-500/40 dark:bg-rose-500/10': item.status === 'err',
              'border-sky-200 bg-sky-50/60 dark:border-sky-500/40 dark:bg-sky-500/10': item.status === 'uploading',
              'border-muted bg-background': ['skip', 'ready'].includes(item.status),
            }">
            <div class="flex items-start gap-3">
              <img :src="item.previewUrl" class="h-16 w-16 rounded-xl object-cover ring-2 ring-background" />
              <div class="flex-1 space-y-2 text-xs">
                <div class="font-semibold">{{ item.name }}</div>
                <Input v-model="item.label" />
                <div
                  class="flex items-center gap-1 text-xs font-semibold"
                  :class="{
                    'text-emerald-600 dark:text-emerald-300': item.status === 'ok',
                    'text-rose-600 dark:text-rose-300': item.status === 'err',
                    'text-amber-600 dark:text-amber-300': ['duplicate', 'skip'].includes(item.status),
                    'text-sky-600 dark:text-sky-300': item.status === 'uploading',
                    'text-muted-foreground': item.status === 'ready',
                  }">
                  <i
                    :class="{
                      'ti ti-circle-check': item.status === 'ok',
                      'ti ti-alert-triangle': item.status === 'duplicate',
                      'ti ti-circle-x': item.status === 'err',
                      'ti ti-loader-2 animate-spin': item.status === 'uploading',
                      'ti ti-corner-up-right-double': item.status === 'skip',
                      'ti ti-clock': item.status === 'ready',
                    }"></i>
                  <span>
                    {{
                      item.status === "uploading"
                        ? ft("bulk.statusLabel.uploading", "Sedang mengunggah")
                        : item.status === "ok"
                        ? ft("bulk.statusLabel.success", "Sukses")
                        : item.status === "duplicate"
                        ? ft("bulk.statusLabel.duplicate", "Duplikat")
                        : item.status === "err"
                        ? ft("bulk.statusLabel.error", "Gagal")
                        : item.status === "skip"
                        ? ft("bulk.statusLabel.skip", "Lewati")
                        : ft("bulk.statusLabel.ready", "Siap")
                    }}
                  </span>
                </div>
                <div
                  v-if="item.message"
                  class="rounded-lg bg-background/60 px-2 py-1 text-[11px] leading-snug text-muted-foreground">
                  {{ item.message }}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                class="text-rose-500 hover:text-rose-400"
                @click="() => removeBulkItem(item)">
                <i class="ti ti-x"></i>
              </Button>
            </div>
          </article>
        </div>
      </div>

      <DialogFooter class="mt-4">
        <Button variant="outline" @click="closeBulkModal" :disabled="state.bulkRunning">{{
          t("common.close", "Tutup")
        }}</Button>
        <Button :disabled="state.bulkRunning || !state.bulkItems.length" @click="startBulkUpload">
          {{ state.bulkRunning ? ft("bulk.uploading", "Sedang mengunggah...") : ft("bulk.start", "Mulai Upload") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- Replace Photo Dialog (improved) -->
  <Dialog v-model:open="state.uploadModal.open">
    <DialogContent
      class="lg:max-w-screen-lg overflow-y-auto max-h-[90svh]"
      @open-auto-focus.prevent
      @close-auto-focus.prevent>
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <i class="ti ti-photo-up"></i>
          {{ ft("modal.replacePhotoFor", "Ganti foto untuk {label}", { label: state.uploadModal.label }) }}
        </DialogTitle>
        <DialogDescription>
          {{
            ft("modal.replacePhotoHint", "Pilih foto baru atau ambil dari kamera. Pastikan wajah jelas dan satu orang.")
          }}
        </DialogDescription>
      </DialogHeader>

      <div class="grid gap-4 md:grid-cols-2">
        <div class="space-y-2">
          <Label class="text-xs">{{ ft("modal.currentPhoto", "Foto saat ini") }}</Label>
          <div class="relative aspect-[3/4] w-full overflow-hidden rounded-xl border bg-muted">
            <template v-if="state.uploadModal.prevUrl">
              <img :src="state.uploadModal.prevUrl" class="absolute inset-0 h-full w-full object-cover" />
            </template>
            <template v-else>
              <div class="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
                <i class="ti ti-user"></i>
                {{ ft("modal.noPhoto", "Tidak ada foto") }}
              </div>
            </template>
          </div>
        </div>

        <div class="space-y-2">
          <Label class="text-xs">{{ ft("modal.newPhoto", "Foto baru") }}</Label>
          <div
            class="relative aspect-[3/4] w-full rounded-xl border border-dashed bg-background/50 overflow-hidden"
            @dragover="preventDefault"
            @dragenter="preventDefault"
            @drop="onDropReplace">
            <template v-if="state.inlineCam.open">
              <video
                ref="camVideoRef"
                autoplay
                playsinline
                muted
                class="absolute inset-0 h-full w-full object-cover"></video>
              <div class="absolute left-2 top-2 rounded-md bg-black/40 px-2 py-1 text-[11px] text-white">
                Live Camera
              </div>
            </template>
            <template v-else>
              <template v-if="state.uploadModal.previewUrl">
                <img
                  :src="state.uploadModal.previewUrl"
                  class="absolute inset-0 h-full w-full rounded-xl object-cover" />
              </template>
              <template v-else>
                <div class="absolute inset-0 grid place-items-center text-center text-sm text-muted-foreground p-4">
                  <div class="space-y-1">
                    <i class="ti ti-upload"></i>
                    <div>{{ ft("modal.dropHere", "Tarik & letakkan foto ke sini") }}</div>
                    <div class="text-[11px]">{{ ft("modal.orChoose", "atau pilih dari perangkat") }}</div>
                  </div>
                </div>
              </template>
            </template>
            <div
              v-if="state.uploadModal.previewLoading"
              class="absolute inset-0 grid place-items-center bg-background/80 text-sm text-muted-foreground">
              <div class="flex items-center gap-2">
                <i class="ti ti-loader-2 animate-spin"></i>
                {{ ft("modal.previewLoading", "Memproses foto...") }}
              </div>
            </div>
            <div
              v-else-if="state.uploadModal.previewError"
              class="absolute inset-0 grid place-items-center bg-destructive/10 px-4 text-center text-xs text-destructive">
              {{ state.uploadModal.previewError }}
            </div>
          </div>
          <div class="flex gap-2">
            <input id="adm-replace-file" type="file" accept="image/*" class="hidden" @change="onReplaceFileChange" />
            <template v-if="!state.inlineCam.open">
              <Button variant="outline" @click="pickReplaceFile"
                ><i class="ti ti-photo mr-2"></i>{{ t("common.chooseFile", "Pilih File") }}</Button
              >
              <Button variant="outline" @click="openInlineCamera"
                ><i class="ti ti-camera mr-2"></i>{{ ft("modal.useCamera", "Gunakan Kamera") }}</Button
              >
            </template>
            <template v-else>
              <Button @click="captureInlineCamera"
                ><i class="ti ti-camera mr-2"></i>{{ ft("modal.capture", "Tangkap") }}</Button
              >
              <Button variant="outline" @click="stopInlineCamera"
                ><i class="ti ti-x mr-2"></i>{{ t("common.cancel", "Batal") }}</Button
              >
              <span v-if="state.inlineCam.error" class="text-xs text-destructive">{{ state.inlineCam.error }}</span>
            </template>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="state.uploadModal.busy" @click="closeUploadModal">{{
          t("common.cancel", "Batal")
        }}</Button>
        <Button :disabled="!canSubmitReplace" @click="submitReplace">
          <i v-if="state.uploadModal.busy" class="ti ti-loader-2 animate-spin mr-2"></i>
          {{ ft("modal.replaceNow", "Ganti Sekarang") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- Photo Preview Dialog -->
  <Dialog v-model:open="state.photoModal.open">
    <DialogContent class="max-w-3xl" @open-auto-focus.prevent @close-auto-focus.prevent>
      <DialogHeader>
        <DialogTitle>{{ state.photoModal.label }}</DialogTitle>
      </DialogHeader>
      <div class="flex items-center justify-center">
        <img :src="state.photoModal.url" alt="preview" class="max-h-[70vh] w-auto rounded-2xl object-contain" />
      </div>
      <DialogFooter>
        <Button variant="outline" @click="closePhotoModal">{{ t("common.close", "Tutup") }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
