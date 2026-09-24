import i18next, { type i18n as I18nInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import enCatalog from "./catalogs/en-ZA.json" with { type: "json" };
import {
  FALLBACK_LOCALE, initialLocale, isSupportedLocale, LANGUAGE_STORAGE_KEY,
  type LocaleCode,
} from "./locales.ts";

/**
 * i18n runtime (spec section 4) — static, reviewed message catalogs keyed by stable message
 * keys. Library choice: react-i18next + i18next — smallest mainstream React option with
 * built-in lazy per-locale bundles, Intl.PluralRules-based plurals (ICU-equivalent) and
 * interpolation; FormatJS ships a heavier ICU parser and Lingui couples to a compile step.
 * Justification is recorded in docs/localisation.md.
 *
 * Safety properties:
 * - English (en-ZA) is loaded eagerly: it is the source of truth and the mandatory fallback.
 * - Other locales lazy-load as separate bundles (offline-friendly: shipped with the app,
 *   no runtime translation API is ever called for safety-critical text).
 * - A missing or empty string ALWAYS falls back to English — never a raw key, never an
 *   empty string, never unreviewed machine output standing in for the canonical wording.
 * - Driver/decision/evidence key FAMILIES resolve as a unit: if the active locale lacks any
 *   member of a family, the whole family falls back to English so the operator never sees a
 *   half-translated explanation chain (spec section 4).
 * - Changing language re-renders instantly (no reload, no form-state loss) and keeps the
 *   document lang attribute in sync for screen readers and hyphenation (spec section 3).
 */

export type CatalogBundle = Record<string, string>;

/** Catalog files carry a numeric version marker alongside the string entries; strip it. */
function toBundle(raw: unknown): CatalogBundle {
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === "string"),
  ) as CatalogBundle;
}

/** The bundled English catalog (strings only) — the universal fallback of last resort. */
export const EN_BUNDLE: CatalogBundle = toBundle(enCatalog);

/** Interpolation values passed to i18next; dates/counts are DATA, never baked into strings. */
export interface TextOptions {
  /** Force a specific language for this lookup (the decision-screen "Show in English" view). */
  lng?: LocaleCode;
  [key: string]: unknown;
}

const catalogCache = new Map<LocaleCode, Promise<CatalogBundle>>();

/** Lazy catalog load (spec section 4). English resolves synchronously — it is bundled. */
export function loadCatalog(locale: LocaleCode): Promise<CatalogBundle> {
  if (locale === FALLBACK_LOCALE) return Promise.resolve(EN_BUNDLE);
  let pending = catalogCache.get(locale);
  if (!pending) {
    pending = import(`./catalogs/${locale}.json`).then((m) => toBundle(m.default));
    catalogCache.set(locale, pending);
  }
  return pending;
}

/** Last-resort handler: an unknown key must never surface as raw key text. */
function lastResort(key: string): string {
  const english = EN_BUNDLE[key];
  return typeof english === "string" && english ? english : "Details not available in the selected language.";
}

export async function initI18n(): Promise<I18nInstance> {
  if (i18next.isInitialized) return i18next;
  // The stored/browser locale may not be English: load and register its bundle BEFORE init
  // so the very first paint already renders the operator's language (with English fallback
  // under it for anything missing).
  const initial = initialLocale();
  const resources: Record<string, { translation: CatalogBundle }> = {
    [FALLBACK_LOCALE]: { translation: EN_BUNDLE },
  };
  if (initial !== FALLBACK_LOCALE) {
    resources[initial] = { translation: await loadCatalog(initial) };
  }
  await i18next.use(initReactI18next).init({
    lng: initial,
    fallbackLng: FALLBACK_LOCALE,
    supportedLngs: ["en-ZA", "zu-ZA", "xh-ZA", "af-ZA"],
    nonExplicitSupportedLngs: false,
    resources,
    interpolation: { escapeValue: false },
    returnNull: false,
    returnEmptyString: false,
    parseMissingKeyHandler: (key) => lastResort(key),
  });
  // Keep <html lang> aligned so screen readers and hyphenation follow the active locale.
  const syncLang = (lng: string) => {
    if (isSupportedLocale(lng)) document.documentElement.lang = lng;
  };
  i18next.on("languageChanged", syncLang);
  syncLang(i18next.language);
  return i18next;
}

/**
 * Switch the display language: lazily load the catalog, register it, apply it, and persist
 * the device-level preference. Instant — no page reload, no form-state loss (spec section 8).
 */
export async function changeLocale(locale: LocaleCode): Promise<void> {
  if (locale !== FALLBACK_LOCALE) {
    const bundle = await loadCatalog(locale);
    i18next.addResourceBundle(locale, "translation", bundle, true, true);
  }
  await i18next.changeLanguage(locale);
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  } catch { /* storage unavailable — preference simply not persisted */ }
}

export { i18next };
