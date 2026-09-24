import { StatusBadge } from "./StatusBadge";
import { TechnicalDetails } from "./TechnicalDetails";
import { formatEventTime } from "../lib/labels";
import { statusName, type AuditRow } from "../types";

export function AuditTimeline({ rows }: { rows: AuditRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-[#607087]">No audit events yet. Run a demonstration scenario.</p>;
  return (
    <ol className="relative space-y-4 border-l-2 border-[#DCE3EC] pl-5">
      {rows.map((a) => (
        <li key={a.id} className="pt-fade">
          <span aria-hidden="true" className="absolute -left-[7px] mt-1 h-3 w-3 rounded-full bg-[#1E5AA8]" />
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge value={a.finalStatus} size="sm" />
            <span className="text-xs text-[#607087]">{formatEventTime(a.timestampUtc)}</span>
            <span className="text-xs text-[#607087]">
              Contextual Analysis {a.aiConsulted ? "consulted" : "not consulted"}
            </span>
          </div>
          <p className="mt-1 text-sm text-[#132238]">{a.action}</p>
          {a.aiSummary && <p className="text-xs text-[#607087]">Advisory note: {a.aiSummary.slice(0, 180)}</p>}
          <TechnicalDetails title="Provenance detail">
            <p>Assessment {a.assessmentId} · audit entry {a.id}</p>
            <p>Initial {statusName(a.initialStatus)} → final {statusName(a.finalStatus)} · recorded {a.timestampUtc}</p>
          </TechnicalDetails>
        </li>
      ))}
    </ol>
  );
}
