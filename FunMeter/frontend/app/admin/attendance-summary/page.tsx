"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useI18n } from "@/components/providers/I18nProvider";
import { request } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Icon } from "@/components/common/Icon";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface AttendanceTotals {
  total_days: number;
  present_days: number;
  late_days: number;
  unique_people: number;
}

interface AttendanceStatus {
  code: string;
  label: string;
  count: number;
}

interface MonthlyData {
  period: string;
  present_days: number;
  late_days: number;
  left_early_days: number;
  off_days: number;
  raw?: Record<string, number>;
}

interface LeaderData {
  person_id: string;
  label: string;
  late_days?: number;
  late_minutes?: number;
  present_days?: number;
  total_events?: number;
}

interface AttendanceSummaryData {
  range?: {
    start?: string;
    end?: string;
  };
  totals: AttendanceTotals;
  statuses: AttendanceStatus[];
  monthly: MonthlyData[];
  leaders: {
    mostLateMinutes: LeaderData[];
    mostPresent: LeaderData[];
  };
}

interface DateRange {
  start?: string;
  end?: string;
}

export default function AdminAttendanceSummaryPage() {
  const { t, locale } = useI18n();
  
  const [summaryState, setSummaryState] = useState({
    loading: false,
    error: "",
    data: null as AttendanceSummaryData | null,
  });

  const [dateRange, setDateRange] = useState<DateRange>({ start: undefined, end: undefined });
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const ft = useCallback((path: string, fallback: string, values?: Record<string, unknown>) => 
    t(`adminAttendanceSummary.${path}`, fallback, values), [t]);

  const df = useMemo(() => {
    const userLocale = locale || (typeof navigator !== "undefined" ? navigator.language : "id-ID");
    return new Intl.DateTimeFormat(userLocale, { dateStyle: "full" });
  }, [locale]);

  const toISODate = (date: Date): string => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  const setDefaultRange = (days = 30) => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - Math.max(0, days - 1));

    const startStr = toISODate(startDate);
    const endStr = toISODate(endDate);
    setStart(startStr);
    setEnd(endStr);
    setDateRange({ start: startStr, end: endStr });
  };

  const fetchSummary = useCallback(async () => {
    setSummaryState(prev => ({ ...prev, loading: true, error: "" }));
    try {
      const query: Record<string, string> = {};
      if (start) query.start = start;
      if (end) query.end = end;
      
      const resp = await request<AttendanceSummaryData>("/admin/attendance/summary", {
        method: "GET",
        query,
      });
      
      setSummaryState(prev => ({ ...prev, data: resp, loading: false }));
    } catch (err: unknown) {
      const error = err as { message?: string };
      setSummaryState(prev => ({ 
        ...prev, 
        error: error?.message || String(err),
        loading: false 
      }));
    }
  }, [start, end]);

  const clearRange = () => {
    setStart("");
    setEnd("");
    setDateRange({ start: undefined, end: undefined });
  };

  const quickRange = (days: number) => {
    if (!days) {
      clearRange();
      return;
    }
    setDefaultRange(days);
  };

  const formatDateText = (value: string): string => {
    if (!value) return ft("filters.noRange", "Semua tanggal");
    try {
      return df.format(new Date(value));
    } catch {
      return value;
    }
  };

  const formatMonthLabel = (period: string): string => {
    if (!period) return "-";
    if (period.includes("-W")) {
      return ft("chart.weekLabel", "{period}", { period });
    }
    const [year, month] = period.split("-");
    if (!year || !month) return period;
    const dt = new Date(Number(year), Number(month) - 1, 1);
    const userLocale = locale || "id-ID";
    return new Intl.DateTimeFormat(userLocale, {
      month: "long",
      year: "numeric",
    }).format(dt);
  };

  const formatMinutes = (mins: number): string => {
    const value = Number(mins || 0);
    if (!Number.isFinite(value) || value <= 0) return "0";
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    const isID = String(locale || "").toLowerCase().startsWith("id");
    const H = isID ? "j" : "h";
    const M = "m";
    if (hours <= 0) return `${minutes}${M}`;
    if (minutes === 0) return `${hours}${H}`;
    return `${hours}${H} ${minutes}${M}`;
  };

  const totals = summaryState.data?.totals || {
    total_days: 0,
    present_days: 0,
    late_days: 0,
    unique_people: 0
  };
  const statusRows = summaryState.data?.statuses || [];
  const lateLeaders = summaryState.data?.leaders?.mostLateMinutes || [];
  const presentLeaders = summaryState.data?.leaders?.mostPresent || [];

  const chartSeries = [
    { key: "present_days", label: ft("chart.series.present", "Hadir") },
    { key: "late_days", label: ft("chart.series.late", "Terlambat") },
    { key: "left_early_days", label: ft("chart.series.leftEarly", "Pulang Awal") },
    { key: "off_days", label: ft("chart.series.off", "Libur") },
  ];

  const monthlyChartData = useMemo(() => {
    if (!summaryState.data?.monthly?.length) return [];
    return summaryState.data.monthly.map((entry) => {
      const row: Record<string, unknown> = { period: formatMonthLabel(entry.period) };
      chartSeries.forEach((s) => {
        row[s.label] = entry[s.key as keyof MonthlyData] ?? entry.raw?.[s.key] ?? 0;
      });
      return row;
    });
  }, [summaryState.data?.monthly, chartSeries]);

  const statusDisplay = {
    present: ft("statuses.present", "Hadir"),
    late: ft("statuses.late", "Terlambat"),
    left_early: ft("statuses.leftEarly", "Pulang Awal"),
    late_and_left_early: ft("statuses.lateAndLeftEarly", "Terlambat & Pulang Awal"),
    off: ft("statuses.off", "Libur"),
  };

  const isEmpty = !summaryState.loading && !summaryState.data;

  // Determine active quick range based on current start/end
  const activeRange = useMemo(() => {
    if (!start && !end) return "all" as const;
    if (!start || !end) return undefined;
    try {
      const s = new Date(start);
      const e = new Date(end);
      const diffDays = Math.floor((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      if (diffDays === 7) return 7 as const;
      if (diffDays === 30) return 30 as const;
      if (diffDays === 90) return 90 as const;
      return undefined;
    } catch {
      return undefined;
    }
  }, [start, end]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-4">
          <div>
            <CardDescription>
              {ft("subtitle", "Attendance insights based on selected date range.")}
            </CardDescription>
          </div>
          
          <div className="flex flex-wrap gap-3 items-center">
            <Button variant="outline" className="flex items-center gap-2">
              <Icon name="CalendarRange" className="h-4 w-4" />
              <span>
                {summaryState.data?.range?.start && summaryState.data?.range?.end
                  ? `${formatDateText(summaryState.data.range.start)} — ${formatDateText(summaryState.data.range.end)}`
                  : ft("filters.noRange", "Semua tanggal")}
              </span>
            </Button>
            
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={activeRange === "all" ? "default" : "outline"} onClick={() => quickRange(0)}>
                {ft("filters.quick.all", "All dates")}
              </Button>
              <Button size="sm" variant={activeRange === 7 ? "default" : "outline"} onClick={() => quickRange(7)}>
                {ft("filters.quick.7d", "7 Days")}
              </Button>
              <Button size="sm" variant={activeRange === 30 ? "default" : "outline"} onClick={() => quickRange(30)}>
                {ft("filters.quick.30d", "30 Days")}
              </Button>
              <Button size="sm" variant={activeRange === 90 ? "default" : "outline"} onClick={() => quickRange(90)}>
                {ft("filters.quick.90d", "90 Days")}
              </Button>
            </div>
          </div>
          
          {summaryState.error && (
            <div className="rounded-md bg-destructive/10 px-4 py-2 text-destructive text-sm">
              {summaryState.error}
            </div>
          )}
        </CardHeader>
        
        <CardContent>
          {summaryState.loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon name="Loader2" className="h-4 w-4 animate-spin" />
              <span>{ft("state.loading", "Memuat ringkasan absensi...")}</span>
            </div>
          )}
          
          {isEmpty && (
            <div className="text-sm text-muted-foreground">
              {ft("state.empty", "Belum ada data absensi pada rentang ini.")}
            </div>
          )}
          
          {!summaryState.loading && !isEmpty && (
            <div className="space-y-6">
              {/* Stats Cards */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { key: 'total_days', label: ft('stats.totalDays', 'Total Days'), value: totals.total_days },
                  { key: 'present_days', label: ft('stats.presentDays', 'Present Days'), value: totals.present_days },
                  { key: 'late_days', label: ft('stats.lateDays', 'Late Days'), value: totals.late_days },
                  { key: 'unique_people', label: ft('stats.uniquePeople', 'People involved'), value: totals.unique_people },
                ].map((stat) => (
                  <Card key={stat.key} className="border border-border">
                    <CardHeader className="pb-2">
                      <CardDescription className="text-sm text-muted-foreground">{stat.label}</CardDescription>
                      <CardTitle className={"text-3xl font-bold"}>{stat.value ?? 0}</CardTitle>
                    </CardHeader>
                  </Card>
                ))}
              </div>

              <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                {/* Status Table */}
                <Card className="border border-border">
                  <CardHeader>
                    <CardTitle>{ft("table.title", "Attendance Status")}</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="h-[300px] overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{ft("table.status", "Status")}</TableHead>
                            <TableHead className="w-32 text-right">{ft("table.count", "Jumlah")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {statusRows.map((row) => (
                            <TableRow key={row.code}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline">
                                    {statusDisplay[row.code as keyof typeof statusDisplay] || row.label}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground uppercase">{row.code}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-medium">{row.count}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                {/* Monthly Overview Chart */}
                <Card className="border border-border">
                  <CardHeader>
                    <CardTitle>{ft("chart.title", "Monthly Overview")}</CardTitle>
                    <CardDescription>
                      {ft("chart.subtitle", "Status distribution per month for the selected range.")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {monthlyChartData.length ? (
                      <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={monthlyChartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                            <XAxis 
                              dataKey="period" 
                              tick={{ fontSize: 12 }}
                              className="text-muted-foreground"
                            />
                            <YAxis 
                              tick={{ fontSize: 12 }}
                              className="text-muted-foreground"
                            />
                            <Tooltip 
                              contentStyle={{ 
                                backgroundColor: 'hsl(var(--card))', 
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '6px'
                              }}
                            />
                            <Legend />
                            {(() => {
                              const sPresent = ft("chart.series.present", "Present");
                              const sLate = ft("chart.series.late", "Late");
                              const sLeft = ft("chart.series.leftEarly", "Left Early");
                              const sOff = ft("chart.series.off", "Off");
                              return (
                                <>
                                  <Bar dataKey={sPresent} fill="#10b981" name={sPresent} />
                                  <Bar dataKey={sLate} fill="#f59e0b" name={sLate} />
                                  <Bar dataKey={sLeft} fill="#ef4444" name={sLeft} />
                                  <Bar dataKey={sOff} fill="#6b7280" name={sOff} />
                                </>
                              );
                            })()}
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground text-center py-8">
                        {ft("chart.empty", "No monthly data available for this range.")}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Separator />

              {/* Leaders Tables */}
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Most Late */}
                <Card className="border border-border">
                  <CardHeader>
                    <CardTitle>{ft("leaders.lateTitle", "Most Late")}</CardTitle>
                    <CardDescription>
                      {ft("leaders.lateSubtitle", "People with the largest accumulated late minutes.")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{ft("leaders.member", "Member")}</TableHead>
                          <TableHead className="w-24 text-right">{ft("leaders.days", "Days")}</TableHead>
                          <TableHead className="w-32 text-right">{ft("leaders.minutes", "Minutes")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lateLeaders.length > 0 ? (
                          lateLeaders.map((person) => (
                            <TableRow key={person.person_id || person.label}>
                              <TableCell>
                                <div className="flex flex-col">
                                  <span className="font-medium">
                                    {person.label || ft("leaders.unknown", "Tanpa Nama")}
                                  </span>
                                  {person.person_id && (
                                    <span className="text-xs text-muted-foreground">
                                      {person.person_id}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-right">{person.late_days || 0}</TableCell>
                              <TableCell className="text-right">{formatMinutes(person.late_minutes || 0)}</TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={3} className="text-sm text-muted-foreground text-center py-4">
                              {ft("leaders.empty", "Tidak ada data terlambat pada rentang ini.")}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {/* Most Present */}
                <Card className="border border-border">
                  <CardHeader>
                    <CardTitle>{ft("leaders.presentTitle", "Most Present")}</CardTitle>
                    <CardDescription>
                      {ft("leaders.presentSubtitle", "People with the highest number of present days.")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{ft("leaders.member", "Member")}</TableHead>
                          <TableHead className="w-24 text-right">{ft("leaders.days", "Days")}</TableHead>
                          <TableHead className="w-32 text-right">{ft("leaders.events", "Events")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {presentLeaders.length > 0 ? (
                          presentLeaders.map((person) => (
                            <TableRow key={person.person_id || person.label}>
                              <TableCell>
                                <div className="flex flex-col">
                                  <span className="font-medium">
                                    {person.label || ft("leaders.unknown", "Tanpa Nama")}
                                  </span>
                                  {person.person_id && (
                                    <span className="text-xs text-muted-foreground">
                                      {person.person_id}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-right">{person.present_days || 0}</TableCell>
                              <TableCell className="text-right">{person.total_events || 0}</TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={3} className="text-sm text-muted-foreground text-center py-4">
                              {ft("leaders.presentEmpty", "Belum ada data kehadiran pada rentang ini.")}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
