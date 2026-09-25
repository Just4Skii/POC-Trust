import { useEffect, useRef, useState } from "react";
import { i18next } from "../i18n";
import { isSupportedLocale, localeEntry } from "../i18n/locales";

/**
 * Accessibility (spec section 11): a language change is announced to assistive technology
 * in the NEW language, through a polite live region. The announcer is visually hidden and
 * has zero layout impact. The initial locale on page load is not a "change" and stays
 * silent; the element is always present so the live region exists before any switch.
 */
export function LocaleAnnouncer() {
  const [message, setMessage] = useState("");
  const mounted = useRef(false);
  useEffect(() => {
    const onChange = (lng: string) => {
      if (!mounted.current) {
        mounted.current = true; // the initial languageChanged from init is not a user switch
        return;
      }
      if (!isSupportedLocale(lng)) return;
      setMessage(i18next.t("ui.language.changed", { lng, language: localeEntry(lng).native }));
    };
    i18next.on("languageChanged", onChange);
    return () => { i18next.off("languageChanged", onChange); };
  }, []);
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="locale-announcer"
      style={{
        position: "absolute", width: 1, height: 1, margin: -1, padding: 0,
        overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0,
      }}
    >
      {message}
    </span>
  );
}
