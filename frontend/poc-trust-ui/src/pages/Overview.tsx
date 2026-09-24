import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { ActivityFeed } from "../components/ActivityFeed";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";
import { SegmentedBar, Sparkline } from "../components/Visuals";
import { SystemPulse, Ticker } from "../components/SystemPulse";
import { deviceLabel, formatEventTime } from "../lib/labels";
import { parseDemonstration } from "../lib/rir";
import type { AssessmentSummary, DashboardSummary, DemonstrationSequence, DemoStatus, IntegrityOverview } from "../types";

/** Assessments recorded per day for the last 7 days — computed from real persisted records. */
function trendPoints(rows: AssessmentSummary[]): { day: string; value: number }[] {
  const out: { day: string; value: number; key: string }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    out.push({ key: d.toDateString(), day: `${d.getMonth() + 1}/${d.getDate()}`, value: 0 });
  }
  const byKey = new Map(out.map((o) => [o.key, o] as const));
  for (const r of rows) {
    const d = new Date(r.decidedAtUtc);
    if (Number.isNaN(d.getTime())) continue;
    const hit = byKey.get(d.toDateString());
    if (hit) hit.value += 1;
  }
  return out.map(({ day, value }) => ({ day, value }));
}

/** One-line product narrative strip (spec Section 17 / 34) — quiet, not decorative. */
function StoryStrip() {
  const beats = ["Evidence", "Decision", "Explanation", "Action", "Audit"];
  return (
    <p className="pt-label mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[#8A97A8]" aria-label="How POC Trust works: evidence, decision, explanation, action, audit">
      {beats.map((b, i) => (
        <span key={b} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden="true" className="text-[#C9D4E3]">→</span>}
          <span className="rounded bg-white px-1.5 py-0.5 text-[#607087]">{b}</span>
        </span>
      ))}
    </p>
  );
}

/**
 * Integrity Overview (spec section 26) — four aggregate metrics over the seeded records, each
 * calculated by the backend from the STORED records at request time. Nothing here is preset:
 * when the store is empty the card says so, and under demonstration mode the environment is
 * labelled explicitly. An operational-integrity reading, never a clinical one.
 */
function IntegrityOverviewCard({ integrity, demoActive }: { integrity: IntegrityOverview | null | undefined; demoActive: boolean }) {
  if (!integrity || integrity.assessments === 0) return null;
  const concernTone = integrity.assessmentsWithConcerns > 0 ? "warn" : undefined;
  const conflictTone = integrity.conflicts > 0 ? "warn" : undefined;
  const agingTone = integrity.assessmentsWithAging > 0 ? "warn" : undefined;
  return (
    <div className="rounded-xl border border-[#DCE3EC] bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-[#0B1F3A]">Integrity overview</h3>
          <p className="mt-0.5 text-xs text-[#607087]">Evidence coverage, concerns, conflicts and aging across the stored assessments.</p>
        </div>
        <span className="mono rounded-full border border-[#0F8B8D]/40 bg-[#EAF7F7] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#0B1F3A]">
          {demoActive ? "Demonstration mode — synthetic data only" : "From stored records"}
        </span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile label="Evidence coverage" value={integrity.coverageStatement} note={`${integrity.assessments} assessments`} />
        <MetricTile
          label="Evidence concerns"
          value={`${integrity.assessmentsWithConcerns} assessment${integrity.assessmentsWithConcerns === 1 ? "" : "s"}`}
          note="with evidence concerns"
          tone={concernTone}
        />
        <MetricTile
          label="Conflicts"
          value={integrity.conflicts === 0 ? "None" : `${integrity.conflicts} detected`}
          note="detected evidence inconsistencies"
          tone={conflictTone}
        />
        <MetricTile
          label="Aging evidence"
          value={`${integrity.assessmentsWithAging} assessment${integrity.assessmentsWithAging === 1 ? "" : "s"}`}
          note="with aging evidence"
          tone={agingTone}
        />
      </div>
      <p className="mt-3 text-xs text-[#607087]">{integrity.note}</p>
    </div>
  );
}

function MetricTile({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "warn" }) {
  return (
    <div className={`rounded-lg border p-3 ${tone === "warn" ? "border-[#B7791F]/40 bg-[#FFF7E6]/60" : "border-[#DCE3EC] bg-white"}`}>
      <p className="pt-label text-[#8A97A8]">{label}</p>
      <p className="mt-1 text-lg font-bold text-[#132238]">{value}</p>
      <p className="mt-0.5 text-xs text-[#607087]">{note}</p>
    </div>
  );
}

/**
 * Demonstration moment (spec section 30): the stored demonstration decision sequence — one
 * result TRUST → REVIEW → VERIFY as its evidence quality changes — with the “why did it
 * change” lines derived from the recorded findings. Fully deterministic: the advisory AI has
 * no part in it. This is the core proof of the integrity engine.
 */
function DemonstrationMoment({
  demo, onSeed, onOpen,
}: {
  demo: DemoStatus | null;
  onSeed: () => void;
  onOpen: (id: string) => void;
}) {
  const [seq, setSeq] = useState<DemonstrationSequence | null>(null);
  const [failed, setFailed] = useState(false);
  const records = demo?.demoRecords ?? 0;

  useEffect(() => {
    let alive = true;
    setFailed(false);
    api
      .demonstration()
      .then((raw) => { if (alive) setSeq(parseDemonstration(raw)); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [records]);

  if (failed) return null; // the card is a demonstration aid — never an error surface

  const steps = seq?.steps ?? [];
  const last = steps.length > 0 ? steps[steps.length - 1] : null;
  const statusValue = (d: string) =>
    d === "TRUST" ? "Trust" : d === "REVIEW" ? "Review" : d === "VERIFY" ? "Verify" : null;
  const changes = steps.slice(1).map((s) => s.change).filter((c): c is string => !!c);

  return (
    <div className="rounded-xl border border-[#DCE3EC] bg-white p-5">
      <h3 className="font-semibold text-[#0B1F3A]">Demonstration moment</h3>
      <p className="mt-0.5 text-xs text-[#607087]">
        {seq?.label ?? "Watch one result become trustworthy, then watch its integrity context change."}
      </p>

      {!seq && <div className="mt-3 skeleton h-24 rounded-lg" aria-hidden="true" />}

      {seq && !seq.available && (
        <div className="mt-3">
          <EmptyState
            title="The demonstration sequence is not loaded"
            note="Load the demonstration dataset to record the three-step sequence through the real deterministic pipeline."
            primaryLabel={demo ? "Run demonstration" : undefined}
            onPrimary={demo ? onSeed : undefined}
          />
        </div>
      )}

      {seq && seq.available && (
        <div className="mt-3">
          <ol className="space-y-1.5" aria-label="Demonstration decision sequence">
            {steps.map((s, i) => {
              const sv = statusValue(s.disposition);
              return (
                <li key={s.assessmentId} className="flex flex-wrap items-center gap-2">
                  {sv ? <StatusBadge value={sv} size="sm" /> : <span className="mono text-xs font-semibold">{s.disposition}</span>}
                  <span className="text-sm text-[#132238]">{s.result}</span>
                  <span className="mono text-[11px] text-[#8A97A8]">{s.policy}</span>
                  {i < steps.length - 1 && <span aria-hidden="true" className="text-[#C9D4E3]">↓</span>}
                </li>
              );
            })}
          </ol>

          {changes.length > 0 && (
            <div className="mt-3 rounded-lg border border-[#DCE3EC] bg-[#F7F9FC] p-3">
              <p className="pt-label text-[#0B1F3A]">Why did it change?</p>
              <ul className="mt-1 space-y-1 text-xs text-[#607087]">
                {changes.map((c, i) => <li key={i}>· {c}</li>)}
              </ul>
            </div>
          )}

          <p className="mt-2 text-xs text-[#607087]">
            {seq.aiInvolved
              ? "Advisory context was recorded for some steps — dispositions still come from the deterministic engine only."
              : "No advisory involvement — every change comes from the deterministic rules alone."}
          </p>
          {last && (
            <button
              onClick={() => onOpen(last.assessmentId)}
              className="pt-action mt-3 min-h-[40px] rounded-md bg-[#0B1F3A] px-4 py-2 text-sm font-semibold text-white hover:bg-[#13294a]"
            >
              Open the latest record
            </button>
          )}
          <p className="mono mt-2 text-[10px] text-[#8A97A8]">{seq.note}</p>
        </div>
      )}
    </div>
  );
}

export function Overview({
  summary, loading, demo, submitting, lastSynced, onSeed, onReset, onOpen, onCreate, onViewAll, onFilterStatus, onRunScenarioKind,
}: {
  summary: DashboardSummary | null;
  loading: boolean;
  demo: DemoStatus | null;
  submitting: boolean;
  lastSynced: string | null;
  onSeed: () => void;
  onReset: () => void;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onViewAll: () => void;
  onFilterStatus: (status: "Trust" | "Review" | "Verify") => void;
  onRunScenarioKind: (kind: string) => void;
}) {
  const demoActive = (demo?.demoRecords ?? 0) > 0;
  const trend = useMemo(() => trendPoints(summary?.recent ?? []), [summary]);
  const [runningKind, setRunningKind] = useState<string | null>(null);

  /** Demonstration scenario cards (spec Section 21, updated by the integrity upgrade / section 29):
   *  each runs the REAL backend flow (GET /api/assessments/demo/{kind}); the body describes what
   *  the opened record's Result Integrity Record will show — the record itself is the proof. */
  const scenarioCards = [
    { kind: "trust", tone: "border-l-[#167A5A]", icon: "✓", title: "Clean evidence", body: "All evidence valid — the record shows complete coverage, no conflicts and all key evidence current.", primary: true },
    { kind: "review", tone: "border-l-[#B7791F]", icon: "!", title: "Context requires review", body: "Aging and contextual concerns — the record keeps complete coverage, names the concerns and offers advisory context.", primary: true },
    { kind: "verify", tone: "border-l-[#C43D3D]", icon: "■", title: "Verification required", body: "A critical domain fails — the record shows the failed critical evidence with the primary driver identified.", primary: true },
    { kind: "missing", tone: "border-l-[#8A97A8]", icon: "◇", title: "Provenance incomplete", body: "Records absent at capture — coverage is incomplete and the engine derives the disposition from what exists.", primary: false },
    { kind: "offline", tone: "border-l-[#1E5AA8]", icon: "◈", title: "Synchronization scenario", body: "Offline capture only — connectivity stays synchronisation metadata; nothing local is invented.", primary: false },
  ] as const;

  function runCard(kind: string) {
    if (runningKind || submitting) return;
    setRunningKind(kind);
    onRunScenarioKind(kind);
    // The parent clears the latched state when navigation completes or fails.
    window.setTimeout(() => setRunningKind((k) => (k === kind ? null : k)), 6000);
  }

  return (
    <div className="space-y-4">
      <div className="pt-card-2 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-[#0B1F3A]">Can this result be relied on?</h2>
            <p className="text-sm text-[#607087]">
              Every assessment below is decided by deterministic rules from recorded evidence — always
              explainable, always auditable. Each one becomes a Result Integrity Record: the evidence
              behind the result, why the disposition occurred, and the action that follows. Real
              persisted data{summary ? ` · ${summary.counts.total} assessments` : ""}.
              {" "}{demoActive ? "Demonstration scenarios are loaded — synthetic, clearly labelled." : "No demonstration data loaded — assessments appear here as they are recorded."}
            </p>
            <StoryStrip />
          </div>
          <SystemPulse />
        </div>
        {loading && <div className="mt-3 grid grid-cols-3 gap-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-20 rounded-lg" />)}</div>}
        {summary && !loading && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {([
              ["Trust", summary.counts.trust, "✓", "border-l-[#167A5A]", "Evidence passed configured checks.", "text-[#167A5A]"],
              ["Review", summary.counts.review, "!", "border-l-[#B7791F]", "Additional review recommended.", "text-[#8A6116]"],
              ["Verify", summary.counts.verify, "■", "border-l-[#C43D3D]", "Verification required before reliance.", "text-[#C43D3D]"],
            ] as const).map(([label, n, icon, accent, hint]) => (
              <button
                key={label}
                onClick={() => onFilterStatus(label)}
                aria-label={`${label}: ${n} assessments. Show the ${label} list.`}
                className={`rounded-lg border border-l-4 border-[#DCE3EC] ${accent} cursor-pointer p-4 text-left transition-colors hover:bg-[#F7F9FC] focus-visible:outline-2 focus-visible:outline-[#1E5AA8]`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{label}</span>
                  <span aria-hidden="true" className="text-[#607087]">{icon}</span>
                </div>
                <div className="tabnum text-3xl font-bold" aria-hidden="true"><Ticker value={n} /></div>
                <p className="mt-1 text-xs text-[#607087]">{hint}</p>
              </button>
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
        <IntegrityOverviewCard integrity={summary?.integrity} demoActive={demoActive} />
        <DemonstrationMoment demo={demo} onSeed={onSeed} onOpen={onOpen} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[#DCE3EC] bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Recent assessments</h3>
            {summary && summary.recent.length > 0 && (
              <button onClick={onViewAll} className="rounded px-2 py-1 text-xs font-semibold text-[#1E5AA8] underline hover:bg-[#F7F9FC]">
                View all assessments
              </button>
            )}
          </div>
          {!summary || summary.recent.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                title="No diagnostic assessments yet"
                note="Run a demonstration scenario to see the reliability engine in action."
                primaryLabel={demo ? "Run demonstration" : undefined}
                onPrimary={demo ? onSeed : undefined}
                secondaryLabel="Create assessment"
                onSecondary={onCreate}
              />
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-[#DCE3EC]">
              {summary.recent.map((r) => (
                <li key={r.id}>
                  <button onClick={() => onOpen(r.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-left transition-colors hover:bg-[#F7F9FC]">
                    <StatusBadge value={r.finalStatus} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.result} · {deviceLabel(r.deviceId)}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[#607087]">
                        <span>{formatEventTime(r.decidedAtUtc)}</span>
                        {r.connectivity === "offline" && <span className="rounded bg-[#EAF2FB] px-1.5 py-0.5 text-[10px] font-semibold text-[#1E5AA8]">Offline event</span>}
                        {r.aiConsulted && <span className="rounded bg-[#EAF7F7] px-1.5 py-0.5 text-[10px] font-semibold text-[#0F8B8D]">Contextual Analysis</span>}
                        <span className="rounded bg-[#F0F3F8] px-1.5 py-0.5 text-[10px] font-semibold text-[#607087]">Audit available</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-[#DCE3EC] bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-[#0B1F3A]">Demonstration scenarios</h3>
            {demo && demoActive && (
              <button onClick={onReset} disabled={submitting || runningKind !== null} className="rounded px-2 py-1 text-xs font-semibold text-[#C43D3D] underline hover:bg-[#FDEEEE] disabled:opacity-50">
                Clear demonstration data
              </button>
            )}
            {demo && !demoActive && (
              <button onClick={onSeed} disabled={submitting || runningKind !== null} className="rounded px-2 py-1 text-xs font-semibold text-[#1E5AA8] underline hover:bg-[#F7F9FC] disabled:opacity-50">
                Load the full set of ten
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-[#607087]">
            Each card runs a real evaluation through the backend pipeline — never a mocked result.
            {demo ? ` ${demo.demoRecords} of ${demo.expectedRecords} curated scenarios loaded.` : " Demonstration controls are available in the development environment only."}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {scenarioCards.map((c) => (
              <button
                key={c.kind}
                onClick={() => runCard(c.kind)}
                disabled={runningKind !== null || submitting || !demo}
                aria-label={`Run the ${c.title} demonstration scenario`}
                className={`rounded-lg border border-[#DCE3EC] border-l-4 ${c.tone} bg-white p-3 text-left transition-colors hover:bg-[#F7F9FC] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-[#1E5AA8] ${c.primary ? "sm:col-span-1" : "sm:col-span-1"}`}
              >
                <span className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-[#132238]">{c.title}</span>
                  <span aria-hidden="true" className="text-[#607087]">{runningKind === c.kind ? "…" : c.icon}</span>
                </span>
                <span className="mt-0.5 block text-xs text-[#607087]">{runningKind === c.kind ? "Running through the real pipeline…" : c.body}</span>
              </button>
            ))}
          </div>
          {!demo && (
            <p className="mt-2 text-xs text-[#607087]">
              Scenario running is enabled in the development environment. Records it creates are demo-marked and removed by reset.
            </p>
          )}
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
