/**
 * Presentation locale (spec section 11): the locale used for Intl date/time formatting of
 * rendered DATA. It is set by the i18n runtime on init and on every language change, and
 * deliberately lives apart from i18next so the pure-English humanization core (src/lib/
 * labels.ts) stays importable in Node — the copy guard and contract checks validate it
 * with no i18n runtime present (null here means "en-ZA").
 *
 * Clinical measurement values (temperature, humidity, result strings) are NOT re-formatted:
 * they are recorded data and are rendered exactly as recorded, in every language.
 */
let current: string | null = null;

export function setPresentationLocale(lng: string | null): void {
  current = lng && lng !== "en-ZA" ? lng : null;
}

export function presentationLocale(): string | null {
  return current;
}
