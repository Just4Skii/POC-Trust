import { useState } from "react";
import { AiFallback, ContextualAnalysis } from "../components/ContextualAnalysis";
import { EvidencePanel, WhyPanel } from "../components/Evidence";
import { StatusBadge } from "../components/StatusBadge";
import { canRelyText, statusName, type Decision, type EvidenceInput } from "../types";

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
      <button onClick={submit} disabled={submitting} className="pt-action rounded-lg bg-[#0B1F3A] px-5 py-3 font-semibold text-white disabled:opacity-50">
        {submitting ? "Evaluating…" : "Evaluate reliability"}
      </button>
    </div>
  );
}

export function AssessmentDetail({
  decision, input, demoMode, onRepeat, onCheckDevice, onBack,
}: {
  decision: Decision;
  input: EvidenceInput;
  demoMode: boolean;
  onRepeat: () => void;
  onCheckDevice: () => void;
  onBack: () => void;
}) {
  const finalName = statusName(decision.finalStatus);
  const heroBg = finalName === "Trust" ? "bg-[#EAF7F1]" : finalName === "Review" ? "bg-[#FFF7E6]" : "bg-[#FDEEEE]";
  const heroBorder = finalName === "Trust" ? "border-[#167A5A]" : finalName === "Review" ? "border-[#B7791F]" : "border-[#C43D3D]";
  const aiFailed = decision.reasons.some((r) => r.startsWith("AI unavailable"));

  return (
    <article className={`space-y-4 ${demoMode ? "pt-demo" : "pt-fade"}`}>
      <section aria-label="Reliability decision" className={`rounded-2xl border-2 ${heroBorder} ${heroBg} p-6 text-center md:p-10`}>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#607087]">Reliability decision</p>
        <div className="mt-2 flex justify-center"><StatusBadge value={decision.finalStatus} size="lg" /></div>
        <p className="mt-3 text-lg font-semibold text-[#132238]">{canRelyText(decision.finalStatus)}</p>
        {finalName === "Verify" && <p className="mt-1 font-bold text-[#C43D3D]">Do not rely on this result alone.</p>}
        <p className="mt-2 text-sm text-[#607087]">Result: <b className="text-[#132238]">{input.result ?? "—"}</b> · Initial {statusName(decision.initialStatus)} · Audit {decision.id.slice(0, 8)}</p>
        <p className="mt-3 rounded-lg bg-white/70 px-4 py-2 text-sm font-medium text-[#132238]">Next action: {decision.action}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button onClick={() => document.getElementById("pt-evidence")?.scrollIntoView({ behavior: "smooth" })} className="pt-action rounded-md border border-[#0B1F3A] bg-white px-4 py-2 text-sm font-semibold">Review Evidence</button>
          <button onClick={onCheckDevice} className="pt-action rounded-md border border-[#0B1F3A] bg-white px-4 py-2 text-sm font-semibold">Check Device</button>
          <button onClick={onRepeat} className="pt-action rounded-md bg-[#0B1F3A] px-4 py-2 text-sm font-semibold text-white">Repeat Test</button>
          <button onClick={onBack} className="pt-action rounded-md px-4 py-2 text-sm text-[#607087] underline">Back to history</button>
        </div>
      </section>

      <WhyPanel decision={decision} />
      <div id="pt-evidence"><EvidencePanel input={input} decision={decision} /></div>
      <ContextualAnalysis decision={decision} />
      <AiFallback show={aiFailed} />
    </article>
  );
}
