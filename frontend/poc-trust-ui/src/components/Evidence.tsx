import { useState } from "react";
import { evidenceItems } from "../lib/evidence";
import { humanizeReason } from "../lib/labels";
import type { Decision, EvidenceInput } from "../types";
import { statusName } from "../types";
import { TechnicalDetails } from "./TechnicalDetails";

export function EvidencePanel({ input, decision }: { input: EvidenceInput; decision: Decision }) {
  const [open, setOpen] = useState<string | null>(null);
  // Attention-first: rows where a deterministic rule fired rise to the top, in original order.
  const items = [...evidenceItems(input, decision.ruleIds ?? [])].sort(
    (a, b) => Number(b.contributed) - Number(a.contributed),
  );
  return (
    <section aria-label="Evidence" className="rounded-xl border border-[#DCE3EC] bg-white">
      <header className="border-b border-[#DCE3EC] px-4 py-3">
        <h3 className="font-semibold text-[#132238]">Evidence</h3>
        <p className="text-sm text-[#607087]">
          What the decision was based on — items that influenced it are listed first. Expand a row for its source and timestamp.
        </p>
      </header>
      <ul className="divide-y divide-[#DCE3EC]">
        {items.map((it) => {
          const dot = it.state === "ok" ? "bg-[#167A5A]" : it.state === "warn" ? "bg-[#B7791F]" : "bg-[#C43D3D]";
          const expanded = open === it.key;
          return (
            <li key={it.key}>
              <button
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#F7F9FC] ${it.contributed ? "" : "opacity-80"}`}
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : it.key)}
              >
                <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${dot}`} />
                <span className="w-44 shrink-0 font-medium text-[#132238]">{it.label}</span>
                <span className="flex-1 truncate text-sm text-[#132238]">{it.value}</span>
                <span className="text-sm text-[#607087]" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
              </button>
              {expanded && (
                <div className="px-4 pb-3 pl-10 text-sm text-[#607087] pt-fade">
                  <p>{it.detail}</p>
                  {it.rule && (
                    <TechnicalDetails>
                      <p>Rule: {it.rule}</p>
                    </TechnicalDetails>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function WhyPanel({ decision }: { decision: Decision }) {
  const reasons = decision.reasons.map(humanizeReason);
  return (
    <section aria-label="Why this decision" className="rounded-xl border border-[#DCE3EC] bg-white px-4 py-3">
      <h3 className="font-semibold text-[#132238]">Why this result received this status</h3>
      <ol className="mt-2 space-y-2 text-sm">
        {reasons.map((r, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden="true" className="font-bold text-[#1E5AA8]">{i + 1}.</span>
            <span>
              <b>{r.label}.</b> {r.text}
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
