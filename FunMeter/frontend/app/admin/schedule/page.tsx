// app/admin/schedule/page.tsx
// Migrasi dari src-vue-original/pages/admin/AdminSchedulePage.vue (fitur inti)

"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/providers/I18nProvider";
import { request } from "@/lib/api";
import { toast } from "@/toast";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/common/Icon";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type DayKey =
  | "Senin"
  | "Selasa"
  | "Rabu"
  | "Kamis"
  | "Jumat"
  | "Sabtu"
  | "Minggu";

interface CustomField {
  id: string;
  label: string;
  type: "text" | "number" | "time" | "textarea";
  value: string | number;
  required?: boolean;
  placeholder?: string;
  min?: number;
  max?: number;
}

interface RuleItem {
  day: DayKey;
  label: string;
  enabled: boolean;
  check_in: string; // HH:MM or ""
  check_out: string; // HH:MM or ""
  grace_in_min: number;
  grace_out_min: number;
  notes?: string;
  customFields?: CustomField[];
}

interface OverrideItem {
  id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  label: string;
  enabled: boolean;
  check_in: string | null;
  check_out: string | null;
  grace_in_min: number;
  grace_out_min: number;
  notes: string;
  targets?: Array<string | { value: string; label?: string }>; // minimal
}

interface AttendanceConfig {
  grace_in_min: number;
  grace_out_min: number;
  rules: RuleItem[];
  overrides: OverrideItem[];
}

interface ScheduleResponse {
  attendance: Partial<AttendanceConfig>;
}

interface MemberItem {
  id: string | number;
  label: string;
  person_id?: string;
  photo_url?: string;
  photo_path?: string;
}

const DAYS: DayKey[] = [
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
  "Minggu",
];

const WORKDAYS: DayKey[] = DAYS.slice(0, 5);
const WEEKEND: DayKey[] = DAYS.slice(5) as DayKey[];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `ov_${Math.random().toString(36).slice(2, 10)}`;
}

  function sortOverrides(list: OverrideItem[]): OverrideItem[] {
  return [...list].sort((a, b) => (a.start_date === b.start_date ? a.end_date.localeCompare(b.end_date) : a.start_date.localeCompare(b.start_date)));
}

export default function AdminSchedulePage() {
  const { t, locale } = useI18n();

  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [gIn, setGIn] = useState<number>(10);
  const [gOut, setGOut] = useState<number>(5);

  // i18n-aware default creators
  const defaultRule = (day: DayKey, gInLocal = 10, gOutLocal = 5): RuleItem => {
    const weekend = WEEKEND.includes(day);
    return {
      day,
      label: weekend ? t("adminSchedule.defaults.holidayLabel", "Holiday / Off") : t("adminSchedule.defaults.workdayLabel", "Normal Working Hours"),
      enabled: !weekend,
      check_in: weekend ? "" : "08:30",
      check_out: weekend ? "" : "17:00",
      grace_in_min: weekend ? 0 : gInLocal,
      grace_out_min: weekend ? 0 : gOutLocal,
      notes: weekend ? t("adminSchedule.defaults.weekendNotes", "Weekend off") : "",
    };
  };

  const normalizeRules = (raw: Partial<RuleItem>[] | undefined, gInLocal: number, gOutLocal: number): RuleItem[] => {
    const map = new Map<DayKey, Partial<RuleItem>>();
    (raw || []).forEach((r) => {
      if (r?.day) map.set(r.day as DayKey, r);
    });
    return DAYS.map((d) => {
      const base = defaultRule(d, gInLocal, gOutLocal);
      const src = map.get(d) || {};
      const enabled = src.enabled ?? base.enabled;
      const rule: RuleItem = {
        day: d,
        label: String(src.label ?? base.label),
        enabled,
        check_in: enabled ? (TIME_RE.test(String(src.check_in || base.check_in)) ? String(src.check_in || base.check_in) : base.check_in) : "",
        check_out: enabled ? (TIME_RE.test(String(src.check_out || base.check_out)) ? String(src.check_out || base.check_out) : base.check_out) : "",
        grace_in_min: enabled ? clamp(Number(src.grace_in_min ?? base.grace_in_min), 0, 240) : 0,
        grace_out_min: enabled ? clamp(Number(src.grace_out_min ?? base.grace_out_min), 0, 240) : 0,
        notes: String(src.notes ?? base.notes ?? ""),
      };
      return rule;
    });
  };

  const [rules, setRules] = useState<RuleItem[]>(() => []);
  const [origRules, setOrigRules] = useState<RuleItem[]>([]);
  const [overrides, setOverrides] = useState<OverrideItem[]>([]);
  const [origOverrides, setOrigOverrides] = useState<OverrideItem[]>([]);
  const [selectedDay, setSelectedDay] = useState<DayKey>("Senin");

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request<ScheduleResponse>("/admin/attendance/schedule", { method: "GET" });
      const att = data?.attendance || {};
      const baseGIn = clamp(Number(att.grace_in_min ?? 10), 0, 240);
      const baseGOut = clamp(Number(att.grace_out_min ?? 5), 0, 240);
      setGIn(baseGIn);
      setGOut(baseGOut);
      const nextRules = normalizeRules((att.rules as Partial<RuleItem>[]) || [], baseGIn, baseGOut);
      setRules(nextRules);
      setOrigRules(JSON.parse(JSON.stringify(nextRules)));
      const rawOverrides = (att.overrides as OverrideItem[]) || [];
      const sorted = sortOverrides(
        rawOverrides.map((ov) => ({
          id: String(ov.id || genId()),
          start_date: String(ov.start_date || ""),
          end_date: String(ov.end_date || ov.start_date || ""),
          label: String(ov.label || t("adminSchedule.overrides.defaultLabel", "Custom Schedule")),
          enabled: ov.enabled !== false,
          check_in: ov.enabled !== false ? (ov.check_in ?? null) : null,
          check_out: ov.enabled !== false ? (ov.check_out ?? null) : null,
          grace_in_min: ov.enabled !== false ? clamp(Number(ov.grace_in_min ?? baseGIn), 0, 240) : 0,
          grace_out_min: ov.enabled !== false ? clamp(Number(ov.grace_out_min ?? baseGOut), 0, 240) : 0,
          notes: String(ov.notes || ""),
          targets: Array.isArray(ov.targets) ? ov.targets : [],
        }))
      );
      setOverrides(sorted);
      setOrigOverrides(JSON.parse(JSON.stringify(sorted)));
    } catch (err) {
      console.error(err);
      toast.error(t("adminSchedule.error.loadConfig", "Failed to load schedule configuration."));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const selectedRule = useMemo(() => rules.find((r) => r.day === selectedDay) || null, [rules, selectedDay]);
  const isDirty = useMemo(() => {
    return (
      JSON.stringify(rules) !== JSON.stringify(origRules) ||
      JSON.stringify(overrides) !== JSON.stringify(origOverrides) ||
      gIn !== (origRules[0]?.grace_in_min ?? 10) ||
      gOut !== (origRules[0]?.grace_out_min ?? 5)
    );
  }, [rules, origRules, overrides, origOverrides, gIn, gOut]);

  const updateRule = (day: DayKey, patch: Partial<RuleItem>): void => {
    setRules((prev) =>
      prev.map((r) => {
        if (r.day !== day) return r;
        const wasEnabled = r.enabled;
        const enabled = patch.enabled ?? r.enabled;
        // Detect transition from disabled to enabled
        const transitioningToEnabled = !wasEnabled && enabled;
        
        const next: RuleItem = {
          ...r,
          ...patch,
          enabled,
          // If transitioning to enabled and no explicit label provided, use default
          label: patch.label !== undefined 
            ? String(patch.label)
            : (transitioningToEnabled ? t("adminSchedule.defaults.workdayLabel", "Normal Working Hours") : r.label),
          // If transitioning to enabled and no explicit check_in provided, use default
          check_in: enabled 
            ? (patch.check_in !== undefined 
                ? String(patch.check_in) // Always use the provided value, even if not yet valid (validation happens on blur)
                : (transitioningToEnabled || !r.check_in ? "08:30" : r.check_in))
            : "",
          // If transitioning to enabled and no explicit check_out provided, use default
          check_out: enabled 
            ? (patch.check_out !== undefined 
                ? String(patch.check_out) // Always use the provided value, even if not yet valid (validation happens on blur)
                : (transitioningToEnabled || !r.check_out ? "17:00" : r.check_out))
            : "",
          // If transitioning to enabled and no explicit grace values provided, use defaults
          grace_in_min: enabled 
            ? (patch.grace_in_min !== undefined 
                ? clamp(Number(patch.grace_in_min), 0, 240)
                : (transitioningToEnabled ? gIn : clamp(Number(r.grace_in_min), 0, 240)))
            : 0,
          grace_out_min: enabled 
            ? (patch.grace_out_min !== undefined 
                ? clamp(Number(patch.grace_out_min), 0, 240)
                : (transitioningToEnabled ? gOut : clamp(Number(r.grace_out_min), 0, 240)))
            : 0,
          // If transitioning to enabled and no explicit notes provided, clear notes
          notes: patch.notes !== undefined 
            ? String(patch.notes)
            : (transitioningToEnabled ? "" : (r.notes || "")),
        };
        if (!enabled) {
          next.check_in = "";
          next.check_out = "";
        }
        return next;
      })
    );
  };

  const applyPreset = (target: "workday" | "halfday" | "evening" | "wfh" | "off"): void => {
    const rule = selectedRule;
    if (!rule) return;
    const presets: Record<string, Partial<RuleItem>> = {
      workday: { enabled: true, label: t("adminSchedule.presets.workday.dataLabel", "Normal Working Hours"), check_in: "08:30", check_out: "17:00", grace_in_min: 10, grace_out_min: 5, notes: "" },
      halfday: { enabled: true, label: t("adminSchedule.presets.halfday.dataLabel", "Morning Shift"), check_in: "08:30", check_out: "13:00", grace_in_min: 5, grace_out_min: 0, notes: t("adminSchedule.presets.halfday.notes", "Half-day morning shift.") },
      evening: { enabled: true, label: t("adminSchedule.presets.evening.dataLabel", "Evening Shift"), check_in: "13:00", check_out: "21:00", grace_in_min: 5, grace_out_min: 5, notes: t("adminSchedule.presets.evening.notes", "Evening / closing shift.") },
      wfh: { enabled: true, label: t("adminSchedule.presets.wfh.dataLabel", "Flexible WFH"), check_in: "09:00", check_out: "17:00", grace_in_min: 30, grace_out_min: 10, notes: t("adminSchedule.presets.wfh.notes", "WFH with 30-minute lateness tolerance.") },
      off: { enabled: false, label: t("adminSchedule.presets.off.dataLabel", "Holiday"), check_in: "", check_out: "", grace_in_min: 0, grace_out_min: 0, notes: t("adminSchedule.presets.off.notes", "No scheduled working hours.") },
    };
    updateRule(rule.day, presets[target]);
    toast.success(t("adminSchedule.toast.presetApplied", "Preset applied.", { preset: target, day: rule.day }));
  };

  const applyToDays = (days: DayKey[]): void => {
    const src = selectedRule;
    if (!src) return;
    setRules((prev) =>
      prev.map((r) => (days.includes(r.day) ? { ...r, label: src.label, enabled: src.enabled, check_in: src.check_in, check_out: src.check_out, grace_in_min: src.grace_in_min, grace_out_min: src.grace_out_min, notes: src.notes } : r))
    );
    toast.success(t("adminSchedule.toast.copyApplied", "Applied to selected days.", { source: selectedRule?.day, targets: days.join(', ') }));
  };

  const saveAll = async (): Promise<void> => {
    setSaving(true);
    try {
      // Basic validations to prevent 500s from backend
      const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
      for (const ov of overrides) {
        if (ov.enabled) {
          if (!ov.start_date || !DATE_RE.test(ov.start_date)) {
            toast.error(t("adminSchedule.validation.ovStart", "Override start date is required (YYYY-MM-DD)."));
            setSaving(false);
            return;
          }
          if (ov.end_date && !DATE_RE.test(ov.end_date)) {
            toast.error(t("adminSchedule.validation.ovEnd", "Override end date is invalid (YYYY-MM-DD)."));
            setSaving(false);
            return;
          }
        }
      }

      const payload = {
        grace_in_min: clamp(gIn, 0, 240),
        grace_out_min: clamp(gOut, 0, 240),
        rules: rules.map((r) => ({
          day: r.day,
          label: r.label.trim() || t("adminSchedule.defaults.workdayLabel", "Normal Working Hours"),
          enabled: r.enabled,
          check_in: r.enabled && TIME_RE.test(r.check_in) ? r.check_in : null,
          check_out: r.enabled && TIME_RE.test(r.check_out) ? r.check_out : null,
          grace_in_min: r.enabled ? clamp(r.grace_in_min, 0, 240) : 0,
          grace_out_min: r.enabled ? clamp(r.grace_out_min, 0, 240) : 0,
          ...(r.notes && r.notes.trim() ? { notes: r.notes.trim() } : {}),
        })),
        overrides: sortOverrides(overrides).map((ov) => {
          const idNumeric = String(ov.id || "").match(/^\d+$/) ? Number(ov.id) : undefined;
          const targets = Array.isArray(ov.targets)
            ? ov.targets
                .map((t: unknown) => (typeof t === "object" && t !== null ? ((t as { value?: unknown; id?: unknown; person_id?: unknown }).value ?? (t as { value?: unknown; id?: unknown; person_id?: unknown }).id ?? (t as { value?: unknown; id?: unknown; person_id?: unknown }).person_id ?? null) : t))
                .filter(Boolean)
                .map((x: unknown) => (String(x).match(/^\d+$/) ? Number(x) : String(x)))
            : [];
          const body: Record<string, unknown> = {
            start_date: ov.start_date,
            end_date: ov.end_date || ov.start_date,
            label: ov.label || t("adminSchedule.overrides.defaultLabel", "Custom Schedule"),
            enabled: ov.enabled,
            check_in: ov.enabled ? ov.check_in : null,
            check_out: ov.enabled ? ov.check_out : null,
            grace_in_min: ov.enabled ? clamp(ov.grace_in_min, 0, 240) : 0,
            grace_out_min: ov.enabled ? clamp(ov.grace_out_min, 0, 240) : 0,
            notes: ov.notes || "",
            targets,
          };
          if (idNumeric != null) body.id = idNumeric;
          return body;
        }),
      };
      const resp = await request<ScheduleResponse>("/admin/attendance/schedule", {
        method: "PUT",
        body: payload,
        headers: { "Content-Type": "application/json" },
      });
      // refresh from server echo
      const att = resp?.attendance || {};
      const baseGIn = clamp(Number(att.grace_in_min ?? payload.grace_in_min), 0, 240);
      const baseGOut = clamp(Number(att.grace_out_min ?? payload.grace_out_min), 0, 240);
      setGIn(baseGIn);
      setGOut(baseGOut);
      const nextRules = normalizeRules((att.rules as Partial<RuleItem>[]) || payload.rules, baseGIn, baseGOut);
      setRules(nextRules);
      setOrigRules(JSON.parse(JSON.stringify(nextRules)));
      const rawOverrides = (att.overrides as OverrideItem[]) || (payload.overrides as unknown as OverrideItem[]);
      const sorted = sortOverrides(rawOverrides.map((x) => ({ ...x, id: String(x.id || genId()) })));
      setOverrides(sorted);
      setOrigOverrides(JSON.parse(JSON.stringify(sorted)));
      toast.success(t("adminSchedule.toast.scheduleSaved", "Schedule saved."));
    } catch (err: unknown) {
      console.error("[SCHEDULE_SAVE] Error:", err);
      const msg = err instanceof Error ? err.message : 
        (err && typeof err === 'object' && 'data' in err ? 
          (err as { data?: { message?: string } }).data?.message : undefined) || 
        (err && typeof err === 'object' && 'response' in err ? 
          (err as { response?: { data?: { message?: string } } }).response?.data?.message : undefined) || t("adminSchedule.error.saveConfig", "Failed to save schedule.");
      toast.error(msg ? `${t("adminSchedule.error.saveConfig", "Failed to save schedule.")}\n${msg}` : t("adminSchedule.error.saveConfig", "Failed to save schedule."));
    } finally {
      setSaving(false);
    }
  };

  const resetChanges = (): void => {
    setRules(JSON.parse(JSON.stringify(origRules)) as RuleItem[]);
    setOverrides(JSON.parse(JSON.stringify(origOverrides)) as OverrideItem[]);
    setGIn(origRules[0]?.grace_in_min ?? 10);
    setGOut(origRules[0]?.grace_out_min ?? 5);
  };

  // Reset to factory defaults (no overrides, weekend off, normal hours)
  const resetToDefault = (): void => {
    const baseGIn = 10;
    const baseGOut = 5;
    setRules(DAYS.map((d) => defaultRule(d, baseGIn, baseGOut)));
    setOverrides([]);
    setGIn(baseGIn);
    setGOut(baseGOut);
  };

  const addOverride = (): void => {
    const draft: OverrideItem & { singleDay?: boolean; scope?: "all" | "individual" } = {
      id: genId(),
      start_date: new Date().toISOString().slice(0,10),
      end_date: new Date().toISOString().slice(0,10),
      label: t("adminSchedule.overrides.defaultLabel", "Custom Schedule"),
      enabled: true,
      check_in: "08:30",
      check_out: "17:00",
      grace_in_min: gIn,
      grace_out_min: gOut,
      notes: "",
      targets: [],
      singleDay: true,
      scope: "all",
    };
    setModalEdit({ open: true, ov: draft });
  };
  const duplicateOverride = (id: string): void => {
    setOverrides((prev) => {
      const src = prev.find((x) => x.id === id);
      if (!src) return prev;
      const copy: OverrideItem = { ...src, id: genId(), label: `${src.label}` };
      return sortOverrides([...prev, copy]);
    });
  };
  const deleteOverride = (id: string): void => {
    setOverrides((prev) => prev.filter((x) => x.id !== id));
  };

  const hdr = t("adminSchedule.overrides.title", "Schedule Overrides");

  const df = useMemo(() => {
    const userLocale = locale || (typeof navigator !== "undefined" ? navigator.language : "en-US");
    // short weekday & month => Wed, 01 Nov 2025 / Rab, 01 Nov 2025
    return new Intl.DateTimeFormat(userLocale, {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }, [locale]);

  // Modal States
  type ModalEditOverride = OverrideItem & { singleDay?: boolean; scope?: "all" | "individual" };
  const [modalView, setModalView] = useState<{ open: boolean; ov: OverrideItem | null }>({ open: false, ov: null });
  const [modalEdit, setModalEdit] = useState<{
    open: boolean;
    ov: ModalEditOverride | null;
  }>({ open: false, ov: null });
  
  // Helper function to update modal edit state
  const updateModalEdit = (updater: (ov: ModalEditOverride) => Partial<ModalEditOverride>) => {
    setModalEdit(p => {
      if (!p.ov) return p;
      return { ...p, ov: { ...p.ov, ...updater(p.ov) } };
    });
  };
  const [modalDeleteOv, setModalDeleteOv] = useState<{ open: boolean; ov: OverrideItem | null }>({ open: false, ov: null });
  const [modalDeleteLog, setModalDeleteLog] = useState<{ open: boolean; ov: OverrideItem | null }>({ open: false, ov: null });
  
  // User selection modal state
  const [modalUserSelect, setModalUserSelect] = useState<{ open: boolean }>({ open: false });
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [searchMember, setSearchMember] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());

  // Custom Fields Management State
  const [modalCustomField, setModalCustomField] = useState<{ 
    open: boolean; 
    field: CustomField | null; 
    isEdit: boolean 
  }>({ open: false, field: null, isEdit: false });

  // ESC key handler for user selection modal
  useEffect(() => {
    if (!modalUserSelect.open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setModalUserSelect({ open: false });
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [modalUserSelect.open]);

  // ESC key handler for custom field modal
  useEffect(() => {
    if (!modalCustomField.open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setModalCustomField({ open: false, field: null, isEdit: false });
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [modalCustomField.open]);

  const openView = (ov: OverrideItem) => setModalView({ open: true, ov });
  const openEdit = (ov: OverrideItem) => setModalEdit({ open: true, ov: { ...ov, singleDay: ov.end_date ? ov.end_date === ov.start_date : true, scope: (ov.targets && ov.targets.length ? "individual" : "all") } });
  const openCustom = (ov: OverrideItem) => setModalEdit({ open: true, ov: { ...ov, singleDay: ov.end_date ? ov.end_date === ov.start_date : true, scope: (ov.targets && ov.targets.length ? "individual" : "all") } });
  const openDeleteOverride = (ov: OverrideItem) => setModalDeleteOv({ open: true, ov });
  const openDeleteLog = (ov: OverrideItem) => setModalDeleteLog({ open: true, ov });

  // Fetch members data
  const fetchMembers = async (search = "") => {
    try {
      setLoadingMembers(true);
      const params = new URLSearchParams();
      params.set("per_page", "9999"); // Get all members
      if (search.trim()) params.set("q", search.trim());
      
      const response = await request<{
        items: MemberItem[];
      }>(`/register-db-data?${params.toString()}`);
      
      setMembers(response.items || []);
    } catch (error) {
      toast.error(t("adminSchedule.error.loadPeople", "Failed to load face registry."));
    } finally {
      setLoadingMembers(false);
    }
  };

  // Open user selection modal
  const openUserSelection = () => {
    // Set scope to individual when opening user selection
    updateModalEdit(() => ({ scope: "individual" }));
    
    // Initialize selected members from current targets
    const currentTargets = modalEdit.ov?.targets || [];
    const targetIds = new Set(currentTargets.map(target => 
      typeof target === 'string' ? target : target.value || String(target)
    ));
    setSelectedMembers(targetIds);
    setSearchMember("");
    setModalUserSelect({ open: true });
    fetchMembers();
  };

  // Handle member selection
  const toggleMemberSelection = (memberId: string) => {
    setSelectedMembers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(memberId)) {
        newSet.delete(memberId);
      } else {
        newSet.add(memberId);
      }
      return newSet;
    });
  };

  // Apply selected members to override
  const applySelectedMembers = () => {
    if (selectedMembers.size === 0) {
      toast.error(t("adminSchedule.userSelect.noSelection", "Please select at least one member"));
      return;
    }

    const selectedTargets = Array.from(selectedMembers).map(id => {
      const member = members.find(m => String(m.id) === id);
      return {
        value: id,
        label: member?.label || id
      };
    });
    
    updateModalEdit(() => ({ targets: selectedTargets }));
    setModalUserSelect({ open: false });
    
    toast.success(
      t("adminSchedule.userSelect.applied", "{count} members selected for this override", { 
        count: selectedTargets.length 
      })
    );
  };

  // Filter members based on search
  const filteredMembers = useMemo(() => {
    if (!searchMember.trim()) return members;
    return members.filter(member => 
      member.label.toLowerCase().includes(searchMember.toLowerCase())
    );
  }, [members, searchMember]);

  // Custom Fields CRUD Functions
  const createCustomField = () => {
    const newField: CustomField = {
      id: genId(),
      label: "",
      type: "text",
      value: "",
      required: false,
      placeholder: ""
    };
    setModalCustomField({ open: true, field: newField, isEdit: false });
  };

  const editCustomField = (field: CustomField) => {
    setModalCustomField({ open: true, field: { ...field }, isEdit: true });
  };

  const saveCustomField = (field: CustomField) => {
    if (!selectedRule) return;
    
    const updatedFields = selectedRule.customFields || [];
    const existingIndex = updatedFields.findIndex(f => f.id === field.id);
    
    if (existingIndex >= 0) {
      // Update existing field
      updatedFields[existingIndex] = field;
    } else {
      // Add new field
      updatedFields.push(field);
    }
    
    updateRule(selectedDay, { customFields: updatedFields });
    setModalCustomField({ open: false, field: null, isEdit: false });
    toast.success(t("adminSchedule.customFields.saved", "Custom field saved"));
  };

  const deleteCustomField = (fieldId: string) => {
    if (!selectedRule) return;
    
    const updatedFields = (selectedRule.customFields || []).filter(f => f.id !== fieldId);
    updateRule(selectedDay, { customFields: updatedFields });
    toast.success(t("adminSchedule.customFields.deleted", "Custom field deleted"));
  };

  const updateCustomFieldValue = (fieldId: string, value: string | number) => {
    if (!selectedRule) return;
    
    const updatedFields = (selectedRule.customFields || []).map(f => 
      f.id === fieldId ? { ...f, value } : f
    );
    updateRule(selectedDay, { customFields: updatedFields });
  };

  const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const saveEdit = (): void => {
    if (!modalEdit.ov) return;
    const form = modalEdit.ov;
    const start = String(form.start_date || "").trim();
    const end = String((form.singleDay ? form.start_date : form.end_date) || start);
    if (!start) {
      toast.error(t("adminSchedule.validation.ovStart", "Override start date is required (YYYY-MM-DD)."));
      return;
    }
    if (form.enabled) {
      const ci = String(form.check_in || "").trim();
      const co = String(form.check_out || "").trim();
      if (!TIME_RE.test(ci)) {
        toast.error(t("adminSchedule.validation.checkIn", "Check-in time must be in HH:MM format."));
        return;
      }
      if (!TIME_RE.test(co)) {
        toast.error(t("adminSchedule.validation.checkOut", "Check-out time must be in HH:MM format."));
        return;
      }
      const toMin = (s: string) => Number(s.slice(0,2))*60 + Number(s.slice(3,5));
      if (toMin(co) <= toMin(ci)) {
        toast.error(t("adminSchedule.validation.order", "Check-out time must be later than check-in time."));
        return;
      }
    }
    const record: OverrideItem = {
      id: form.id,
      start_date: start,
      end_date: end,
      label: form.label || t("adminSchedule.overrides.defaultLabel", "Custom Schedule"),
      enabled: !!form.enabled,
      check_in: form.enabled ? (form.check_in || "08:30") : null,
      check_out: form.enabled ? (form.check_out || "17:00") : null,
      grace_in_min: form.enabled ? Math.max(0, Math.min(240, Math.round(form.grace_in_min ?? 0))) : 0,
      grace_out_min: form.enabled ? Math.max(0, Math.min(240, Math.round(form.grace_out_min ?? 0))) : 0,
      notes: String(form.notes || ""),
      targets: form.scope === "individual" ? (Array.isArray(form.targets) ? form.targets : []) : [],
    };
    setOverrides((prev) => {
      const exists = prev.some((x) => x.id === record.id);
      const next = exists ? prev.map((x) => (x.id === record.id ? { ...record } : x)) : sortOverrides([...(prev || []), { ...record }]);
      return next;
    });
    setModalEdit({ open: false, ov: null });
    toast.success(t("adminSchedule.toast.overrideSaved", "Override saved."));
  };

  const confirmDeleteOverride = (): void => {
    const id = modalDeleteOv.ov?.id;
    if (id) deleteOverride(id);
    setModalDeleteOv({ open: false, ov: null });
    toast.success(t("adminSchedule.toast.overrideRemoved", "Override removed."));
  };

  const confirmDeleteLog = async (): Promise<void> => {
    try {
      // Placeholder: implement real endpoint if available
      // await request("/admin/attendance/logs", { method: "DELETE", body: { override_id: modalDeleteLog.ov?.id } });
      toast.success(t("adminSchedule.logs.deleted", "Log deleted."));
    } catch {
      toast.error(t("adminSchedule.logs.deleteFailed", "Failed to delete log."));
    } finally {
      setModalDeleteLog({ open: false, ov: null });
    }
  };

  return (
    <div className="space-y-6">
      {/* Action Bar */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="outline"
          onClick={resetToDefault}
          className="whitespace-normal text-center leading-tight px-3 py-2 min-h-[2.5rem]"
        >
          {t("adminSchedule.actions.resetDefault", "Reset to Default")}
        </Button>
        <Button
          className="bg-orange-500 hover:bg-orange-600 text-white whitespace-normal text-center leading-tight px-3 py-2 min-h-[2.5rem]"
          onClick={resetChanges}
          disabled={!isDirty}
        >
          {t("adminSchedule.actions.discard", "Discard Changes")}
        </Button>
        <Button
          onClick={saveAll}
          disabled={!isDirty}
          className="whitespace-normal text-center leading-tight px-3 py-2 min-h-[2.5rem]"
        >
          {t("adminSchedule.actions.saveSchedule", "Save Schedule")}
        </Button>
      </div>
      {/* Overrides Header */}
      <div className="border rounded-lg bg-card">
        <div className="p-4 border-b flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">{hdr}</div>
            <div className="text-xs text-muted-foreground">
              {t("adminSchedule.overrides.description", "Tambah rentang tanggal untuk menimpa jadwal mingguan (libur, WFH, lembur).")}
            </div>
      {/* Modals */}
      <Dialog open={modalView.open} onOpenChange={(open) => !open && setModalView({ open: false, ov: null })}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-auto bg-background border border-border rounded-2xl m-auto shadow-2xl" hideOverlay onEscapeKeyDown={() => setModalView({ open: false, ov: null })}>
          <DialogHeader>
            <DialogTitle>{t("adminSchedule.modals.view.title", "View Override")}</DialogTitle>
          </DialogHeader>
          {modalView.ov && (
            <div className="grid gap-3 text-sm">
              <div className="flex justify-between"><span>{t("adminSchedule.overrides.label", "Label")}</span><span className="font-medium">{modalView.ov.label}</span></div>
              <div className="flex justify-between"><span>{t("adminSchedule.overrides.range", "Date Range")}</span><span className="font-medium">{modalView.ov.start_date} {modalView.ov.end_date && modalView.ov.end_date !== modalView.ov.start_date ? `→ ${modalView.ov.end_date}` : ""}</span></div>
              <div className="flex justify-between"><span>{t("adminSchedule.overrides.status", "Status")}</span><span className="font-medium">{modalView.ov.enabled ? t("adminSchedule.common.onLabel", "Hari Masuk") : t("adminSchedule.common.offLabel", "Hari Libur")}</span></div>
              <div className="flex justify-between"><span>{t("adminSchedule.overrides.hours", "Hours")}</span><span className="font-medium">{modalView.ov.check_in || "—"} - {modalView.ov.check_out || "—"}</span></div>
              <div className="flex justify-between"><span>{t("adminSchedule.overrides.grace", "Grace (In/Out)")}</span><span className="font-medium">{modalView.ov.grace_in_min} / {modalView.ov.grace_out_min}</span></div>
              {modalView.ov.notes && <div><div className="text-muted-foreground">{t("adminSchedule.overrides.notes", "Notes")}</div><div className="font-medium">{modalView.ov.notes}</div></div>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalView({ open: false, ov: null })}>{t("common.close", "Close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modalEdit.open} onOpenChange={(open) => !open ? setModalEdit({ open: false, ov: null }) : null}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-auto bg-background border border-border rounded-2xl m-auto shadow-2xl" hideOverlay onEscapeKeyDown={() => setModalEdit({ open: false, ov: null })} onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            saveEdit();
          }
        }}>
          <DialogHeader>
            <DialogTitle>{t("adminSchedule.overrides.modal.title", "Override Jadwal")}</DialogTitle>
          </DialogHeader>
          {modalEdit.ov && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">{t("adminSchedule.overrides.form.label", "Label")}</Label>
                <Input value={modalEdit.ov.label} onChange={(e)=> updateModalEdit(() => ({ label: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">{t("adminSchedule.overrides.form.range", "Date Range")}</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input type="date" value={modalEdit.ov.start_date} onChange={(e)=> updateModalEdit((ov) => ({ start_date: e.target.value, end_date: ov.singleDay ? e.target.value : (ov.end_date || e.target.value) }))} />
                  <Input type="date" value={modalEdit.ov.singleDay ? modalEdit.ov.start_date : modalEdit.ov.end_date} disabled={!!modalEdit.ov.singleDay} onChange={(e)=> updateModalEdit(() => ({ end_date: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <div className="flex items-center gap-6">
                  <Label className="text-xs font-semibold flex items-center gap-2">
                    <input type="checkbox" checked={!!modalEdit.ov.singleDay} onChange={(e)=> updateModalEdit((ov) => ({ singleDay: e.target.checked, end_date: e.target.checked ? (ov.start_date || "") : (ov.end_date || ov.start_date || "") }))} />
                    {t("adminSchedule.overrides.form.singleDay", "Single Day")}
                  </Label>
                  <div className="flex items-center gap-3">
                    <Label className="text-xs font-semibold flex items-center gap-2">
                      <input type="checkbox" className="h-4 w-4" checked={!modalEdit.ov.enabled} onChange={(e)=> {
                        if (e.target.checked) {
                          updateModalEdit(() => ({ enabled: false }));
                        }
                      }} />
                      {t("adminSchedule.common.offLabel", "Holiday")}
                    </Label>
                    <Label className="text-xs font-semibold flex items-center gap-2">
                      <input type="checkbox" className="h-4 w-4" checked={!!modalEdit.ov.enabled} onChange={(e)=> {
                        if (e.target.checked) {
                          updateModalEdit(() => ({ enabled: true }));
                        }
                      }} />
                      {t("adminSchedule.common.onLabel", "Working Day")}
                    </Label>
                  </div>
                </div>
              </div>
              {/* Time and Grace Settings - Grouped together */}
              <div className="space-y-3 sm:col-span-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">{t("adminSchedule.overrides.form.checkIn", "Check In")}</Label>
                    <Input type="time" value={modalEdit.ov.check_in ?? ""} disabled={!modalEdit.ov.enabled} onChange={(e)=> updateModalEdit(() => ({ check_in: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">{t("adminSchedule.overrides.form.checkOut", "Check Out")}</Label>
                    <Input type="time" value={modalEdit.ov.check_out ?? ""} disabled={!modalEdit.ov.enabled} onChange={(e)=> updateModalEdit(() => ({ check_out: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">{t("adminSchedule.overrides.form.graceIn", "Grace In (minutes)")}</Label>
                    <Input type="number" value={modalEdit.ov.grace_in_min} disabled={!modalEdit.ov.enabled} onChange={(e)=> updateModalEdit(() => ({ grace_in_min: clamp(Number(e.target.value), 0, 240) }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">{t("adminSchedule.overrides.form.graceOut", "Grace Out (minutes)")}</Label>
                    <Input type="number" value={modalEdit.ov.grace_out_min} disabled={!modalEdit.ov.enabled} onChange={(e)=> updateModalEdit(() => ({ grace_out_min: clamp(Number(e.target.value), 0, 240) }))} />
                  </div>
                </div>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs font-semibold">{t("adminSchedule.overrides.form.notes", "Notes")}</Label>
                <textarea rows={3} className="w-full rounded-md border p-2 text-sm" placeholder={t("adminSchedule.form.notesPlaceholder", "Optional")} value={modalEdit.ov.notes || ""} onChange={(e)=> updateModalEdit(() => ({ notes: e.target.value }))} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs font-semibold">{t("adminSchedule.overrides.form.scope", "Applies to")}</Label>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant={modalEdit.ov.scope === "all" ? "default" : "outline"} onClick={()=> updateModalEdit(() => ({ scope: "all", targets: [] }))}>{t("adminSchedule.overrides.scope.all", "Applies to everyone")}</Button>
                  <Button type="button" size="sm" variant={modalEdit.ov.scope === "individual" ? "default" : "outline"} onClick={openUserSelection}>{t("adminSchedule.overrides.scope.individual", "Specific people")}</Button>
                </div>
                <p className="text-xs text-muted-foreground">{modalEdit.ov.scope === "individual" ? t("adminSchedule.overrides.form.scopeHelpIndividual", "Select specific members that receive this override.") : t("adminSchedule.overrides.form.scopeHelpAll", "Override applies to every member.")}</p>
                
                {/* Selected Members Display */}
                {modalEdit.ov.scope === "individual" && modalEdit.ov.targets && modalEdit.ov.targets.length > 0 && (
                  <div className="mt-3 p-3 bg-muted/30 rounded-lg border">
                    <div className="text-xs font-medium text-muted-foreground mb-2">
                      {t("adminSchedule.overrides.selectedMembers", "Selected members")} ({modalEdit.ov.targets.length})
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {modalEdit.ov.targets.map((target, index) => {
                        const label = typeof target === 'string' ? target : target.label || target.value;
                        return (
                          <Badge key={index} className="text-xs bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-200 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-800">
                            {label}
                            <button
                              type="button"
                              className="ml-1 hover:text-destructive"
                              onClick={() => {
                                const newTargets = modalEdit.ov?.targets?.filter((_, i) => i !== index) || [];
                                updateModalEdit(() => ({ targets: newTargets }));
                              }}
                            >
                              ×
                            </button>
                          </Badge>
                        );
                      })}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={openUserSelection}
                    >
                      <Icon name="Users" className="h-3 w-3 mr-1" />
                      {t("adminSchedule.overrides.editSelection", "Edit Selection")}
                    </Button>
                  </div>
                )}
                
                {/* Empty state for individual scope */}
                {modalEdit.ov.scope === "individual" && (!modalEdit.ov.targets || modalEdit.ov.targets.length === 0) && (
                  <div className="mt-3 p-3 bg-muted/30 rounded-lg border border-dashed">
                    <div className="text-center text-sm text-muted-foreground">
                      {t("adminSchedule.overrides.noMembersSelected", "No members selected")}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2 w-full"
                      onClick={openUserSelection}
                    >
                      <Icon name="UserPlus" className="h-3 w-3 mr-1" />
                      {t("adminSchedule.overrides.selectMembers", "Select Members")}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalEdit({ open: false, ov: null })}>{t("common.cancel", "Cancel")}</Button>
            <Button onClick={saveEdit}>{t("common.save", "Save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modalDeleteOv.open} onOpenChange={(open) => !open && setModalDeleteOv({ open: false, ov: null })}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-auto bg-background border border-border rounded-2xl m-auto shadow-2xl" hideOverlay onEscapeKeyDown={() => setModalDeleteOv({ open: false, ov: null })} onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            confirmDeleteOverride();
          }
        }}>
          <DialogHeader>
            <DialogTitle>{t("adminSchedule.modals.deleteOverride.title", "Delete Override?")}</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground">
            {t("adminSchedule.modals.deleteOverride.body", "This action will delete the selected override. Continue?")}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalDeleteOv({ open: false, ov: null })}>{t("common.cancel", "Cancel")}</Button>
            <Button variant="destructive" onClick={confirmDeleteOverride}>{t("common.delete", "Delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modalDeleteLog.open} onOpenChange={(open) => !open && setModalDeleteLog({ open: false, ov: null })}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-auto bg-background border border-border rounded-2xl m-auto shadow-2xl" hideOverlay onEscapeKeyDown={() => setModalDeleteLog({ open: false, ov: null })} onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            confirmDeleteLog();
          }
        }}>
          <DialogHeader>
            <DialogTitle>{t("adminSchedule.modals.deleteLog.title", "Delete Log?")}</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground">
            {t("adminSchedule.modals.deleteLog.body", "This action will delete the log related to this schedule. Continue?")}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalDeleteLog({ open: false, ov: null })}>{t("common.cancel", "Cancel")}</Button>
            <Button variant="destructive" onClick={confirmDeleteLog}>{t("adminSchedule.actions.deleteLog", "Delete Log")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
          </div>
          <Button
            size="sm"
            onClick={addOverride}
            className="whitespace-normal text-center leading-tight px-3 py-2 min-h-[2.5rem]"
          >
            <Icon name="Plus" className="h-4 w-4 mr-2" />
            {t("adminSchedule.overrides.add", "Add Override")}
          </Button>
        </div>

        <div className="p-2 overflow-x-auto">
          <table className="w-full">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left p-2">{t("adminSchedule.overrides.range", "Date Range")}</th>
                <th className="text-left p-2">{t("adminSchedule.overrides.label", "Label")}</th>
                <th className="text-left p-2">{t("adminSchedule.overrides.status", "Status")}</th>
                <th className="text-left p-2">{t("adminSchedule.overrides.hours", "Hours")}</th>
                <th className="text-left p-2">{t("adminSchedule.overrides.grace", "Grace (In/Out)")}</th>
                <th className="text-left p-2">{t("adminSchedule.overrides.notes", "Notes")}</th>
                <th className="text-right p-2">{t("common.actions", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {overrides.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-sm text-muted-foreground">
                    {t("adminSchedule.overrides.empty", "Belum ada override")}
                  </td>
                </tr>
              ) : (
                overrides.map((ov) => (
                  <tr key={ov.id} className="border-b align-top">
                    <td className="p-2 text-sm whitespace-nowrap">
                      <div>
                        {ov.start_date ? df.format(new Date(ov.start_date)) : "—"}
                        {ov.end_date && ov.end_date !== ov.start_date ? ` » ${df.format(new Date(ov.end_date))}` : ""}
                      </div>
                    </td>
                    <td className="p-2 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold uppercase">{ov.label}</div>
                        {!ov.enabled && (
                          <span className="text-[10px] px-2 py-1 rounded-full bg-red-500 dark:bg-red-600 text-white">{t("adminSchedule.overrides.offSummary", "Off / Holiday")}</span>
                        )}
                      </div>
                    </td>
                    <td className="p-2">
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        ov.enabled 
                          ? "bg-green-500 dark:bg-green-600 text-white" 
                          : "bg-blue-500 dark:bg-blue-600 text-white"
                      }`}>
                        {ov.enabled ? t("adminSchedule.common.onLabel", "Hari Masuk") : t("adminSchedule.common.offLabel", "Hari Libur")}
                      </span>
                    </td>
                    <td className="p-2 text-sm">
                      {ov.enabled && ov.check_in && ov.check_out ? (
                        <span>{ov.check_in} - {ov.check_out}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-2 text-sm">
                      {ov.enabled ? (
                        <span>{ov.grace_in_min || 0} / {ov.grace_out_min || 0}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-2 text-sm">
                      {ov.notes?.trim() ? ov.notes : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2 text-right">
                      <div className="inline-flex flex-wrap gap-2 justify-end">
                        <Button
                          size="sm"
                          onClick={() => openEdit(ov)}
                          className="bg-orange-500 hover:bg-orange-600 text-white"
                          title={t("adminSchedule.actions.editOverride", "Edit Override")}
                          aria-label={t("adminSchedule.actions.editOverride", "Edit Override")}
                        >
                          <Icon name="Pencil" className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => duplicateOverride(ov.id)}
                          title={t("common.duplicate", "Duplicate")}
                          aria-label={t("common.duplicate", "Duplicate")}
                        >
                          <Icon name="Copy" className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => openDeleteOverride(ov)}
                          title={t("adminSchedule.actions.deleteOverride", "Delete Override")}
                          aria-label={t("adminSchedule.actions.deleteOverride", "Delete Override")}
                        >
                          <Icon name="Trash2" className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Days Editor */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        <div className="border rounded-lg p-2 md:col-span-1 bg-card self-start">
          <div className="divide-y">
            {DAYS.map((d) => {
              const r = rules.find((x) => x.day === d);
              const active = selectedDay === d;
              const badge = r?.enabled ? t("adminSchedule.badge.work", "Working Day") : t("adminSchedule.badge.holiday", "Holiday / Off");
              const hours = r?.enabled ? `${r.check_in} - ${r.check_out}` : t("adminSchedule.badge.noSchedule", "No schedule");
              return (
                <button
                  key={d}
                  className={`w-full text-left p-3 flex items-center justify-between ${active ? "bg-accent" : "hover:bg-muted/50"}`}
                  onClick={() => setSelectedDay(d)}
                >
                  <div>
                    <div className="font-medium">{t(`adminSchedule.week.${d}`, d)}</div>
                    <div className="text-xs text-muted-foreground">{hours}</div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                    r?.enabled 
                      ? "bg-green-500 dark:bg-green-600 text-white" 
                      : "bg-blue-500 dark:bg-blue-600 text-white"
                  }`}>{badge}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="border rounded-lg p-4 md:col-span-2 bg-card">
          <div className="flex items-center justify-between mb-3">
            <div className="text-lg font-semibold">{t(`adminSchedule.week.${selectedDay}`, selectedDay)}</div>
            <div className="flex items-center gap-2">
              <span className="text-sm">{t("adminSchedule.common.workingDay", "Working Day")}</span>
              <select
                className="h-8 rounded-md border px-2 text-sm"
                value={selectedRule?.enabled ? "on" : "off"}
                onChange={(e) => updateRule(selectedDay, { enabled: e.target.value === "on" })}
              >
                <option value="on">{t("adminSchedule.common.onLabel", "Hari Masuk")}</option>
                <option value="off">{t("adminSchedule.common.offLabel", "Hari Libur")}</option>
              </select>
            </div>
          </div>

          {/* Presets */}
          <div className="flex flex-wrap gap-2 mb-4">
            <Button variant="outline" size="sm" onClick={() => applyPreset("workday")}>{t("adminSchedule.presets.workday.label", "Normal Hours")}</Button>
            <Button variant="outline" size="sm" onClick={() => applyPreset("halfday")}>{t("adminSchedule.presets.halfday.label", "Morning Shift")}</Button>
            <Button variant="outline" size="sm" onClick={() => applyPreset("evening")}>{t("adminSchedule.presets.evening.label", "Evening Shift")}</Button>
            <Button variant="outline" size="sm" onClick={() => applyPreset("wfh")}>{t("adminSchedule.presets.wfh.label", "Flexible WFH")}</Button>
            <Button variant="outline" size="sm" onClick={() => applyPreset("off")}>{t("adminSchedule.presets.off.label", "Holiday / Off")}</Button>
          </div>

          {/* Form */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1 md:col-span-2">
              <div className="text-sm font-medium">{t("adminSchedule.form.label", "Schedule Label")}</div>
              <input
                className="h-9 w-full rounded-md border px-3 text-sm"
                value={selectedRule?.label || ""}
                onChange={(e) => updateRule(selectedDay, { label: e.target.value })}
              />
            </label>

            {/* Time and Grace Settings - Grouped together */}
            <div className="space-y-3 md:col-span-2">
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <div className="text-sm font-medium">{t("adminSchedule.form.checkIn", "Check In")}</div>
                  <Input
                    type="time"
                    value={selectedRule?.check_in || ""}
                    disabled={!selectedRule?.enabled}
                    onChange={(e) => updateRule(selectedDay, { check_in: e.target.value })}
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-sm font-medium">{t("adminSchedule.form.checkOut", "Check Out")}</div>
                  <Input
                    type="time"
                    value={selectedRule?.check_out || ""}
                    disabled={!selectedRule?.enabled}
                    onChange={(e) => updateRule(selectedDay, { check_out: e.target.value })}
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <div className="text-sm font-medium">{t("adminSchedule.form.graceIn", "Grace In (minutes)")}</div>
                  <input
                    type="number"
                    className="h-9 w-full rounded-md border px-3 text-sm"
                    value={selectedRule?.grace_in_min ?? 0}
                    disabled={!selectedRule?.enabled}
                    onChange={(e) => updateRule(selectedDay, { grace_in_min: clamp(Number(e.target.value), 0, 240) })}
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-sm font-medium">{t("adminSchedule.form.graceOut", "Grace Out (minutes)")}</div>
                  <input
                    type="number"
                    className="h-9 w-full rounded-md border px-3 text-sm"
                    value={selectedRule?.grace_out_min ?? 0}
                    disabled={!selectedRule?.enabled}
                    onChange={(e) => updateRule(selectedDay, { grace_out_min: clamp(Number(e.target.value), 0, 240) })}
                  />
                </label>
              </div>
            </div>

            <label className="space-y-1 md:col-span-2">
              <div className="text-sm font-medium">{t("adminSchedule.form.notes", "Notes")}</div>
              <input
                className="h-9 w-full rounded-md border px-3 text-sm"
                placeholder={t("adminSchedule.form.notesPlaceholder", "Optional")}
                value={selectedRule?.notes || ""}
                onChange={(e) => updateRule(selectedDay, { notes: e.target.value })}
              />
            </label>

            {/* Custom Fields Section */}
            <div className="md:col-span-2 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{t("adminSchedule.customFields.title", "Custom Fields")}</div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={createCustomField}
                  className="text-xs"
                >
                  <Icon name="Plus" className="h-3 w-3 mr-1" />
                  {t("adminSchedule.customFields.add", "Add Field")}
                </Button>
              </div>
              
              {selectedRule?.customFields && selectedRule.customFields.length > 0 && (
                <div className="space-y-2 p-3 bg-muted/30 rounded-lg border">
                  {selectedRule.customFields.map((field) => (
                    <div key={field.id} className="flex items-center gap-2">
                      <div className="flex-1">
                        <label className="space-y-1">
                          <div className="text-xs font-medium text-muted-foreground">
                            {field.label}
                            {field.required && <span className="text-red-500 ml-1">*</span>}
                          </div>
                          {field.type === "textarea" ? (
                            <textarea
                              className="w-full rounded-md border p-2 text-sm resize-none"
                              rows={2}
                              placeholder={field.placeholder}
                              value={String(field.value)}
                              onChange={(e) => updateCustomFieldValue(field.id, e.target.value)}
                            />
                          ) : (
                            <input
                              type={field.type}
                              className="h-8 w-full rounded-md border px-2 text-sm"
                              placeholder={field.placeholder}
                              value={String(field.value)}
                              min={field.min}
                              max={field.max}
                              onChange={(e) => {
                                const value = field.type === "number" ? Number(e.target.value) : e.target.value;
                                updateCustomFieldValue(field.id, value);
                              }}
                            />
                          )}
                        </label>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => editCustomField(field)}
                          className="h-6 w-6 p-0"
                          title={t("adminSchedule.customFields.edit", "Edit field")}
                        >
                          <Icon name="Pencil" className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteCustomField(field.id)}
                          className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                          title={t("adminSchedule.customFields.delete", "Delete field")}
                        >
                          <Icon name="Trash2" className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {(!selectedRule?.customFields || selectedRule.customFields.length === 0) && (
                <div className="text-center py-4 text-sm text-muted-foreground border border-dashed rounded-lg">
                  {t("adminSchedule.customFields.empty", "No custom fields added yet")}
                </div>
              )}
            </div>

            <div className="md:col-span-2 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => applyToDays(DAYS)}>
                {t("adminSchedule.actions.copyToAll", "Copy to other days")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => applyToDays(WORKDAYS)}>
                {t("adminSchedule.actions.applyToWorkdays", "Apply to workdays")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => applyToDays(WEEKEND)}>
                {t("adminSchedule.actions.applyToWeekend", "Apply to weekend")}
              </Button>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end border-t pt-4">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={resetChanges} disabled={loading || saving || !isDirty}>
                {t("adminSchedule.actions.discard", "Discard Changes")}
              </Button>
              <Button size="sm" onClick={saveAll} disabled={loading || saving}>
                {saving ? t("adminSchedule.actions.saving", "Menyimpan...") : t("adminSchedule.actions.save", "Save Schedule")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* User Selection Modal */}
      <Dialog open={modalUserSelect.open} onOpenChange={(open) => !open && setModalUserSelect({ open: false })}>
        <DialogContent 
          className="max-w-2xl max-h-[75vh] bg-background border border-border rounded-2xl m-auto shadow-2xl flex flex-col p-0" 
          hideOverlay
          role="dialog"
          aria-labelledby="user-select-title"
          aria-describedby="user-select-description"
        >
          {/* Header - Fixed */}
          <div className="px-6 py-4 border-b border-border shrink-0">
            <DialogTitle id="user-select-title" className="text-lg font-semibold">
              {t("adminSchedule.userSelect.title", "Select Members")}
            </DialogTitle>
            <p id="user-select-description" className="text-sm text-muted-foreground mt-1">
              {t("adminSchedule.userSelect.subtitle", "Select members who will receive this custom schedule")}
            </p>
          </div>
          
          {/* Content - Scrollable */}
          <div className="flex flex-col flex-1 min-h-0 px-6 py-4 gap-4">
            {/* Search Input - Fixed */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="relative flex-1">
                <Icon name="Search" className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
                <Input
                  type="text"
                  placeholder={t("adminSchedule.userSelect.searchPlaceholder", "Search member names...")}
                  value={searchMember}
                  onChange={(e) => setSearchMember(e.target.value)}
                  className="pl-10 focus:ring-2 focus:ring-primary focus:border-primary"
                  aria-label={t("adminSchedule.userSelect.searchLabel", "Search members by name")}
                />
              </div>
              {searchMember && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSearchMember("")}
                  className="shrink-0"
                  title={t("adminSchedule.userSelect.clearSearch", "Clear search")}
                  aria-label={t("adminSchedule.userSelect.clearSearch", "Clear search")}
                >
                  <Icon name="X" className="h-4 w-4" />
                </Button>
              )}
            </div>

            {/* Selected Count - Fixed */}
            <div className="flex items-center justify-between text-sm shrink-0">
              <span className="text-muted-foreground">
                {t("adminSchedule.userSelect.selectedCount", "{count} members selected", { count: selectedMembers.size })}
              </span>
              <div className="flex items-center gap-2 overflow-x-auto">
                {filteredMembers.length > 0 && selectedMembers.size < filteredMembers.length && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const allIds = new Set([...selectedMembers, ...filteredMembers.map(m => String(m.id))]);
                      setSelectedMembers(allIds);
                    }}
                    className="whitespace-nowrap"
                    title={t("adminSchedule.userSelect.selectAllTooltip", "Select all displayed members")}
                    aria-label={t("adminSchedule.userSelect.selectAllTooltip", "Select all displayed members")}
                  >
                    {t("adminSchedule.userSelect.selectAll", "Select All")}
                  </Button>
                )}
                {selectedMembers.size > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedMembers(new Set())}
                    className="whitespace-nowrap"
                    title={t("adminSchedule.userSelect.clearAllTooltip", "Clear all member selections")}
                    aria-label={t("adminSchedule.userSelect.clearAllTooltip", "Clear all member selections")}
                  >
                    {t("adminSchedule.userSelect.clearAll", "Clear All")}
                  </Button>
                )}
              </div>
            </div>

            {/* Members List - Scrollable */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto border rounded-lg">
              {loadingMembers ? (
                <div className="flex items-center justify-center p-8 min-h-[200px]">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    <span className="text-sm text-muted-foreground">
                      {t("adminSchedule.userSelect.loading", "Loading member data...")}
                    </span>
                  </div>
                </div>
              ) : filteredMembers.length === 0 ? (
                <div className="flex items-center justify-center p-8 min-h-[200px]">
                  <div className="text-center">
                    <Icon name="Users" className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {searchMember 
                        ? t("adminSchedule.userSelect.noResults", "No results found for this search")
                        : t("adminSchedule.userSelect.noMembers", "No member data available")
                      }
                    </p>
                  </div>
                </div>
              ) : (
                <div className="divide-y min-w-full">
                  {filteredMembers.map((member) => {
                    const memberId = String(member.id);
                    const isSelected = selectedMembers.has(memberId);
                    
                    return (
                      <div
                        key={member.id}
                        className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors min-w-0 ${
                          isSelected ? 'bg-orange-50 border-l-2 border-l-orange-500 dark:bg-orange-900/10 dark:border-l-orange-400' : ''
                        }`}
                        onClick={() => toggleMemberSelection(memberId)}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleMemberSelection(memberId)}
                          className="h-4 w-4 rounded shrink-0"
                          onClick={(e) => e.stopPropagation()}
                          aria-label={t("adminSchedule.userSelect.selectMember", "Select member {name}", { name: member.label })}
                        />
                        
                        {/* Member Avatar */}
                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                          {member.photo_url || member.photo_path ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={member.photo_url || member.photo_path}
                              alt={member.label}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <Icon name="User" className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                        
                        {/* Member Info */}
                        <div className="flex-1 min-w-0 overflow-hidden">
                          <div className="font-medium text-sm truncate">{member.label}</div>
                          {member.person_id && (
                            <div className="text-xs text-muted-foreground truncate">
                              {t("adminSchedule.userSelect.memberId", "ID")}: {member.person_id}
                            </div>
                          )}
                        </div>
                        
                        {isSelected && (
                          <Icon name="Check" className="h-4 w-4 text-orange-500 shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Footer - Sticky */}
          <div className="px-6 py-4 border-t border-border bg-muted/20 shrink-0 rounded-b-2xl">
            <div className="flex items-center justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setModalUserSelect({ open: false })}
                aria-label={t("adminSchedule.userSelect.cancelAction", "Cancel member selection")}
              >
                {t("common.cancel", "Cancel")}
              </Button>
              <Button
                onClick={applySelectedMembers}
                disabled={selectedMembers.size === 0}
                aria-label={t("adminSchedule.userSelect.applyAction", "Apply selection of {count} members", { count: selectedMembers.size })}
              >
                {t("adminSchedule.userSelect.apply", "Apply ({count})", { count: selectedMembers.size })}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Custom Field Modal */}
      <Dialog open={modalCustomField.open} onOpenChange={(open) => !open && setModalCustomField({ open: false, field: null, isEdit: false })}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-auto bg-background border border-border rounded-2xl m-auto shadow-2xl" hideOverlay>
          <DialogHeader>
            <DialogTitle>
              {modalCustomField.isEdit 
                ? t("adminSchedule.customFields.editTitle", "Edit Custom Field")
                : t("adminSchedule.customFields.createTitle", "Create Custom Field")
              }
            </DialogTitle>
          </DialogHeader>
          
          {modalCustomField.field && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label className="text-sm font-semibold">{t("adminSchedule.customFields.fieldLabel", "Field Label")}</Label>
                <Input
                  value={modalCustomField.field.label}
                  onChange={(e) => setModalCustomField(prev => ({
                    ...prev,
                    field: prev.field ? { ...prev.field, label: e.target.value } : null
                  }))}
                  placeholder={t("adminSchedule.customFields.labelPlaceholder", "Enter field label")}
                />
              </div>
              
              <div className="space-y-1">
                <Label className="text-sm font-semibold">{t("adminSchedule.customFields.fieldType", "Field Type")}</Label>
                <select
                  className="h-9 w-full rounded-md border px-3 text-sm"
                  value={modalCustomField.field.type}
                  onChange={(e) => setModalCustomField(prev => ({
                    ...prev,
                    field: prev.field ? { 
                      ...prev.field, 
                      type: e.target.value as CustomField["type"],
                      value: e.target.value === "number" ? 0 : ""
                    } : null
                  }))}
                >
                  <option value="text">{t("adminSchedule.customFields.types.text", "Text")}</option>
                  <option value="number">{t("adminSchedule.customFields.types.number", "Number")}</option>
                  <option value="time">{t("adminSchedule.customFields.types.time", "Time")}</option>
                  <option value="textarea">{t("adminSchedule.customFields.types.textarea", "Textarea")}</option>
                </select>
              </div>
              
              <div className="space-y-1">
                <Label className="text-sm font-semibold">{t("adminSchedule.customFields.placeholder", "Placeholder")}</Label>
                <Input
                  value={modalCustomField.field.placeholder || ""}
                  onChange={(e) => setModalCustomField(prev => ({
                    ...prev,
                    field: prev.field ? { ...prev.field, placeholder: e.target.value } : null
                  }))}
                  placeholder={t("adminSchedule.customFields.placeholderPlaceholder", "Enter placeholder text")}
                />
              </div>
              
              {modalCustomField.field.type === "number" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-sm font-semibold">{t("adminSchedule.customFields.min", "Min Value")}</Label>
                    <Input
                      type="number"
                      value={modalCustomField.field.min || ""}
                      onChange={(e) => setModalCustomField(prev => ({
                        ...prev,
                        field: prev.field ? { ...prev.field, min: Number(e.target.value) } : null
                      }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-sm font-semibold">{t("adminSchedule.customFields.max", "Max Value")}</Label>
                    <Input
                      type="number"
                      value={modalCustomField.field.max || ""}
                      onChange={(e) => setModalCustomField(prev => ({
                        ...prev,
                        field: prev.field ? { ...prev.field, max: Number(e.target.value) } : null
                      }))}
                    />
                  </div>
                </div>
              )}
              
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="required"
                  checked={modalCustomField.field.required || false}
                  onChange={(e) => setModalCustomField(prev => ({
                    ...prev,
                    field: prev.field ? { ...prev.field, required: e.target.checked } : null
                  }))}
                  className="h-4 w-4 rounded"
                />
                <Label htmlFor="required" className="text-sm">
                  {t("adminSchedule.customFields.required", "Required field")}
                </Label>
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setModalCustomField({ open: false, field: null, isEdit: false })}
            >
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              onClick={() => {
                if (modalCustomField.field && modalCustomField.field.label.trim()) {
                  saveCustomField(modalCustomField.field);
                } else {
                  toast.error(t("adminSchedule.customFields.validation.labelRequired", "Field label is required"));
                }
              }}
              disabled={!modalCustomField.field?.label.trim()}
            >
              {t("common.save", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
