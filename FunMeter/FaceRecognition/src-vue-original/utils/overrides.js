export function normalizeTargets(list, limit = 64) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const normalized = [];

  for (const entry of list) {
    if (!entry && entry !== 0) continue;

    let label = "";
    if (typeof entry === "string") {
      label = entry.trim();
    } else if (typeof entry === "object") {
      label = String(entry.value ?? entry.label ?? entry.id ?? JSON.stringify(entry)).trim();
    } else {
      label = String(entry).trim();
    }

    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(label);
    if (normalized.length >= limit) break;
  }

  return normalized;
}


export function ensureTargetsArray(targets) {
  if (!targets) return [];
  return Array.isArray(targets) ? targets : [targets];
}

const PERSON_ID_RE = /^p-[a-z0-9]{4}-[a-z0-9]{3}-[a-z0-9]{3}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeIdTargets(list, limit = 128) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (!raw && raw !== 0) continue;

    let type = "label";
    let value = "";
    let label = "";

    if (typeof raw === "object") {
      type = String(raw.type || raw.kind || "label").toLowerCase();
      value = String(
        raw.value ??
          raw.id ??
          raw.person_id ??
          raw.group_id ??
          raw.label ??
          raw.slug ??
          ""
      ).trim();
      label = String(raw.label || "").trim();
    } else {
      value = String(raw ?? "").trim();
      label = value;
      if (PERSON_ID_RE.test(value)) {
        type = "person";
      } else if (UUID_RE.test(value)) {
        type = "group";
      } else {
        type = "label";
      }
    }

    if (!value) continue;

    if (type === "person_id") type = "person";
    if (type === "group_id") type = "group";
    if (!["person", "group", "face_id", "label"].includes(type)) {
      type = "label";
    }

    const dedupeKey = `${type}:${value.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const target = { type, value };
    if (label && !target.label) {
      target.label = label;
    }
    out.push(target);
    if (out.length >= limit) break;
  }
  return out;
}
