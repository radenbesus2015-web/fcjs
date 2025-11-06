<script setup>
import { computed, ref, watch } from "vue";
import { DateFormatter, getLocalTimeZone, parseDate } from "@internationalized/date";
import { normalizeTargets, normalizeIdTargets } from "@/utils/overrides";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { RangeCalendar } from "@/components/ui/range-calendar";
import { Badge } from "@/components/ui/badge";
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

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  form: { type: Object, required: true },
  loading: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  defaults: {
    type: Object,
    default: () => ({ grace_in_min: 10, grace_out_min: 5 }),
  },
  texts: {
    type: Object,
    default: () => ({}),
  },
  allowScope: { type: Boolean, default: false },
  allowSingleDay: { type: Boolean, default: true },
  peopleOptions: { type: Array, default: () => [] },
  peopleLoading: { type: Boolean, default: false },
  peopleError: { type: String, default: "" },
  locale: { type: String, default: () => (typeof navigator !== "undefined" ? navigator.language : "id-ID") },
});

const rangePopoverOpen = ref(false);
const emit = defineEmits(["update:modelValue", "submit", "cancel", "ensure-people", "scope-change"]);

const form = computed(() => props.form || {});

const dateRange = ref({ start: undefined, end: undefined });
const df = computed(() => new DateFormatter(props.locale || "id-ID", { dateStyle: "full" }));
const peopleOpen = ref(false);

function text(path, fallback) {
  return props.texts?.[path] ?? fallback;
}

function nestedText(group, key, fallback) {
  return props.texts?.[group]?.[key] ?? fallback;
}

function holidayLabel() {
  return nestedText("fields", "holidayLabel", "Hari Libur");
}

function syncDateRangeFromForm() {
  const start = form.value.start_date ? parseDate(String(form.value.start_date).slice(0, 10)) : undefined;
  const end = form.value.end_date ? parseDate(String(form.value.end_date).slice(0, 10)) : start;
  dateRange.value = { start, end };
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      syncDateRangeFromForm();
      if (props.allowScope && form.value.scope === "individual") {
        emit("ensure-people");
      }
    }
  }
);

watch(
  () => form.value.start_date,
  () => {
    if (!props.modelValue) return;
    syncDateRangeFromForm();
  }
);

watch(
  () => form.value.singleDay,
  (single) => {
    if (!props.allowSingleDay) return;
    if (single) {
      form.value.end_date = form.value.start_date;
      if (dateRange.value?.start) {
        dateRange.value = { start: dateRange.value.start, end: dateRange.value.start };
      }
    }
  }
);

watch(
  () => dateRange.value,
  (rng) => {
    if (!rng || !rng.start) return;
    form.value.start_date = rng.start.toString();
    form.value.end_date = (rng.end ?? rng.start).toString();
    if (props.allowSingleDay) {
      form.value.singleDay = form.value.start_date === form.value.end_date;
    }
  },
  { deep: true }
);

// Keep time/grace coherent when toggling active/inactive
watch(
  () => form.value.enabled,
  (enabled) => {
    if (!enabled) {
      // When marking as holiday/off, clear times and set grace to 0
      form.value.check_in = "";
      form.value.check_out = "";
      form.value.grace_in_min = 0;
      form.value.grace_out_min = 0;
      if (!String(form.value.label || "").trim()) {
        form.value.label = holidayLabel();
      }
    } else {
      // When enabling, if times empty, set sensible defaults
      if (!String(form.value.check_in || "").trim()) form.value.check_in = "08:30";
      if (!String(form.value.check_out || "").trim()) form.value.check_out = "17:00";
      if (!Number.isFinite(form.value.grace_in_min)) form.value.grace_in_min = props.defaults?.grace_in_min ?? 10;
      if (!Number.isFinite(form.value.grace_out_min)) form.value.grace_out_min = props.defaults?.grace_out_min ?? 5;
    }
  }
);

watch(
  () => form.value.scope,
  (scope) => {
    if (!props.allowScope) return;
    if (scope === "individual") {
      emit("ensure-people");
    } else if (scope === "all") {
      form.value.targets = [];
      form.value.personQuery = "";
    }
    emit("scope-change", scope);
  }
);

// Build a map id->label for display
const peopleMap = computed(() => {
  const map = new Map();
  (props.peopleOptions || []).forEach((opt) => {
    if (opt && typeof opt === "object" && opt.id) map.set(String(opt.id), String(opt.label || ""));
    else if (typeof opt === "string") map.set(opt, opt);
  });
  return map;
});

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

function currentTargets() {
  return normalizeIdTargets(form.value.targets || []);
}

const filteredPeople = computed(() => {
  if (!props.allowScope || form.value.scope !== "individual") return [];
  const selected = new Set(currentTargets().map((item) => String(item.value || "")));
  const query = (form.value.personQuery || "").trim().toLowerCase();
  const options = (props.peopleOptions || []).map((opt) =>
    typeof opt === "object" && opt.id ? { id: String(opt.id), label: String(opt.label || "") } : { id: String(opt), label: String(opt) }
  );
  return options
    .filter((opt) => {
      if (!opt.id || !opt.label) return false;
      if (selected.has(opt.id)) return false;
      if (!query) return true;
      return opt.label.toLowerCase().includes(query);
    })
    .slice(0, 20);
});

function closeModal() {
  emit("cancel");
  emit("update:modelValue", false);
}

function handleSubmit() {
  emit("submit");
}

function setScope(scope) {
  if (!props.allowScope) return;
  if (scope !== "all" && scope !== "individual") return;
  form.value.scope = scope;
}

function ensureTargetsArray() {
  form.value.targets = currentTargets();
}

function addTarget(id) {
  if (!props.allowScope) return;
  const targetId = String(id || "").trim();
  if (!targetId) return;
  ensureTargetsArray();
  const label = peopleMap.value.get(targetId) || "";
  const normalized = normalizeIdTargets([...form.value.targets, { type: "person", value: targetId, label }]);
  form.value.targets = normalized;
  form.value.personQuery = "";
}

function removeTarget(id) {
  ensureTargetsArray();
  const key = String(id || "").trim();
  const filtered = currentTargets().filter((entry) => entry.value !== key);
  form.value.targets = filtered;
}

function commitPersonQuery() {
  const query = (form.value.personQuery || "").trim();
  if (!query) return;
  const options = (props.peopleOptions || []).map((opt) =>
    typeof opt === "object" && opt.id ? { id: String(opt.id), label: String(opt.label || "") } : { id: String(opt), label: String(opt) }
  );
  const qLower = query.toLowerCase();
  const exactId = options.find((opt) => opt.id && opt.id.toLowerCase() === qLower);
  if (exactId) {
    addTarget(exactId.id);
    form.value.personQuery = "";
    return;
  }
  const exactLabelMatches = options.filter((opt) => opt.label && opt.label.toLowerCase() === qLower);
  if (exactLabelMatches.length === 1) {
    addTarget(exactLabelMatches[0].id);
    form.value.personQuery = "";
    return;
  }
  const partialMatches = options.filter((opt) => opt.label && opt.label.toLowerCase().includes(qLower));
  if (partialMatches.length === 1) {
    addTarget(partialMatches[0].id);
    form.value.personQuery = "";
    return;
  }
  const candidate = normalizeIdTargets([{ value: query }])[0];
  if (candidate && candidate.type === "person" && candidate.value) {
    addTarget(candidate.value);
    form.value.personQuery = "";
  }
}

const scopeTexts = computed(() => ({
  all: nestedText("scope", "allLabel", "Berlaku untuk semua"),
  individual: nestedText("scope", "individualLabel", "Perorangan"),
  helpAll: nestedText("scope", "helpAll", "Override berlaku untuk semua anggota."),
  helpIndividual: nestedText("scope", "helpIndividual", "Pilih anggota tertentu yang menerima jadwal khusus ini."),
  badgeAll: nestedText("scope", "badgeAll", "Berlaku untuk semua"),
}));

const peopleTexts = computed(() => ({
  placeholder: nestedText("people", "placeholder", "Cari nama..."),
  noMatches: nestedText("people", "noMatches", "Tidak ada hasil untuk pencarian ini."),
  noPeople: nestedText("people", "noPeople", "Belum ada data wajah yang dapat dipilih."),
  loading: nestedText("people", "loading", "Memuat daftar wajah..."),
}));
</script>

<template>
  <Dialog :open="modelValue" @update:open="(v) => emit('update:modelValue', v)">
    <DialogContent class="max-w-3xl" @open-auto-focus.prevent @close-auto-focus.prevent>
      <DialogHeader>
        <DialogTitle>{{ text("title", "Override Jadwal") }}</DialogTitle>
        <DialogDescription>{{ text("description", "") }}</DialogDescription>
      </DialogHeader>

      <div v-if="loading" class="mb-4 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        {{ text("loading", "Memuat...") }}
      </div>

      <form class="grid gap-4 sm:grid-cols-2" @submit.prevent="handleSubmit">
        <div class="space-y-1">
          <Label class="text-xs font-semibold">{{ nestedText("fields", "label", "Label") }}</Label>
          <Input v-model="form.label" type="text" :disabled="loading || saving" />
        </div>

        <div class="space-y-1">
          <Label class="text-xs font-semibold">{{ nestedText("fields", "range", "Rentang Tanggal") }}</Label>
          <Popover :open="rangePopoverOpen" @update:open="(val) => (rangePopoverOpen = val)">
            <PopoverTrigger as-child>
              <Button type="button" variant="outline" :title="targetTitle(target)" class="w-full justify-between" :disabled="loading || saving">
                <span>
                  <template v-if="dateRange?.start">
                    <template v-if="dateRange?.end">
                      <template v-if="dateRange.start.toString() === dateRange.end.toString()">
                        {{ df.format(dateRange.start.toDate(getLocalTimeZone())) }}
                      </template>
                      <template v-else>
                        {{ df.format(dateRange.start.toDate(getLocalTimeZone())) }}
                        &nbsp;-&nbsp;
                        {{ df.format(dateRange.end.toDate(getLocalTimeZone())) }}
                      </template>
                    </template>
                    <template v-else>
                      {{ df.format(dateRange.start.toDate(getLocalTimeZone())) }}
                    </template>
                  </template>
                  <template v-else>
                    {{ nestedText("fields", "pickDate", "Pilih tanggal") }}
                  </template>
                </span>
                <i class="ti ti-calendar text-base" />
              </Button>
            </PopoverTrigger>
            <PopoverContent class="p-0 w-auto" align="start" :trap-focus="false">
              <RangeCalendar v-model="dateRange" :number-of-months="2" initial-focus />
            </PopoverContent>
          </Popover>
        </div>

        <div v-if="allowSingleDay" class="space-y-1">
          <Label class="text-xs font-semibold flex items-center gap-2">
            <Checkbox v-model:checked="form.singleDay" :disabled="loading || saving" />
            {{ nestedText("fields", "singleDay", "Satu hari") }}
          </Label>
        </div>

        <div class="space-y-1">
          <div class="flex items-center gap-3">
            <span class="text-xs text-muted-foreground">{{ nestedText("common", "offLabel", "Hari Libur") }}</span>
            <Switch
              :model-value="form.enabled"
              @update:model-value="(v) => (form.enabled = !!v)"
              :disabled="loading || saving" />
            <span class="text-xs text-muted-foreground">{{ nestedText("common", "onLabel", "Hari Masuk") }}</span>
          </div>
        </div>

        <div class="space-y-1">
          <Label class="text-xs font-semibold">{{ nestedText("fields", "checkIn", "Jam Masuk") }}</Label>
          <Input v-model="form.check_in" type="time" :disabled="loading || saving || !form.enabled" />
        </div>
        <div class="space-y-1">
          <Label class="text-xs font-semibold">{{ nestedText("fields", "checkOut", "Jam Pulang") }}</Label>
          <Input v-model="form.check_out" type="time" :disabled="loading || saving || !form.enabled" />
        </div>

        <div class="space-y-1">
          <Label class="text-xs font-semibold">{{ nestedText("fields", "graceIn", "Grace Masuk (menit)") }}</Label>
          <Input
            v-model.number="form.grace_in_min"
            type="number"
            min="0"
            max="240"
            :disabled="loading || saving || !form.enabled" />
        </div>
        <div class="space-y-1">
          <Label class="text-xs font-semibold">{{ nestedText("fields", "graceOut", "Grace Pulang (menit)") }}</Label>
          <Input
            v-model.number="form.grace_out_min"
            type="number"
            min="0"
            max="240"
            :disabled="loading || saving || !form.enabled" />
        </div>

        <div class="space-y-1 sm:col-span-2">
          <Label class="text-xs font-semibold">{{ nestedText("fields", "notes", "Catatan") }}</Label>
          <Textarea
            v-model="form.notes"
            rows="3"
            :placeholder="nestedText('fields', 'notesPlaceholder', 'Opsional')"
            :disabled="loading || saving" />
        </div>

        <div v-if="allowScope" class="space-y-1 sm:col-span-2">
          <Label class="text-xs font-semibold">{{ nestedText("fields", "scope", "Penerapan") }}</Label>
          <div class="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              :variant="form.scope === 'all' ? 'default' : 'outline'"
              :disabled="loading || saving"
              @click="setScope('all')">
              {{ scopeTexts.all }}
            </Button>
            <Button
              type="button"
              size="sm"
              :variant="form.scope === 'individual' ? 'default' : 'outline'"
              :disabled="loading || saving"
              @click="setScope('individual')">
              {{ scopeTexts.individual }}
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ form.scope === "individual" ? scopeTexts.helpIndividual : scopeTexts.helpAll }}
          </p>
        </div>

        <div v-if="allowScope && form.scope === 'individual'" class="space-y-2 sm:col-span-2">
          <div class="space-y-1">
            <Label class="text-xs font-semibold">{{ nestedText("fields", "personLabel", "Pilih Anggota") }}</Label>
            <div class="flex items-center gap-2">
              <Combobox
                :open="peopleOpen"
                @update:open="
                  (v) => {
                    peopleOpen = v;
                    if (v) emit('ensure-people');
                  }
                ">
                <ComboboxAnchor class="w-[280px]">
                  <ComboboxInput
                    v-model="form.personQuery"
                    :placeholder="peopleTexts.placeholder"
                    :disabled="loading || saving"
                    autocomplete="off"
                    @keyup.enter="form.personQuery = ''" />
                </ComboboxAnchor>
                <ComboboxList v-if="peopleOpen" class="w-[280px]">
                  <ComboboxEmpty>{{
                    peopleError || (peopleLoading ? peopleTexts.loading : peopleTexts.noMatches)
                  }}</ComboboxEmpty>
                  <ComboboxViewport>
                  <ComboboxItem
                    v-for="option in filteredPeople"
                    :key="`option-${option.id}`"
                    :value="option.id"
                    @click.stop="addTarget(option.id)">
                    <span>{{ option.label }}</span>
                  </ComboboxItem>
                  </ComboboxViewport>
                </ComboboxList>
              </Combobox>
              <Button
                v-if="form.personQuery"
                type="button"
                size="sm"
                variant="outline" :title="targetTitle(target)"
                :disabled="loading || saving"
                @click="form.personQuery = ''">
                {{ nestedText("common", "clear", "Bersihkan") }}
              </Button>
            </div>
            <p v-if="peopleLoading" class="text-xs text-muted-foreground">
              {{ peopleTexts.loading }}
            </p>
            <p v-else-if="peopleError" class="text-xs text-destructive">{{ peopleError }}</p>
          </div>
          <div v-if="form.targets?.length" class="flex flex-wrap gap-2">
            <Badge
              :title="targetTitle(target)"
              v-for="target in form.targets"
              :key="`selected-${target && typeof target === 'object' ? target.value : String(target)}`"
              variant="outline" 
              class="flex items-center gap-1">
              <span>
                {{
                  peopleMap.get(String(target && typeof target === "object" ? target.value : target)) ||
                    (target && typeof target === "object" && target.label) ||
                    (target && typeof target === "object" ? target.value : target)
                }}
              </span>
              <button
                type="button"
                class="flex items-center justify-center rounded-full p-0.5 text-[10px] hover:text-destructive"
                @click.stop="removeTarget(target && typeof target === 'object' ? target.value : target)">
                <i class="ti ti-x" />
              </button>
            </Badge>
          </div>
          <p v-if="!peopleLoading && !peopleError && !filteredPeople.length" class="text-xs text-muted-foreground">
            {{
              form.personQuery
                ? peopleTexts.noMatches
                : peopleOptions.length
                ? nestedText("people", "allSelected", "Semua anggota telah dipilih.")
                : peopleTexts.noPeople
            }}
          </p>
        </div>
      </form>

      <DialogFooter class="mt-4 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" :title="targetTitle(target)" :disabled="saving" @click="closeModal">
          {{ nestedText("actions", "cancel", "Batal") }}
        </Button>
        <Button type="button" :disabled="saving || loading" @click="handleSubmit">
          {{ saving ? nestedText("actions", "saving", "Menyimpan...") : nestedText("actions", "save", "Simpan") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

