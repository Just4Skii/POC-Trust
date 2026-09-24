import { useState } from "react";
import { AuditLifecycle } from "../components/AuditTimeline";
import { AiFallback, ContextualAnalysis } from "../components/ContextualAnalysis";
import { EvidencePanel, WhyPanel } from "../components/Evidence";
import { EvidenceFlow, SignalMap } from "../components/Flow";
import { EvidenceMonitor } from "../components/Instrument";
import { IntegrityRecord } from "../components/IntegrityRecord";
import { StatusBadge } from "../components/StatusBadge";
import { ReliabilityArc, SignalRailViz } from "../components/Visuals";
import { evidenceItems } from "../lib/evidence";
import { usePointerLight } from "../lib/hooks";
import { STATUS_COPY, formatEventTime, isAiUnavailableReason } from "../lib/labels";
import { evidenceSignals } from "../lib/signals";
import { DEMO_SCENARIOS, scenarioFor } from "../lib/scenarios";
import { canRelyText, statusName, type AuditRow, type Decision, type EvidenceInput } from "../types";

export interface FormState extends EvidenceInput {
  result: string;
  deviceId: string;
  calibrationDueUtc: string;
  operatorId: string;
  reagentLot: string;
  reagentExpiryUtc: string;
  temperatureC: number;
}

export const emptyForm = (): FormState => ({
  result: "Hb 14.2 g/dL",
  testType: "Hb",
  deviceId: "DEV-01",
  qcPassed: true,
  calibrationDueUtc: new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 16),
  operatorId: "OP-07",
  operatorCompetent: true,
  reagentLot: "LOT-GOOD",
  reagentExpiryUtc: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 16),
  temperatureC: 22.5,
  humidityPct: 45,
  powerInterruption: false,
  connectivity: "online",
  localEventId: "",
  provenance: "site-A/DEV-01/OP-07",
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-[#DCE3EC] p-4">
      <legend className="px-1 text-sm font-semibold text-[#0B1F3A]">{title}</legend>
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
    </fieldset>
  );
}

const inputCls = "mt-1 w-full rounded-md border border-[#DCE3EC] px-3 py-2.5 text-[15px]";

export function NewAssessment({
  initial, submitting, error, onSubmit,
}: {
  initial: FormState;
  submitting: boolean;
  error: string;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const set = (k: keyof FormState, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const [localError, setLocalError] = useState("");

  function submit() {
    if (!form.result.trim()) return setLocalError("Diagnostic result is required.");
    if (!form.deviceId.trim()) return setLocalError("Device is required.");
    setLocalError("");
    onSubmit({
      ...form,
      calibrationDueUtc: new Date(form.calibrationDueUtc).toISOString(),
      reagentExpiryUtc: new Date(form.reagentExpiryUtc).toISOString(),
      timestampUtc: new Date().toISOString(),
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#DCE3EC] bg-white p-5">
        <h2 className="text-lg font-bold text-[#0B1F3A]">New assessment</h2>
        <p className="text-sm text-[#607087]">Capture the evidence the backend actually evaluates. Synthetic data only.</p>
      </div>
      <Section title="Result & test">
        <label>Test type<input className={inputCls} value={form.testType ?? ""} onChange={(e) => set("testType", e.target.value)} /></label>
        <label>Diagnostic result*<input className={inputCls} value={form.result} onChange={(e) => set("result", e.target.value)} aria-required="true" /></label>
      </Section>
      <Section title="Device, QC & calibration">
        <label>Device ID*<input className={inputCls} value={form.deviceId} onChange={(e) => set("deviceId", e.target.value)} /></label>
        <label>Calibration due<input type="datetime-local" className={inputCls} value={form.calibrationDueUtc} onChange={(e) => set("calibrationDueUtc", e.target.value)} /></label>
        <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" checked={!!form.qcPassed} onChange={(e) => set("qcPassed", e.target.checked)} /> QC passed</label>
        <p className="text-xs text-[#607087]">Failed QC forces VERIFY — cannot be overridden.</p>
      </Section>
      <Section title="Operator & reagent">
        <label>Operator ID<input className={inputCls} value={form.operatorId} onChange={(e) => set("operatorId", e.target.value)} /></label>
        <label>Reagent lot<input className={inputCls} value={form.reagentLot} onChange={(e) => set("reagentLot", e.target.value)} /></label>
        <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" checked={!!form.operatorCompetent} onChange={(e) => set("operatorCompetent", e.target.checked)} /> Operator competent</label>
        <label>Reagent expiry<input type="datetime-local" className={inputCls} value={form.reagentExpiryUtc} onChange={(e) => set("reagentExpiryUtc", e.target.value)} /></label>
      </Section>
      <Section title="Environment & provenance">
        <label>Temperature °C<input type="number" step="0.1" className={inputCls} value={form.temperatureC} onChange={(e) => set("temperatureC", Number(e.target.value))} /></label>
        <label>Humidity %<input type="number" className={inputCls} value={form.humidityPct ?? 45} onChange={(e) => set("humidityPct", Number(e.target.value))} /></label>
        <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" checked={!!form.powerInterruption} onChange={(e) => set("powerInterruption", e.target.checked)} /> Power interruption</label>
        <label>Connectivity<select className={inputCls} value={form.connectivity ?? "online"} onChange={(e) => set("connectivity", e.target.value)}><option value="online">online</option><option value="offline">offline</option></select></label>
        <label className="md:col-span-2">Provenance (who / where / device / reagent)<input className={inputCls} value={form.provenance ?? ""} onChange={(e) => set("provenance", e.target.value)} placeholder="site-A/DEV-01/OP-07" /></label>
      </Section>
      {(localError || error) && <p role="alert" className="text-sm font-semibold text-[#C43D3D]">{localError || error}</p>}
      <button onClick={submit} disabled={submitting} className="pt-action pt-primary w-full rounded-lg px-5 py-3 font-semibold disabled:opacity-50 sm:w-auto">
        {submitting ? "Evaluating…" : "Evaluate reliability"}
      </button>
    </div>
  );
}

export function AssessmentDetail({
  decision, input, auditRow, onRepeat, onCheckDevice, onBack,
}: {
  decision: Decision;
  input: EvidenceInput;
  /** The real stored audit entry for this assessment, when the audit list contains it. */
  auditRow?: AuditRow;
  onRepeat: () => void;
  onCheckDevice: () => void;
  onBack: () => void;
}) {
  const finalName = statusName(decision.finalStatus);
  const isKindRun = typeof input.demoKey === "string" && input.demoKey.startsWith("demo-kind-");
  const heroBg = finalName === "Trust" ? "bg-[#EAF7F1]" : finalName === "Review" ? "bg-[#FFF7E6]" : "bg-[#FDEEEE]";
  const heroBorder = finalName === "Trust" ? "border-[#167A5A]" : finalName === "Review" ? "border-[#B7791F]" : "border-[#C43D3D]";
  const aiFailed = decision.reasons.some(isAiUnavailableReason);
  const scenario = scenarioFor(input.demoKey);
  const scnIndex = DEMO_SCENARIOS.findIndex((s) => s.key === input.demoKey);
  // Shared cross-highlight: evidence cards ↔ signal map ↔ reliability arc (Section 15/17).
  const [highlight, setHighlight] = useState<string | null>(null);
  const heroRef = usePointerLight<HTMLDivElement>();
  const items = evidenceItems(input, decision.ruleIds ?? []);
  const signals = evidenceSignals(input, decision.ruleIds ?? []);
  // Motion signature per state (Section 12) — plays once on reveal, then static.
  const sigWrap =
    finalName === "Trust" ? "pt-sig-trust inline-block"
    : finalName === "Review" ? "pt-sig-review inline-flex rounded-md"
    : "pt-sig-verify inline-flex";

  return (
    <article className={`space-y-4 ${scenario || isKindRun ? "pt-demo" : "pt-fade"}`}>
      {(scenario || isKindRun) && (
        <p role="note" className="pt-fade rounded-lg border border-[#0F8B8D]/40 bg-[#EAF7F7] px-4 py-2 text-sm text-[#0B1F3A]">
          {scnIndex >= 0 && (
            <span className="mono mr-2 rounded bg-[#0B1F3A] px-1.5 py-0.5 text-[10px] font-semibold text-white">
              SCN-{String(scnIndex + 1).padStart(2, "0")}
            </span>
          )}
          <b>{scenario ? `Demonstration scenario — ${scenario.story}.` : "Demonstration run — a fresh evaluation of a curated scenario."}</b>{" "}
          {scenario ? scenario.summary : "This record was created through the real pipeline by a demonstration scenario card. It is synthetic and demo-marked."} Synthetic record, clearly labelled.
        </p>
      )}
      <section
        ref={heroRef}
        aria-label="Reliability decision"
        className={`pt-lume-ring pt-light pt-settle rounded-2xl border-2 ${heroBorder} ${heroBg} p-6 text-center shadow-[var(--shadow-2)] md:p-10`}
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-[#607087]">{STATUS_COPY[finalName].strip}</p>
        <div className="mt-3 flex flex-col items-center justify-center gap-6 md:flex-row md:text-left">
          <div className="text-center">
            <span className={sigWrap}>
              <StatusBadge value={decision.finalStatus} size="lg" />
            </span>
            <p className="mt-4 text-lg font-semibold text-[#132238]" style={{ animation: "pt-fade 300ms var(--ease-enter) 120ms both" }}>
              {canRelyText(decision.finalStatus)}
            </p>
            {finalName === "Verify" && (
              <p className="mt-1 font-bold text-[#C43D3D]" style={{ animation: "pt-fade 300ms var(--ease-enter) 200ms both" }}>
                Do not rely on this result alone.
              </p>
            )}
            <p className="mt-2 text-sm text-[#607087]">Result: <b className="text-[#132238]">{input.result ?? "—"}</b> · initial assessment: {statusName(decision.initialStatus)} · <span className="mono">{formatEventTime(decision.decidedAtUtc)}</span></p>
            <p className="mt-3 rounded-lg bg-white/70 px-4 py-2 text-sm font-medium text-[#132238]">Next action: {decision.action}</p>
          </div>
          <ReliabilityArc
            segments={items.map((i) => ({ key: i.key, label: i.label, state: i.state }))}
            status={decision.finalStatus}
            highlight={highlight}
            onHighlight={setHighlight}
          />
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2 pt-stagger">
          {([
            ["Review Evidence", () => document.getElementById("pt-evidence")?.scrollIntoView({ behavior: "smooth" }), false],
            ["Check Device", onCheckDevice, false],
            ["Repeat Test", onRepeat, true],
            ["Back to history", onBack, false],
          ] as const).map(([label, fn, primary], i) => (
            <button
              key={label}
              onClick={fn}
              style={{ ["--d" as string]: `${i * 50}ms` }}
              className={`pt-action rounded-md px-4 py-2 text-sm font-semibold ${
                primary ? "bg-[#0B1F3A] text-white" : label === "Back to history" ? "px-4 py-2 text-[#607087] underline" : "border border-[#0B1F3A] bg-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
      {/* The central artefact: derived on the backend from the stored assessment. */}
      <IntegrityRecord id={decision.id} />

      <div className="grid gap-4 lg:grid-cols-2">
        <EvidenceFlow input={input} ruleIds={decision.ruleIds ?? []} status={finalName} />
        <SignalMap
          input={input}
          ruleIds={decision.ruleIds ?? []}
          status={finalName}
          highlight={highlight}
          onHighlight={setHighlight}
        />
      </div>

      <WhyPanel decision={decision} />

      <section aria-label="Evidence signals" className="pt-card p-4">
        <h3 className="pt-label text-[#0B1F3A]">Evidence signals</h3>
        <p className="mt-1 text-xs text-[#607087]">
          Evidence telemetry from this assessment&apos;s recorded values — not patient vitals. Bands are the
          supported ranges the deterministic rules evaluate.
        </p>
        <div className="mt-3 grid gap-5 sm:grid-cols-3">
          {signals.map((s, i) => (
            <SignalRailViz key={s.key} signal={s} delay={i * 80} />
          ))}
        </div>
      </section>

      <div id="pt-evidence">
        <EvidencePanel input={input} decision={decision} highlight={highlight} onHighlight={setHighlight} />
      </div>

      <EvidenceMonitor input={input} ruleIds={decision.ruleIds ?? []} />

      <ContextualAnalysis decision={decision} />
      <AiFallback show={aiFailed} />
      <AuditLifecycle row={auditRow} status={decision.finalStatus} action={decision.action} />
    </article>
  );
}
