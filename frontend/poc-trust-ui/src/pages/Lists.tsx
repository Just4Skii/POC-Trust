import { AuditTimeline } from "../components/AuditTimeline";
import { StatusBadge } from "../components/StatusBadge";
import { formatEventTime } from "../lib/labels";
import type { AssessmentSummary, AuditRow } from "../types";

export function AssessmentsList({
  items, onOpen,
}: {
  items: AssessmentSummary[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-[#DCE3EC] bg-white p-5">
      <h2 className="text-lg font-bold text-[#0B1F3A]">Assessments</h2>
      <p className="text-sm text-[#607087]">Real persisted assessments. Open any row for decision → evidence → provenance.</p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-[#607087]">No records yet — use Demonstration Mode.</p>
      ) : (
        <ul className="mt-2 divide-y divide-[#DCE3EC]">
          {items.map((a) => (
            <li key={a.id}>
              <button onClick={() => onOpen(a.id)} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 py-2.5 text-left hover:bg-[#F7F9FC]">
                <StatusBadge value={a.finalStatus} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{a.result} · {a.testType ?? ""}</span>
                  <span className="block truncate text-xs text-[#607087]">{a.deviceId} · {a.operatorId ?? "operator not recorded"} · {a.connectivity === "offline" ? "offline event" : "online"} · Contextual Analysis {a.aiConsulted ? "consulted" : "not consulted"}</span>
                </span>
                <span className="text-xs text-[#607087]">{formatEventTime(a.decidedAtUtc)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AuditTrail({ rows }: { rows: AuditRow[] }) {
  return (
    <div className="rounded-xl border border-[#DCE3EC] bg-white p-5">
      <h2 className="text-lg font-bold text-[#0B1F3A]">Audit Trail</h2>
      <p className="text-sm text-[#607087]">Evidence → rules → decision → action → audit. Append-only prototype (no cryptographic sealing claimed).</p>
      <div className="mt-4"><AuditTimeline rows={rows} /></div>
    </div>
  );
}
