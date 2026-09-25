import { useState } from "react";
import { useTranslation } from "react-i18next";
import { evidenceItems, type EvidenceItem } from "../lib/evidence";
import type { Decision, EvidenceInput } from "../types";
import { statusName } from "../types";
import { TechnicalDetails } from "./TechnicalDetails";
import { humanizeReasonLocal } from "../i18n/strings";
import { FALLBACK_LOCALE, type LocaleCode } from "../i18n/locales";

export function EvidencePanel({
  input, decision, highlight, onHighlight,
}: {
  input: EvidenceInput;
  decision: Decision;
  /** Shared cross-highlight key, links with the Signal Map and Reliability Arc. */
  highlight?: string | null;
  onHighlight?: (key: string | null) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  // Attention-first: rows where a deterministic rule fired rise to the top, in original order.
  const items = [...evidenceItems(input, decision.ruleIds ?? [])].sort(
    (a, b) => Number(b.contributed) - Number(a.contributed),
  );
  const edge: Record<EvidenceItem["state"], string> = {
    ok: "border-l-[#167A5A]",
    warn: "border-l-[#B7791F]",
    fail: "border-l-[#C43D3D]",
  };
  return (
    <section aria-label="Evidence" className="rounded-xl border border-[#DCE3EC] bg-white">
      <header className="border-b border-[#DCE3EC] px-4 py-3">
        <h3 className="font-semibold text-[#132238]">Evidence</h3>
        <p className="text-sm text-[#607087]">
          What the decision was based on, items that influenced it are listed first. Expand a row for its source and timestamp.
        </p>
      </header>
      <ul className="divide-y divide-[#DCE3EC]">
        {items.map((it) => {
          const dot = it.state === "ok" ? "bg-[#167A5A]" : it.state === "warn" ? "bg-[#B7791F]" : "bg-[#C43D3D]";
          const expanded = open === it.key;
          const active = highlight === it.key;
          return (
            <li
              key={it.key}
              className={`border-l-2 transition-colors ${it.contributed ? edge[it.state] : "border-l-transparent"} ${
                active ? "bg-[#F3F7FD]" : ""
              }`}
            >
              <button
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#F7F9FC] ${it.contributed ? "" : "opacity-80"} ${
                  active ? "ring-1 ring-inset ring-[#1E5AA8]/50" : ""
                }`}
                aria-expanded={expanded}
                onMouseEnter={() => onHighlight?.(it.key)}
                onMouseLeave={() => onHighlight?.(null)}
                onFocus={() => onHighlight?.(it.key)}
                onBlur={() => onHighlight?.(null)}
                onClick={() => setOpen(expanded ? null : it.key)}
              >
                <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${dot} transition-colors`} />
                <span className="w-40 shrink-0 font-medium text-[#132238]">
                  {it.label}
                  {it.contributed && (
                    <span className="mono ml-1.5 text-[10px] font-semibold text-[#607087]" title="Contributed to this decision">✓</span>
                  )}
                </span>
                <span className="flex-1 break-words text-sm text-[#132238]">{it.value}</span>
                <span
                  aria-hidden="true"
                  className={`text-sm text-[#607087] transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
                >
                  ▸
                </span>
              </button>
              {/* height/opacity transition without layout jumps (grid-rows technique) */}
              <div className="pt-expand" data-open={expanded}>
                <div>
                  <div className="px-4 pb-3 pl-10 pt-fade text-sm text-[#607087]">
                    <p>{it.detail}</p>
                    {it.rule && (
                      <TechnicalDetails>
                        <p>Rule: {it.rule}</p>
                      </TechnicalDetails>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function WhyPanel({ decision, lngOverride }: { decision: Decision; /** Supervisor "Show in English" override (spec section 8): when set, the reason chain renders the canonical English wording. */ lngOverride?: boolean }) {
  // Reasons flow through the central humanization module extended with the reviewed catalog
  // (rule ID → message key → localised string). Each reason carries its family's presented
  // next action so the reason, the evidence card and the action tell one consistent story.
  const { t } = useTranslation();
  const ov = lngOverride ? { lng: FALLBACK_LOCALE as LocaleCode } : undefined;
  const reasons = decision.reasons.map((r) => humanizeReasonLocal(r, ov));
  return (
    <section aria-label="Why this decision" className="rounded-xl border border-[#DCE3EC] bg-white px-4 py-3">
      <h3 className="font-semibold text-[#132238]">Why this result received this status</h3>
      <ol className="mt-2 space-y-2 text-sm">
        {reasons.map((r, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden="true" className="font-bold text-[#1E5AA8]">{i + 1}.</span>
            <span>
              <b>{r.label}.</b> {r.text}
              {r.action && (
                <span className="mt-1 block text-xs text-[#607087]">
                  <b className="font-semibold">{t("ui.driver.suggested_action")}:</b> {r.action}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
      <TechnicalDetails>
        <p>Assessment record: {decision.id}</p>
        <p>Rules applied: {decision.ruleIds.join(", ") || "none"}</p>
        <p>Trace: evidence → rule → {statusName(decision.finalStatus)} → action → audit entry</p>
        {decision.reasons.map((r, i) => <p key={i}>Persisted reason {i + 1}: {r}</p>)}
      </TechnicalDetails>
    </section>
  );
}
