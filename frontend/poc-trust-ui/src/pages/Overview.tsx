import { StatusBadge } from "../components/StatusBadge";
import { formatEventTime } from "../lib/labels";
import type { DashboardSummary } from "../types";

export function Overview({
  summary, loading, demoMode, submitting, onDemo, onOpen,
}: {
  summary: DashboardSummary | null;
  loading: boolean;
  demoMode: boolean;
  submitting: boolean;
  onDemo: (kind: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#DCE3EC] bg-white p-5">
        <h2 className="text-lg font-bold text-[#0B1F3A]">Operational overview</h2>
        <p className="text-sm text-[#607087]">
          Real persisted data{summary ? ` · ${summary.counts.total} assessments` : ""}. {demoMode ? "Demonstration Mode — synthetic data only." : "Synthetic demo data only when Demonstration Mode is used."}
        </p>
        {loading && <div className="mt-3 grid grid-cols-3 gap-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-20 rounded-lg" />)}</div>}
        {summary && !loading && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {([
              ["Trust", summary.counts.trust, "✓"],
              ["Review", summary.counts.review, "!"],
              ["Verify", summary.counts.verify, "■"],
            ] as const).map(([label, n, icon]) => (
              <div key={label} className="rounded-lg border border-[#DCE3EC] p-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{label}</span>
                  <span aria-hidden="true" className="text-[#607087]">{icon}</span>
                </div>
                <div className="text-3xl font-bold" aria-label={`${label} count ${n}`}>{n}</div>
              </div>
            ))}
          </div>
        )}
        {summary && (
          <p className="mt-2 text-xs text-[#607087]">
            Offline assessments: {summary.offlineCount} · AI consulted: {summary.aiConsultedCount} · {summary.source}
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[#DCE3EC] bg-white p-5">
          <h3 className="font-semibold">Recent assessments</h3>
          {!summary || summary.recent.length === 0 ? (
            <p className="text-sm text-[#607087]">No assessments yet. Run a demo scenario to populate real data.</p>
          ) : (
            <ul className="mt-2 divide-y divide-[#DCE3EC]">
              {summary.recent.map((r) => (
                <li key={r.id}>
                  <button onClick={() => onOpen(r.id)} className="flex w-full items-center gap-3 py-2 text-left hover:bg-[#F7F9FC]">
                    <StatusBadge value={r.finalStatus} size="sm" />
                    <span className="flex-1 truncate text-sm">{r.result} · {r.deviceId}</span>
                    <span className="text-xs text-[#607087]">{formatEventTime(r.decidedAtUtc)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-[#0B1F3A] bg-[#0B1F3A] p-5 text-white">
          <h3 className="font-semibold">Demonstration Mode — synthetic data only</h3>
          <p className="text-sm text-slate-300">Evaluator path: Overview → demo TRUST → REVIEW → VERIFY → Audit Trail.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {["trust", "review", "verify", "missing", "offline"].map((k) => (
              <button key={k} onClick={() => onDemo(k)} disabled={submitting} className="pt-action rounded-md bg-white px-3 py-2 text-sm font-semibold capitalize text-[#0B1F3A] hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">
                {k}
              </button>
            ))}
          </div>
          {submitting && <p role="status" className="mt-2 text-xs text-slate-300">Evaluating — one assessment at a time.</p>}
          <p className="mt-3 text-xs text-slate-400">
            Offline is synchronisation metadata in this prototype: the deterministic engine has no
            connectivity rule, so offline alone neither raises nor lowers reliability.
          </p>
        </div>
      </div>

      <p className="text-xs text-[#607087]">
        IMPLEMENTED: dashboard aggregation from SQLite. SIMULATED: demo content. FUTURE: live device feeds.
        No clinical validation or regulatory approval claimed.
      </p>
    </div>
  );
}

export function MetaPage({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#DCE3EC] bg-white p-5">
      <h2 className="text-lg font-bold text-[#0B1F3A]">{title}</h2>
      <p className="text-sm text-[#607087]">{note}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

