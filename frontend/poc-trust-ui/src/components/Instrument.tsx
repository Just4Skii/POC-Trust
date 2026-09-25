import { useEffect, useMemo, useRef, useState } from "react";
import { evidenceItems } from "../lib/evidence";
import { evidenceSignals } from "../lib/signals";
import { seededSamples, tracePathD, traceLatest } from "../lib/telemetry";
import { useOnScreen, useReducedMotion } from "../lib/hooks";
import { isDemoRecord } from "../lib/labels";
import { formatEventTimeLocal } from "../i18n/strings";
import type { EvidenceInput } from "../types";

/**
 * Evidence Monitor (Section 9), the signature instrument: the ONE navy panel for this page
 * (never pure black), muted teal/blue traces, mono labels, tabular numerals, luminous hairline.
 *
 * TRUTHFULNESS: row values are the real recorded values of this assessment. Trace shapes are
 * seeded presentation aids derived from the record identifier, deterministic per record ,
 * never a live device feed. The header always labels demonstration evidence as synthetic.
 * Rows that contributed to the decision are tagged "↳ contributor"; contextual rows are tagged
 * "↳ contextual" (spec section 23: monitor ↔ evidence cards ↔ decision drivers ↔ record are one
 * system). Traces draw in once (staggered ~50 ms), then only a faint cosmetic sweep every ~9 s
 * runs while on-screen and the tab is visible.
 */

interface MonitorRow {
  key: string;
  label: string;
  valueText: string;
  state: "ok" | "warn" | "fail";
  note: string;
  contributed: boolean;
  hasTrace: boolean;
}

const DARK_TEXT: Record<MonitorRow["state"], string> = { ok: "#6FD3C4", warn: "#E7B25C", fail: "#F0908E" };
const TRACE_STROKE: Record<MonitorRow["state"], string> = { ok: "#4DA3B8", warn: "#C9A45C", fail: "#D98B8B" };
const CHIP_WORD: Record<MonitorRow["state"], string> = { ok: "ok", warn: "attention", fail: "problem" };

function buildRows(input: EvidenceInput, ruleIds: string[]): MonitorRow[] {
  const items = Object.fromEntries(evidenceItems(input, ruleIds).map((i) => [i.key, i]));
  const signals = Object.fromEntries(evidenceSignals(input, ruleIds).map((s) => [s.key, s]));
  const power = items.env;
  return [
    { key: "temp", label: "Temperature", valueText: signals.temp.valueText, state: signals.temp.state, note: signals.temp.note, contributed: power?.contributed ?? false, hasTrace: true },
    { key: "hum", label: "Humidity", valueText: signals.hum.valueText, state: signals.hum.state, note: signals.hum.note, contributed: power?.contributed ?? false, hasTrace: true },
    { key: "power", label: "Power state", valueText: input.powerInterruption ? "Interruption recorded" : "Stable", state: input.powerInterruption ? "warn" : "ok", note: input.powerInterruption ? "A power interruption was recorded around the time of the test." : "No power interruption recorded.", contributed: Boolean(input.powerInterruption), hasTrace: false },
    { key: "cal", label: "Calibration", valueText: signals.cal.valueText, state: signals.cal.state, note: signals.cal.note, contributed: items.cal?.contributed ?? false, hasTrace: false },
    { key: "qc", label: "Quality control", valueText: input.qcPassed ? "Pass" : "Fail", state: input.qcPassed ? "ok" : "fail", note: input.qcPassed ? "Device quality-control check passed." : "Device quality-control check failed, the result must not be relied on without verification.", contributed: items.qc?.contributed ?? false, hasTrace: false },
    { key: "conn", label: "Connectivity", valueText: (input.connectivity ?? "online") === "offline" ? "Offline" : "Online", state: "ok", note: (input.connectivity ?? "online") === "offline" ? "Recorded offline, synchronisation metadata only; not a reliability rule." : "Online when recorded.", contributed: false, hasTrace: true },
    { key: "op", label: "Operator", valueText: items.op?.value ?? "Not recorded", state: items.op?.state ?? "ok", note: items.op?.detail ?? "", contributed: items.op?.contributed ?? false, hasTrace: false },
    { key: "reagent", label: "Reagent", valueText: items.reagent?.value ?? "Not recorded", state: items.reagent?.state ?? "ok", note: items.reagent?.detail ?? "", contributed: items.reagent?.contributed ?? false, hasTrace: false },
  ];
}
export function EvidenceMonitor({ input, ruleIds }: { input: EvidenceInput; ruleIds: string[] }) {
  const rows = useMemo(() => buildRows(input, ruleIds), [input, ruleIds]);
  const reduced = useReducedMotion();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onScreen = useOnScreen(panelRef);
  const [tabVisible, setTabVisible] = useState(true);
  const [openRow, setOpenRow] = useState<string | null>(null);

  useEffect(() => {
    const on = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  useEffect(() => {
    if (!openRow) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenRow(null); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [openRow]);

  const seed = [input.localEventId, input.timestampUtc, input.deviceId, input.testType].filter(Boolean).join("|") || "record";
  const sweep = onScreen && tabVisible && !reduced;
  const demo = isDemoRecord(input.demoKey);
  const recordTime = formatEventTimeLocal(input.timestampUtc);

  return (
    <section
      ref={panelRef}
      aria-label="Evidence monitor"
      className={`pt-lume-dark relative overflow-hidden rounded-xl p-4 text-slate-100 shadow-[var(--shadow-2)] md:p-5 ${sweep ? "pt-scan" : ""}`}
    >
      {/* faint internal grid */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
      <header className="relative flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
        <div>
          <h3 className="pt-label text-slate-200">Evidence monitor</h3>
          <p className="mono text-[10px] text-slate-400">
            {demo ? "Demonstration environment" : "Recorded evidence environment"}
          </p>
        </div>
        <span
          className={`mono rounded-full border px-2.5 py-1 text-[9px] font-medium uppercase tracking-[0.09em] ${
            demo ? "border-[#E7B25C]/60 text-[#E7B25C]" : "border-[#6FD3C4]/50 text-[#6FD3C4]"
          }`}
        >
          {demo ? "Demonstration signal · synthetic evidence" : "Recorded evidence"}
        </span>
      </header>

      <ul className="relative mt-1">
        {rows.map((r, i) => {
          const samples = seededSamples(`${seed}:${r.key}`, 26, 0.5, r.state === "ok" ? 0.16 : r.state === "warn" ? 0.3 : 0.36);
          const d = tracePathD(samples, 128, 26, 4);
          const latest = traceLatest(samples, 128, 26, 4);
          const color = DARK_TEXT[r.state];
          const open = openRow === r.key;
          return (
            <li
              key={r.key}
              className="relative flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/[0.06] py-2 last:border-0"
              tabIndex={0}
              onMouseEnter={() => setOpenRow(r.key)}
              onMouseLeave={() => setOpenRow(null)}
              onFocus={() => setOpenRow(r.key)}
              onBlur={() => setOpenRow(null)}
              aria-describedby={open ? `pt-mon-tip-${r.key}` : undefined}
            >
              <span className="pt-label w-[7.5rem] shrink-0 text-slate-400">{r.label}</span>
              <span className="mono min-w-0 flex-1 break-words text-[12px] text-slate-100">{r.valueText}</span>
              <span className="order-last w-full sm:order-none sm:w-auto">
                <svg viewBox="0 0 128 26" width="128" height="26" aria-hidden="true">
                  <line x1="4" y1="22" x2="124" y2="22" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                  <path
                    d={d}
                    fill="none"
                    stroke={TRACE_STROKE[r.state]}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pathLength={1}
                    className="pt-draw transition-opacity duration-150"
                    style={{ ["--d" as string]: `${i * 50}ms`, opacity: open ? 1 : 0.8 }}
                  />
                  <circle cx={latest.x} cy={latest.y} r="2.4" fill={color} className="pt-marker-in" style={{ animationDelay: `${i * 50 + 500}ms` }} />
                </svg>
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-2">
                <span
                  className="mono text-[10px] font-medium"
                  style={{ color: r.contributed ? color : "rgba(148,163,184,0.75)" }}
                >
                  {r.contributed ? "↳ contributor" : "↳ contextual"}
                </span>
                <span className="mono rounded-full border px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em]" style={{ color, borderColor: `${color}66` }}>
                  {CHIP_WORD[r.state]}
                </span>
              </span>
              {open && (
                <span
                  id={`pt-mon-tip-${r.key}`}
                  role="tooltip"
                  className="pt-fade absolute right-0 top-full z-20 mt-1 w-64 rounded-md border border-white/15 bg-[#122945] p-2.5 text-left shadow-lg"
                >
                  <span className="mono block text-[12px] font-semibold text-slate-100">{r.valueText}</span>
                  <span className="mono block text-[10px] text-slate-400">recorded {recordTime}</span>
                  <span className="mt-1 block text-[11px] leading-snug text-slate-300">{r.note}</span>
                  <span className="mt-1 block text-[10px] text-slate-400">
                    Trace is a seeded presentation shape, the value above is the recorded evidence.
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <p className="relative mt-3 border-t border-white/10 pt-2.5 text-[11px] leading-relaxed text-slate-400">
        {demo ? "Demonstration evidence, synthetic, clearly labelled. " : ""}
        Values shown are this assessment&apos;s recorded evidence. Trace shapes are deterministic presentation aids, not a live device feed.
      </p>
    </section>
  );
}
