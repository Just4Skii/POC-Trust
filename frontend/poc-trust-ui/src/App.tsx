import { useCallback, useEffect, useState } from "react";
import { api } from "./api/client";
import { Brand } from "./components/Brand";
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

function loadPending(): Record<string, unknown>[] {
  try { return JSON.parse(localStorage.getItem("poctrust-pending") ?? "[]"); } catch { return []; }
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
  const [pending, setPending] = useState<Record<string, unknown>[]>(loadPending());
  const [lastSynced, setLastSynced] = useState<string | null>(localStorage.getItem("poctrust-synced"));

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
    setDemoMode(true); setSubmitting(true); setError("");
    try {
      const d = await api.demo(kind);
      setDecision(d); setInput(demoInput(kind));
      setNav("overview");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSubmitting(false); }
  }

  async function submit(body: Record<string, unknown>) {
    setSubmitting(true); setError("");
    const isOffline = body.connectivity === "offline" || !navigator.onLine;
    try {
      if (isOffline && body.connectivity === "offline") {
        // Honest prototype: evaluate locally-available path via backend when reachable,
        // else queue. Try backend first so demo/offline still goes through real engine.
        try {
          const d = await api.evaluate(body);
          setDecision(d); setInput(body as EvidenceInput); setNav("overview"); return;
        } catch {
          const q = [...pending, { ...body, _queuedAt: new Date().toISOString() }];
          localStorage.setItem("poctrust-pending", JSON.stringify(q));
          setPending(q);
          setError("Backend unreachable — event queued locally as pending (prototype offline queue).");
          return;
        }
      }
      const d = await api.evaluate(body);
      setDecision(d); setInput(body as EvidenceInput); setNav("overview");
    } catch (e) {
      const q = [...pending, { ...body, _queuedAt: new Date().toISOString() }];
      localStorage.setItem("poctrust-pending", JSON.stringify(q));
      setPending(q);
      setError(e instanceof Error ? `${e.message} — queued locally.` : String(e));
    } finally { setSubmitting(false); }
  }

  async function syncPending() {
    const q = loadPending();
    let ok = 0;
    for (const body of q) {
      try { await api.evaluate(body); ok++; } catch { break; }
    }
    const rest = q.slice(ok);
    localStorage.setItem("poctrust-pending", JSON.stringify(rest));
    setPending(rest);
    await refresh();
  }

  async function openAssessment(id: string) {
    try {
      const detail = await api.assessmentDetail(id);
      const a = detail.assessment as unknown as {
        id: string; initialStatus: number; finalStatus: number; reasonsJson: string; ruleIdsJson: string;
        action: string; aiSummary?: string; aiConsulted: boolean; decidedAtUtc: string;
      };
      const inp = detail.input as unknown as EvidenceInput;
      setInput(inp);
      setDecision({
        id: a.id,
        initialStatus: a.initialStatus, finalStatus: a.finalStatus,
        reasons: JSON.parse(a.reasonsJson ?? "[]"), ruleIds: JSON.parse(a.ruleIdsJson ?? "[]"),
        action: a.action,
        aiAssessment: a.aiSummary ? { summary: a.aiSummary, anomalies: [], recommendedAction: "", confidence: 0.7, model: "recorded" } : null,
        aiConsulted: a.aiConsulted, decidedAtUtc: a.decidedAtUtc,
      });
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
                <Overview summary={summary} loading={loadingSummary} demoMode={demoMode} onDemo={runDemo} onOpen={openAssessment} />
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
