import { computed, inject, reactive, watch } from "vue";
import { LANGUAGE_OPTIONS, messages } from "./messages";

const FALLBACK_LOCALE = "id";

function resolveLocale(locale) {
  const validCodes = Object.keys(messages);
  if (validCodes.includes(locale)) return locale;
  const normal = String(locale || "").toLowerCase();
  return validCodes.includes(normal) ? normal : FALLBACK_LOCALE;
}

function readMessage(locale, path) {
  const bag = messages[locale];
  if (!bag) return undefined;
  return path.split(".").reduce((acc, part) => {
    if (acc && Object.prototype.hasOwnProperty.call(acc, part)) {
      return acc[part];
    }
    return undefined;
  }, bag);
}

function setDocumentLang(locale) {
  if (typeof document === "undefined") return;
  document.documentElement?.setAttribute("lang", locale);
}

function formatMessage(message, values) {
  if (!values || typeof values !== "object") return message;
  const entries = Object.entries(values);
  if (!entries.length) return message;
  let output = String(message);
  for (const [token, value] of entries) {
    const pattern = new RegExp(`\\{${token}\\}`, "g");
    output = output.replace(pattern, String(value));
  }
  return output;
}

export function createI18nState(initialLocale = FALLBACK_LOCALE) {
  const state = reactive({
    locale: resolveLocale(initialLocale),
  });

  setDocumentLang(state.locale);

  function setLocale(next) {
    const nextLocale = resolveLocale(next);
    if (state.locale === nextLocale) return;
    state.locale = nextLocale;
  }

  watch(
    () => state.locale,
    (loc) => {
      setDocumentLang(loc);
    },
    { immediate: false }
  );

  function t(key, fallback, values) {
    if (!key) return fallback ?? "";

    // Support legacy usage: t(key, values)  -> treat second arg as values
    if (values === undefined && fallback && typeof fallback === "object") {
      values = fallback;
      fallback = undefined;
    }

    const current = readMessage(state.locale, key);
    if (current !== undefined) return formatMessage(current, values);
    if (state.locale !== FALLBACK_LOCALE) {
      const fallbackMsg = readMessage(FALLBACK_LOCALE, key);
      if (fallbackMsg !== undefined) return formatMessage(fallbackMsg, values);
    }
    const base = fallback ?? key;
    return formatMessage(base, values);
  }

  return {
    state,
    locale: computed(() => state.locale),
    available: LANGUAGE_OPTIONS,
    setLocale,
    t,
  };
}

export function useI18n() {
  const ctx = inject("i18n");
  if (!ctx) {
    throw new Error("I18n context is missing");
  }
  return ctx;
}

export { LANGUAGE_OPTIONS } from "./messages";
