import { useMemo } from "react";
import { ActivityFeed } from "../components/ActivityFeed";
import { StatusBadge } from "../components/StatusBadge";
import { SegmentedBar, Sparkline } from "../components/Visuals";
import { SystemPulse, Ticker } from "../components/SystemPulse";
import { formatEventTime } from "../lib/labels";
import type { AssessmentSummary, DashboardSummary, DemoStatus } from "../types";

/** Assessments recorded per day for the last 7 days — computed from real persisted records. */
function trendPoints(rows: AssessmentSummary[]): { day: string; value: number }[] {
  const out: { day: string; value: number; key: string }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    out.push({ key: d.toDateString(), day: `${d.getMonth() + 1}/${d.getDate()}`, value: 0 });
  }
  const byKey = new Map(out.map((o) => [o.key, o]));
  for (const r of rows) {
    const d = new Date(r.decidedAtUtc);
    if (Number.isNaN(d.getTime())) continue;
    const hit = byKey.get(d.toDateString());
    if (hit) hit.value += 1;
  }
  return out.map(({ day, value }) => ({ day, value }));
}

export function Overview({
  summary, loading, demo, submitting, lastSynced, onSeed, onReset, onOpen,
}: {
  summary: DashboardSummary | null;
  loading: boolean;
  demo: DemoStatus | null;
  submitting: boolean;
  lastSynced: string | null;
  onSeed: () => void;
  onReset: () => void;
  onOpen: (id: string) => void;
}) {
  const demoActive = (demo?.demoRecords ?? 0) > 0;
  const trend = useMemo(() => trendPoints(summary?.recent ?? []), [summary]);
  return (
    <div className="space-y-4">
      <div className="pt-card-2 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-[#0B1F3A]">Can this result be relied on?</h2>
            <p className="text-sm text-[#607087]">
              Every assessment below is decided by deterministic rules from recorded evidence — always
              explainable, always auditable. Real persisted data{summary ? ` · ${summary.counts.total} assessments` : ""}.
              {" "}{demoActive ? "Demonstration scenarios are loaded — synthetic, clearly labelled." : "No demonstration data loaded — assessments appear here as they are recorded."}
            </p>
          </div>
          <SystemPulse />
        </div>
        {loading && <div className="mt-3 grid grid-cols-3 gap-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-20 rounded-lg" />)}</div>}
        {summary && !loading && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {([
              ["Trust", summary.counts.trust, "✓", "border-l-[#167A5A]", "May be relied on subject to routine controls."],
              ["Review", summary.counts.review, "!", "border-l-[#B7791F]", "A trained operator should review before reliance."],
              ["Verify", summary.counts.verify, "■", "border-l-[#C43D3D]", "Do not rely alone — repeat or confirm."],
            ] as const).map(([label, n, icon, accent, hint]) => (
              <div key={label} className={`rounded-lg border border-l-4 border-[#DCE3EC] ${accent} p-4`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{label}</span>
                  <span aria-hidden="true" className="text-[#607087]">{icon}</span>
                </div>
                <div className="tabnum text-3xl font-bold" aria-label={`${label} count ${n}`}><Ticker value={n} /></div>
                <p className="mt-1 text-xs text-[#607087]">{hint}</p>
              </div>
            ))}
          </div>
        )}
        {summary && (
          <>
            <div className="mt-4">
              <p className="pt-label mb-1.5 text-[#607087]">Reliability distribution</p>
              <SegmentedBar counts={summary.counts} />
            </div>
            <p className="mt-3 text-xs text-[#607087]">
              Offline assessments: {summary.offlineCount} · AI consulted: {summary.aiConsultedCount} · {summary.source}
            </p>
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[#DCE3EC] bg-white p-5">
          <h3 className="font-semibold">Recent assessments</h3>
          {!summary || summary.recent.length === 0 ? (
            <p className="text-sm text-[#607087]">No assessments yet — load the demonstration data for ten curated scenarios computed by the real pipeline.</p>
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
          <h3 className="font-semibold">Demonstration data — synthetic, clearly labelled</h3>
          <p className="text-sm text-slate-300">
            Ten curated scenarios covering Trust, Review and Verify, each computed by the real assessment
            pipeline. Evaluator path: Overview → open a scenario → evidence and reasoning → Audit Trail.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {demoActive ? (
              <button onClick={onReset} disabled={submitting} className="pt-action rounded-md bg-white px-3 py-2 text-sm font-semibold text-[#0B1F3A] hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">
                Clear demonstration data
              </button>
            ) : (
              <button onClick={onSeed} disabled={submitting || !demo} className="pt-action rounded-md bg-white px-3 py-2 text-sm font-semibold text-[#0B1F3A] hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">
                Load demonstration data
              </button>
            )}
          </div>
          {submitting && <p role="status" className="mt-2 text-xs text-slate-300">Working — one action at a time.</p>}
          <p className="mt-3 text-xs text-slate-400">
            {demo
              ? `${demo.demoRecords} of ${demo.expectedRecords} demonstration scenarios loaded · ${demo.totalRecords} records in total.`
              : "Demonstration controls are available in the development environment only."}
            {" "}Offline is synchronisation metadata in this prototype: the deterministic engine has no
            connectivity rule, so offline alone neither raises nor lowers reliability.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ActivityFeed rows={summary?.recentAudit ?? []} lastSynced={lastSynced} onOpen={onOpen} />
        <div className="pt-card p-5">
          <h3 className="pt-label text-[#0B1F3A]">Activity trend</h3>
          <p className="mt-1 text-xs text-[#607087]">Assessments recorded per day over the last week — drawn from the same persisted records.</p>
          <div className="mt-3">
            <Sparkline points={trend} label="Assessments" />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#DCE3EC] bg-white p-5">
        <h3 className="font-semibold text-[#0B1F3A]">How every decision is made</h3>
        <ol className="mt-3 grid gap-3 md:grid-cols-3">
          {([
            ["1", "Evidence is recorded", "Quality control, calibration, operator competency, reagent, environment and provenance — captured with the result."],
            ["2", "Deterministic rules decide", "The same evidence always produces the same status — Trust, Review or Verify — with the reasons shown alongside."],
            ["3", "An advisory note may follow", "Contextual Analysis can add a plain-language note for review cases. It never changes the decision."],
          ] as const).map(([n, title, body]) => (
            <li key={n} className="rounded-lg border border-[#DCE3EC] p-4">
              <span aria-hidden="true" className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#0B1F3A] text-xs font-bold text-white">{n}</span>
              <p className="mt-2 font-medium text-[#132238]">{title}</p>
              <p className="mt-1 text-xs text-[#607087]">{body}</p>
            </li>
          ))}
        </ol>
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

