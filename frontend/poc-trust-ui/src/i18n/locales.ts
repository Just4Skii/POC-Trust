/**
 * Supported locales (spec section 3), BCP 47 codes.
 *
 * en-ZA is the canonical SOURCE language and the mandatory fallback: every key in every
 * catalog must exist in en-ZA (enforced by scripts/check-i18n.mjs). The set intentionally
 * covers the most widely spoken home languages for this deployment context; the registry is
 * the only place a new official language is added (catalog + meta file + one entry here ,
 * no redesign). Home-language rationale is documented in docs/localisation.md, citing the
 * primary Stats SA Census 2022 source rather than repeating figures from memory.
 */

export type LocaleCode = "en-ZA" | "zu-ZA" | "xh-ZA" | "af-ZA";

export interface LocaleEntry {
  code: LocaleCode;
  /** Language name shown in its OWN language (spec section 8). */
  native: string;
  /** English name for accessibility strings. */
  english: string;
}

export const FALLBACK_LOCALE: LocaleCode = "en-ZA";

export const SUPPORTED_LOCALES: readonly LocaleEntry[] = [
  { code: "en-ZA", native: "English", english: "English (South Africa)" },
  { code: "zu-ZA", native: "isiZulu", english: "isiZulu" },
  { code: "xh-ZA", native: "isiXhosa", english: "isiXhosa" },
  { code: "af-ZA", native: "Afrikaans", english: "Afrikaans" },
];

/** Browser-storage key for the operator's device-level language preference (no authentication). */
export const LANGUAGE_STORAGE_KEY = "poctrust.language";

export function isSupportedLocale(value: unknown): value is LocaleCode {
  return typeof value === "string" && SUPPORTED_LOCALES.some((l) => l.code === value);
}

export function localeEntry(code: LocaleCode): LocaleEntry {
  return SUPPORTED_LOCALES.find((l) => l.code === code) ?? SUPPORTED_LOCALES[0];
}

/** Exact-match, then base-language match ("zu" → "zu-ZA") against the supported set. */
export function browserLocale(candidates: readonly string[]): LocaleCode | null {
  for (const raw of candidates) {
    if (isSupportedLocale(raw)) return raw;
    const base = raw.split("-")[0];
    const hit = SUPPORTED_LOCALES.find((l) => l.code.split("-")[0] === base);
    if (hit) return hit.code;
  }
  return null;
}

/**
 * Initial locale: stored device preference first, then browser language when supported,
 * else English. Always user-overridable (spec section 8).
 */
export function initialLocale(storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage): LocaleCode {
  try {
    const stored = storage?.getItem(LANGUAGE_STORAGE_KEY) ?? null;
    if (isSupportedLocale(stored)) return stored;
  } catch { /* storage unavailable, fall through */ }
  if (typeof navigator !== "undefined") {
    const fromBrowser = browserLocale([...(navigator.languages ?? []), navigator.language].filter(Boolean) as string[]);
    if (fromBrowser) return fromBrowser;
  }
  return FALLBACK_LOCALE;
}
