import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "./api/client";
import { Brand } from "./components/Brand";
import { normaliseEvidenceInput, toDecision, type StoredAssessment } from "./lib/history";
import { completeSync, enqueueEvent, readQueue, type QueuedEvent } from "./lib/queue";
import type { AssessmentSummary, AuditRow, DashboardSummary, Decision, EvidenceInput } from "./types";
import { AssessmentDetail, NewAssessment, emptyForm, type FormState } from "./pages/Assessment";
import { AssessmentsList, AuditTrail } from "./pages/Lists";
import { DevicesPage, OperatorsPage, QualityPage, SettingsPage } from "./pages/Meta";
import { Overview } from "./pages/Overview";

type Nav = "overview" | "new" | "assessments" | "audit" | "devices" | "operators" | "qc" | "settings";

const NAV: { id: Nav; label: string; ready: boolean }[] = [
  { id: "overview", label: "Overview", ready: true },
  { id: "new", label: "New Assessment", ready: true },
  { id: "assessments", label: "Assessments", ready: true },
  { id: "audit", label: "Audit Trail", ready: true },
  { id: "devices", label: "Devices", ready: true },
  { id: "operators", label: "Operators", ready: true },
  { id: "qc", label: "Quality Controls", ready: true },
  { id: "settings", label: "Settings", ready: true },
];

function demoInput(kind: string): EvidenceInput {
  const now = new Date();
  const iso = (d: Date) => d.toISOString();
  const addDays = (n: number) => new Date(now.getTime() + n * 864e5);
  switch (kind) {
    case "trust":
      return { result: "Hb 14.2 g/dL", testType: "Hb", deviceId: "DEV-01", qcPassed: true, calibrationDueUtc: iso(addDays(60)), operatorId: "OP-07", operatorCompetent: true, reagentLot: "LOT-GOOD", reagentExpiryUtc: iso(addDays(90)), temperatureC: 22.5, humidityPct: 45, powerInterruption: false, provenance: "site-A/DEV-01/OP-07", connectivity: "online", timestampUtc: iso(now) };
    case "review":
      return { result: "Hb 9.1 g/dL", testType: "Hb", deviceId: "DEV-02", qcPassed: true, calibrationDueUtc: iso(addDays(3)), operatorId: "OP-12", operatorCompetent: false, reagentLot: "LOT-44", reagentExpiryUtc: iso(addDays(10)), temperatureC: 24, humidityPct: 55, powerInterruption: true, provenance: "site-B/DEV-02/OP-12", connectivity: "online", timestampUtc: iso(now) };
    case "missing":
      return { result: "Hb 11.0 g/dL", testType: "Hb", deviceId: "DEV-04", qcPassed: true, calibrationDueUtc: iso(addDays(30)), operatorId: "", operatorCompetent: true, reagentLot: "", reagentExpiryUtc: iso(addDays(30)), temperatureC: 23, humidityPct: 45, powerInterruption: false, provenance: "", connectivity: "online", timestampUtc: iso(now) };
    case "offline":
      return { result: "Malaria RDT positive", testType: "Malaria-RDT", deviceId: "DEV-OFF-1", qcPassed: true, calibrationDueUtc: iso(addDays(30)), operatorId: "OP-09", operatorCompetent: true, reagentLot: "LOT-OFF-7", reagentExpiryUtc: iso(addDays(60)), temperatureC: 25, humidityPct: 50, powerInterruption: false, provenance: "site-mobile/DEV-OFF-1/OP-09", connectivity: "offline", localEventId: "local-demo12", timestampUtc: iso(now) };
    default:
      return { result: "CRP 68 mg/L", testType: "CRP", deviceId: "DEV-03", qcPassed: false, calibrationDueUtc: iso(addDays(-9)), operatorId: "OP-03", operatorCompetent: true, reagentLot: "LOT-91", reagentExpiryUtc: iso(addDays(-1)), temperatureC: 31.5, humidityPct: 90, powerInterruption: false, provenance: "site-C/DEV-03/OP-03", connectivity: "online", timestampUtc: iso(now) };
  }
}

export default function App() {
  const [nav, setNav] = useState<Nav>("overview");
  const [collapsed, setCollapsed] = useState(false);
  const [demoMode, setDemoMode] = useState(true);
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
  // Latch so rapid clicks cannot start a second submission while one is in flight.
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const [s, a, h] = await Promise.all([api.summary(), api.audit(100), api.assessments(100)]);
      setSummary(s); setAudit(a); setAssessments(h);
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

  async function runDemo(kind: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setDemoMode(true); setSubmitting(true); setError("");
    try {
      const d = await api.demo(kind);
      setDecision(d); setInput(demoInput(kind));
      setNav("overview");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; setSubmitting(false); }
  }

  function queueLocally(body: Record<string, unknown>, reason: string) {
    setPending(enqueueEvent(window.localStorage, body));
    setError(reason);
  }

  async function submit(body: Record<string, unknown>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true); setError("");
    try {
      if (body.connectivity === "offline") {
        // Honest prototype boundary: the offline path still asks the real engine. If the backend is
        // unreachable the event is only *queued* — no reliability evaluation happens locally.
        try {
          const d = await api.evaluate(body);
          setDecision(d); setInput(body as EvidenceInput); setNav("overview"); return;
        } catch (e) {
          if (e instanceof ApiError) throw e;   // rejected by the backend: not a connectivity failure
          queueLocally(body, "Backend unreachable — event queued locally as pending (prototype offline queue).");
          return;
        }
      }
      const d = await api.evaluate(body);
      setDecision(d); setInput(body as EvidenceInput); setNav("overview");
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);   // invalid/unservable request — queueing it would only mislead
      } else {
        const message = e instanceof Error ? e.message : String(e);
        queueLocally(body, `${message} — queued locally.`);
      }
    } finally { inFlight.current = false; setSubmitting(false); }
  }

  async function syncPending() {
    const snapshot = readQueue(window.localStorage);
    const syncedIds: string[] = [];
    for (const body of snapshot) {
      try { await api.evaluate(body); syncedIds.push(body._queueId); }
      catch { break; }   // first failure: unsynced entries stay queued (existing partial-failure behaviour)
    }
    // completeSync re-reads storage, so anything queued while this sync ran is preserved.
    setPending(completeSync(window.localStorage, syncedIds));
    await refresh();
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

  return (
    <div className="min-h-screen bg-[#F7F9FC] text-[#132238]">
      {demoMode && (
        <div role="banner" className="bg-[#0B1F3A] px-4 py-2 text-center text-sm font-semibold text-white">
          DEMONSTRATION MODE — SYNTHETIC DATA ONLY
        </div>
      )}
      <div className="flex">
        <aside className={`hidden min-h-screen shrink-0 flex-col bg-[#0B1F3A] text-white transition-all md:flex ${collapsed ? "w-16" : "w-60"}`} aria-label="Primary">
          <div className="flex items-center justify-between p-3">
            <Brand collapsed={collapsed} />
            <button onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} className="rounded p-2 text-slate-300 hover:bg-white/10">☰</button>
          </div>
          <nav className="flex flex-col gap-1 p-2">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => setNav(n.id)}
                aria-current={nav === n.id ? "page" : undefined}
                className={`pt-navbtn rounded-md px-3 py-2 text-left text-sm ${nav === n.id ? "bg-white font-semibold text-[#0B1F3A]" : "text-slate-200 hover:bg-white/10"}`}
              >
                {collapsed ? n.label[0] : n.label}
              </button>
            ))}
          </nav>
          <div className="mt-auto p-3 text-xs text-slate-300">
            {!collapsed && <p>Deterministic rules authoritative · AI advisory only.</p>}
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center gap-2 border-b border-[#DCE3EC] bg-white px-4 py-3">
            <div className="md:hidden"><Brand collapsed /></div>
            <nav className="flex flex-wrap gap-1 md:hidden" aria-label="Primary mobile">
              {NAV.slice(0, 4).map((n) => (
                <button key={n.id} onClick={() => setNav(n.id)} className={`rounded border px-2 py-1.5 text-xs ${nav === n.id ? "bg-[#0B1F3A] text-white" : ""}`}>{n.label}</button>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-2 text-xs">
              <span role="status" aria-label={online ? "Online" : "Offline"} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold ${online ? "border-[#167A5A]/30 bg-[#EAF7F1] text-[#167A5A]" : "border-[#B7791F]/40 bg-[#FFF7E6] text-[#B7791F]"}`}>
                <span aria-hidden="true">{online ? "●" : "○"}</span> {online ? "Online" : "Offline"}
              </span>
              <span className="text-[#607087]">Pending {pending.length}{lastSynced ? ` · synced ${new Date(lastSynced).toLocaleTimeString()}` : ""}</span>
              {pending.length > 0 && <button onClick={syncPending} className="rounded border px-2 py-1 font-semibold">Sync now</button>}
            </div>
          </header>

          <main className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
            {error && <p role="alert" className="rounded-lg border border-[#C43D3D]/30 bg-[#FDEEEE] px-3 py-2 text-sm text-[#C43D3D]">{error}</p>}
            {nav === "overview" && (
              decision ? (
                <AssessmentDetail
                  decision={decision} input={input} demoMode={demoMode}
                  onRepeat={() => { setPrefill({ ...emptyForm(), ...input } as FormState); setFormKey((k) => k + 1); setNav("new"); }}
                  onCheckDevice={() => setNav("devices")}
                  onBack={() => setNav("assessments")}
                />
              ) : (
                <Overview summary={summary} loading={loadingSummary} demoMode={demoMode} submitting={submitting} onDemo={runDemo} onOpen={openAssessment} />
              )
            )}
            {nav === "new" && <NewAssessment key={formKey} initial={prefill} submitting={submitting} error={error} onSubmit={submit} />}
            {nav === "assessments" && <AssessmentsList items={assessments} onOpen={openAssessment} />}
            {nav === "audit" && <AuditTrail rows={audit} />}
            {nav === "devices" && <DevicesPage />}
            {nav === "operators" && <OperatorsPage />}
            {nav === "qc" && <QualityPage />}
            {nav === "settings" && <SettingsPage demoMode={demoMode} onDemoMode={setDemoMode} />}
            {submitting && nav === "overview" && !decision && <div className="skeleton h-48 rounded-xl" aria-label="Loading assessment" />}
          </main>
        </div>
      </div>
    </div>
  );
}
