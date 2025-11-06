<script setup>
import { computed, onMounted, reactive, ref, watch, watchEffect } from "vue";
import { apiFetchJSON, download } from "@/utils/api";
import { normalizeIdTargets } from "@/utils/overrides";
import { toast } from "@/utils/toast";
import { useI18n } from "@/i18n";
import { useConfirmDialog } from "@/composables/useConfirmDialog";

const { t } = useI18n();
const confirmDialog = useConfirmDialog();
const ft = (path, fallback, values) => t(`adminAttendance.${path}`, fallback, values);

// shadcn-vue
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
} from "@/components/ui/pagination";
import OverrideEditorModal from "@/components/modals/OverrideEditorModal.vue";
import { Textarea } from "@/components/ui/textarea";
import { DateFormatter, getLocalTimeZone, parseDate } from "@internationalized/date";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { RangeCalendar } from "@/components/ui/range-calendar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const GRACE_LIMIT = { min: 0, max: 240 };

function clampGrace(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(GRACE_LIMIT.max, Math.max(GRACE_LIMIT.min, Math.round(n)));
}
function timeToMinutes(value) {
  if (!value || !TIME_RE.test(value)) return 0;
  const [h, m] = value.split(":");
  return Number(h) * 60 + Number(m);
}
function sortOverrides(list = []) {
  return [...(list || [])].sort((a, b) => {
    if (a.start_date === b.start_date) {
      if (a.end_date === b.end_date) return (a.label || "").localeCompare(b.label || "");
      return a.end_date.localeCompare(b.end_date);
    }
    return a.start_date.localeCompare(b.start_date);
  });
}
function defaultOverrideForm() {
  return {
    id: null,
    start_date: "",
    end_date: "",
    singleDay: true,
    label: "",
    enabled: true,
    check_in: "08:30",
    check_out: "17:00",
    grace_in_min: "",
    grace_out_min: "",
    notes: "",
    scope: "all",
    targets: [],
    personQuery: "",
  };
}

function defaultTargetsForRow(row) {
  const pid = String(row?.person_id || "").trim();
  const label = String(row?.label || "").trim();
  if (pid) {
    return [{ type: "person", value: pid, label: label || pid }];
  }
  if (label) {
    return [{ type: "label", value: label, label }];
  }
  return [];
}

function filterTargetsForRow(targets = [], row = null) {
  if (!row) return normalizeIdTargets(targets || []);
  const normalized = normalizeIdTargets(targets || []);
  const pid = String(row.person_id || "")
    .trim()
    .toLowerCase();
  const label = String(row.label || "")
    .trim()
    .toLowerCase();
  const filtered = normalized.filter((item) => {
    const type = String(item?.type || "label").toLowerCase();
    const value = String(item?.value || "")
      .trim()
      .toLowerCase();
    const tagged = String(item?.label || "")
      .trim()
      .toLowerCase();
    if (type === "person" && pid && value === pid) return true;
    if (type === "label" && label && value === label) return true;
    if (label && tagged === label) return true;
    if (!pid && label && type === "person" && value === label) return true;
    return false;
  });
  return filtered.length ? filtered : defaultTargetsForRow(row);
}

function normalizeTargetsForRow(targets = [], row = null) {
  const normalized = normalizeIdTargets(targets);
  const seen = new Set();
  const pid = row
    ? String(row.person_id || "")
        .trim()
        .toLowerCase()
    : "";
  const label = row
    ? String(row.label || "")
        .trim()
        .toLowerCase()
    : "";
  const result = [];
  for (const item of normalized) {
    let type = String(item?.type || "label").toLowerCase();
    let value = String(item?.value || "").trim();
    if (!value) continue;
    if (type === "label" && pid && label && value.toLowerCase() === label) {
      type = "person";
      value = String(row.person_id || "").trim();
    }
    const key = `${type}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      type,
      value,
      ...(item?.label ? { label: item.label } : type === "person" && row?.label ? { label: row.label } : {}),
    });
  }
  return result;
}

function targetTitle(target) {
  if (target && typeof target === "object") {
    const value = String(target.value ?? target.id ?? target.person_id ?? "").trim();
    const label = String(target.label ?? "").trim();
    if (value && label && value.toLowerCase() !== label.toLowerCase()) {
      return `${value} — ${label}`;
    }
    return value || label;
  }
  return String(target ?? "").trim();
}

const overrideModal = reactive({
  open: false,
  loading: false,
  saving: false,
  editingId: null,
  attendanceSnapshot: null,
  baseOverrides: [],
  defaults: { grace_in_min: 10, grace_out_min: 5 },
  form: defaultOverrideForm(),
  sourceRow: null,
});

const state = reactive({
  items: [],
  meta: { page: 1, per_page: 10, total: 0, total_pages: 1, has_prev: false, has_next: false, order: "desc" },
  loading: false,
});

const q = ref("");
const searchOpen = ref(false);
const searchQuery = ref("");
const perPage = ref(10);
const order = ref("desc");
const start = ref("");
const end = ref("");
const statusFilter = ref("all");
const statusOptions = computed(() => [
  { value: "all", label: ft("filters.statusOptions.all", "Semua status") },
  { value: "present", label: ft("filters.statusOptions.present", "Hadir") },
  { value: "late", label: ft("filters.statusOptions.late", "Terlambat") },
  { value: "left_early", label: ft("filters.statusOptions.leftEarly", "Pulang awal") },
  { value: "mixed", label: ft("filters.statusOptions.mixed", "Terlambat & Pulang awal") },
  { value: "off", label: ft("filters.statusOptions.off", "Libur") },
]);

function normalizeDailyRow(row = {}) {
  const defaults = {
    check_in: "",
    check_out: "",
    grace_in_min: overrideModal.defaults?.grace_in_min ?? 10,
    grace_out_min: overrideModal.defaults?.grace_out_min ?? 5,
    notes: "",
    override: null,
    source: "default",
  };
  const detail = {
    ...defaults,
    ...(row.schedule_detail || {}),
  };

  detail.check_in = detail.check_in || row.check_in || "";
  detail.check_out = detail.check_out || row.check_out || "";
  detail.grace_in_min = detail.grace_in_min ?? defaults.grace_in_min;
  detail.grace_out_min = detail.grace_out_min ?? defaults.grace_out_min;
  detail.notes = detail.notes || "";
  detail.source = detail.source || row.schedule_source || "default";

  return {
    ...row,
    check_in: row.check_in || detail.check_in || "",
    check_out: row.check_out || detail.check_out || "",
    schedule: row.schedule || "",
    schedule_source: row.schedule_source || detail.source || "default",
    schedule_detail: detail,
    schedule_override: row.schedule_override || null,
    status: row.status || "present",
    events: Array.isArray(row.events) ? row.events : [],
  };
}

// Texts for OverrideEditorModal with On/Off semantics (Hari Masuk/Hari Libur)
const overrideModalTexts = computed(() => ({
  title: ft("overrideModal.title", "Override Jadwal"),
  description: ft("overrideModal.description", "Pilih rentang tanggal dan jam kerja untuk menimpa jadwal mingguan."),
  loading: ft("overrideModal.loading", "Memuat..."),
  fields: {
    label: ft("overrideModal.form.label", "Label"),
    range: ft("overrideModal.form.range", "Rentang Tanggal"),
    pickDate: ft("overrideModal.form.pickDate", "Pilih tanggal"),
    singleDay: ft("overrideModal.form.singleDay", "Satu hari"),
    active: ft("overrideModal.form.active", "Mode Jadwal"),
    checkIn: ft("overrideModal.form.checkIn", "Jam Masuk"),
    checkOut: ft("overrideModal.form.checkOut", "Jam Pulang"),
    graceIn: ft("overrideModal.form.graceIn", "Grace Masuk (menit)"),
    graceOut: ft("overrideModal.form.graceOut", "Grace Pulang (menit)"),
    notes: ft("overrideModal.form.notes", "Catatan"),
    notesPlaceholder: ft("overrideModal.form.notesPlaceholder", "Opsional"),
    scope: ft("overrideModal.form.scope", "Penerapan"),
    personLabel: ft("overrideModal.form.personLabel", "Pilih Anggota"),
    personPlaceholder: ft("overrideModal.form.personPlaceholder", "Cari nama..."),
    setHoliday: ft("overrideModal.form.setHoliday", "Set Hari Libur"),
    holidayLabel: ft("overrideModal.form.holidayLabel", "Hari Libur"),
  },
  active: {
    label: ft("overrideModal.active.label", "Holiday (Off) / Working Day (On)"),
    on: t("adminSchedule.common.onLabel", "Working Day"),
    off: t("adminSchedule.common.offLabel", "Holiday"),
  },
  people: {
    placeholder: ft("overrideModal.people.placeholder", "Cari nama..."),
    noMatches: ft("overrideModal.people.noMatches", "Tidak ada hasil untuk pencarian ini."),
    noPeople: ft("overrideModal.people.noPeople", "Belum ada data wajah yang dapat dipilih."),
    loading: ft("overrideModal.people.loading", "Memuat daftar wajah..."),
    allSelected: ft("overrideModal.people.allSelected", "Semua anggota telah dipilih."),
  },
  common: {
    clear: ft("common.clear", "Bersihkan"),
  },
}));

// Date range state for filters
const dateRange = ref({ start: undefined, end: undefined });
const datePopoverOpen = ref(false);

function commitSearchQuery() {
  const s = (searchQuery?.value || "").trim();
  if (!s) return;
  q.value = s;
  searchOpen.value = false;
  debounceFetch();
}

// People options for OverrideEditorModal scope=individual
const peopleOptions = ref([]); // [{ id, label }]

const allPeopleOptions = computed(() => {
  const seen = new Set();
  const merged = [];
  const push = (id, label) => {
    if (!id) return;
    const key = String(id).trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push({ id: key, label: (label && String(label).trim()) || key });
  };

  (peopleOptions.value || []).forEach((item) => {
    if (item && typeof item === "object") push(item.id, item.label);
    else push(item, item);
  });

  (state.items || []).forEach((row) => {
    push(row?.person_id, row?.label);
    (row?.schedule_override?.targets || []).forEach((target) => {
      if (target && typeof target === "object") {
        push(target.value ?? target.id ?? target.person_id, target.label);
      } else {
        push(target, target);
      }
    });
  });

  (overrideModal.baseOverrides || []).forEach((ov) => {
    (ov?.targets || []).forEach((target) => {
      if (target && typeof target === "object") {
        push(target.value ?? target.id ?? target.person_id, target.label);
      } else {
        push(target, target);
      }
    });
  });

  return merged;
});

const peopleMap = computed(() => {
  const map = new Map();
  allPeopleOptions.value.forEach((opt) => {
    if (opt?.id) map.set(String(opt.id), String(opt.label || ""));
  });
  return map;
});
const peopleLoading = ref(false);
const peopleLoaded = ref(false);
const peopleError = ref("");
const filteredPeopleForSearch = computed(() => {
  const qstr = (searchQuery?.value || "").trim().toLowerCase();
  const base = (allPeopleOptions.value || []).map((p) => p.label);
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
    const mapped = items
      .map((it) => ({ id: String(it?.person_id || it?.id || ""), label: String(it?.label ?? "").trim() }))
      .filter((x) => x.id && x.label);
    mapped.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    // Unique by id
    const seen = new Set();
    peopleOptions.value = mapped.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
    peopleLoaded.value = true;
  } catch (err) {
    console.error(err);
    peopleError.value = err?.message || ft("error.loadPeople", "Gagal memuat daftar wajah.");
  } finally {
    peopleLoading.value = false;
  }
}

let debounceT = null;
function debounceFetch() {
  clearTimeout(debounceT);
  debounceT = setTimeout(() => fetchDaily(1), 250);
}

onMounted(() => ensurePeopleOptions(true));

async function fetchDaily(page = state.meta.page) {
  state.loading = true;
  try {
    const params = new URLSearchParams({
      page: String(page || 1),
      per_page: String(perPage.value || 10),
      order: order.value || "desc",
    });
    if (q.value?.trim()) params.set("q", q.value.trim());
    if (start.value?.trim()) params.set("start", start.value.trim());
    if (end.value?.trim()) params.set("end", end.value.trim());
    if (statusFilter.value && statusFilter.value !== "all") params.set("status", statusFilter.value);

    const data = await apiFetchJSON(`/admin/attendance/daily?${params.toString()}`, { method: "GET" });
    state.items = (data.items || []).map(normalizeDailyRow);
    const meta = data.meta || {};
    state.meta = {
      page: meta.page || page,
      per_page: meta.per_page || perPage.value,
      total: meta.total || 0,
      total_pages: meta.total_pages || 1,
      has_prev: Boolean(meta.has_prev),
      has_next: Boolean(meta.has_next),
      order: meta.order || order.value,
    };
    perPage.value = state.meta.per_page;
    order.value = state.meta.order;
  } catch {
    toast.error(ft("error.fetchDaily", "Gagal memuat data attendance harian."));
  } finally {
    state.loading = false;
  }
}

function closeOverrideModal() {
  overrideModal.open = false;
  overrideModal.loading = false;
  overrideModal.saving = false;
  overrideModal.editingId = null;
  overrideModal.attendanceSnapshot = null;
  overrideModal.baseOverrides = [];
  overrideModal.form = defaultOverrideForm();
  overrideModal.sourceRow = null;
}

const genOverrideId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `ov_${Math.random().toString(36).slice(2, 8)}`;

function buildOverrideRecord(form, defaults, editingId) {
  const start = (form.start_date || "").trim();
  if (!start) throw new Error(ft("override.startRequired", "Tanggal mulai wajib diisi."));
  const endRaw = form.singleDay ? start : (form.end_date || "").trim() || start;
  const range = [start, endRaw].sort();
  const enabled = Boolean(form.enabled);

  let checkIn = (form.check_in || "").trim();
  let checkOut = (form.check_out || "").trim();
  if (enabled) {
    if (!TIME_RE.test(checkIn))
      throw new Error(ft("override.checkInFormat", "Jam masuk harus menggunakan format JJ:MM."));
    if (!TIME_RE.test(checkOut))
      throw new Error(ft("override.checkOutFormat", "Jam pulang harus menggunakan format JJ:MM."));
    if (timeToMinutes(checkOut) <= timeToMinutes(checkIn))
      throw new Error(ft("override.checkOrder", "Jam pulang harus lebih besar dari jam masuk."));
  } else {
    checkIn = "";
    checkOut = "";
  }

  const graceIn = clampGrace(form.grace_in_min, enabled ? defaults.grace_in_min : 0);
  const graceOut = clampGrace(form.grace_out_min, enabled ? defaults.grace_out_min : 0);
  const scope = form.scope === "individual" ? "individual" : "all";
  const targets = scope === "individual" ? normalizeIdTargets(form.targets || []) : [];
  if (scope === "individual" && !targets.length) {
    throw new Error(ft("overrideModal.errors.targetsRequired", "Pilih minimal satu orang."));
  }

  return {
    id: form.id || editingId || genOverrideId(),
    start_date: range[0],
    end_date: range[1],
    label: (form.label || "").trim() || ft("overrideModal.form.defaultLabel", "Jadwal Khusus"),
    enabled,
    check_in: enabled ? checkIn : "",
    check_out: enabled ? checkOut : "",
    grace_in_min: enabled ? graceIn : 0,
    grace_out_min: enabled ? graceOut : 0,
    notes: (form.notes || "").trim(),
    targets,
  };
}

async function openOverrideModalForRow(row) {
  overrideModal.sourceRow = row;
  overrideModal.open = true;
  overrideModal.loading = true;
  overrideModal.form = defaultOverrideForm();
  try {
    const resp = await apiFetchJSON("/admin/attendance/schedule", { method: "GET" });
    const attendanceCfg = resp?.attendance || {};
    overrideModal.attendanceSnapshot = attendanceCfg;
    overrideModal.defaults = {
      grace_in_min: clampGrace(attendanceCfg.grace_in_min, 10),
      grace_out_min: clampGrace(attendanceCfg.grace_out_min, 5),
    };
    overrideModal.baseOverrides = Array.isArray(attendanceCfg.overrides) ? [...attendanceCfg.overrides] : [];

    const overrideMeta = row.schedule_override || row.schedule_detail?.override;
    let existing = null;
    if (overrideMeta?.id) {
      existing = overrideModal.baseOverrides.find((ov) => ov && ov.id === overrideMeta.id) || null;
    }

    const defaults = overrideModal.defaults;
    const isExisting = Boolean(existing);
    const baseTargets = isExisting ? filterTargetsForRow(existing?.targets || [], row) : defaultTargetsForRow(row);

    const base = existing || {
      id: null,
      start_date: row.date,
      end_date: row.date,
      label: row.schedule || ft("overrideModal.form.defaultLabel", "Jadwal Khusus"),
      enabled: row.schedule_source !== "off",
      check_in: row.schedule_detail?.check_in || row.check_in || "08:30",
      check_out: row.schedule_detail?.check_out || row.check_out || "17:00",
      grace_in_min: row.schedule_detail?.grace_in_min ?? defaults.grace_in_min,
      grace_out_min: row.schedule_detail?.grace_out_min ?? defaults.grace_out_min,
      notes: row.schedule_detail?.notes || "",
      targets: baseTargets,
    };

    overrideModal.editingId = base.id;
    const targetsRaw = Array.isArray(base.targets) ? base.targets : [];
    const targets = normalizeTargetsForRow(targetsRaw, row);
    const scope = targets.length ? "individual" : "all";
    overrideModal.form = {
      id: base.id,
      start_date: base.start_date,
      end_date: base.end_date,
      singleDay: base.start_date === base.end_date,
      label: base.label,
      enabled: Boolean(base.enabled),
      check_in: base.check_in || "",
      check_out: base.check_out || "",
      grace_in_min: base.grace_in_min,
      grace_out_min: base.grace_out_min,
      notes: base.notes || "",
      scope,
      targets,
      personQuery: "",
    };
    if (scope === "individual") {
      ensurePeopleOptions();
    }
  } catch (err) {
    console.error(err);
    toast.error(err?.message || ft("error.loadOverrides", "Gagal memuat konfigurasi override."));
    closeOverrideModal();
  } finally {
    overrideModal.loading = false;
  }
}

async function submitOverrideModal() {
  if (overrideModal.saving) return;
  try {
    let record = buildOverrideRecord(overrideModal.form, overrideModal.defaults, overrideModal.editingId);
    const sourceRow = overrideModal.sourceRow;
    if (sourceRow) {
      record = {
        ...record,
        targets: overrideModal.form.scope === "individual" ? normalizeIdTargets(defaultTargetsForRow(sourceRow)) : [],
      };
    }

    const updated = sortOverrides([...overrideModal.baseOverrides.filter((ov) => ov.id !== record.id), record]);
    overrideModal.saving = true;
    const resp = await apiFetchJSON("/admin/attendance/schedule", {
      method: "PUT",
      body: { overrides: updated },
    });
    const attendanceCfg = resp?.attendance || {};
    overrideModal.attendanceSnapshot = attendanceCfg;
    overrideModal.baseOverrides = Array.isArray(attendanceCfg.overrides)
      ? sortOverrides(attendanceCfg.overrides)
      : updated;
    overrideModal.defaults = {
      grace_in_min: clampGrace(attendanceCfg.grace_in_min, overrideModal.defaults.grace_in_min),
      grace_out_min: clampGrace(attendanceCfg.grace_out_min, overrideModal.defaults.grace_out_min),
    };
    toast.success(ft("toast.overrideSaved", "Override jadwal tersimpan."));
    closeOverrideModal();
    fetchDaily(state.meta.page);
  } catch (err) {
    console.error(err);
    toast.error(err?.message || ft("error.saveOverride", "Gagal menyimpan override."));
  } finally {
    overrideModal.saving = false;
  }
}

async function removeOverrideForRow(row) {
  const overrideMeta = row.schedule_override || row.schedule_detail?.override;
  if (!overrideMeta?.id) {
    toast.info(ft("toast.noOverrideForDate", "Tidak ada override untuk tanggal ini."));
    return;
  }
  const confirmation = ft(
    "confirm.removeOverride",
    "Hapus override untuk {label} pada {date}? (Jika override untuk banyak orang, hanya orang ini yang dihapus)",
    { label: row.label, date: row.date }
  );
  const confirmed = await confirmDialog({
    title: ft("confirm.removeOverrideTitle", "Hapus override?"),
    description: confirmation,
    confirmText: t("common.delete", "Hapus"),
    cancelText: t("common.cancel", "Batal"),
  });
  if (!confirmed) return;
  try {
    const resp = await apiFetchJSON("/admin/attendance/schedule", { method: "GET" });
    const attendanceCfg = resp?.attendance || {};
    const list = Array.isArray(attendanceCfg.overrides) ? [...attendanceCfg.overrides] : [];
    const idx = list.findIndex((ov) => ov && ov.id === overrideMeta.id);
    if (idx < 0) {
      toast.info(ft("toast.noOverrideForDate", "Tidak ada override untuk tanggal ini."));
      return;
    }
    const current = { ...(list[idx] || {}) };
    const pid = String(row.person_id || "")
      .trim()
      .toLowerCase();
    const label = String(row.label || "")
      .trim()
      .toLowerCase();
    const targets = Array.isArray(current.targets) ? [...current.targets] : [];
    if (!targets.length) {
      list.splice(idx, 1);
    } else {
      const filtered = targets.filter((t) => {
        const type = String((t && t.type) || "label").toLowerCase();
        const value = String((t && t.value) || t || "")
          .trim()
          .toLowerCase();
        const tagged = String((t && t.label) || "")
          .trim()
          .toLowerCase();
        if (type === "person") {
          if (pid && value === pid) return false;
          if (!pid && label && value === label) return false;
          if (label && tagged === label) return false;
          return true;
        }
        if (type === "label") {
          if (label && value === label) return false;
          if (label && tagged === label) return false;
          return true;
        }
        if (pid && value === pid) return false;
        return true;
      });
      if (!filtered.length) {
        list.splice(idx, 1);
      } else {
        list[idx] = { ...current, targets: filtered };
      }
    }
    await apiFetchJSON("/admin/attendance/schedule", {
      method: "PUT",
      body: { overrides: sortOverrides(list) },
    });
    toast.success(ft("toast.overrideDeleted", "Override dihapus."));
    if (overrideModal.open && overrideModal.editingId === overrideMeta.id) closeOverrideModal();
    fetchDaily(state.meta.page);
  } catch (err) {
    console.error(err);
    toast.error(err?.message || ft("error.deleteOverride", "Gagal menghapus override."));
  }
}

function formatScheduleSource(row) {
  const source = row?.schedule_source || row?.schedule_detail?.source || "default";
  if (source === "override") return ft("table.scheduleSource.override", "Override");
  if (source === "weekly") return row?.schedule_detail?.day || ft("table.scheduleSource.weekly", "Mingguan");
  return ft("table.scheduleSource.default", "Standar");
}

// date range (mirip AdminSchedulePage.vue)
const userLocale = typeof navigator !== "undefined" && navigator.language ? navigator.language : "id-ID";
const df = new DateFormatter(userLocale, { dateStyle: "full" });

// kalau user pilih range → isi start/end (YYYY-MM-DD) dan fetch
watch(
  () => [dateRange.value?.start, dateRange.value?.end],
  ([startVal, endVal]) => {
    const sVal = startVal ? startVal.toString() : "";
    const eVal = endVal ? endVal.toString() : sVal;
    start.value = sVal;
    end.value = eVal;
    debounceFetch();
  },
  { immediate: false } // <— ini kuncinya, biar gak langsung jalan saat mount
);

function clearDateRange() {
  dateRange.value = { start: undefined, end: undefined };
  start.value = "";
  end.value = "";
  debounceFetch();
}

const modal = reactive({ open: false, title: "", rows: [], date: "", label: "" });
async function openDayDetail(row) {
  try {
    const params = new URLSearchParams({ person_id: row.person_id, date: row.date, order: "asc" });
    const data = await apiFetchJSON(`/admin/attendance/log?${params}`, { method: "GET" });
    modal.open = true;
    modal.title = ft("detailModal.title", `${row.label} - ${row.date}`, { label: row.label, date: row.date });
    modal.rows = data.items || [];
    modal.date = row.date;
    modal.label = row.label;
  } catch {
    toast.error(ft("error.openLog", "Gagal membuka detail log."));
  }
}
function closeModal() {
  modal.open = false;
  modal.rows = [];
}

async function deleteDay(row) {
  const confirmation = ft("confirm.deleteLog", "Hapus log untuk {label} pada {date}?", {
    label: row.label,
    date: row.date,
  });
  const confirmed = await confirmDialog({
    title: ft("confirm.deleteDayTitle", "Hapus log harian?"),
    description: confirmation,
    confirmText: t("common.delete", "Hapus"),
    cancelText: t("common.cancel", "Batal"),
  });
  if (!confirmed) return;
  try {
    await apiFetchJSON("/admin/attendance/daily/delete", {
      method: "POST",
      body: { label: row.label, date: row.date, person_id: row.person_id || null },
    });
    toast.success(ft("toast.logDeleted", "Log dihapus."));
    fetchDaily(state.meta.page);
  } catch {
    toast.error(ft("error.deleteLog", "Gagal menghapus log."));
  }
}

async function exportCsv() {
  try {
    const params = new URLSearchParams({ order: order.value || "desc" });
    if (q.value?.trim()) params.set("q", q.value.trim());
    if (start.value?.trim()) params.set("start", start.value.trim());
    if (end.value?.trim()) params.set("end", end.value.trim());
    if (statusFilter.value && statusFilter.value !== "all") params.set("status", statusFilter.value);
    await download(`/admin/attendance/daily/export.csv?${params.toString()}`, "attendance_daily.csv");
  } catch (e) {
    console.error(e);
  }
}

// Selection (multi-select like AdminFaceDbPage)
const selectedKeys = ref(new Set());
const displayRows = computed(() =>
  (state.items || []).map((row) => {
    const key = `${row.date}::${String(row.person_id || row.label || "").trim()}`;
    return { ...row, _key: key, _checked: selectedKeys.value.has(key) };
  })
);
const allSelected = computed(
  () => displayRows.value.length > 0 && selectedKeys.value.size === displayRows.value.length
);
const someSelected = computed(() => selectedKeys.value.size > 0 && !allSelected.value);
const headerModel = computed(() => (allSelected.value ? true : someSelected.value ? null : false));
function setHeaderModel(v) {
  if (v) {
    const next = new Set();
    displayRows.value.forEach((row) => next.add(row._key));
    selectedKeys.value = next;
  } else {
    selectedKeys.value = new Set();
  }
}
function toggleRowSelected(row) {
  const next = new Set(selectedKeys.value);
  if (next.has(row._key)) next.delete(row._key);
  else next.add(row._key);
  selectedKeys.value = next;
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

function statusBadgeClass(tag) {
  const normalized = String(tag || "").toLowerCase();
  if (normalized.includes("late")) return "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200";
  if (normalized.includes("early")) return "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200";
  if (normalized.includes("off")) return "bg-slate-200 text-slate-700 dark:bg-slate-600/30 dark:text-slate-200";
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200";
}
function formatStatusLabel(status) {
  const normalized = String(status || "").toLowerCase();
  if (!status) return ft("table.status.present", "Hadir");
  if (normalized.includes("off")) return ft("table.status.off", "Libur");
  if (normalized.includes("late") && normalized.includes("left early"))
    return ft("table.status.mixed", "Terlambat & Pulang awal");
  if (normalized.includes("late")) return ft("table.status.late", "Terlambat");
  if (normalized.includes("left early") || normalized.includes("early")) return ft("table.status.early", "Pulang awal");
  if (normalized.includes("present") || normalized.includes("on time")) return ft("table.status.present", "Hadir");
  return status;
}

onMounted(() => fetchDaily(1));
onMounted(() => {
  searchQuery.value = q.value || "";
  ensurePeopleOptions();
});
watch(q, () => debounceFetch());
watch(perPage, () => fetchDaily(1));
watch(order, () => fetchDaily(1));
watch(statusFilter, () => fetchDaily(1));
watch(
  () => state.meta.page,
  (p, prev) => {
    if (p !== prev) fetchDaily(p);
  }
);
</script>

<template>
  <div class="space-y-6">
    <Card>
      <CardContent class="p-6 space-y-6">
        <!-- Pagination controls (top) -->
        <div class="items-center justify-start w-full flex flex-col md:flex-wrap gap-3 text-sm">
          <div class="flex flex-wrap md:flex-nowrap w-full gap-3">
            <div class="flex flex-wrap items-center gap-3">
              <div class="space-y-1">
                <Label class="text-xs font-semibold">{{
                  ft("filters.searchPlaceholder", "Cari nama anggota...")
                }}</Label>
                <div class="flex items-center gap-2">
                  <Combobox
                    v-model="q"
                    :open="searchOpen"
                    @update:open="
                      (v) => {
                        searchOpen = v;
                        if (v) ensurePeopleOptions();
                      }
                    ">
                    <ComboboxAnchor class="w-fit">
                      <ComboboxTrigger>
                        <Button variant="outline" class="justify-between">
                          {{ q || ft("filters.searchPlaceholder", "Cari nama anggota...") }}
                          <span class="ti ti-selector ml-2 h-4 w-4 shrink-0 opacity-50"></span>
                        </Button>
                      </ComboboxTrigger>
                    </ComboboxAnchor>
                    <ComboboxList v-if="searchOpen">
                      <ComboboxInput
                        v-model="searchQuery"
                        :placeholder="ft('filters.searchPlaceholder', 'Cari nama anggota...')"
                        @keydown.enter.prevent="commitSearchQuery"
                        autocomplete="off" />
                      <ComboboxEmpty>{{ ft("filters.noMatches", "Tidak ada hasil") }}</ComboboxEmpty>
                      <ComboboxViewport>
                        <ComboboxItem
                          v-if="
                            searchQuery &&
                            Array.isArray(allPeopleOptions) &&
                            !allPeopleOptions.some((p) => {
                              const label = (typeof p === 'object' ? p?.label : p) ?? '';
                              return label.toLowerCase() === String(searchQuery).toLowerCase();
                            })
                          "
                          :value="searchQuery">
                          <span> {{ ft("filters.search", "Cari") }}: "{{ searchQuery }}" </span>
                        </ComboboxItem>
                        <ComboboxItem v-for="option in filteredPeopleForSearch" :key="`opt-${option}`" :value="option">
                          <span>{{ option }}</span>
                        </ComboboxItem>
                      </ComboboxViewport>
                    </ComboboxList>
                  </Combobox>
                </div>
              </div>

              <div class="space-y-1">
                <Label class="text-xs font-semibold">{{ ft("filters.statusLabel", "Status") }}</Label>
                <Select :model-value="statusFilter" @update:model-value="(v) => (statusFilter = v)">
                  <SelectTrigger class="min-w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="option in statusOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="space-y-1">
                <Label class="text-xs font-semibold">{{ ft("pagination.perPage", "Per halaman") }}</Label>
                <Select :model-value="String(perPage)" @update:model-value="(v) => (perPage = Number(v))">
                  <SelectTrigger>
                    <SelectValue :placeholder="String(perPage)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div class="space-y-1">
                <Label class="text-xs font-semibold">{{ ft("pagination.order", "Urutan") }}</Label>
                <Select :model-value="order" @update:model-value="(v) => (order = v)">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desc">{{ ft("pagination.newest", "Terbaru") }}</SelectItem>
                    <SelectItem value="asc">{{ ft("pagination.oldest", "Terlama") }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <!-- Date range (shadcn-vue) -->
            <div class="flex w-full items-start gap-1 sm:w-auto flex-col">
              <Label class="text-xs font-semibold">{{ ft("pagination.rangeDate", "Range Tanggal") }}</Label>

              <div class="flex">
                <Popover v-model:open="datePopoverOpen">
                  <PopoverTrigger as-child>
                    <Button variant="outline">
                      <span>
                        <template v-if="dateRange?.start">
                          <template v-if="dateRange?.end">
                            {{ df.format(dateRange.start.toDate(getLocalTimeZone())) }}
                            &nbsp;–&nbsp;
                            {{ df.format(dateRange.end.toDate(getLocalTimeZone())) }}
                          </template>
                          <template v-else>
                            {{ df.format(dateRange.start.toDate(getLocalTimeZone())) }}
                          </template>
                        </template>
                        <template v-else>
                          {{ ft("filters.pickDate", "Pilih rentang tanggal") }}
                        </template>
                      </span>
                      <i class="ti ti-calendar text-base"></i>
                    </Button>
                  </PopoverTrigger>

                  <PopoverContent class="w-auto p-0" align="start" :trap-focus="false">
                    <RangeCalendar v-model="dateRange" :number-of-months="2" initial-focus />
                  </PopoverContent>
                </Popover>
                <Button variant="ghost" class="px-3 py-1" @click="clearDateRange" :disabled="!dateRange?.start">
                  {{ ft("filters.clear", "Bersihkan") }}
                </Button>
              </div>
            </div>
          </div>

          <div class="flex items-center justify-between w-full gap-3 text-sm">
            <span class="text-muted-foreground">
              {{ ft("pagination.totalLabel", "Total") }}:{{ state.meta.total }}
            </span>
            <template v-if="Number(state.meta.total) > 0">
              <Pagination
                v-model:page="state.meta.page"
                :items-per-page="Number(state.meta.per_page)"
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
        </div>

        <div class="w-full space-y-6">
          <div v-if="state.loading" class="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            {{ ft("state.loading", "Memuat data attendance...") }}
          </div>

          <!-- Desktop table -->
          <div v-if="!state.loading" class="hidden md:block">
            <div class="overflow-x-auto">
              <Table class="min-w-[880px]">
                <TableHeader>
                  <TableRow>
                    <TableHead class="w-[36px]">
                      <div class="flex items-center justify-center">
                        <Checkbox :model-value="headerModel" @update:modelValue="setHeaderModel" />
                      </div>
                    </TableHead>
                    <TableHead>{{ ft("table.columns.member", "Anggota") }}</TableHead>
                    <TableHead>{{ ft("table.columns.date", "Tanggal") }}</TableHead>
                    <TableHead>{{ ft("table.columns.checkIn", "Jam Masuk") }}</TableHead>
                    <TableHead>{{ ft("table.columns.checkOut", "Jam Pulang") }}</TableHead>
                    <TableHead>{{ ft("table.columns.schedule", "Jadwal") }}</TableHead>
                    <TableHead>{{ ft("table.columns.status", "Status") }}</TableHead>
                    <TableHead class="text-right">{{ ft("table.columns.actions", "Aksi") }}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="row in displayRows" :key="row._key">
                    <TableCell class="text-center">
                      <Checkbox :model-value="row._checked" @update:modelValue="() => toggleRowSelected(row)" />
                    </TableCell>
                    <TableCell class="tabular-nums">
                      <div class="flex flex-row items-center gap-2">
                        <i class="ti ti-user text-muted-foreground" />
                        <div class="flex flex-col gap-2">
                          <span class="text-xs text-muted-foreground">
                            {{ ft("table.inline.idPrefix", "ID") }}: {{ row.person_id }}
                          </span>
                          <span class="font-medium">{{ peopleMap.get(String(row.person_id || "")) || row.label }}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell class="tabular-nums">
                      {{ df.format(parseDate(String(row.date)).toDate(getLocalTimeZone())) }}
                    </TableCell>
                    <TableCell class="tabular-nums">{{ row.check_in }}</TableCell>
                    <TableCell class="tabular-nums">{{ row.check_out }}</TableCell>
                    <TableCell>
                      <div class="flex flex-col gap-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="font-semibold">
                            {{ row.schedule || ft("table.scheduleFallback", "Jam Kerja Normal") }}
                          </span>
                          <Badge
                            :class="[
                              row.schedule_source === 'override'
                                ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200'
                                : row.schedule_source === 'weekly'
                                ? 'bg-slate-200 text-slate-700 dark:bg-slate-600/30 dark:text-slate-200'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-200',
                            ]">
                            {{ formatScheduleSource(row) }}
                          </Badge>
                        </div>
                        <div v-if="row.schedule_override?.targets?.length" class="flex flex-wrap gap-1">
                          <Badge
                            v-for="target in row.schedule_override.targets"
                            :title="targetTitle(target)"
                            :key="`override-target-${target && target.value ? target.value : String(target)}`"
                            variant="default">
                            {{
                              (target && target.label) ||
                              peopleMap.get(String(target && target.value ? target.value : target)) ||
                              (target && target.value ? target.value : target)
                            }}
                          </Badge>
                        </div>
                        <div class="space-y-1 text-xs text-muted-foreground">
                          <p>
                            {{
                              ft("table.graceSummary", "Grace: {in}/{out} menit", {
                                in: row.schedule_detail?.grace_in_min ?? 0,
                                out: row.schedule_detail?.grace_out_min ?? 0,
                              })
                            }}
                          </p>
                          <p v-if="row.schedule_detail?.notes">
                            {{ ft("table.notesPrefix", "Catatan: {notes}", { notes: row.schedule_detail.notes }) }}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge :class="['px-3 py-1 text-xs font-semibold', statusBadgeClass(row.status)]">
                        {{ formatStatusLabel(row.status) }}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div class="flex flex-wrap items-center gap-2 justify-end">
                        <Button variant="outline" size="sm" @click="openDayDetail(row)">
                          {{ ft("actions.view", "Lihat") }}
                        </Button>
                        <Button size="sm" @click="openOverrideModalForRow(row)">
                          {{
                            row.schedule_source === "override"
                              ? ft("actions.editOverride", "Ubah Override")
                              : ft("actions.customSchedule", "Jadwal Khusus")
                          }}
                        </Button>
                        <Button
                          v-if="row.schedule_override"
                          variant="destructive"
                          size="sm"
                          @click="removeOverrideForRow(row)">
                          {{ ft("actions.deleteOverride", "Hapus Override") }}
                        </Button>
                        <Button variant="destructive" size="sm" @click="deleteDay(row)">
                          {{ ft("actions.deleteLog", "Hapus Log") }}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>

                  <TableRow v-if="!displayRows.length">
                    <TableCell colspan="8" class="text-center text-muted-foreground">
                      {{ ft("table.noData", "Tidak ada data") }}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>

          <!-- Mobile cards -->
          <div v-if="!state.loading" class="md:hidden">
            <div v-if="displayRows.length" class="grid gap-4">
              <article
                v-for="row in displayRows"
                :key="`${row.label}-${row.date}`"
                class="rounded-xl border p-4 shadow-sm">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <p class="text-xs text-muted-foreground">
                      {{ ft("table.inline.idPrefix", "ID") }}: {{ row.person_id }}
                    </p>
                    <p class="text-base font-semibold">{{ row.label }}</p>
                    <p class="text-sm text-muted-foreground">
                      {{ df.format(parseDate(String(row.date)).toDate(getLocalTimeZone())) }}
                    </p>
                  </div>
                  <Badge :class="['px-3 py-1 text-xs font-semibold', statusBadgeClass(row.status)]">
                    {{ formatStatusLabel(row.status) }}
                  </Badge>
                </div>
                <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt class="text-xs uppercase tracking-wide text-muted-foreground">
                      {{ ft("table.columns.checkIn", "Jam Masuk") }}
                    </dt>
                    <dd class="tabular-nums">{{ row.check_in }}</dd>
                  </div>
                  <div>
                    <dt class="text-xs uppercase tracking-wide text-muted-foreground">
                      {{ ft("table.columns.checkOut", "Jam Pulang") }}
                    </dt>
                    <dd class="tabular-nums">{{ row.check_out }}</dd>
                  </div>
                  <div class="col-span-2">
                    <dt class="text-xs uppercase tracking-wide text-muted-foreground">
                      {{ ft("table.columns.schedule", "Jadwal") }}
                    </dt>
                    <dd class="mt-1 space-y-1">
                      <p>{{ row.schedule || ft("table.scheduleFallback", "Jam Kerja Normal") }}</p>
                      <p class="text-xs text-muted-foreground">{{ formatScheduleSource(row) }}</p>
                      <p class="text-xs text-muted-foreground">
                        {{
                          ft("table.graceSummary", "Grace: {in}/{out} menit", {
                            in: row.schedule_detail?.grace_in_min ?? 0,
                            out: row.schedule_detail?.grace_out_min ?? 0,
                          })
                        }}
                      </p>
                      <p v-if="row.schedule_detail?.notes" class="text-xs text-muted-foreground">
                        {{ ft("table.notesPrefix", "Catatan: {notes}", { notes: row.schedule_detail.notes }) }}
                      </p>
                    </dd>
                  </div>
                </dl>
                <div class="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" @click="openDayDetail(row)">
                    {{ ft("actions.view", "Lihat") }}
                  </Button>
                  <Button size="sm" @click="openOverrideModalForRow(row)">
                    {{
                      row.schedule_source === "override"
                        ? ft("actions.editOverride", "Ubah Override")
                        : ft("actions.customSchedule", "Jadwal Khusus")
                    }}
                  </Button>
                  <Button
                    v-if="row.schedule_override"
                    variant="destructive"
                    size="sm"
                    @click="removeOverrideForRow(row)">
                    {{ ft("actions.deleteOverride", "Hapus Override") }}
                  </Button>
                  <Button variant="destructive" size="sm" @click="deleteDay(row)">
                    {{ ft("actions.deleteLog", "Hapus Log") }}
                  </Button>
                </div>
              </article>
            </div>
            <p v-else class="text-center text-sm text-muted-foreground">
              {{ ft("table.noData", "Tidak ada data") }}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Detail Log Dialog -->
    <Dialog v-model:open="modal.open">
      <DialogContent class="max-w-2xl" @open-auto-focus.prevent @close-auto-focus.prevent>
        <DialogHeader>
          <DialogTitle>
            {{
              ft("detailModal.title", "{label} — {date}", {
                label: modal.label,
                date: df.format(parseDate(String(modal.date)).toDate(getLocalTimeZone())),
              })
            }}
          </DialogTitle>
          <DialogDescription>{{ ft("detailModal.desc", "Log untuk tanggal ini") }}</DialogDescription>
        </DialogHeader>
        <div class="max-h-[60vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{{ ft("detailModal.columns.time", "Waktu") }}</TableHead>
                <TableHead>{{ ft("detailModal.columns.score", "Skor") }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="(r, idx) in modal.rows" :key="idx">
                <TableCell class="tabular-nums">
                  {{ new Date(r.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" , hour12: false}) }}
                </TableCell>
                <TableCell class="tabular-nums">{{ Number(r.score).toFixed(3) }}</TableCell>
              </TableRow>
              <TableRow v-if="!modal.rows.length">
                <TableCell colspan="2" class="text-center text-muted-foreground">
                  {{ ft("detailModal.empty", "Tidak ada log") }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="closeModal">{{ ft("detailModal.close", "Tutup") }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Override Dialog -->
    <OverrideEditorModal
      v-model="overrideModal.open"
      :form="overrideModal.form"
      :loading="overrideModal.loading"
      :saving="overrideModal.saving"
      :defaults="overrideModal.defaults"
      :texts="overrideModalTexts"
      :allow-scope="true"
      :allow-single-day="true"
      :people-options="allPeopleOptions"
      :people-loading="peopleLoading"
      :people-error="peopleError"
      :locale="userLocale"
      @submit="submitOverrideModal"
      @cancel="closeOverrideModal"
      @ensure-people="() => ensurePeopleOptions(true)" />
  </div>
</template>
