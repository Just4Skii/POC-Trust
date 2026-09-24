import { useState } from "react";
import type { Decision, EvidenceInput } from "../types";
import { statusName } from "../types";

interface Item {
  key: string;
  label: string;
  state: "ok" | "warn" | "fail";
  value: string;
  detail: string;
  rule?: string;
}

function fmtDate(v?: string) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

export function evidenceItems(input: EvidenceInput, ruleIds: string[]): Item[] {
  const has = (r: string) => ruleIds.includes(r);
  return [
    { key: "device", label: "Device", state: "ok", value: input.deviceId ?? "—", detail: `Source: event record · ${fmtDate(input.timestampUtc)}`, rule: undefined },
    { key: "qc", label: "Quality Control", state: input.qcPassed ? "ok" : "fail", value: input.qcPassed ? "QC passed" : "QC FAILED", detail: `Device ${input.deviceId ?? "—"} · Source: device QC record`, rule: has("QC_FAILED") ? "QC_FAILED → VERIFY" : undefined },
    { key: "cal", label: "Calibration / Maintenance", state: has("CAL_EXPIRED") ? "fail" : has("CAL_NEAR_DUE") ? "warn" : "ok", value: input.calibrationDueUtc ? `Due ${fmtDate(input.calibrationDueUtc)}` : "—", detail: "Source: calibration record", rule: has("CAL_EXPIRED") ? "CAL_EXPIRED → VERIFY" : has("CAL_NEAR_DUE") ? "CAL_NEAR_DUE → REVIEW" : undefined },
    { key: "op", label: "Operator", state: input.operatorCompetent ? "ok" : "warn", value: input.operatorId ? `${input.operatorId} · ${input.operatorCompetent ? "competent" : "not competent"}` : "Unknown operator", detail: "Source: competency record", rule: has("OPERATOR_NOT_COMPETENT") ? "OPERATOR_NOT_COMPETENT → REVIEW" : undefined },
    { key: "reagent", label: "Reagent", state: has("REAGENT_EXPIRED") ? "fail" : has("REAGENT_NEAR_EXPIRY") ? "warn" : "ok", value: input.reagentLot ? `${input.reagentLot} · exp ${fmtDate(input.reagentExpiryUtc)}` : "Missing lot", detail: "Source: consumable record", rule: has("REAGENT_EXPIRED") ? "REAGENT_EXPIRED → VERIFY" : has("REAGENT_NEAR_EXPIRY") ? "REAGENT_NEAR_EXPIRY → REVIEW" : undefined },
    { key: "env", label: "Environment", state: has("ENV_TEMP") || has("ENV_HUMIDITY") ? "warn" : "ok", value: `${input.temperatureC ?? "—"}°C · ${input.humidityPct ?? "—"}%`, detail: `Power interruption: ${input.powerInterruption ? "YES" : "no"} · Source: site sensor`, rule: has("POWER_INTERRUPTION") ? "POWER_INTERRUPTION → REVIEW" : undefined },
    { key: "prov", label: "Provenance", state: has("PROVENANCE_INCOMPLETE") ? "warn" : "ok", value: input.provenance || "Incomplete", detail: `WHO ${input.operatorId || "?"} · WHERE ${input.provenance || "?"} · ${fmtDate(input.timestampUtc)}`, rule: has("PROVENANCE_INCOMPLETE") ? "PROVENANCE_INCOMPLETE → REVIEW" : undefined },
    { key: "conn", label: "Connectivity", state: "ok", value: `${input.connectivity ?? "online"}${input.localEventId ? ` · ${input.localEventId}` : ""}`, detail: "Prototype offline metadata; full sync is FUTURE.", rule: undefined },
  ];
}

export function EvidencePanel({ input, decision }: { input: EvidenceInput; decision: Decision }) {
  const [open, setOpen] = useState<string | null>(null);
  const items = evidenceItems(input, decision.ruleIds ?? []);
  return (
    <section aria-label="Evidence" className="rounded-xl border border-[#DCE3EC] bg-white">
      <header className="border-b border-[#DCE3EC] px-4 py-3">
        <h3 className="font-semibold text-[#132238]">Evidence</h3>
        <p className="text-sm text-[#607087]">Compact view — expand any row for source, timestamp, rule and severity.</p>
      </header>
      <ul className="divide-y divide-[#DCE3EC]">
        {items.map((it) => {
          const dot = it.state === "ok" ? "bg-[#167A5A]" : it.state === "warn" ? "bg-[#B7791F]" : "bg-[#C43D3D]";
          const expanded = open === it.key;
          return (
            <li key={it.key}>
              <button
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#F7F9FC]"
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
                  {it.rule && <p className="mt-1 font-mono text-xs text-[#132238]">Rule: {it.rule}</p>}
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
  return (
    <section aria-label="Why this decision" className="rounded-xl border border-[#DCE3EC] bg-white px-4 py-3">
      <h3 className="font-semibold text-[#132238]">Why — deterministic reasons</h3>
      <ol className="mt-2 space-y-1.5 text-sm">
        {decision.reasons.map((r, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden="true" className="font-bold text-[#1E5AA8]">{i + 1}.</span>
            <span>{r}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-[#607087]">
        Trace: evidence → rule ({decision.ruleIds.join(", ") || "none"}) → {statusName(decision.finalStatus)} → action → audit {decision.id.slice(0, 8)}.
      </p>
    </section>
  );
}
