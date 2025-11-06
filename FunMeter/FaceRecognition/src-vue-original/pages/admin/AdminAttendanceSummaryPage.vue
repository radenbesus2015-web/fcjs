<script setup>
import { computed, reactive, ref, watch, onMounted } from "vue";
import { DateFormatter, parseDate } from "@internationalized/date";
import { useDebounceFn } from "@vueuse/core";
import { useI18n } from "@/i18n";
import { apiFetchJSON } from "@/utils/api";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { RangeCalendar } from "@/components/ui/range-calendar";
import { ScrollArea } from "@/components/ui/scroll-area";
import Icon from "@/components/Icon.vue";

import { BarChart } from "@/components/ui/chart-bar";

const { t, locale } = useI18n();
const ft = (path, fallback, values) => t(`adminAttendanceSummary.${path}`, fallback, values);

const summaryState = reactive({
  loading: false,
  error: "",
  data: null,
});

const datePopoverOpen = ref(false);
const dateRange = ref({ start: undefined, end: undefined });
const start = ref("");
const end = ref("");

const df = computed(
  () =>
    new DateFormatter(locale.value || (typeof navigator !== "undefined" ? navigator.language : "id-ID"), {
      dateStyle: "full",
    })
);

function toISODate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function setDefaultRange(days = 30) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - Math.max(0, days - 1));

  const startStr = toISODate(startDate);
  const endStr = toISODate(endDate);
  start.value = startStr;
  end.value = endStr;

  try {
    dateRange.value = {
      start: parseDate(startStr),
      end: parseDate(endStr),
    };
  } catch {
    dateRange.value = { start: undefined, end: undefined };
  }
}

const fetchSummary = useDebounceFn(async () => {
  summaryState.loading = true;
  summaryState.error = "";
  try {
    const query = {};
    if (start.value) query.start = start.value;
    if (end.value) query.end = end.value;
    const resp = await apiFetchJSON("/admin/attendance/summary", {
      method: "GET",
      query,
    });
    summaryState.data = resp;
  } catch (err) {
    summaryState.error = err?.message || String(err);
  } finally {
    summaryState.loading = false;
  }
}, 250);

watch(
  () => [dateRange.value?.start, dateRange.value?.end],
  ([startVal, endVal]) => {
    const sVal = startVal ? startVal.toString() : "";
    const eVal = endVal ? endVal.toString() : sVal;
    start.value = sVal;
    end.value = eVal;
  }
);

watch([start, end], () => {
  fetchSummary();
});

function clearRange() {
  start.value = "";
  end.value = "";
  dateRange.value = { start: undefined, end: undefined };
}

function quickRange(days) {
  if (!days) {
    clearRange();
    fetchSummary();
    return;
  }
  setDefaultRange(days);
  fetchSummary();
}

function formatDateText(value) {
  if (!value) return ft("filters.noRange", "Semua tanggal");
  try {
    return df.value.format(new Date(value));
  } catch {
    return value;
  }
}

function formatMonthLabel(period) {
  if (!period) return "-";
  if (period.includes("-W")) {
    return ft("chart.weekLabel", "{period}", { period });
  }
  const [year, month] = period.split("-");
  if (!year || !month) return period;
  const dt = new Date(Number(year), Number(month) - 1, 1);
  return new Intl.DateTimeFormat(locale.value || "id-ID", {
    month: "long",
    year: "numeric",
  }).format(dt);
}

function formatMinutes(mins) {
  const value = Number(mins || 0);
  if (!Number.isFinite(value) || value <= 0) return "0";
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (hours <= 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

const totals = computed(() => summaryState.data?.totals || {});

const statusRows = computed(() => summaryState.data?.statuses || []);

const chartSeries = computed(() => [
  { key: "present_days", label: ft("chart.series.present", "Hadir") },
  { key: "late_days", label: ft("chart.series.late", "Terlambat") },
  { key: "left_early_days", label: ft("chart.series.leftEarly", "Pulang Awal") },
  { key: "off_days", label: ft("chart.series.off", "Libur") },
]);

const chartCategories = computed(() => chartSeries.value.map((c) => c.label));

const monthlyChartData = computed(() => {
  if (!summaryState.data?.monthly?.length) return [];
  return summaryState.data.monthly.map((entry) => {
    const row = { period: formatMonthLabel(entry.period) };
    chartSeries.value.forEach((s) => {
      row[s.label] = entry[s.key] ?? entry.raw?.[s.key] ?? 0;
    });
    return row;
  });
});

const yFormatter = (tick) => (typeof tick === "number" ? tick : "");

const lateLeaders = computed(() => summaryState.data?.leaders?.mostLateMinutes || []);
const presentLeaders = computed(() => summaryState.data?.leaders?.mostPresent || []);

const statusDisplay = computed(() => ({
  present: ft("statuses.present", "Hadir"),
  late: ft("statuses.late", "Terlambat"),
  left_early: ft("statuses.leftEarly", "Pulang Awal"),
  late_and_left_early: ft("statuses.lateAndLeftEarly", "Terlambat & Pulang Awal"),
  off: ft("statuses.off", "Libur"),
}));

const isEmpty = computed(() => !summaryState.loading && !summaryState.data);

onMounted(() => {
  fetchSummary();
});
</script>

<template>
  <div class="space-y-6">
    <Card>
      <CardHeader class="space-y-4">
        <div>
          <CardTitle>{{ ft("title", "Ringkasan Absensi") }}</CardTitle>
          <CardDescription>
            {{ ft("subtitle", "Insight kehadiran berdasarkan rentang tanggal yang dipilih.") }}
          </CardDescription>
        </div>
        <div class="flex flex-wrap gap-3 items-center">
          <Popover v-model:open="datePopoverOpen">
            <PopoverTrigger as-child>
              <Button variant="outline" class="flex items-center gap-2">
                <Icon name="CalendarRange" class="size-4" />
                <span>
                  {{
                    start && end
                      ? `${formatDateText(start)} — ${formatDateText(end)}`
                      : ft("filters.noRange", "Semua tanggal")
                  }}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent class="w-auto p-0">
              <RangeCalendar v-model="dateRange" :number-of-months="2" initial-focus />
            </PopoverContent>
          </Popover>
          <div class="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" @click="quickRange(7)">
              {{ ft("filters.quick.7d", "< 7 Hari") }}
            </Button>
            <Button size="sm" variant="outline" @click="quickRange(30)">
              {{ ft("filters.quick.30d", "< 30 Hari") }}
            </Button>
            <Button size="sm" variant="outline" @click="quickRange(90)">
              {{ ft("filters.quick.90d", "< 90 Hari") }}
            </Button>
            <Button size="sm" variant="outline" @click="quickRange(0)">
              {{ ft("filters.quick.all", "Reset") }}
            </Button>
          </div>
        </div>
        <div v-if="summaryState.error" class="rounded-md bg-destructive/10 px-4 py-2 text-destructive text-sm">
          {{ summaryState.error }}
        </div>
      </CardHeader>
      <CardContent>
        <div v-if="summaryState.loading" class="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" class="size-4 animate-spin" />
          <span>{{ ft("state.loading", "Memuat ringkasan absensi...") }}</span>
        </div>
        <div v-else-if="isEmpty" class="text-sm text-muted-foreground">
          {{ ft("state.empty", "Belum ada data absensi pada rentang ini.") }}
        </div>
        <div v-else class="space-y-6">
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card
              v-for="stat in [
                { key: 'total_days', label: ft('stats.totalDays', 'Total Hari'), value: totals.total_days },
                { key: 'present_days', label: ft('stats.presentDays', 'Hari Hadir'), value: totals.present_days },
                { key: 'late_days', label: ft('stats.lateDays', 'Hari Terlambat'), value: totals.late_days },
                { key: 'unique_people', label: ft('stats.uniquePeople', 'Anggota Terlibat'), value: totals.unique_people },
              ]"
              :key="stat.key"
              class="border border-border"
            >
              <CardHeader class="pb-2">
                <CardDescription>{{ stat.label }}</CardDescription>
                <CardTitle class="text-2xl font-semibold">{{ stat.value ?? 0 }}</CardTitle>
              </CardHeader>
            </Card>
          </div>

          <div class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <Card class="border border-border">
              <CardHeader>
                <CardTitle>{{ ft("table.title", "Status Kehadiran") }}</CardTitle>
              </CardHeader>
              <CardContent class="p-0">
                <ScrollArea class="h-[300px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{{ ft("table.status", "Status") }}</TableHead>
                        <TableHead class="w-32 text-right">{{ ft("table.count", "Jumlah") }}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow v-for="row in statusRows" :key="row.code">
                        <TableCell>
                          <div class="flex items-center gap-2">
                            <Badge variant="outline">{{ statusDisplay.value?.[row.code] || row.label }}</Badge>
                            <span class="text-xs text-muted-foreground uppercase">{{ row.code }}</span>
                          </div>
                        </TableCell>
                        <TableCell class="text-right font-medium">{{ row.count }}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card class="border border-border">
              <CardHeader>
                <CardTitle>{{ ft("chart.title", "Ringkasan Bulanan") }}</CardTitle>
                <CardDescription>
                  {{ ft("chart.subtitle", "Distribusi status per bulan dalam rentang yang dipilih.") }}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BarChart
                  v-if="monthlyChartData.length"
                  index="period"
                  :data="monthlyChartData"
                  :categories="chartCategories"
                  :rounded-corners="4"
                  :y-formatter="yFormatter"
                  :margin="{ top: 16, right: 16, bottom: 36, left: 48 }"
                />
                <div v-else class="text-sm text-muted-foreground">
                  {{ ft("chart.empty", "Belum ada data bulanan untuk rentang ini.") }}
                </div>
              </CardContent>
            </Card>
          </div>

          <Separator />

          <div class="grid gap-6 lg:grid-cols-2">
            <Card class="border border-border">
              <CardHeader>
                <CardTitle>{{ ft("leaders.lateTitle", "Top Terlambat") }}</CardTitle>
                <CardDescription>
                  {{ ft("leaders.lateSubtitle", "Anggota dengan akumulasi menit terlambat terbanyak.") }}
                </CardDescription>
              </CardHeader>
              <CardContent class="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{{ ft("leaders.member", "Anggota") }}</TableHead>
                      <TableHead class="w-24 text-right">{{ ft("leaders.days", "Hari") }}</TableHead>
                      <TableHead class="w-32 text-right">{{ ft("leaders.minutes", "Menit") }}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow v-for="person in lateLeaders" :key="person.person_id || person.label">
                      <TableCell>
                        <div class="flex flex-col">
                          <span class="font-medium">{{ person.label || ft("leaders.unknown", "Tanpa Nama") }}</span>
                          <span v-if="person.person_id" class="text-xs text-muted-foreground">
                            {{ person.person_id }}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell class="text-right">{{ person.late_days || 0 }}</TableCell>
                      <TableCell class="text-right">{{ formatMinutes(person.late_minutes) }}</TableCell>
                    </TableRow>
                    <TableRow v-if="!lateLeaders.length">
                      <TableCell colspan="3" class="text-sm text-muted-foreground text-center py-4">
                        {{ ft("leaders.empty", "Tidak ada data terlambat pada rentang ini.") }}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card class="border border-border">
              <CardHeader>
                <CardTitle>{{ ft("leaders.presentTitle", "Kehadiran Terbanyak") }}</CardTitle>
                <CardDescription>
                  {{ ft("leaders.presentSubtitle", "Anggota dengan jumlah hari hadir terbanyak.") }}
                </CardDescription>
              </CardHeader>
              <CardContent class="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{{ ft("leaders.member", "Anggota") }}</TableHead>
                      <TableHead class="w-24 text-right">{{ ft("leaders.days", "Hari") }}</TableHead>
                      <TableHead class="w-32 text-right">{{ ft("leaders.events", "Event") }}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow v-for="person in presentLeaders" :key="person.person_id || person.label">
                      <TableCell>
                        <div class="flex flex-col">
                          <span class="font-medium">{{ person.label || ft("leaders.unknown", "Tanpa Nama") }}</span>
                          <span v-if="person.person_id" class="text-xs text-muted-foreground">
                            {{ person.person_id }}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell class="text-right">{{ person.present_days || 0 }}</TableCell>
                      <TableCell class="text-right">{{ person.total_events || 0 }}</TableCell>
                    </TableRow>
                    <TableRow v-if="!presentLeaders.length">
                      <TableCell colspan="3" class="text-sm text-muted-foreground text-center py-4">
                        {{ ft("leaders.presentEmpty", "Belum ada data kehadiran pada rentang ini.") }}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
