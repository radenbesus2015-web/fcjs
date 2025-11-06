<script setup>
import { computed, onMounted, reactive, watch, ref } from "vue";
import { apiFetchJSON } from "@/utils/api";
import { toast } from "@/utils/toast";
import { useI18n } from "@/i18n";
import { normalizeIdTargets } from "@/utils/overrides";
import { useConfirmDialog } from "@/composables/useConfirmDialog";

// shadcn-vue UI
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { parseDate, CalendarDate, DateFormatter, getLocalTimeZone } from "@internationalized/date";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import OverrideEditorModal from "@/components/modals/OverrideEditorModal.vue";

const { t } = useI18n();
const confirmDialog = useConfirmDialog();
const lt = (path, fallback, values) => t(`adminSchedule.${path}`, fallback, values);

const DAYS = [
  { key: "monday", day: "Senin", short: "Sen" },
  { key: "tuesday", day: "Selasa", short: "Sel" },
  { key: "wednesday", day: "Rabu", short: "Rab" },
  { key: "thursday", day: "Kamis", short: "Kam" },
  { key: "friday", day: "Jumat", short: "Jum" },
  { key: "saturday", day: "Sabtu", short: "Sab" },
  { key: "sunday", day: "Minggu", short: "Min" },
];

const WORKDAYS = DAYS.slice(0, 5).map(({ day }) => day);
const WEEKEND_DAYS = DAYS.slice(5).map(({ day }) => day);
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const GRACE_LIMIT = { min: 0, max: 240 };
const FALLBACK_GRACE = { grace_in_min: 10, grace_out_min: 5 };

function clampGrace(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(GRACE_LIMIT.max, Math.max(GRACE_LIMIT.min, Math.round(n)));
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isHolidayLabel(label) {
  const s = String(label || "").toLowerCase();
  return s.includes("libur") || s.includes("holiday");
}

function statusTextFor(item) {
  // Show explicit labels for switch semantics: On = Hari Masuk, Off = Hari Libur
  if (item?.enabled) return t("adminSchedule.common.onLabel", "Hari Masuk");
  return t("adminSchedule.common.offLabel", "Hari Libur");
}

function dayLabel(day) {
  const entry = DAYS.find((item) => item.day === day);
  if (!entry) return day;
  return t(`adminSchedule.days.${entry.key}`, entry.day);
}

function dayShortLabel(day) {
  const entry = DAYS.find((item) => item.day === day);
  if (!entry) return day.slice(0, 3);
  return t(`adminSchedule.daysShort.${entry.key}`, entry.short);
}

function defaultRule(day, graceDefaults = FALLBACK_GRACE) {
  const isWeekend = WEEKEND_DAYS.includes(day);
  const graceIn = clampGrace(isWeekend ? 0 : graceDefaults?.grace_in_min, FALLBACK_GRACE.grace_in_min);
  const graceOut = clampGrace(isWeekend ? 0 : graceDefaults?.grace_out_min, FALLBACK_GRACE.grace_out_min);
  return {
    day,
    label: isWeekend
      ? t("adminSchedule.defaults.weekendLabel", "Hari Libur")
      : t("adminSchedule.defaults.workdayLabel", "Jam Kerja Normal"),
    enabled: !isWeekend,
    check_in: isWeekend ? "" : "08:30",
    check_out: isWeekend ? "" : "17:00",
    grace_in_min: graceIn,
    grace_out_min: graceOut,
    notes: isWeekend ? t("adminSchedule.defaults.weekendNotes", "Libur akhir pekan") : "",
  };
}

const genId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `ov_${Math.random().toString(36).slice(2, 10)}`;

function normalizeOverrides(raw = [], graceDefaults = FALLBACK_GRACE) {
  const defaults = {
    grace_in_min: clampGrace(graceDefaults?.grace_in_min, FALLBACK_GRACE.grace_in_min),
    grace_out_min: clampGrace(graceDefaults?.grace_out_min, FALLBACK_GRACE.grace_out_min),
  };
  const list = (raw || [])
    .map((entry) => {
      const start = String(entry?.start_date || entry?.startDate || "").slice(0, 10);
      if (!start) return null;
      const endRaw = String(entry?.end_date || entry?.endDate || start).slice(0, 10) || start;
      const range = [start, endRaw].sort();
      const enabled = entry?.enabled !== false;
      const graceIn = Number.isFinite(Number(entry?.grace_in_min)) ? Number(entry.grace_in_min) : defaults.grace_in_min;
      const graceOut = Number.isFinite(Number(entry?.grace_out_min))
        ? Number(entry.grace_out_min)
        : defaults.grace_out_min;
      const targets = normalizeIdTargets(entry?.targets || []);
      return {
        id: entry?.id || genId(),
        start_date: range[0],
        end_date: range[1],
        label: (entry?.label ?? t("adminSchedule.overrides.defaultLabel", "Jadwal Khusus")).toString(),
        enabled,
        check_in: typeof entry?.check_in === "string" ? entry.check_in : enabled ? "08:30" : "",
        check_out: typeof entry?.check_out === "string" ? entry.check_out : enabled ? "17:00" : "",
        grace_in_min: enabled ? clampGrace(graceIn, defaults.grace_in_min) : 0,
        grace_out_min: enabled ? clampGrace(graceOut, defaults.grace_out_min) : 0,
        notes: (entry?.notes ?? "").toString(),
        targets,
        scope: targets.length ? "individual" : "all",
      };
    })
    .filter(Boolean);
  return sortOverrides(list);
}

function sortOverrides(list = []) {
  return [...(list || [])].sort((a, b) => {
    if (a.start_date === b.start_date) {
      if (a.end_date === b.end_date) {
        return a.label.localeCompare(b.label);
      }
      return a.end_date.localeCompare(b.end_date);
    }
    return a.start_date.localeCompare(b.start_date);
  });
}
function normalizeRules(raw = [], graceDefaults = FALLBACK_GRACE) {
  const map = new Map();
  (raw || []).forEach((entry) => {
    if (entry && entry.day) {
      map.set(entry.day, entry);
    }
  });
  return DAYS.map(({ day }) => {
    const base = defaultRule(day, graceDefaults);
    if (!map.has(day)) return base;
    const payload = map.get(day);
    const enabled = payload.enabled !== undefined ? Boolean(payload.enabled) : base.enabled;
    const checkIn =
      typeof payload.check_in === "string" ? payload.check_in : payload.check_in ? String(payload.check_in) : "";
    const checkOut =
      typeof payload.check_out === "string" ? payload.check_out : payload.check_out ? String(payload.check_out) : "";
    return {
      day,
      label: (payload.label ?? base.label ?? "").toString(),
      enabled,
      check_in: checkIn || (enabled ? base.check_in : ""),
      check_out: checkOut || (enabled ? base.check_out : ""),
      grace_in_min: Number.isFinite(Number(payload.grace_in_min))
        ? clampGrace(payload.grace_in_min, base.grace_in_min)
        : base.grace_in_min,
      grace_out_min: Number.isFinite(Number(payload.grace_out_min))
        ? clampGrace(payload.grace_out_min, base.grace_out_min)
        : base.grace_out_min,
      notes: (payload.notes ?? base.notes ?? "").toString(),
    };
  });
}

const presetOptions = computed(() => [
  {
    key: "workday",
    label: t("adminSchedule.presets.workday.label", "Jam Normal"),
    description: t("adminSchedule.presets.workday.description", "08:30-17:00, toleransi 10/5m"),
    data: {
      enabled: true,
      label: t("adminSchedule.presets.workday.dataLabel", "Jam Kerja Normal"),
      check_in: "08:30",
      check_out: "17:00",
      grace_in_min: 10,
      grace_out_min: 5,
      notes: "",
    },
  },
  {
    key: "halfday",
    label: t("adminSchedule.presets.halfday.label", "Shift Pagi"),
    description: t("adminSchedule.presets.halfday.description", "08:30-13:00"),
    data: {
      enabled: true,
      label: t("adminSchedule.presets.halfday.dataLabel", "Shift Pagi"),
      check_in: "08:30",
      check_out: "13:00",
      grace_in_min: 5,
      grace_out_min: 0,
      notes: t("adminSchedule.presets.halfday.notes", "Shift pagi setengah hari."),
    },
  },
  {
    key: "evening",
    label: t("adminSchedule.presets.evening.label", "Shift Sore"),
    description: t("adminSchedule.presets.evening.description", "13:00-21:00"),
    data: {
      enabled: true,
      label: t("adminSchedule.presets.evening.dataLabel", "Shift Sore"),
      check_in: "13:00",
      check_out: "21:00",
      grace_in_min: 5,
      grace_out_min: 5,
      notes: t("adminSchedule.presets.evening.notes", "Shift sore / penutupan."),
    },
  },
  {
    key: "wfh",
    label: t("adminSchedule.presets.wfh.label", "WFH Fleksibel"),
    description: t("adminSchedule.presets.wfh.description", "09:00-17:00, toleransi 30m"),
    data: {
      enabled: true,
      label: t("adminSchedule.presets.wfh.dataLabel", "WFH Fleksibel"),
      check_in: "09:00",
      check_out: "17:00",
      grace_in_min: 30,
      grace_out_min: 10,
      notes: t("adminSchedule.presets.wfh.notes", "WFH dengan toleransi keterlambatan 30 menit."),
    },
  },
  {
    key: "off",
    label: t("adminSchedule.presets.off.label", "Libur / Nonaktif"),
    description: t("adminSchedule.presets.off.description", "Matikan jadwal"),
    data: {
      enabled: false,
      label: t("adminSchedule.presets.off.dataLabel", "Hari Libur"),
      check_in: "",
      check_out: "",
      grace_in_min: 0,
      grace_out_min: 0,
      notes: t("adminSchedule.presets.off.notes", "Tidak ada jam kerja terjadwal."),
    },
  },
]);

const state = reactive({
  loading: false,
  saving: false,
  rules: normalizeRules([], FALLBACK_GRACE),
  original: [],
  attendance: {
    grace_in_min: FALLBACK_GRACE.grace_in_min,
    grace_out_min: FALLBACK_GRACE.grace_out_min,
  },
  originalAttendance: {
    grace_in_min: FALLBACK_GRACE.grace_in_min,
    grace_out_min: FALLBACK_GRACE.grace_out_min,
  },
  selectedDay: "Senin",
  errors: {},
  copy: { open: false, targets: [] },
  overrides: [],
  originalOverrides: [],
});

const peopleOptions = ref([]); // [{ id: '123', label: 'Nama' }]

const allPeopleOptions = computed(() => {
  const seen = new Set();
  const merged = [];
  const push = (id, label) => {
    if (!id) return;
    const key = String(id).trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push({ id: key, label: label?.trim() || key });
  };

  (peopleOptions.value || []).forEach((p) => push(p?.id, p?.label));

  const collectTargets = (list) => {
    (list || []).forEach((ov) => {
      (ov?.targets || []).forEach((t) => {
        if (!t && t !== 0) return;
        if (typeof t === "object") {
          push(t.value ?? t.id ?? t.person_id, t.label);
        } else {
          push(String(t), String(t));
        }
      });
    });
  };

  collectTargets(state.overrides);
  collectTargets(state.originalOverrides);

  return merged;
});

const peopleMap = computed(() => {
  const map = new Map;
  allPeopleOptions.value.forEach((p) => map.set(String(p.id), String(p.label)));
  return map;
});
const peopleLoading = ref(false);
const peopleLoaded = ref(false);
const peopleError = ref("");

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
    // unique by id
    const seen = new Set();
    peopleOptions.value = mapped.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
    peopleLoaded.value = true;
  } catch (err) {
    console.error(err);
    peopleError.value = err?.message || lt("error.loadPeople", "Gagal memuat daftar wajah.");
  } finally {
    peopleLoading.value = false;
  }
}

function decorateOverrideTargets(list) {
  const optionMap = new Map();
  (peopleOptions.value || []).forEach((p) => optionMap.set(String(p.id), String(p.label)));
  return (list || []).map((ov) => {
    const targets = normalizeIdTargets(ov?.targets || []);
    const hydrated = targets.map((target) => {
      if (target && target.label) {
        optionMap.set(String(target.value || ""), target.label);
        return target;
      }
      const rawValue =
        typeof target === "object"
          ? String(target.value ?? target.id ?? target.person_id ?? "")
          : String(target ?? "");
      const lookup = optionMap.get(String(target?.value || "")) || "";
      const label = lookup.trim() || rawValue.trim();
      return label ? { ...target, label } : { ...target, label: rawValue };
    });
    return { ...ov, targets: hydrated };
  });
}
function defaultOverrideForm() {
  return {
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

const overrideEditor = reactive({
  open: false,
  editingId: null,
  loading: false,
  saving: false,
  form: defaultOverrideForm(),
});
// Date range untuk shadcn-vue Calendar (wajib DateValue, bukan JS Date)
function getGraceDefaults() {
  return {
    grace_in_min: clampGrace(state.attendance?.grace_in_min, FALLBACK_GRACE.grace_in_min),
    grace_out_min: clampGrace(state.attendance?.grace_out_min, FALLBACK_GRACE.grace_out_min),
  };
}

// Helpers that were referenced in rule updates
function graceDefaultIn() {
  return getGraceDefaults().grace_in_min;
}
function graceDefaultOut() {
  return getGraceDefaults().grace_out_min;
}
function syncAttendanceGrace() {
  const defaults = getGraceDefaults();
  state.attendance.grace_in_min = defaults.grace_in_min;
  state.attendance.grace_out_min = defaults.grace_out_min;
}

function isValidTime(value) {
  return Boolean(value) && TIME_RE.test(String(value));
}
function normalizeTime(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const str = String(value).trim();
  if (!str) return fallback;
  if (TIME_RE.test(str)) return str;
  return fallback;
}
function clampMinutes(value, fallback = 0) {
  return clampGrace(value, fallback);
}
function timeToMinutes(value) {
  if (!isValidTime(value)) return 0;
  const [h, m] = String(value).split(":");
  return Number(h) * 60 + Number(m);
}

// Sync single-day flag and end_date when toggled
watch(
  () => overrideEditor.form.singleDay,
  (single) => {
    if (single) {
      overrideEditor.form.end_date = overrideEditor.form.start_date || overrideEditor.form.end_date || "";
    }
  }
);

watch(
  () => overrideEditor.form.start_date,
  (value) => {
    if (overrideEditor.form.singleDay) {
      overrideEditor.form.end_date = value || "";
    }
  }
);

// watch(
//   (rng) => {
//     if (!rng || !rng.start) return;
//     overrideEditor.form.start_date = rng.start.toString(); // "YYYY-MM-DD"
//     overrideEditor.form.end_date = (rng.end ?? rng.start).toString();
//     overrideEditor.form.singleDay = overrideEditor.form.start_date === overrideEditor.form.end_date;
//   },
//   { deep: true }
// );

const selectedRule = computed(() => state.rules.find((rule) => rule.day === state.selectedDay) || null);
const selectedErrors = computed(() => state.errors[state.selectedDay] || []);
const isDirty = computed(() => {
  const rulesChanged = JSON.stringify(state.rules) !== JSON.stringify(state.original);
  const graceChanged = JSON.stringify(state.attendance) !== JSON.stringify(state.originalAttendance);
  const overridesChanged = JSON.stringify(state.overrides) !== JSON.stringify(state.originalOverrides);
  return rulesChanged || graceChanged || overridesChanged;
});
const hasErrors = computed(() => Object.values(state.errors).some((errs) => (errs || []).length));

// Global toggle for all days: Hari Masuk (On) / Hari Libur (Off)
const allEnabled = computed(() => state.rules.every((r) => !!r.enabled));
function setAllDaysEnabled(val) {
  const target = Boolean(val);
  state.rules.forEach((r) => updateRule(r.day, { enabled: target }));
  validateAll();
}

function validateRule(rule) {
  const errors = [];
  if (!rule.label || !rule.label.trim()) {
    errors.push(lt("errors.labelRequired", "Label wajib diisi."));
  }
  if (rule.enabled) {
    if (!isValidTime(rule.check_in)) {
      errors.push(lt("errors.checkInFormat", "Jam masuk harus menggunakan format JJ:MM."));
    }
    if (!isValidTime(rule.check_out)) {
      errors.push(lt("errors.checkOutFormat", "Jam pulang harus menggunakan format JJ:MM."));
    }
    if (
      isValidTime(rule.check_in) &&
      isValidTime(rule.check_out) &&
      Number(rule.check_out.split(":")[0]) * 60 + Number(rule.check_out.split(":")[1]) <=
        Number(rule.check_in.split(":")[0]) * 60 + Number(rule.check_in.split(":")[1])
    ) {
      errors.push(lt("errors.checkOutOrder", "Jam pulang harus lebih akhir dari jam masuk."));
    }
  } else {
    if (rule.check_in && !isValidTime(rule.check_in)) {
      errors.push(lt("errors.checkInInvalid", "Jam masuk tidak valid."));
    }
    if (rule.check_out && !isValidTime(rule.check_out)) {
      errors.push(lt("errors.checkOutInvalid", "Jam pulang tidak valid."));
    }
  }
  if (rule.grace_in_min < 0 || rule.grace_in_min > 240) {
    errors.push(lt("errors.graceInRange", "Grace masuk harus 0-240 menit."));
  }
  if (rule.grace_out_min < 0 || rule.grace_out_min > 240) {
    errors.push(lt("errors.graceOutRange", "Grace pulang harus 0-240 menit."));
  }
  state.errors[rule.day] = errors;
  return errors;
}

function validateAll() {
  let ok = true;
  state.rules.forEach((rule) => {
    const errs = validateRule(rule);
    if (errs.length) ok = false;
  });
  return ok;
}

// Overrides helpers and UI state
function setOverrides(list) {
  state.overrides = sortOverrides(decorateOverrideTargets(list));
}

const overridesSorted = computed(() => sortOverrides(state.overrides));

const userLocale = typeof navigator !== "undefined" && navigator.language ? navigator.language : "id-ID";
const df = new DateFormatter(userLocale, { dateStyle: "full" });
function fmtISODate(iso) {
  if (!iso) return "-";
  try {
    const d = parseDate(String(iso).slice(0, 10));
    return df.format(d.toDate(getLocalTimeZone()));
  } catch {
    return iso;
  }
}

function setRule(day, updater) {
  const idx = state.rules.findIndex((rule) => rule.day === day);
  if (idx === -1) return;
  const rule = state.rules[idx];
  updater(rule);
  validateRule(rule);
}

function updateRule(day, patch) {
  if (!patch) return;
  setRule(day, (rule) => {
    const defaultIn = graceDefaultIn();
    const defaultOut = graceDefaultOut();
    if (Object.prototype.hasOwnProperty.call(patch, "enabled")) {
      const enabled = Boolean(patch.enabled);
      rule.enabled = enabled;
      if (enabled) {
        if (!isValidTime(rule.check_in)) rule.check_in = "08:30";
        if (!isValidTime(rule.check_out)) rule.check_out = "17:00";
        rule.grace_in_min = clampMinutes(rule.grace_in_min ?? defaultIn, defaultIn);
        rule.grace_out_min = clampMinutes(rule.grace_out_min ?? defaultOut, defaultOut);
      } else {
        // Off/Libur: clear times and set grace to 0
        rule.check_in = "";
        rule.check_out = "";
        rule.grace_in_min = 0;
        rule.grace_out_min = 0;
        if (!String(rule.label || "").trim()) {
          rule.label = t("adminSchedule.defaults.weekendLabel", "Hari Libur");
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, "label")) {
      rule.label = String(patch.label || "").slice(0, 64);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "check_in")) {
      const current = rule.check_in || (rule.enabled ? "08:30" : "");
      rule.check_in = normalizeTime(patch.check_in, current);
      if (rule.enabled && !rule.check_in) {
        rule.check_in = "08:30";
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, "check_out")) {
      const current = rule.check_out || (rule.enabled ? "17:00" : "");
      rule.check_out = normalizeTime(patch.check_out, current);
      if (rule.enabled && !rule.check_out) {
        rule.check_out = "17:00";
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, "grace_in_min")) {
      rule.grace_in_min = clampMinutes(patch.grace_in_min, rule.enabled ? defaultIn : 0);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "grace_out_min")) {
      rule.grace_out_min = clampMinutes(patch.grace_out_min, rule.enabled ? defaultOut : 0);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "notes")) {
      rule.notes = String(patch.notes || "").slice(0, 280);
    }
  });
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

async function loadConfig() {
  state.loading = true;
  try {
    const data = await apiFetchJSON("/admin/attendance/schedule", { method: "GET" });
    const attendanceCfg = data?.attendance || {};
    const graceDefaults = {
      grace_in_min: clampGrace(attendanceCfg.grace_in_min, FALLBACK_GRACE.grace_in_min),
      grace_out_min: clampGrace(attendanceCfg.grace_out_min, FALLBACK_GRACE.grace_out_min),
    };
    state.attendance.grace_in_min = graceDefaults.grace_in_min;
    state.attendance.grace_out_min = graceDefaults.grace_out_min;
    state.originalAttendance = deepClone(graceDefaults);
    syncAttendanceGrace();
    setOverrides(normalizeOverrides(attendanceCfg?.overrides || [], graceDefaults));
    state.originalOverrides = deepClone(state.overrides);

    const rules = attendanceCfg?.rules || [];
    const prevSelected = state.selectedDay;
    state.rules = normalizeRules(rules, graceDefaults);
    state.original = deepClone(state.rules);
    state.errors = {};
    if (!state.rules.some((rule) => rule.day === prevSelected)) {
      state.selectedDay = "Senin";
    }
    validateAll();
  } catch (err) {
    console.error(err);
    toast.error(lt("error.loadConfig", "Gagal memuat konfigurasi jadwal."));
  } finally {
    state.loading = false;
  }
}

function sanitizedRules() {
  const defaults = getGraceDefaults();
  return state.rules.map((rule) => {
    const enabled = Boolean(rule.enabled);
    const payload = {
      day: rule.day,
      label: rule.label?.trim() || t("adminSchedule.defaults.workdayLabel", "Jam Kerja Normal"),
      enabled,
      check_in: rule.check_in && isValidTime(rule.check_in) ? rule.check_in : null,
      check_out: rule.check_out && isValidTime(rule.check_out) ? rule.check_out : null,
      grace_in_min: clampMinutes(rule.grace_in_min, enabled ? defaults.grace_in_min : 0),
      grace_out_min: clampMinutes(rule.grace_out_min, enabled ? defaults.grace_out_min : 0),
    };
    const notes = rule.notes?.trim();
    if (notes) payload.notes = notes;
    return payload;
  });
}

function sanitizedOverridesFrom(list) {
  const defaults = getGraceDefaults();
  return sortOverrides(list || []).map((item) => {
    const enabled = Boolean(item.enabled);
    const targets = normalizeIdTargets(item?.targets || []);
    const payload = {
      id: item.id,
      start_date: item.start_date,
      end_date: item.end_date || item.start_date,
      label: item.label || t("adminSchedule.overrides.defaultLabel", "Jadwal Khusus"),
      enabled,
      check_in: enabled && item.check_in ? item.check_in : null,
      check_out: enabled && item.check_out ? item.check_out : null,
      grace_in_min: enabled ? clampGrace(item.grace_in_min, defaults.grace_in_min) : 0,
      grace_out_min: enabled ? clampGrace(item.grace_out_min, defaults.grace_out_min) : 0,
      notes: item.notes || "",
    };
    payload.targets = targets;
    return payload;
  });
}

async function saveRules() {
  if (!validateAll()) {
    toast.error(lt("errors.hasIssues", "Periksa input jadwal yang masih bermasalah."));
    return;
  }
  state.saving = true;
  try {
    const rulesPayload = sanitizedRules();
    const graceDefaults = getGraceDefaults();
    const overridesPayload = sanitizedOverridesFrom(state.overrides);
    const resp = await apiFetchJSON("/admin/attendance/schedule", {
      method: "PUT",
      body: {
        grace_in_min: graceDefaults.grace_in_min,
        grace_out_min: graceDefaults.grace_out_min,
        rules: rulesPayload,
        overrides: overridesPayload,
      },
    });
    // Prefer server-echoed config to ensure persistence and normalization
    const attendanceCfg = resp?.attendance || {};
    const serverDefaults = {
      grace_in_min: clampGrace(attendanceCfg.grace_in_min, FALLBACK_GRACE.grace_in_min),
      grace_out_min: clampGrace(attendanceCfg.grace_out_min, FALLBACK_GRACE.grace_out_min),
    };
    state.attendance.grace_in_min = serverDefaults.grace_in_min;
    state.attendance.grace_out_min = serverDefaults.grace_out_min;
    state.originalAttendance = deepClone(serverDefaults);
    syncAttendanceGrace();
    state.rules = normalizeRules(attendanceCfg?.rules || [], serverDefaults);
    state.original = deepClone(state.rules);
    setOverrides(normalizeOverrides(attendanceCfg?.overrides || [], serverDefaults));
    state.originalOverrides = deepClone(state.overrides);
    toast.success(lt("toast.scheduleSaved", "Jadwal tersimpan."));
  } catch (err) {
    console.error(err);
    const msg = err?.message || lt("error.saveConfig", "Gagal menyimpan jadwal.");
    toast.error(msg);
  } finally {
    state.saving = false;
  }
}

function resetChanges() {
  state.rules = deepClone(state.original);
  state.attendance.grace_in_min = clampGrace(state.originalAttendance.grace_in_min, FALLBACK_GRACE.grace_in_min);
  state.attendance.grace_out_min = clampGrace(state.originalAttendance.grace_out_min, FALLBACK_GRACE.grace_out_min);
  syncAttendanceGrace();
  setOverrides(deepClone(state.originalOverrides));
  state.errors = {};
  validateAll();
}

function resetToDefault() {
  state.attendance.grace_in_min = FALLBACK_GRACE.grace_in_min;
  state.attendance.grace_out_min = FALLBACK_GRACE.grace_out_min;
  state.rules = normalizeRules([], state.attendance);
  syncAttendanceGrace();
  setOverrides([]);
  state.errors = {};
  validateAll();
}

function applyGraceDefaultsToAll() {
  const defaults = getGraceDefaults();
  state.rules.forEach((rule) => {
    if (!rule.enabled) {
      rule.grace_in_min = 0;
      rule.grace_out_min = 0;
      return;
    }
    rule.grace_in_min = clampMinutes(rule.grace_in_min ?? defaults.grace_in_min, defaults.grace_in_min);
    rule.grace_out_min = clampMinutes(rule.grace_out_min ?? defaults.grace_out_min, defaults.grace_out_min);
    validateRule(rule);
  });
  setOverrides(
    state.overrides.map((ov) => ({
      ...ov,
      grace_in_min: ov.enabled ? clampGrace(ov.grace_in_min ?? defaults.grace_in_min, defaults.grace_in_min) : 0,
      grace_out_min: ov.enabled ? clampGrace(ov.grace_out_min ?? defaults.grace_out_min, defaults.grace_out_min) : 0,
    }))
  );
  state.errors = {};
  validateAll();
  toast.success(lt("toast.graceApplied", "Grace default diterapkan ke semua hari."));
}

function applyPresetToSelected(key) {
  const preset = presetOptions.value.find((item) => item.key === key);
  const rule = selectedRule.value;
  if (!preset || !rule) return;
  updateRule(rule.day, preset.data);
  toast.success(
    lt("toast.presetApplied", "Preset {preset} diterapkan ke {day}.", {
      preset: preset.label,
      day: dayLabel(rule.day),
    })
  );
}

// Override editor texts for OverrideEditorModal
const overrideModalTexts = computed(() => ({
  title: overrideEditor.editingId
    ? t("adminSchedule.overrides.modal.title", "Override Jadwal")
    : t("adminSchedule.overrides.modal.title", "Override Jadwal"),
  description: t(
    "adminSchedule.overrides.modal.description",
    "Pilih rentang tanggal dan jam kerja untuk menimpa jadwal mingguan."
  ),
  loading: t("adminSchedule.overrides.modal.loading", "Memuat..."),
  fields: {
    label: t("adminSchedule.overrides.form.label", "Label"),
    range: t("adminSchedule.overrides.form.range", "Rentang Tanggal"),
    pickDate: t("adminSchedule.overrides.form.pickDate", "Pilih tanggal"),
    singleDay: t("adminSchedule.overrides.form.singleDay", "Satu hari"),
    active: t("adminSchedule.overrides.form.active", "Aktif"),
    checkIn: t("adminSchedule.overrides.form.checkIn", "Jam Masuk"),
    checkOut: t("adminSchedule.overrides.form.checkOut", "Jam Pulang"),
    graceIn: t("adminSchedule.overrides.form.graceIn", "Grace Masuk (menit)"),
    graceOut: t("adminSchedule.overrides.form.graceOut", "Grace Pulang (menit)"),
    notes: t("adminSchedule.overrides.form.notes", "Catatan"),
    notesPlaceholder: t("adminSchedule.form.notesPlaceholder", "Opsional"),
    scope: t("adminSchedule.overrides.form.scope", "Penerapan"),
    personLabel: t("adminSchedule.overrides.form.personLabel", "Pilih Anggota"),
    personPlaceholder: t("adminSchedule.overrides.form.personPlaceholder", "Cari nama..."),
  },
  active: {
    label: t("adminSchedule.overrides.form.activeLabel", "Hari Libur (Off) / Hari Masuk (On)"),
    on: t("adminSchedule.common.onLabel", "Hari Masuk"),
    off: t("adminSchedule.common.offLabel", "Hari Libur"),
  },
  actions: {
    cancel: t("common.cancel", "Batal"),
    save: t("adminSchedule.overrides.actions.save", "Simpan Override"),
    saving: t("adminSchedule.actions.saving", "Menyimpan..."),
  },
  scope: {
    allLabel: t("adminSchedule.overrides.scope.all", "Berlaku untuk semua"),
    individualLabel: t("adminSchedule.overrides.scope.individual", "Perorangan"),
    helpAll: t("adminSchedule.overrides.form.scopeHelpAll", "Override berlaku untuk semua anggota."),
    helpIndividual: t(
      "adminSchedule.overrides.form.scopeHelpIndividual",
      "Pilih anggota tertentu yang menerima jadwal khusus ini."
    ),
    badgeAll: t("adminSchedule.overrides.scope.all", "Berlaku untuk semua"),
  },
  people: {
    placeholder: t("adminSchedule.overrides.form.personPlaceholder", "Cari nama..."),
    noMatches: t("adminSchedule.overrides.form.noMatches", "Tidak ada hasil untuk pencarian ini."),
    noPeople: t("adminSchedule.overrides.form.noPeople", "Belum ada data wajah yang dapat dipilih."),
    loading: t("adminSchedule.overrides.people.loading", "Memuat daftar wajah..."),
    allSelected: t("adminSchedule.overrides.form.allSelected", "Semua anggota telah dipilih."),
  },
  common: {
    clear: t("common.clear", "Bersihkan"),
  },
}));

// Override editor operations
function openOverrideEditor(base = {}, { duplicate = false } = {}) {
  const defaults = getGraceDefaults();
  const start = (base.start_date || base.startDate || base.date || "").slice(0, 10);
  const end = (base.end_date || base.endDate || start || "").slice(0, 10);
  const enabled = base.enabled !== undefined ? Boolean(base.enabled) : true;
  const checkIn = typeof base.check_in === "string" ? base.check_in : enabled ? "08:30" : "";
  const checkOut = typeof base.check_out === "string" ? base.check_out : enabled ? "17:00" : "";

  overrideEditor.editingId = duplicate ? null : base.id || null;
  const targets = normalizeIdTargets(base.targets || []);
  overrideEditor.form = {
    start_date: start,
    end_date: end,
    singleDay: !end || end === start,
    label: base.label || "",
    enabled,
    check_in: checkIn,
    check_out: checkOut,
    grace_in_min: enabled ? clampGrace(base.grace_in_min ?? defaults.grace_in_min, defaults.grace_in_min) : 0,
    grace_out_min: enabled ? clampGrace(base.grace_out_min ?? defaults.grace_out_min, defaults.grace_out_min) : 0,
    notes: base.notes || "",
    scope: targets.length ? "individual" : "all",
    targets,
    personQuery: "",
  };
  overrideEditor.open = true;
  if (overrideEditor.form.scope === "individual") {
    ensurePeopleOptions();
  }
}

function openOverrideForSelectedDay() {
  const defaults = getGraceDefaults();
  const rule = selectedRule.value;
  const today = new Date().toISOString().slice(0, 10);
  openOverrideEditor({
    start_date: today,
    end_date: today,
    label: rule?.label || "",
    enabled: rule ? Boolean(rule.enabled) : true,
    check_in: rule?.check_in || (rule?.enabled === false ? "" : "08:30"),
    check_out: rule?.check_out || (rule?.enabled === false ? "" : "17:00"),
    grace_in_min: rule?.grace_in_min ?? defaults.grace_in_min,
    grace_out_min: rule?.grace_out_min ?? defaults.grace_out_min,
    notes: rule?.notes || "",
  });
}

function editOverride(id) {
  const current = state.overrides.find((ov) => ov.id === id);
  if (!current) return;
  openOverrideEditor(current);
}

function duplicateOverride(id) {
  const current = state.overrides.find((ov) => ov.id === id);
  if (!current) return;
  openOverrideEditor(current, { duplicate: true });
}

function closeOverrideEditor() {
  overrideEditor.open = false;
  overrideEditor.editingId = null;
  overrideEditor.form = defaultOverrideForm();
  overrideEditor.saving = false;
}

async function saveOverridesRemote(nextList) {
  const prev = state.overrides;
  setOverrides(nextList);
  try {
    const payload = sanitizedOverridesFrom(nextList);
    const resp = await apiFetchJSON("/admin/attendance/schedule", {
      method: "PUT",
      body: { overrides: payload },
    });
    const attendanceCfg = resp?.attendance || {};
    setOverrides(normalizeOverrides(attendanceCfg?.overrides || [], getGraceDefaults()));
    state.originalOverrides = deepClone(state.overrides);
    toast.success(lt("toast.overrideSaved", "Override tersimpan."));
  } catch (err) {
    setOverrides(prev);
    const msg = err?.message || lt("error.saveConfig", "Gagal menyimpan jadwal.");
    toast.error(msg);
    throw err;
  }
}

async function submitOverride() {
  const form = overrideEditor.form;
  const defaults = getGraceDefaults();
  const start = (form.start_date || "").trim();
  if (!start) {
    toast.error(lt("errors.overrideStartRequired", "Tanggal mulai wajib diisi."));
    return;
  }
  const endRaw = form.singleDay ? start : (form.end_date || "").trim() || start;
  const range = [start, endRaw].sort();
  const scope = form.scope === "individual" ? "individual" : "all";
  const targets = scope === "individual" ? normalizeIdTargets(form.targets || []) : [];
  if (scope === "individual" && !targets.length) {
    toast.error(lt("errors.overrideTargetsRequired", "Pilih minimal satu orang untuk override ini."));
    return;
  }
  if (form.enabled) {
    if (!TIME_RE.test(form.check_in || "")) {
      toast.error(lt("errors.overrideCheckInFormat", "Jam masuk override harus menggunakan format JJ:MM."));
      return;
    }
    if (!TIME_RE.test(form.check_out || "")) {
      toast.error(lt("errors.overrideCheckOutFormat", "Jam pulang override harus menggunakan format JJ:MM."));
      return;
    }
    if (timeToMinutes(form.check_out) <= timeToMinutes(form.check_in)) {
      toast.error(lt("errors.overrideCheckOrder", "Jam pulang override harus lebih akhir dari jam masuk."));
      return;
    }
  }
  const enabled = Boolean(form.enabled);
  const record = {
    id: overrideEditor.editingId || genId(),
    start_date: range[0],
    end_date: range[1],
    label: (form.label || "").trim() || t("adminSchedule.overrides.defaultLabel", "Jadwal Khusus"),
    enabled,
    check_in: enabled ? form.check_in || "08:30" : "",
    check_out: enabled ? form.check_out || "17:00" : "",
    grace_in_min: enabled ? clampGrace(form.grace_in_min || defaults.grace_in_min, defaults.grace_in_min) : 0,
    grace_out_min: enabled ? clampGrace(form.grace_out_min || defaults.grace_out_min, defaults.grace_out_min) : 0,
    notes: (form.notes || "").trim(),
    targets,
  };
  const next = state.overrides.filter((ov) => ov.id !== record.id);
  next.push(record);
  await saveOverridesRemote(next);
  closeOverrideEditor();
  // toast.success(lt("toast.overrideSaved", "Override tersimpan."));
}

async function removeOverride(id) {
  const confirmed = await confirmDialog({
    title: lt("confirm.removeOverrideTitle", "Hapus override?"),
    description: lt("confirm.removeOverride", "Hapus override jadwal ini?"),
    confirmText: t("common.delete", "Hapus"),
    cancelText: t("common.cancel", "Batal"),
  });
  if (!confirmed) return;
  const next = state.overrides.filter((ov) => ov.id !== id);
  await saveOverridesRemote(next);
  toast.success(lt("toast.overrideRemoved", "Override dihapus."));
}

function copyToDays(days, notify = true) {
  const source = selectedRule.value;
  if (!source) return;
  const targets = Array.from(new Set(days)).filter((day) => day && day !== source.day);
  if (!targets.length) {
    if (notify) toast.info(lt("toast.copyTargetsMissing", "Tidak ada hari tujuan yang dipilih."));
    return;
  }
  targets.forEach((day) => {
    updateRule(day, {
      label: source.label,
      enabled: source.enabled,
      check_in: source.check_in,
      check_out: source.check_out,
      grace_in_min: source.grace_in_min,
      grace_out_min: source.grace_out_min,
      notes: source.notes,
    });
  });
  if (notify) {
    const targetLabels = targets.map((day) => dayLabel(day)).join(", ");
    toast.success(
      lt("toast.copyApplied", "{source} disalin ke {targets}.", {
        source: dayLabel(source.day),
        targets: targetLabels,
      })
    );
  }
}

function toggleCopyPanel() {
  if (state.copy.open) {
    closeCopyPanel();
  } else {
    state.copy.open = true;
    state.copy.targets = [];
  }
}

function closeCopyPanel() {
  state.copy.open = false;
  state.copy.targets = [];
}

function toggleCopyTarget(day) {
  const idx = state.copy.targets.indexOf(day);
  if (idx === -1) {
    state.copy.targets.push(day);
  } else {
    state.copy.targets.splice(idx, 1);
  }
}

function toggleCopyTargetValue(day, val) {
  if (val && !state.copy.targets.includes(day)) {
    state.copy.targets.push(day);
  } else if (!val) {
    state.copy.targets = state.copy.targets.filter((d) => d !== day);
  }
}

function applyCopyTargets() {
  if (!state.copy.targets.length) {
    toast.info(lt("toast.copyTargetsMissing", "Tidak ada hari tujuan yang dipilih."));
    return;
  }
  copyToDays(state.copy.targets);
  closeCopyPanel();
}

function applyToWorkdays() {
  copyToDays(WORKDAYS);
}

function applyToWeekend() {
  copyToDays(WEEKEND_DAYS);
}

const daysExceptSelected = computed(() => DAYS.filter((d) => d.day !== (selectedRule.value?.day || "")));

onMounted(loadConfig);
onMounted(() => ensurePeopleOptions(true));
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" @click="resetToDefault">
          {{ t("adminSchedule.actions.resetDefault", "Atur Ulang ke Bawaan") }}
        </Button>
        <Button size="sm" :disabled="!isDirty" @click="resetChanges">
          {{ t("adminSchedule.actions.resetChanges", "Batalkan Perubahan") }}
        </Button>
        <Button size="sm" :disabled="!isDirty || hasErrors || state.saving" @click="saveRules">
          {{
            state.saving
              ? t("adminSchedule.actions.saving", "Menyimpan...")
              : t("adminSchedule.actions.save", "Simpan Jadwal")
          }}
        </Button>
        <!-- <div class="flex items-center gap-2 pl-2">
          <Label class="text-sm font-medium">
            {{ allEnabled ? t('adminSchedule.common.onLabel', 'Semua: Hari Masuk') : t('adminSchedule.common.offLabel', 'Semua: Hari Libur') }}
          </Label>
          <Switch :model-value="allEnabled" @update:model-value="setAllDaysEnabled" />
        </div> -->
      </div>
    </div>

    <Card v-if="state.loading" class="p-10 text-center">
      <p class="text-sm font-medium text-muted-foreground">
        {{ t("adminSchedule.state.loadingConfig", "Memuat konfigurasi jadwal.") }}
      </p>
    </Card>

    <template v-else>
      <!-- Overrides -->
      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle class="text-base">
              {{ t("adminSchedule.overrides.title", "Override Jadwal") }}
            </CardTitle>
            <CardDescription>
              {{
                t(
                  "adminSchedule.overrides.content-title",
                  "Tambahkan rentang tanggal khusus untuk menimpa jadwal mingguan (misalnya cuti bersama, lembur, atau libur mendadak)"
                )
              }}.
            </CardDescription>
          </div>
          <Button variant="default" size="sm" @click="openOverrideForSelectedDay">
            {{ t("adminSchedule.overrides.add", "Tambah Override") }}
          </Button>
        </CardHeader>
        <Separator />
        <CardContent class="p-6">
          <div v-if="overridesSorted.length" class="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{{ t("adminSchedule.overrides.table.range", "Rentang Tanggal") }}</TableHead>
                  <TableHead>{{ t("adminSchedule.overrides.table.label", "Label") }}</TableHead>
                  <TableHead>{{ t("adminSchedule.overrides.table.status", "Status") }}</TableHead>
                  <TableHead>{{ t("adminSchedule.overrides.table.time", "Jam") }}</TableHead>
                  <TableHead>{{ t("adminSchedule.overrides.table.grace", "Grace (Masuk/Keluar)") }}</TableHead>
                  <TableHead>{{ t("adminSchedule.overrides.table.notes", "Catatan") }}</TableHead>
                  <TableHead class="w-[160px]">{{ t("adminSchedule.overrides.table.actions", "Aksi") }}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="override in overridesSorted" :key="override.id">
                  <TableCell class="tabular-nums">{{
                    override.start_date === override.end_date
                      ? df.format(parseDate(String(override.start_date)).toDate(getLocalTimeZone()))
                      : lt("overrides.range", "{start} → {end}", {
                          start: df.format(parseDate(String(override.start_date)).toDate(getLocalTimeZone())),
                          end: df.format(parseDate(String(override.end_date)).toDate(getLocalTimeZone())),
                        })
                  }}</TableCell>
                  <TableCell>
                    <div class="flex flex-col gap-1">
                      <span class="font-semibold">{{ override.label }}</span>
                      <div v-if="override.targets?.length" class="flex flex-wrap gap-1">
                        <Badge :title="targetTitle(target)"
                          v-for="target in override.targets"
                          :key="`${override.id}-target-${(target && target.value) ? target.value : String(target)}`"
                          variant="default">
                          {{
                            peopleMap.get(String((target && target.value) ? target.value : target)) ||
                              (target && target.label) ||
                              ((target && target.value) ? target.value : target)
                          }}
                        </Badge>
                      </div>
                      <div v-else class="text-xs text-muted-foreground">
                        {{ t("adminSchedule.overrides.scope.all", "Berlaku untuk semua") }}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge :title="targetTitle(target)" :variant="override.enabled ? 'default' : 'outline'">
                      {{ statusTextFor(override) }}
                    </Badge>
                  </TableCell>
                  <TableCell class="tabular-nums">{{
                    override.enabled
                      ? `${override.check_in || "--"} - ${override.check_out || "--"}`
                      : '—'
                  }}</TableCell>
                  <TableCell class="tabular-nums">{{
                    override.enabled
                      ? `${override.grace_in_min ?? 0} / ${override.grace_out_min ?? 0}`
                      : '—'
                  }}</TableCell>
                  <TableCell class="max-w-[240px] truncate text-sm text-muted-foreground">{{
                    override.notes || "—"
                  }}</TableCell>
                  <TableCell>
                    <div class="flex flex-nowrap gap-1">
                      <Button variant="outline" size="sm" @click="editOverride(override.id)">{{
                        t("adminSchedule.overrides.actions.edit", "Edit")
                      }}</Button>
                      <Button variant="outline" size="sm" @click="duplicateOverride(override.id)">{{
                        t("adminSchedule.overrides.actions.duplicate", "Salin")
                      }}</Button>
                      <Button variant="destructive" size="sm" @click="removeOverride(override.id)">{{
                        t("adminSchedule.overrides.actions.delete", "Hapus")
                      }}</Button>
                    </div>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <p v-else class="text-sm text-muted-foreground">
            {{ t("adminSchedule.overrides.empty", "Belum ada override tanggal khusus.") }}
          </p>
        </CardContent>
      </Card>

      <div class="grid gap-6 lg:grid-cols-12">
        <!-- Days Sidebar -->
        <Card class="lg:col-span-4">
          <CardHeader>
            <CardTitle class="text-sm tracking-widest uppercase text-muted-foreground">{{
              t("adminSchedule.sidebar.daysTitle", "Hari")
            }}</CardTitle>
          </CardHeader>
          <Separator />
          <CardContent class="p-6 space-y-2">
            <Button
              v-for="rule in state.rules"
              :key="rule.day"
              variant="outline"
              class="w-full justify-between"
              :class="rule.day === state.selectedDay ? 'border-primary dark:border-primary' : ''"
              @click="state.selectedDay = rule.day">
              <span class="font-medium">{{ dayLabel(rule.day) }}</span>
              <div class="flex items-center gap-2">
                <Badge :title="targetTitle(target)" :variant="rule.enabled ? 'default' : 'outline'" class="text-xs">
                  {{ statusTextFor(rule) }}
                </Badge>
                <span class="text-xs text-muted-foreground">
                  <template v-if="rule.enabled && rule.check_in && rule.check_out"
                    >{{ rule.check_in }} - {{ rule.check_out }}</template
                  >
                  <template v-else>{{ t("adminSchedule.sidebar.noSchedule", "Tanpa jadwal") }}</template>
                </span>
              </div>
            </Button>
          </CardContent>
        </Card>

        <!-- Day Details -->
        <Card class="lg:col-span-8" :key="state.selectedDay">
          <template v-if="selectedRule">
            <CardHeader class="space-y-2">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle class="text-xl">{{ dayLabel(selectedRule.day) }}</CardTitle>
                  <CardDescription>{{
                    t("adminSchedule.detail.subtitle", "Atur jam kerja dan kebijakan hari ini.")
                  }}</CardDescription>
                </div>
                <div class="flex items-center gap-3">
                  <Label class="text-sm font-medium">{{ statusTextFor(selectedRule) }}</Label>
                  <Switch
                    :model-value="selectedRule.enabled"
                    @update:model-value="(val) => updateRule(selectedRule.day, { enabled: val })" />
                </div>
              </div>
              <div class="flex flex-wrap gap-2">
                <Button
                  v-for="preset in presetOptions"
                  :key="preset.key"
                  variant="outline"
                  size="sm"
                  @click="applyPresetToSelected(preset.key)">
                  {{ preset.label }}
                </Button>
              </div>
            </CardHeader>
            <Separator />

            <CardContent class="space-y-6 p-6">
              <div
                v-if="selectedErrors.length"
                class="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <ul class="list-disc list-inside">
                  <li v-for="err in selectedErrors" :key="err">{{ err }}</li>
                </ul>
              </div>

              <div class="grid gap-4 sm:grid-cols-2">
                <div class="space-y-1">
                  <Label>{{ t("adminSchedule.form.label", "Label Jadwal") }}</Label>
                  <Input
                    :modelValue="selectedRule.label"
                    :placeholder="t('adminSchedule.form.labelPlaceholder', 'Contoh: Jam Kerja Normal')"
                    @update:modelValue="(v) => updateRule(selectedRule.day, { label: v })" />
                </div>
                <div class="space-y-1">
                  <Label>{{ t("adminSchedule.overrides.form.notes", "Catatan") }}</Label>
                  <Textarea
                    :modelValue="selectedRule.notes"
                    rows="2"
                    :placeholder="t('adminSchedule.form.notesPlaceholder', 'Opsional')"
                    @update:modelValue="(v) => updateRule(selectedRule.day, { notes: v })" />
                </div>
                <div class="space-y-1">
                  <Label>{{ t("adminSchedule.form.checkIn", "Masuk") }}</Label>
                  <Input
                    type="time"
                    :modelValue="selectedRule.check_in"
                    :disabled="!selectedRule.enabled"
                    @update:modelValue="(v) => updateRule(selectedRule.day, { check_in: v })" />
                </div>
                <div class="space-y-1">
                  <Label>{{ t("adminSchedule.form.checkOut", "Pulang") }}</Label>
                  <Input
                    type="time"
                    :modelValue="selectedRule.check_out"
                    :disabled="!selectedRule.enabled"
                    @update:modelValue="(v) => updateRule(selectedRule.day, { check_out: v })" />
                </div>
                <div class="space-y-1">
                  <Label>{{ t("adminSchedule.form.graceIn", "Grace Masuk (menit)") }}</Label>
                  <Input
                    type="number"
                    min="0"
                    max="240"
                    :modelValue="selectedRule.grace_in_min"
                    :disabled="!selectedRule.enabled"
                    @update:modelValue="(v) => updateRule(selectedRule.day, { grace_in_min: Number(v) })" />
                </div>
                <div class="space-y-1">
                  <Label>{{ t("adminSchedule.form.graceOut", "Grace Keluar (menit)") }}</Label>
                  <Input
                    type="number"
                    min="0"
                    max="240"
                    :modelValue="selectedRule.grace_out_min"
                    :disabled="!selectedRule.enabled"
                    @update:modelValue="(v) => updateRule(selectedRule.day, { grace_out_min: Number(v) })" />
                </div>
              </div>

              <div class="space-y-3">
                <div class="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" @click="toggleCopyPanel">{{
                    t("adminSchedule.copy.copyOther", "Salin ke hari lain")
                  }}</Button>
                  <Button variant="outline" size="sm" @click="applyToWorkdays">{{
                    t("adminSchedule.copy.copyWorkdays", "Terapkan ke hari kerja")
                  }}</Button>
                  <Button variant="outline" size="sm" @click="applyToWeekend">{{
                    t("adminSchedule.copy.copyWeekend", "Terapkan ke weekend")
                  }}</Button>
                </div>

                <div v-if="state.copy.open" class="rounded-xl border bg-muted/30 p-4">
                  <p class="text-sm font-semibold">
                    {{ t("adminSchedule.copy.panelTitle", "Salin {day} ke:", { day: dayLabel(selectedRule.day) }) }}
                  </p>
                  <div class="mt-3 grid gap-2 grid-cols-1 sm:grid-rows-2 sm:grid-flow-col sm:auto-cols-fr">
                    <!-- AFTER (aman) -->
                    <label
                      v-for="dayItem in daysExceptSelected"
                      :key="dayItem.day"
                      class="flex items-center gap-2 text-sm">
                      <Checkbox
                        :checked="state.copy.targets.includes(dayItem.day)"
                        @update:checked="(val) => toggleCopyTargetValue(dayItem.day, val)"
                        @update:modelValue="(val) => toggleCopyTargetValue(dayItem.day, val)" />
                      <span>{{ dayLabel(dayItem.day) }}</span>
                    </label>
                  </div>
                  <div class="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" @click="applyCopyTargets">{{ t("adminSchedule.copy.apply", "Terapkan") }}</Button>
                    <Button size="sm" variant="outline" @click="closeCopyPanel">{{
                      t("adminSchedule.copy.cancel", "Batal")
                    }}</Button>
                  </div>
                </div>
              </div>
            </CardContent>

            <CardFooter class="flex justify-start gap-2">
              <Button variant="outline" size="sm" @click="resetChanges">{{
                t("adminSchedule.actions.resetChanges", "Batalkan Perubahan")
              }}</Button>
              <Button size="sm" :disabled="!isDirty || hasErrors || state.saving" @click="saveRules">{{
                state.saving
                  ? t("adminSchedule.actions.saving", "Menyimpan...")
                  : t("adminSchedule.actions.save", "Simpan Jadwal")
              }}</Button>
            </CardFooter>
          </template>
        </Card>
      </div>
    </template>

  <OverrideEditorModal
    v-model="overrideEditor.open"
    :form="overrideEditor.form"
    :loading="overrideEditor.loading"
    :saving="overrideEditor.saving"
    :defaults="getGraceDefaults()"
    :texts="overrideModalTexts"
    :allow-scope="true"
    :allow-single-day="true"
    :people-options="allPeopleOptions"
    :people-loading="peopleLoading"
    :people-error="peopleError"
    :locale="userLocale"
    @submit="submitOverride"
    @cancel="closeOverrideEditor"
    @ensure-people="() => ensurePeopleOptions(true)"
  />
</div>
</template>


