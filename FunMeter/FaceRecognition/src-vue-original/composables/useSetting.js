import { computed, inject } from "vue";

/**
 * @typedef {Object} Clamp
 * @property {number} [min]
 * @property {number} [max]
 * @property {boolean} [round]
 */

/** @param {any} obj @param {string} path */
function getByPath(obj, path) {
  return path.split(".").reduce((acc, k) => (acc ? acc[k] : undefined), obj);
}

/** @param {any} obj @param {string} path @param {any} val */
function setByPath(obj, path, val) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((acc, k) => acc[k], obj);
  target[last] = val;
}

/**
 * @param {string} path
 * @param {{ clamp?: Clamp }} [opts]
 */
export function useSetting(path, opts = {}) {
  const settings = inject("settings");
  if (!settings) throw new Error("Settings provider missing");
  const state = settings.state;

  const model = computed({
    get() {
      return getByPath(state, path);
    },
    set(v) {
      // Coerce number if target currently a number
      const current = getByPath(state, path);
      let next = v;

      if (typeof current === "number") {
        const n = typeof v === "string" ? Number(v) : v;
        if (!Number.isFinite(n)) return;
        next = n;

        const { clamp } = opts;
        if (clamp) {
          if (clamp.round) next = Math.round(next);
          if (typeof clamp.min === "number") next = Math.max(clamp.min, next);
          if (typeof clamp.max === "number") next = Math.min(clamp.max, next);
        }
      }

      setByPath(state, path, next);
    },
  });

  const placeholder = computed(() => String(getByPath(state, path) ?? ""));

  return { model, placeholder };
}
