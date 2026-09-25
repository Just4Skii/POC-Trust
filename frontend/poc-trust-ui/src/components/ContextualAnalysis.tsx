import { useTranslation } from "react-i18next";
import { FALLBACK_LOCALE, type LocaleCode } from "../i18n/locales";
import type { Decision } from "../types";
import { statusName } from "../types";

/**
 * Contextual Analysis panel, localisation spec section 9 (DEFAULT policy).
 *
 * The AI-generated text itself remains ENGLISH in every locale: it is advisory content,
 * never machine-translated at runtime, and the English original is the persisted record.
 * Only the framing around it (subtitle, availability note, authoritative-decision line)
 * is localised from the reviewed catalog. In non-English locales the panel says so
 * explicitly: "Contextual Analysis is currently available in English."
 *
 * The AI prose is marked lang="en" so screen readers switch pronunciation for the inline
 * language change (spec section 11). VERIFY renders NO panel at all, in every language.
 */
export function ContextualAnalysis({ decision }: { decision: Decision }) {
  const { t, i18n } = useTranslation();
  // VERIFY hard-stop: NO Contextual Analysis panel is rendered at all, not hidden, absent
  // (Section 26). REVIEW keeps a persistent line that the deterministic state remains authoritative.
  if (!decision.aiConsulted || !decision.aiAssessment) return null;
  if (statusName(decision.finalStatus) === "Verify") return null;
  const activeLocale = (i18n.language as LocaleCode) || FALLBACK_LOCALE;
  const isEnglishView = activeLocale === FALLBACK_LOCALE;
  const ai = decision.aiAssessment;
  const anomalies = ai.anomalies ?? [];
  const isReview = statusName(decision.finalStatus) === "Review";
  // Only metadata that actually arrived with this decision is shown. Historical records persist the
  // advisory summary alone, so no confidence score or model name is invented for them.
  const meta = [
    ai.recommendedAction ? t("ui.ai.suggested_review", { value: ai.recommendedAction }) : "",
    typeof ai.confidence === "number" ? t("ui.ai.confidence", { value: ai.confidence }) : "",
    ai.model ? t("ui.ai.model", { value: ai.model }) : "",
  ].filter(Boolean);

  return (
    <section aria-label="Contextual analysis" className="pt-fade rounded-xl border border-[#0F8B8D]/40 bg-[#EAF7F7] px-4 py-3">
      <h3 lang="en" className="font-semibold text-[#0B1F3A]">Contextual Analysis</h3>
      <p className="text-xs text-[#607087]">{t("ui.ai.subtitle")}</p>
      {!isEnglishView && (
        <p className="mt-1 text-xs font-semibold text-[#1E5AA8]" data-testid="ai-language-note">
          {t("ui.ai.english_only")}
        </p>
      )}
      <p lang="en" className="mt-2 text-sm text-[#132238]">{ai.summary}</p>
      {anomalies.length > 0 && (
        <ul lang="en" className="mt-1 list-disc pl-5 text-sm text-[#132238]">
          {anomalies.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      )}
      {isReview && (
        <p className="mt-2 rounded-md border border-[#B7791F]/40 bg-[#FFF7E6] px-3 py-1.5 text-xs font-semibold text-[#8A6216]">
          {t("ui.ai.review_authoritative")}
        </p>
      )}
      {meta.length > 0 ? (
        <p lang="en" className="mt-1 text-xs text-[#607087]">{meta.join(" · ")}</p>
      ) : (
        <p className="mt-1 text-xs text-[#607087]">{t("ui.ai.summary_only")}</p>
      )}
    </section>
  );
}

export function AiFallback({ show }: { show: boolean }) {
  const { t } = useTranslation();
  if (!show) return null;
  return (
    <p role="note" className="rounded-lg border border-[#DCE3EC] bg-white px-3 py-2 text-xs text-[#607087]">
      {t("ui.ai.unavailable")}
    </p>
  );
}
