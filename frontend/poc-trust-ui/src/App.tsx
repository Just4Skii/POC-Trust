import { useEffect, useState } from "react";

type Status = "Trust" | "Review" | "Verify";
type Decision = {
  id: string;
  initialStatus: Status | number;
  finalStatus: Status | number;
  reasons: string[];
  ruleIds: string[];
  action: string;
  aiAssessment?: { summary: string; anomalies: string[]; recommendedAction: string; confidence: number; model: string } | null;
  aiConsulted: boolean;
};
type AuditRow = {
  id: string; assessmentId: string; initialStatus: number; finalStatus: number;
  aiConsulted: boolean; aiSummary?: string; action: string; timestampUtc: string;
};

const statusName = (s: Status | number) =>
  typeof s === "string" ? s : (["Trust", "Review", "Verify"] as Status[])[s] ?? String(s);
const badge = (s: Status | number) => {
  const n = statusName(s);
  return n === "Trust" ? "bg-emerald-100 text-emerald-800 border-emerald-300"
    : n === "Review" ? "bg-amber-100 text-amber-900 border-amber-300"
    : "bg-red-100 text-red-800 border-red-300";
};

export default function App() {
  const [tab, setTab] = useState<"dashboard" | "form" | "audit">("dashboard");
  const [form, setForm] = useState({
    result: "Hb 14.2 g/dL", testType: "Hb", deviceId: "DEV-01", qcPassed: true,
    calibrationDueUtc: new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 16),
    operatorId: "OP-07", operatorCompetent: true, reagentLot: "LOT-GOOD",
    reagentExpiryUtc: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 16),
    temperatureC: 22.5, humidityPct: 45, powerInterruption: false,
    connectivity: "online", provenance: "site-A/DEV-01/OP-07",
  });
  const [decision, setDecision] = useState<Decision | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [counts, setCounts] = useState({ Trust: 0, Review: 0, Verify: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  async function loadAudit() {
    try {
      const res = await fetch("/api/assessments/audit?take=100");
      if (!res.ok) return;
      const rows: AuditRow[] = await res.json();
      setAudit(rows);
      const c = { Trust: 0, Review: 0, Verify: 0 };
      rows.forEach((r) => { c[statusName(r.finalStatus) as keyof typeof c]++; });
      setCounts(c);
    } catch { /* backend may be down in preview */ }
  }
  useEffect(() => { loadAudit(); }, [tab, decision]);

  async function evaluate(demo?: string) {
    setLoading(true); setError("");
    try {
      const res = demo ? await fetch(`/api/assessments/demo/${demo}`) : await fetch("/api/assessments/evaluate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          calibrationDueUtc: new Date(form.calibrationDueUtc).toISOString(),
          reagentExpiryUtc: new Date(form.reagentExpiryUtc).toISOString(),
          timestampUtc: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      setDecision(await res.json());
      setTab("dashboard");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-6xl px-6 py-5">
          <h1 className="text-2xl font-bold">POC Trust — Point-of-Care Diagnostic Integrity Layer</h1>
          <p className="text-sm text-slate-600">Deterministic TRUST/REVIEW/VERIFY is authoritative. AI is advisory only. Clinician decides.</p>
          <div className="mt-3 flex gap-2 text-sm">
            {(["dashboard", "form", "audit"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`rounded border px-3 py-1 capitalize ${tab === t ? "bg-slate-900 text-white" : "bg-white"}`}>{t === "form" ? "Event Form" : t}</button>
            ))}
            <span className="mx-2" />
            {["trust", "review", "verify", "missing", "offline"].map((d) => (
              <button key={d} onClick={() => evaluate(d)} className="rounded border px-2 py-1 capitalize">{d}</button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        {tab === "dashboard" && (
          <div className="grid gap-6 md:grid-cols-3">
            <div className="rounded-xl border bg-white p-5"><h2 className="font-semibold">Dashboard</h2>
              <p className="text-sm">Trust {counts.Trust} · Review {counts.Review} · Verify {counts.Verify} (last 100 audits)</p>
              {!decision && <p className="mt-2 text-sm text-slate-500">Run a demo or submit the Event Form.</p>}
            </div>
            <div className="rounded-xl border bg-white p-5 md:col-span-2"><h2 className="font-semibold mb-2">Assessment View</h2>
              {!decision && <p className="text-sm text-slate-500">No assessment yet.</p>}
              {decision && (
                <div className="space-y-3 text-sm">
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded border px-3 py-1 font-semibold ${badge(decision.initialStatus)}`}>Initial: {statusName(decision.initialStatus)}</span>
                    <span className={`rounded border px-3 py-1 font-semibold ${badge(decision.finalStatus)}`}>Final: {statusName(decision.finalStatus)}</span>
                    <span className="rounded border px-3 py-1">{decision.aiConsulted ? "AI consulted" : "Rules only"}</span>
                  </div>
                  <p><b>Action:</b> {decision.action}</p>
                  <p className="text-slate-500">Audit ID: {decision.id}</p>
                  <ul className="list-disc pl-5">{decision.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  {decision.aiAssessment && (
                    <div className="rounded border bg-slate-50 p-3">
                      <b>AI advisory — not a diagnosis:</b>
                      <p>{decision.aiAssessment.summary}</p>
                      <ul className="list-disc pl-5">{decision.aiAssessment.anomalies.map((a, i) => <li key={i}>{a}</li>)}</ul>
                    </div>
                  )}
                </div>
              )}
              {error && <p className="text-red-700">Backend unreachable ({error}). Run API first.</p>}
            </div>
          </div>
        )}

        {tab === "form" && (
          <section className="rounded-xl border bg-white p-5">
            <h2 className="font-semibold mb-4">Diagnostic Event Form (synthetic data only)</h2>
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <label>Test type<input className="mt-1 w-full rounded border px-2 py-1" value={form.testType} onChange={(e) => set("testType", e.target.value)} /></label>
              <label>Result<input className="mt-1 w-full rounded border px-2 py-1" value={form.result} onChange={(e) => set("result", e.target.value)} /></label>
              <label>Device<input className="mt-1 w-full rounded border px-2 py-1" value={form.deviceId} onChange={(e) => set("deviceId", e.target.value)} /></label>
              <label>Operator<input className="mt-1 w-full rounded border px-2 py-1" value={form.operatorId} onChange={(e) => set("operatorId", e.target.value)} /></label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.qcPassed} onChange={(e) => set("qcPassed", e.target.checked)} /> QC passed</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.operatorCompetent} onChange={(e) => set("operatorCompetent", e.target.checked)} /> Operator competent</label>
              <label>Calibration due<input type="datetime-local" className="mt-1 w-full rounded border px-2 py-1" value={form.calibrationDueUtc} onChange={(e) => set("calibrationDueUtc", e.target.value)} /></label>
              <label>Reagent expiry<input type="datetime-local" className="mt-1 w-full rounded border px-2 py-1" value={form.reagentExpiryUtc} onChange={(e) => set("reagentExpiryUtc", e.target.value)} /></label>
              <label>Reagent lot<input className="mt-1 w-full rounded border px-2 py-1" value={form.reagentLot} onChange={(e) => set("reagentLot", e.target.value)} /></label>
              <label>Provenance<input className="mt-1 w-full rounded border px-2 py-1" value={form.provenance} onChange={(e) => set("provenance", e.target.value)} /></label>
              <label>Temp °C<input type="number" step="0.1" className="mt-1 w-full rounded border px-2 py-1" value={form.temperatureC} onChange={(e) => set("temperatureC", Number(e.target.value))} /></label>
              <label>Humidity %<input type="number" className="mt-1 w-full rounded border px-2 py-1" value={form.humidityPct} onChange={(e) => set("humidityPct", Number(e.target.value))} /></label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.powerInterruption} onChange={(e) => set("powerInterruption", e.target.checked)} /> Power interruption</label>
              <label>Connectivity<select className="mt-1 w-full rounded border px-2 py-1" value={form.connectivity} onChange={(e) => set("connectivity", e.target.value)}><option>online</option><option>offline</option></select></label>
            </div>
            <button disabled={loading} onClick={() => evaluate()} className="mt-4 rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">{loading ? "Evaluating…" : "Evaluate reliability"}</button>
          </section>
        )}

        {tab === "audit" && (
          <section className="rounded-xl border bg-white p-5">
            <h2 className="font-semibold mb-2">Audit View (append-only, prototype)</h2>
            <p className="text-sm text-slate-600 mb-3">Input → rules → initial → AI? → final → action → timestamp. No cryptographic immutability claimed.</p>
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b"><th>Time</th><th>Final</th><th>AI?</th><th>Action</th><th>ID</th></tr></thead>
              <tbody>{audit.map((a) => (
                <tr key={a.id} className="border-b"><td>{new Date(a.timestampUtc).toLocaleString()}</td>
                  <td><span className={`rounded border px-2 py-0.5 ${badge(a.finalStatus)}`}>{statusName(a.finalStatus)}</span></td>
                  <td>{a.aiConsulted ? "yes" : "no"}</td><td className="max-w-md truncate">{a.action}</td><td className="font-mono text-xs">{a.assessmentId.slice(0, 8)}</td></tr>
              ))}</tbody>
            </table>
          </section>
        )}
      </main>
    </div>
  );
}
