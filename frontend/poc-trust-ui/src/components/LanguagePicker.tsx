import { useTranslation } from "react-i18next";
import { changeLocale } from "../i18n";
import { FALLBACK_LOCALE, localeEntry, SUPPORTED_LOCALES, type LocaleCode } from "../i18n/locales";
import { useLocaleSupport } from "../i18n/support";

/**
 * The ONE compact language control (spec section 8): a native <select> — instantly
 * keyboard- and screen-reader-accessible — labelled "Language", listing each language in
 * its own language with its support state taken from real catalog metadata (never
 * hard-coded). Deliberately NOT in the header: the header already carries the
 * demonstration indicator, palette hint, help, online status and last-sync time.
 * It is rendered in the sidebar (desktop) and duplicated in Settings; on narrow screens
 * it lives in Settings, per the spec.
 */
export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const support = useLocaleSupport();
  const active = (i18n.language as LocaleCode) || FALLBACK_LOCALE;

  const suffix = (code: LocaleCode) => {
    if (code === FALLBACK_LOCALE) return "";
    const s = support?.[code];
    // Derived from real catalog metadata; while it is still loading, show nothing rather
    // than a hard-coded claim. A fully reviewed locale earns no suffix.
    return s && s.state !== "supported" ? ` (${t("ui.support.preview")})` : "";
  };

  return (
    <label className={`flex items-center gap-2 ${compact ? "text-xs" : "text-sm"}`}>
      <span className={compact ? "text-slate-300" : "font-medium text-[#132238]"}>{t("ui.language.label")}</span>
      <select
        value={active}
        aria-label={t("ui.language.selector_aria")}
        onChange={(e) => void changeLocale(e.target.value as LocaleCode)}
        className={`min-h-[36px] rounded-md border bg-white px-2 py-1 ${compact ? "border-white/25 text-xs text-[#0B1F3A]" : "border-[#DCE3EC] text-sm text-[#0B1F3A]"}`}
      >
        {SUPPORTED_LOCALES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.native}
            {suffix(l.code)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Active-locale native name (for the "Show in isiZulu" toggle after an English override). */
export function activeNativeName(code: LocaleCode): string {
  return localeEntry(code).native;
}
