import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api } from "./api/client";
import { Brand } from "./components/Brand";
import { CommandPalette, ShortcutHelp, type RecentItem } from "./components/CommandPalette";
import { EvidenceFlow } from "./components/Flow";
import { LanguagePicker } from "./components/LanguagePicker";
import { LocaleAnnouncer } from "./components/LocaleAnnouncer";
import { PipelineRail, type RailOutcome } from "./components/PipelineRail";
import { prefetchLocaleAssets } from "./i18n";
import { StatusChip, type SyncView } from "./components/SystemPulse";
import { normaliseEvidenceInput, toDecision, type StoredAssessment } from "./lib/history";
import { EVAL_STEPS, stepDomainStates } from "./lib/pipeline";
import { completeSync, enqueueEvent, readQueue, type QueuedEvent } from "./lib/queue";
import { statusName } from "./types";
import type { AssessmentSummary, AuditRow, DashboardSummary, Decision, DemoStatus, EvidenceInput } from "./types";
import { AssessmentDetail, NewAssessment, emptyForm, type FormState } from "./pages/Assessment";
import { AssessmentsList, AuditTrail } from "./pages/Lists";
import { DevicesPage, OperatorsPage, QualityPage, SettingsPage } from "./pages/Meta";
import { Overview } from "./pages/Overview";

type Nav = "overview" | "new" | "assessments" | "audit" | "devices" | "operators" | "qc" | "settings";

const NAV: { id: Nav; label: string; key: string; ready: boolean }[] = [
  { id: "overview", label: "Overview", key: "overview", ready: true },
  { id: "new", label: "New Assessment", key: "new", ready: true },
  { id: "assessments", label: "Assessments", key: "assessments", ready: true },
  { id: "audit", label: "Audit Trail", key: "audit", ready: true },
  { id: "devices", label: "Devices", key: "devices", ready: true },
  { id: "operators", label: "Operators", key: "operators", ready: true },
  { id: "qc", label: "Quality Controls", key: "qc", ready: true },
  { id: "settings", label: "Settings", key: "settings", ready: true },
];

/** Staged evaluation presentation — pipeline rail + evidence flow during a real request. */
interface RunState {
  idx: number;
  outcomes: Record<string, RailOutcome> | null;
  settling: boolean;
  form: EvidenceInput | null;
}

export default function App() {
  // Subscribes the tree to languageChanged — switching language re-renders instantly,
  // with no page reload and no loss of form state (spec section 8).
  const { t } = useTranslation();
  const [nav, setNav] = useState<Nav>("overview");
  const [collapsed, setCollapsed] = useState(false);
  const [demo, setDemo] = useState<DemoStatus | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [input, setInput] = useState<EvidenceInput>({});
  const [formKey, setFormKey] = useState(0);
  const [prefill, setPrefill] = useState<FormState>(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [assessments, setAssessments] = useState<AssessmentSummary[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState<QueuedEvent[]>(() => readQueue(window.localStorage));
  const [lastSynced, setLastSynced] = useState<string | null>(localStorage.getItem("poctrust-synced"));
  // Presentation-layer state (all driven by real events below).
  const [run, setRun] = useState<RunState | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncedFlash, setSyncedFlash] = useState(false);
  // List filters (spec Sections 18/26): status tiles and operational rows drill into the list.
  const [statusFilter, setStatusFilter] = useState<"all" | "Trust" | "Review" | "Verify">("all");
  const [deviceFilter, setDeviceFilter] = useState<string | null>(null);
  const [operatorFilter, setOperatorFilter] = useState<string | null>(null);
  const runTimers = useRef<number[]>([]);
  const scenarioCache = useRef<Map<string, string>>(new Map());
  const navRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [navInd, setNavInd] = useState({ top: 0, height: 0, visible: false });
  // Latch so rapid clicks cannot start a second submission while one is in flight.
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const [s, a, h] = await Promise.all([api.summary(), api.audit(100), api.assessments(100)]);
      setSummary(s); setAudit(a); setAssessments(h);
      // Demo lifecycle endpoints exist only in Development; elsewhere this 404s and demo stays null.
      setDemo(await api.demoStatus().catch(() => null));
      const now = new Date().toISOString();
      localStorage.setItem("poctrust-synced", now);
      setLastSynced(now);
    } catch { /* backend down — offline UX shows */ }
    finally { setLoadingSummary(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh, decision]);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  async function seedDemo() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true); setError("");
    try {
      const r = await api.demoSeed();
      if (r.distributionMismatches.length > 0) {
        setError("Demonstration seed self-check reported a mismatch — the seed definition, not the engine, needs attention.");
      }
      setDecision(null);
      await refresh();
      setNav("overview");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; setSubmitting(false); }
  }

  async function resetDemo() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true); setError("");
    try {
      await api.demoReset();
      scenarioCache.current.clear();
      setDecision(null);
      await refresh();
      setNav("overview");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; setSubmitting(false); }
  }

  function queueLocally(body: Record<string, unknown>, reason: string) {
    setPending(enqueueEvent(window.localStorage, body));
    setError(reason);
  }

  /** Stable per-event identity used as the backend Idempotency-Key: the first offline attempt and
   *  any later queued retry share it, so a replay can never create a duplicate assessment. */
  function withQueueId(body: Record<string, unknown>): string {
    if (typeof body._queueId !== "string" || !body._queueId) {
      const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `q-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
      body._queueId = id;
      return id;
    }
    return body._queueId;
  }

  const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

  /** Begin the staged pipeline presentation over a real in-flight request (Section 10). */
  function beginRun(form: EvidenceInput) {
    runTimers.current.forEach((t) => window.clearTimeout(t));
    runTimers.current = [];
    setRun({ idx: 0, outcomes: null, settling: false, form });
    EVAL_STEPS.forEach((_, i) => {
      if (i === 0) return;
      runTimers.current.push(
        window.setTimeout(() => setRun((r) => (r && !r.outcomes ? { ...r, idx: i } : r)), i * 150),
      );
    });
  }

  /**
   * The rail never gets ahead of the real request: hold the staged steps until their budget
   * elapses (or the response arrives, whichever is later), paint the authoritative outcomes,
   * settle briefly, then reveal. Total ≈1.05–1.5 s — a demonstration of the pipeline, not a
   * fake long-running computation. On failure the run aborts and never fakes success.
   */
  async function finishRun(outcomes: Record<string, RailOutcome>, apply: () => void, t0: number) {
    const remaining = Math.max(0, EVAL_STEPS.length * 150 - (Date.now() - t0));
    await wait(remaining);
    runTimers.current.forEach((t) => window.clearTimeout(t));
    runTimers.current = [];
    setRun((r) => (r ? { ...r, idx: EVAL_STEPS.length - 1, outcomes } : r));
    await wait(300);
    setRun((r) => (r ? { ...r, settling: true } : r));
    await wait(120);
    setRun(null);
    apply();
  }

  const evaluatedOutcomes = (body: Record<string, unknown>, ruleIds: string[]): Record<string, RailOutcome> =>
    stepDomainStates(body as EvidenceInput, ruleIds);

  const queuedOutcomes = (): Record<string, RailOutcome> =>
    Object.fromEntries(EVAL_STEPS.map((s) => [s.key, s.key === "collect" ? "ok" : "queued"])) as Record<string, RailOutcome>;

  async function submit(body: Record<string, unknown>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true); setError("");
    const t0 = Date.now();
    beginRun(body as EvidenceInput);
    try {
      if (body.connectivity === "offline") {
        // Honest prototype boundary: the offline path still asks the real engine. If the backend is
        // unreachable the event is only *queued* — no reliability evaluation happens locally. The
        // attempt and any later queued retry share one idempotency key (withQueueId).
        const idempotencyKey = withQueueId(body);
        try {
          const d = await api.evaluate(body, idempotencyKey);
          await finishRun(evaluatedOutcomes(body, d.ruleIds), () => { setDecision(d); setInput(body as EvidenceInput); setNav("overview"); }, t0);
          return;
        } catch (e) {
          if (e instanceof ApiError) throw e;   // rejected by the backend: not a connectivity failure
          await finishRun(queuedOutcomes(), () => { queueLocally(body, "Backend unreachable — event queued locally as pending (prototype offline queue)."); }, t0);
          return;
        }
      }
      const d = await api.evaluate(body);
      await finishRun(evaluatedOutcomes(body, d.ruleIds), () => { setDecision(d); setInput(body as EvidenceInput); setNav("overview"); }, t0);
    } catch (e) {
      setRun(null);   // abort the staged rail — a failure never fakes a completed pipeline
      if (e instanceof ApiError) {
        setError(e.message);   // invalid/unservable request — queueing it would only mislead
      } else {
        const message = e instanceof Error ? e.message : String(e);
        await finishRun(queuedOutcomes(), () => { queueLocally(body, `${message} — queued locally.`); }, Date.now());
      }
    } finally { inFlight.current = false; setSubmitting(false); }
  }

  async function syncPending() {
    if (syncing) return;
    setSyncing(true);   // DATA-DRIVEN: the chip reflects this real operation, never a timer
    try {
      const snapshot = readQueue(window.localStorage);
      const syncedIds: string[] = [];
      for (const body of snapshot) {
        // The queue's stable identity doubles as the idempotency key: a retry after a lost
        // response replays the original decision instead of duplicating the assessment.
        const key = typeof body._queueId === "string" ? body._queueId : undefined;
        try { await api.evaluate(body, key); syncedIds.push(body._queueId); }
        catch { break; }   // first failure: unsynced entries stay queued (existing partial-failure behaviour)
      }
      // completeSync re-reads storage, so anything queued while this sync ran is preserved.
      const remaining = completeSync(window.localStorage, syncedIds);
      setPending(remaining);
      await refresh();
      if (syncedIds.length > 0) {
        setSyncedFlash(true);
        window.setTimeout(() => setSyncedFlash(false), 2600);
      }
    } finally { setSyncing(false); }
  }

  async function openAssessment(id: string) {
    try {
      const detail = await api.assessmentDetail(id);
      // Records store camelCase evidence; earlier builds wrote PascalCase, so reads are
      // case-insensitive and a reopened assessment shows the values it was created with.
      setInput(normaliseEvidenceInput(detail.input));
      setDecision(toDecision(detail.assessment as unknown as StoredAssessment, detail.reasons, detail.ruleIds));
      setNav("overview");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  /**
   * Command-palette scenario action: open the curated scenario's REAL stored record (building a
   * key→id index on first use, seeding first when the demonstration set is not loaded). The
   * deterministic backend remains authoritative — this only navigates to its record, so each
   * scenario is replayable without a page reload and never re-fabricates a result.
   */
  async function runScenario(key: string) {
    if (inFlight.current) return;
    try {
      const cached = scenarioCache.current.get(key);
      if (cached) { await openAssessment(cached); return; }
      if (!demo) return;
      if (!demo.seeded.includes(key)) await seedDemo();
      const list = await api.assessments(100);
      const details = await Promise.all(list.map((a) => api.assessmentDetail(a.id).catch(() => null)));
      details.forEach((d, i) => {
        if (!d) return;
        const raw = d.input as Record<string, unknown>;
        const dk = raw.demoKey ?? raw.DemoKey;
        if (typeof dk === "string" && dk) scenarioCache.current.set(dk, list[i].id);
      });
      const id = scenarioCache.current.get(key);
      if (id) await openAssessment(id);
      else setError("That scenario is not loaded yet — load demonstration data first.");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  /**
   * Overview scenario card (spec Section 21): runs ONE demonstration scenario through the real
   * backend endpoint (GET /api/assessments/demo/{kind}) — a genuine evaluation that persists a
   * demo-marked record — then opens the resulting assessment. Never fabricates a result.
   */
  async function runScenarioKind(kind: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true); setError("");
    try {
      await api.demoKind(kind);
      setDecision(null);
      await refresh();
      const list = await api.assessments(1);
      if (list[0]?.id) await openAssessment(list[0].id);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; setSubmitting(false); }
  }

  // Command layer: ⌘/Ctrl+K toggles the palette; "?" opens shortcuts (never while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.key === "?" && !typing) setHelpOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Pause ambient animation while the tab is hidden (Section 31).
  useEffect(() => {
    const on = () => document.body.classList.toggle("pt-paused", document.hidden);
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  // Sliding nav indicator (transform-based, ~200ms).
  useEffect(() => {
    const el = navRefs.current[nav];
    if (!el) { setNavInd((v) => ({ ...v, visible: false })); return; }
    setNavInd({ top: el.offsetTop, height: el.offsetHeight, visible: true });
  }, [nav, collapsed]);

  // Clear staged-pipeline timers on unmount.
  useEffect(() => () => runTimers.current.forEach((t) => window.clearTimeout(t)), []);

  // Offline operation (spec section 10): warm every locale catalog + review metadata once
  // the first paint is done, so switching language never depends on the network.
  useEffect(() => { prefetchLocaleAssets(); }, []);

  const demoActive = (demo?.demoRecords ?? 0) > 0;
  const syncView: SyncView = !online ? "offline" : syncing ? "syncing" : syncedFlash ? "synced" : "online";
  const recent: RecentItem[] = (summary?.recent ?? []).slice(0, 6).map((r) => ({
    id: r.id, result: r.result, deviceId: r.deviceId, status: statusName(r.finalStatus),
  }));

  return (
    <div className="min-h-screen bg-[#F7F9FC] text-[#132238]">
      <LocaleAnnouncer />
      {demoActive && (
        <div aria-hidden="true" className="pt-demo-topline fixed left-0 right-0 top-0 z-40 h-[2px]" />
      )}
      <div className="flex">
        <aside className={`pt-sidebar hidden min-h-screen shrink-0 flex-col text-white transition-all md:flex ${collapsed ? "w-16" : "w-60"}`} aria-label="Primary">
          <div className="flex items-center justify-between p-3">
            <Brand collapsed={collapsed} />
            <button onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} className="rounded p-2 text-slate-300 hover:bg-white/10">☰</button>
          </div>
          <nav className="relative flex flex-col gap-1 p-2">
            <span
              aria-hidden="true"
              className="pt-nav-indicator absolute left-0 w-[3px] rounded-r bg-gradient-to-b from-[#2E7BD6] via-[#1E5AA8] to-[#0F8B8D]"
              style={{ transform: `translateY(${navInd.top}px)`, height: navInd.height, opacity: navInd.visible ? 1 : 0 }}
            />
            {NAV.map((n) => (
              <button
                key={n.id}
                ref={(el) => { navRefs.current[n.id] = el; }}
                onClick={() => setNav(n.id)}
                aria-current={nav === n.id ? "page" : undefined}
                className={`pt-navbtn rounded-md px-3 py-2 text-left text-sm transition-colors ${nav === n.id ? "bg-white font-semibold text-[#0B1F3A]" : "text-slate-200 hover:bg-white/10"}`}
              >
                {collapsed ? t(`ui.nav.${n.key}`)[0] : t(`ui.nav.${n.key}`)}
              </button>
            ))}
          </nav>
          <div className="mt-auto space-y-2 p-3 text-xs text-slate-300">
            {!collapsed && <p>{t("ui.app.tagline")}</p>}
            {/* The ONE compact language control (spec section 8) — sidebar footer, never the
                header; duplicated in Settings. Collapsed view shows the label-less select. */}
            <LanguagePicker compact={collapsed} />
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="pt-glass sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-[#DCE3EC] px-4 py-2.5">
            <div className="md:hidden"><Brand collapsed /></div>
            <nav className="flex flex-wrap gap-1 md:hidden" aria-label="Primary mobile">
              {NAV.slice(0, 4).map((n) => (
                <button key={n.id} onClick={() => setNav(n.id)} className={`rounded border px-2 py-1.5 text-xs ${nav === n.id ? "bg-[#0B1F3A] text-white" : ""}`}>{t(`ui.nav.${n.key}`)}</button>
              ))}
            </nav>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2 text-xs">
              {demoActive && (
                <>
                  {/* Compact persistent environment indicator (spec Section 16): a pill in the
                      header — never a full-width bar; shortens at narrow widths but never hides. */}
                  <span className="mono rounded-full border border-[#0F8B8D]/40 bg-[#EAF7F7] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#0B1F3A] sm:hidden">
                    Demo · synthetic
                  </span>
                  <span className="mono hidden rounded-full border border-[#0F8B8D]/40 bg-[#EAF7F7] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#0B1F3A] sm:inline-block">
                    Demo · synthetic data only
                  </span>
                </>
              )}
              <span aria-hidden="true" className="mono hidden rounded border border-[#DCE3EC] px-2 py-1 text-[10px] text-[#8A97A8] lg:inline-block">Ctrl/⌘ K</span>
              <button onClick={() => setPaletteOpen(true)} aria-label="Open command palette" className="rounded border border-[#DCE3EC] px-2.5 py-1 font-semibold hover:bg-[#F7F9FC]">⌕</button>
              <button onClick={() => setHelpOpen(true)} aria-label="Show keyboard shortcuts" className="rounded border border-[#DCE3EC] px-2.5 py-1 font-semibold hover:bg-[#F7F9FC]">?</button>
              <StatusChip view={syncView} pending={pending.length} lastSynced={lastSynced} />
              {pending.length > 0 && (
                <button onClick={syncPending} disabled={syncing} className="rounded border px-2 py-1 font-semibold disabled:opacity-50">
                  {syncing ? "Syncing…" : "Sync now"}
                </button>
              )}
            </div>
          </header>

          <main className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
            {error && <p role="alert" className="rounded-lg border border-[#C43D3D]/30 bg-[#FDEEEE] px-3 py-2 text-sm text-[#C43D3D]">{error}</p>}
            {nav === "overview" && (
              decision ? (
                <AssessmentDetail
                  decision={decision} input={input}
                  auditRow={audit.find((a) => a.assessmentId === decision.id)}
                  onRepeat={() => { setPrefill({ ...emptyForm(), ...input } as FormState); setFormKey((k) => k + 1); setNav("new"); }}
                  onCheckDevice={() => setNav("devices")}
                  onBack={() => setNav("assessments")}
                />
              ) : (
                <Overview
                  summary={summary} loading={loadingSummary} demo={demo} submitting={submitting}
                  lastSynced={lastSynced} onSeed={seedDemo} onReset={resetDemo} onOpen={openAssessment}
                  onCreate={() => setNav("new")} onViewAll={() => setNav("assessments")}
                  onFilterStatus={(s) => { setStatusFilter(s); setDeviceFilter(null); setOperatorFilter(null); setNav("assessments"); }}
                  onRunScenarioKind={runScenarioKind}
                />
              )
            )}
            {nav === "new" && <NewAssessment key={formKey} initial={prefill} submitting={submitting} error={error} onSubmit={submit} />}
            {nav === "new" && run && (
              <div className="grid gap-4 lg:grid-cols-2" data-testid="evaluation-pipeline">
                <PipelineRail steps={EVAL_STEPS} index={run.idx} outcomes={run.outcomes} settling={run.settling} />
                {run.form && <EvidenceFlow input={run.form} ruleIds={[]} status={null} running={!run.outcomes} />}
              </div>
            )}
            {nav === "assessments" && (
              <AssessmentsList
                items={assessments} onOpen={openAssessment}
                statusFilter={statusFilter} onStatusFilter={setStatusFilter}
                deviceFilter={deviceFilter} onDeviceFilter={setDeviceFilter}
                operatorFilter={operatorFilter} onOperatorFilter={setOperatorFilter}
              />
            )}
            {nav === "audit" && <AuditTrail rows={audit} />}
            {nav === "devices" && <DevicesPage onViewAssessments={(deviceId) => { setDeviceFilter(deviceId); setStatusFilter("all"); setOperatorFilter(null); setNav("assessments"); }} />}
            {nav === "operators" && <OperatorsPage onViewAssessments={(operatorId) => { setOperatorFilter(operatorId); setStatusFilter("all"); setDeviceFilter(null); setNav("assessments"); }} />}
            {nav === "qc" && <QualityPage />}
            {nav === "settings" && <SettingsPage demo={demo} busy={submitting} onSeed={seedDemo} onReset={resetDemo} />}
            {submitting && nav === "overview" && !decision && <div className="skeleton h-48 rounded-xl" aria-label="Loading assessment" />}
          </main>
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            pages={NAV.map((n) => ({ id: n.id, label: String(t(`ui.nav.${n.key}`)) }))}
            onNav={(id) => setNav(id as Nav)}
            demo={demo}
            onSeed={seedDemo}
            onReset={resetDemo}
            onSync={syncPending}
            onRunScenario={runScenario}
            recent={recent}
            onOpen={openAssessment}
          />
          <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
        </div>
      </div>
    </div>
  );
}
