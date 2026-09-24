import { AuditTimeline } from "../components/AuditTimeline";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";
import { deviceLabel, formatEventTime } from "../lib/labels";
import { driverPhrase, parseRowIntegrity } from "../lib/rir";
import { statusName } from "../types";
import type { AssessmentSummary, AuditRow } from "../types";

export type StatusFilter = "all" | "Trust" | "Review" | "Verify";

/** Status chips (spec Sections 18/19): clicking an Overview tile lands here pre-filtered. */
function StatusChips({
  items, value, onChange,
}: {
  items: AssessmentSummary[];
  value: StatusFilter;
  onChange: (next: StatusFilter) => void;
}) {
  const count = (s: StatusFilter) =>
    s === "all" ? items.length : items.filter((a) => statusName(a.finalStatus) === s).length;
  const chips: StatusFilter[] = ["all", "Trust", "Review", "Verify"];
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter assessments by reliability state">
      {chips.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          aria-pressed={value === c}
          className={`min-h-[36px] rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-[#1E5AA8] ${
            value === c ? "border-[#0B1F3A] bg-[#0B1F3A] text-white" : "border-[#DCE3EC] bg-white text-[#607087] hover:bg-[#F7F9FC]"
          }`}
        >
          {c === "all" ? "All" : c} <span className="tabnum opacity-70">{count(c)}</span>
        </button>
      ))}
    </div>
  );
}

export function AssessmentsList({
  items, onOpen, statusFilter, onStatusFilter, deviceFilter, onDeviceFilter, operatorFilter, onOperatorFilter,
}: {
  items: AssessmentSummary[];
  onOpen: (id: string) => void;
  statusFilter: StatusFilter;
  onStatusFilter: (next: StatusFilter) => void;
  deviceFilter: string | null;
  onDeviceFilter: (next: string | null) => void;
  operatorFilter: string | null;
  onOperatorFilter: (next: string | null) => void;
}) {
  const filtered = items.filter((a) =>
    (statusFilter === "all" || statusName(a.finalStatus) === statusFilter)
    && (!deviceFilter || a.deviceId === deviceFilter)
    && (!operatorFilter || a.operatorId === operatorFilter));
  const filteredByDrilldown = !!deviceFilter || !!operatorFilter;
  return (
    <div className="rounded-xl border border-[#DCE3EC] bg-white p-5">
      <h2 className="text-lg font-bold text-[#0B1F3A]">Assessments</h2>
      <p className="text-sm text-[#607087]">Real persisted assessments. Open any row for decision → evidence → provenance.</p>
      <div className="mt-3 space-y-2">
        <StatusChips items={items} value={statusFilter} onChange={onStatusFilter} />
        {deviceFilter && (
          <button onClick={() => onDeviceFilter(null)} className="rounded-full border border-[#1E5AA8]/40 bg-[#EAF2FB] px-3 py-1 text-xs font-semibold text-[#1E5AA8]">
            Device: {deviceLabel(deviceFilter)} · clear
          </button>
        )}
        {operatorFilter && (
          <button onClick={() => onOperatorFilter(null)} className="rounded-full border border-[#1E5AA8]/40 bg-[#EAF2FB] px-3 py-1 text-xs font-semibold text-[#1E5AA8]">
            Operator: {operatorFilter} · clear
          </button>
        )}
      </div>
      {filtered.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title={items.length === 0 ? "No diagnostic assessments yet" : "No assessments match this filter"}
            note={items.length === 0
              ? "Run a demonstration scenario to see the reliability engine in action."
              : "Clear the filters to see every persisted assessment."}
          />
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-[#DCE3EC] pt-stagger">
          {filtered.map((a, i) => {
            // Compact integrity fields come from the same backend projector as the full record
            // (spec section 27): each row is understandable before opening it. Missing fields
            // (older payload, unprojectable record) simply render a plainer row — never invented ones.
            const integ = parseRowIntegrity(a.integrity ?? null);
            const driver = integ
              ? (integ.primaryDriverLabel && integ.primaryDriverState
                  ? driverPhrase(integ)
                  : integ.concerns > 0 && integ.primaryDriverStatement
                    ? integ.primaryDriverStatement
                    : null)
              : null;
            return (
            <li key={a.id} style={{ ["--d" as string]: `${Math.min(i, 8) * 45}ms` }}>
              <button onClick={() => onOpen(a.id)} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 py-2.5 text-left transition-colors hover:bg-[#F7F9FC]">
                <StatusBadge value={a.finalStatus} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{a.result} · {a.testType ?? "Assessment"}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#607087]">
                    <span>{deviceLabel(a.deviceId)} · {a.operatorId ?? "Operator not recorded"}</span>
                    {integ && integ.coverageRequired > 0 && (
                      <span className="mono text-[11px]">
                        Evidence: {integ.coverageAvailable}/{integ.coverageRequired}
                        {integ.conflictCount > 0 ? ` · ${integ.conflictCount} conflict${integ.conflictCount === 1 ? "" : "s"}` : ""}
                      </span>
                    )}
                    {driver && <span className="min-w-0 truncate">Primary driver: {driver}</span>}
                    {integ && integ.policy && <span>Policy: {integ.policy}</span>}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                    {a.connectivity === "offline" && <span className="rounded bg-[#EAF2FB] px-1.5 py-0.5 text-[10px] font-semibold text-[#1E5AA8]">Offline event</span>}
                    {a.aiConsulted
                      ? <span className="rounded bg-[#EAF7F7] px-1.5 py-0.5 text-[10px] font-semibold text-[#0F8B8D]">AI: Contextual Analysis</span>
                      : <span className="rounded bg-[#F0F3F8] px-1.5 py-0.5 text-[10px] font-semibold text-[#607087]">AI: Not consulted</span>}
                    <span className="rounded bg-[#F0F3F8] px-1.5 py-0.5 text-[10px] font-semibold text-[#607087]">
                      {integ?.auditAvailable ? "Audit: Available" : "Audit: Pending"}
                    </span>
                  </span>
                </span>
                <span className="mono text-xs text-[#607087]">{formatEventTime(a.decidedAtUtc)}</span>
              </button>
            </li>
            );
          })}
        </ul>
      )}
      {filteredByDrilldown && filtered.length > 0 && (
        <p className="mt-2 text-xs text-[#607087]">Showing drill-down results from the operational pages — clear a chip to widen the view.</p>
      )}
    </div>
  );
}

export function AuditTrail({ rows }: { rows: AuditRow[] }) {
  return (
    <div className="rounded-xl border border-[#DCE3EC] bg-white p-5">
      <h2 className="text-lg font-bold text-[#0B1F3A]">Audit Trail</h2>
      <p className="text-sm text-[#607087]">
        Evidence → rules → decision → action → audit. Append-only, and every entry is sealed into a
        SHA-256 hash chain — the verify endpoint proves the trail has not been altered.
      </p>
      <div className="mt-4">
        {rows.length === 0 ? (
          <EmptyState
            title="No audit events yet"
            note="Every assessment writes an append-only audit trail — run a demonstration scenario to see one."
          />
        ) : (
          <AuditTimeline rows={rows} />
        )}
      </div>
    </div>
  );
}
