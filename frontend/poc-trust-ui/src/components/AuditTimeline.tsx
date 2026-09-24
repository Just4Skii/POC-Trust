import { StatusBadge } from "./StatusBadge";
import { TechnicalDetails } from "./TechnicalDetails";
import { formatEventTime } from "../lib/labels";
import { statusName, type AuditRow, type StatusCode } from "../types";
import type { RirLoad } from "./IntegrityRecord";

/**
 * Audit Trail (Section 14) — the lifecycle of an assessment made traceable. A hairline spine
 * draws top → bottom once per open; nodes light as it reaches them; event text fades in with a
 * short stagger. Sequence numbers sit in muted mono; timestamps are mono with tabular numerals.
 * "Contextual Analysis" is always visually secondary to the deterministic decision, and any
 * displayed identifier is a real stored value labelled "Record ID" — no invented hashes.
 */

const nodeColor = (s: StatusCode) => {
  const n = statusName(s);
  return n === "Trust" ? "#167A5A" : n === "Review" ? "#B7791F" : "#C43D3D";
};

/** Flat audit list for the Audit Trail page — one entry per recorded decision. */
export function AuditTimeline({ rows }: { rows: AuditRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-[#607087]">No audit events yet. Run a demonstration scenario.</p>;
  }
  return (
    <ol className="relative" aria-label="Audit events">
      <span aria-hidden="true" className="pt-draw-v absolute bottom-2 left-[7px] top-2 w-[2px] bg-[#E3E8EF]" />
      {rows.map((a, i) => (
        <li
          key={a.id}
          className="relative grid grid-cols-[16px_1fr] gap-x-3 pb-5 pt-stagger last:pb-0"
          style={{ ["--d" as string]: `${i * 50}ms` }}
        >
          <span
            aria-hidden="true"
            className="relative z-10 mt-1.5 h-3.5 w-3.5 rounded-full border-2 border-white shadow-sm ring-1 ring-[#E3E8EF]"
            style={{ background: nodeColor(a.finalStatus) }}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className="mono text-[11px] text-[#8A97A8]">{String(i + 1).padStart(2, "0")}</span>
              <StatusBadge value={a.finalStatus} size="sm" />
              <span className="mono text-xs text-[#607087]">{formatEventTime(a.timestampUtc)}</span>
              <span className="mono text-[11px] text-[#8A97A8]">Record ID {a.assessmentId}</span>
            </div>
            <p className="mt-1 text-sm text-[#132238]">{a.action}</p>
            <p className="mono mt-0.5 text-[11px] text-[#607087]">
              {statusName(a.initialStatus)} → {statusName(a.finalStatus)}
            </p>
            {a.aiConsulted && (
              <p className="mt-1.5 border-l border-dashed border-[#C7D0DC] pl-2.5 text-xs text-[#607087]">
                Contextual Analysis consulted — advisory context only; the decision above remains authoritative.
                {a.aiSummary ? ` ${a.aiSummary.slice(0, 140)}` : ""}
              </p>
            )}
            <TechnicalDetails title="Provenance detail">
              <p>Assessment {a.assessmentId} · audit entry {a.id}</p>
              <p>Initial {statusName(a.initialStatus)} → final {statusName(a.finalStatus)} · recorded {a.timestampUtc}</p>
            </TechnicalDetails>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Per-assessment lifecycle reveal for the decision page — the audit trail as one connected
 * pipeline (spec section 28): Evidence received → Evidence quality evaluated → Rules evaluated
 * → Decision drivers identified → Disposition recorded → Contextual Analysis consulted (only
 * when it actually was) → Audit saved. Every stage is bound to real stored data: the audit row
 * plus, when loaded, the derived Result Integrity Record. The advisory stage is visually
 * secondary — it must never read as if the AI created the decision.
 */
export function AuditLifecycle({
  row, status, action, rir,
}: {
  row: AuditRow | undefined;
  status: StatusCode;
  action: string;
  /** The derived integrity record (or its loading state) — enriches the quality, driver and
   *  audit-saved stages when available; every stage still renders honestly without it. */
  rir?: RirLoad;
}) {
  if (!row) return null;
  const anchorColor = nodeColor(status);
  const record = rir?.kind === "ready" ? rir.record : null;
  const primaryDriver = record?.causality?.verified && record.causality.primaryDrivers.length > 0
    ? record.causality.primaryDrivers[0]
    : null;
  const events: { label: string; sub?: string; anchor?: boolean; secondary?: boolean }[] = [
    { label: "Evidence received", sub: "Device, quality, operator, environment and provenance captured with the result." },
    {
      label: "Evidence quality evaluated",
      sub: record
        ? `${record.evidenceQuality.coverage.statement} · ${record.evidenceQuality.freshness}.`
        : "Classified under the configured demonstration policy — see the Result Integrity Record.",
    },
    { label: "Rules evaluated", sub: `${statusName(row.initialStatus)} initial assessment → ${statusName(status)} final state.` },
    {
      label: "Decision drivers identified",
      sub: primaryDriver
        ? `${primaryDriver.statement}${record && record.causality!.secondaryConsiderations.length > 0 ? ` Plus ${record.causality!.secondaryConsiderations.length} secondary consideration${record.causality!.secondaryConsiderations.length === 1 ? "" : "s"}.` : ""}`
        : "Driver roles derive from the recorded findings — see the Result Integrity Record.",
    },
    { label: "Disposition recorded", sub: action, anchor: true },
    row.aiConsulted
      ? { label: "Contextual Analysis consulted", sub: "Advisory context only — it does not change the deterministic decision.", secondary: true }
      : { label: "Advisory context not consulted", sub: "The deterministic decision stands on its own — no advisory note was recorded for this assessment.", secondary: true },
    {
      label: "Audit saved",
      sub: record
        ? `${record.audit.status.toLowerCase()} — ${record.audit.sealedEntries} of ${record.audit.entries} entr${record.audit.entries === 1 ? "y" : "ies"} sealed into the hash chain.`
        : "Append-only entry, sealed into the tamper-evident hash chain.",
    },
  ];

  return (
    <section aria-label="Assessment audit lifecycle" className="pt-card p-4">
      <h3 className="pt-label text-[#0B1F3A]">Audit trail</h3>
      <p className="mt-1 text-xs text-[#607087]">The recorded lifecycle of this decision — append-only, traceable, real stored data.</p>
      <ol className="relative mt-3" aria-label="Lifecycle of this assessment">
        <span aria-hidden="true" className="pt-draw-v absolute bottom-2 left-[7px] top-2 w-[2px] bg-[#E3E8EF]" />
        {events.map((e, i) => (
          <li
            key={e.label}
            className={`relative grid grid-cols-[16px_1fr] gap-x-3 pb-4 pt-stagger last:pb-0 ${e.secondary ? "opacity-90" : ""}`}
            style={{ ["--d" as string]: `${i * 55}ms` }}
          >
            <span aria-hidden="true" className="relative z-10 mt-1.5">
              {e.anchor ? (
                <span className="block h-4 w-4 rounded-full border-2 border-white shadow-sm" style={{ background: anchorColor }} />
              ) : e.secondary ? (
                <span className="block h-3 w-3 rounded-full border border-dashed border-[#A9B4C4] bg-white" />
              ) : (
                <span className="block h-3 w-3 rounded-full bg-[#1E5AA8] ring-2 ring-[#1E5AA8]/25" />
              )}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="mono text-[11px] text-[#8A97A8]">{String(i + 1).padStart(2, "0")}</span>
                <span className={`text-sm ${e.anchor ? "font-semibold text-[#132238]" : e.secondary ? "text-[#607087]" : "font-medium text-[#132238]"}`}>
                  {e.label}
                </span>
                {e.anchor && <StatusBadge value={status} size="sm" />}
              </div>
              {e.sub && <p className={`mt-0.5 text-xs ${e.secondary ? "text-[#607087]" : "text-[#5B6B80]"}`}>{e.sub}</p>}
              {e.anchor && (
                <p className="mono mt-1 text-[11px] text-[#607087]">
                  Record ID {row.assessmentId} · recorded {formatEventTime(row.timestampUtc)}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="mono mt-2 text-[10px] text-[#8A97A8]">
        every step above comes from the same append-only audit entry — {formatEventTime(row.timestampUtc)}
      </p>
    </section>
  );
}
