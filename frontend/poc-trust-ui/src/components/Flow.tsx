import { useEffect, useRef, useState } from "react";
import { evidenceItems, qualityFor, type EvidenceItem } from "../lib/evidence";
import { stateWord as qualityStateWord } from "../lib/rir";
import { useReducedMotion } from "../lib/hooks";
import type { EvidenceInput, Status } from "../types";

/**
 * Evidence Flow (Section 16), the causal chain made legible: this evidence → this evaluation →
 * this state. Presentation is driven by the real evidence items; a node with no recorded value
 * reads "not evaluated" and is never falsely lit. One dark-panel rule: this stays light.
 */

type NodeState = "ok" | "warn" | "fail" | "none";

const STATE_TEXT: Record<NodeState, string> = { ok: "passed", warn: "attention", fail: "problem", none: "not evaluated" };
const STATE_DOT: Record<NodeState, string> = {
  ok: "bg-[#0F8B8D]",
  warn: "bg-[#B7791F]",
  fail: "bg-[#C43D3D]",
  none: "bg-transparent border border-[#A9B4C4]",
};
const STATE_RING: Record<NodeState, string> = {
  ok: "border-[#0F8B8D]/45",
  warn: "border-[#B7791F]/60",
  fail: "border-[#C43D3D]/60",
  none: "border-dashed border-[#C7D0DC]",
};

interface FlowNode {
  key: string;
  label: string;
  evidenceKey: string;
  state: NodeState;
  evaluable: boolean;
}

function buildNodes(input: EvidenceInput, ruleIds: string[]): FlowNode[] {
  const byKey: Record<string, EvidenceItem> = Object.fromEntries(evidenceItems(input, ruleIds).map((i) => [i.key, i]));
  const st = (k: string): NodeState => byKey[k]?.state ?? "ok";
  const node = (key: string, label: string, evidenceKey: string, evaluable: boolean): FlowNode => ({
    key, label, evidenceKey, evaluable,
    state: evaluable ? st(evidenceKey) : "none",
  });
  return [
    node("device", "Device", "device", Boolean(input.deviceId)),
    node("qc", "Quality control", "qc", typeof input.qcPassed === "boolean"),
    node("reagent", "Reagent", "reagent", Boolean(input.reagentLot)),
    node("operator", "Operator", "op", Boolean(input.operatorId)),
    node("environment", "Environment", "env", input.temperatureC != null || input.humidityPct != null),
    node("provenance", "Provenance", "prov", Boolean(input.provenance)),
  ];
}

interface CapsuleProps {
  label: string;
  state?: NodeState;
  /** Extra mono note (e.g. "not evaluated", "state", "awaiting evaluation"). */
  note?: string;
  noteColor?: string;
  dark?: boolean;
  innerRef?: (el: HTMLSpanElement | null) => void;
}

function Capsule({
  label, state, note, noteColor, dark = false, innerRef, reached = false,
}: CapsuleProps & { reached?: boolean }) {
  const s = state ?? "none";
  return (
    <span
      ref={innerRef}
      className={`mono inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.06em] transition-shadow duration-200 ${
        dark
          ? "border-[#0B1F3A] bg-[#0B1F3A] text-white"
          : `bg-white ${state ? STATE_RING[s] : "border-[#C7D0DC]"} ${s === "none" && !noteColor ? "text-[#8A97A8]" : "text-[#132238]"}`
      } ${reached ? "ring-2 ring-[#1E5AA8]/40" : ""}`}
      style={!dark && noteColor ? { color: noteColor, borderColor: noteColor } : undefined}
      title={state ? STATE_TEXT[state] : note}
    >
      {state && !dark && <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[s]}`} />}
      {label}
      {note && (
        <>
          <span aria-hidden="true" className="opacity-50">·</span>
          <span style={noteColor ? { color: noteColor } : undefined}>{note}</span>
        </>
      )}
    </span>
  );
}

/**
 * Evidence Flow (Section 16). Horizontal on desktop, vertical on mobile. During an evaluation
 * a SINGLE 5px signal packet travels node to node (rAF over real layout centers, wrap-safe);
 * each node gains a soft ring as it is reached. Total travel ≈1.15 s, synced to the pipeline
 * budget. Idle: nodes quiet, lines static, no looping travel. Reduced motion: no packet.
 */
export function EvidenceFlow({
  input, ruleIds, status, running = false,
}: {
  input: EvidenceInput;
  ruleIds: string[];
  status?: Status | null;
  running?: boolean;
}) {
  const nodes = buildNodes(input, ruleIds);
  const reduced = useReducedMotion();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const packetRef = useRef<HTMLSpanElement | null>(null);
  const [reachedCount, setReachedCount] = useState(0);

  useEffect(() => {
    if (!running || reduced) return;
    if (typeof document !== "undefined" && document.hidden) return;
    const els = nodeRefs.current.filter((el): el is HTMLSpanElement => el !== null);
    const container = containerRef.current;
    if (els.length < 2 || !container) return;
    const base = container.getBoundingClientRect();
    const points = els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - base.left + r.width / 2, y: r.top - base.top + r.height / 2 };
    });
    const total = 1150;
    const start = performance.now();
    let frame = 0;
    const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / total);
      const scaled = easeInOut(t) * (points.length - 1);
      const i = Math.min(points.length - 2, Math.floor(scaled));
      const f = scaled - i;
      const x = points[i].x + (points[i + 1].x - points[i].x) * f;
      const y = points[i].y + (points[i + 1].y - points[i].y) * f;
      const el = packetRef.current;
      if (el) {
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
        el.style.opacity = "1";
      }
      setReachedCount((prev) => (Math.round(scaled + 1) > prev ? Math.round(scaled + 1) : prev));
      if (t < 1) frame = requestAnimationFrame(tick);
      else if (el) el.style.opacity = "0";
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      if (packetRef.current) packetRef.current.style.opacity = "0";
    };
  }, [running, reduced]);

  const connector = (k: string) => (
    <span key={k} className="w-px h-4 shrink-0 bg-[#DCE3EC] sm:h-px sm:w-auto sm:flex-1" aria-hidden="true" />
  );

  return (
    <section aria-label="Evidence flow" className="pt-card p-4">
      <h3 className="pt-label text-[#0B1F3A]">Evidence flow</h3>
      <p className="mt-1 text-xs text-[#607087]">
        One continuous story: recorded evidence feeds the evaluation and resolves into a reliability state.
      </p>
      <div
        ref={containerRef}
        className="relative mt-4 flex flex-col items-center sm:flex-row sm:flex-wrap sm:justify-center sm:gap-y-3"
      >
        {nodes.map((n, i) => (
          <span key={n.key} className="contents">
            {i > 0 && connector(`c-${i}`)}
            <Capsule
              label={n.label}
              state={running ? undefined : n.state}
              note={!running && !n.evaluable ? "not evaluated" : undefined}
              innerRef={(el) => { nodeRefs.current[i] = el; }}
              reached={running && reachedCount > i}
            />
          </span>
        ))}
        {connector("c-end")}
        <Capsule label="POC Trust" dark />
        {connector("c-state")}
        {status ? (
          <Capsule
            label={status.toUpperCase()}
            note="state"
            noteColor={status === "Trust" ? "#167A5A" : status === "Review" ? "#B7791F" : "#C43D3D"}
          />
        ) : (
          <Capsule label="Pending" note="awaiting evaluation" noteColor="#8A97A8" />
        )}
        {/* single signal packet, one dot, not a stream of particles */}
        <span
          ref={packetRef}
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 h-1.5 w-1.5 rounded-full bg-[#0F8B8D] opacity-0 shadow-[0_0_0_3px_rgba(15,139,141,0.25)]"
        />
      </div>
      <p className="sr-only">
        Evidence flow: device, quality control, reagent, operator, environment and provenance feed the POC Trust
        evaluation{status ? `, which resolved to ${status}` : ""}.
      </p>
      <p className="mt-3 text-[11px] text-[#607087]">
        Node states come from this assessment&apos;s recorded evidence; nodes with no recorded value are marked
        not evaluated rather than assumed.
      </p>
    </section>
  );
}

/**
 * Signal Map (spec section 24), communicates evidence → quality state → POC Trust → disposition
 * on a clean, fixed structure (never a force layout). Each node carries its precise evidence
 * quality state (VALID / AGING / EXPIRED / FAILED…), and links colour along the path so the
 * problematic nodes are visually linked into the decision. Hover/focus cross-links with the
 * evidence cards (shared highlight). Fully keyboard navigable; degrades to a plain list at
 * narrow widths with the same information.
 */
export function SignalMap({
  input, ruleIds, status, highlight, onHighlight,
}: {
  input: EvidenceInput;
  ruleIds: string[];
  status?: Status | null;
  highlight: string | null;
  onHighlight: (key: string | null) => void;
}) {
  const flow = buildNodes(input, ruleIds);
  const byKey = Object.fromEntries(flow.map((n) => [n.key, n]));
  const evidenceList = evidenceItems(input, ruleIds);
  const calItem = evidenceList.find((i) => i.key === "cal");
  const calState: NodeState = input.calibrationDueUtc ? (calItem?.state ?? "ok") : "none";
  // Precise evidence-quality word per node (VALID / AGING / EXPIRED / FAILED / MISSING…) ,
  // the SAME rule-first classification the integrity record uses, so map and record agree.
  const qualityWord = (evidenceKey: string | undefined): string | null => {
    if (!evidenceKey) return null;
    if (evidenceKey === "device") return qualityStateWord(qualityFor("device", input, ruleIds));
    const item = evidenceList.find((i) => i.key === evidenceKey);
    if (!item || item.state === "ok" && !item.contributed) return qualityStateWord(item?.quality ?? "valid");
    return qualityStateWord(item.quality);
  };

  interface MapNode {
    id: string; label: string; pos: [number, number];
    state?: NodeState; evaluable?: boolean; evidenceKey?: string; dark?: boolean; statusPill?: boolean;
  }
  const nodes: MapNode[] = [
    { id: "device", label: "Device", pos: [50, 7], state: byKey.device.state, evaluable: byKey.device.evaluable, evidenceKey: "device" },
    { id: "qc", label: "QC", pos: [15, 25], state: byKey.qc.state, evaluable: byKey.qc.evaluable, evidenceKey: "qc" },
    { id: "reagent", label: "Reagent", pos: [50, 25], state: byKey.reagent.state, evaluable: byKey.reagent.evaluable, evidenceKey: "reagent" },
    { id: "cal", label: "Calibration", pos: [85, 25], state: calState, evaluable: Boolean(input.calibrationDueUtc), evidenceKey: "cal" },
    { id: "op", label: "Operator", pos: [50, 43], state: byKey.operator.state, evaluable: byKey.operator.evaluable, evidenceKey: "op" },
    { id: "env", label: "Environment", pos: [50, 58], state: byKey.environment.state, evaluable: byKey.environment.evaluable, evidenceKey: "env" },
    { id: "prov", label: "Provenance", pos: [50, 73], state: byKey.provenance.state, evaluable: byKey.provenance.evaluable, evidenceKey: "prov" },
    { id: "poctrust", label: "POC Trust", pos: [50, 87], dark: true },
    { id: "state", label: status ? status.toUpperCase() : "Pending", pos: [50, 96], statusPill: true },
  ];
  const pos = (id: string) => nodes.find((n) => n.id === id)!.pos;
  const links: [string, string][] = [
    ["device", "qc"], ["device", "reagent"], ["device", "cal"],
    ["qc", "op"], ["reagent", "op"], ["cal", "op"],
    ["op", "env"], ["env", "prov"], ["prov", "poctrust"], ["poctrust", "state"],
  ];
  const nodeById = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const linkColor = (to: MapNode) => {
    if (to.statusPill) return status === "Trust" ? "#167A5A" : status === "Review" ? "#B7791F" : status === "Verify" ? "#C43D3D" : "#DCE3EC";
    if (to.state === "fail") return "#C43D3D";
    if (to.state === "warn") return "#B7791F";
    return "#DCE3EC";
  };
  const stateWord = (n: MapNode) => (n.evaluable === false || n.state === "none" ? "not evaluated" : STATE_TEXT[n.state as NodeState]);
  const pillColor = status ? (status === "Trust" ? "#167A5A" : status === "Review" ? "#B7791F" : "#C43D3D") : "#8A97A8";

  return (
    <section aria-label="Evidence health" className="pt-card p-4">
      <h3 className="pt-label text-[#0B1F3A]">Evidence health</h3>
      <p className="mt-1 text-xs text-[#607087]">
        Evidence → quality state → POC Trust → disposition. Problem nodes are coloured along the
        path into the decision, hover or focus a node.
      </p>

      <div className="relative mx-auto mt-3 hidden h-[470px] w-full max-w-[430px] sm:block" onMouseLeave={() => onHighlight(null)}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
          {links.map(([from, to], i) => {
            const [x1, y1] = pos(from);
            const [x2, y2] = pos(to);
            const color = linkColor(nodeById[to]);
            const strong = color !== "#DCE3EC";
            return (
              <line
                key={`${from}-${to}`}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={color}
                strokeWidth={strong ? 1.6 : 1}
                vectorEffect="non-scaling-stroke"
                pathLength={1}
                className="pt-draw"
                style={{ ["--d" as string]: `${i * 45}ms` }}
              />
            );
          })}
        </svg>
        {nodes.map((n, i) => {
          const isState = Boolean(n.statusPill);
          const active = n.evidenceKey != null && highlight === n.evidenceKey;
          const aria = n.dark
            ? "POC Trust evaluation"
            : isState
              ? `Resulting state: ${n.label}`
              : `${n.label}: ${stateWord(n)}${active ? ", highlighted" : ""}`;
          return (
            <button
              key={n.id}
              type="button"
              className={`mono absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.06em] pt-fade ${
                n.dark ? "border-[#0B1F3A] bg-[#0B1F3A] text-white" : "bg-white"
              } ${active ? "ring-2 ring-[#1E5AA8] ring-offset-1" : ""}`}
              style={{
                left: `${n.pos[0]}%`,
                top: `${n.pos[1]}%`,
                animationDelay: `${isState ? 500 : i * 55}ms`,
                ...(n.statusPill ? { color: pillColor, borderColor: pillColor } : undefined),
                ...(!n.dark && !n.statusPill && n.state && n.state !== "none"
                  ? { borderColor: n.state === "fail" ? "#C43D3D" : n.state === "warn" ? "#B7791F" : "#0F8B8D" }
                  : undefined),
                ...(!n.dark && !n.statusPill && (n.evaluable === false || n.state === "none")
                  ? { borderStyle: "dashed" as const, color: "#8A97A8" }
                  : undefined),
              }}
              aria-label={aria}
              onMouseEnter={() => onHighlight(n.evidenceKey ?? null)}
              onFocus={() => onHighlight(n.evidenceKey ?? null)}
              onBlur={() => onHighlight(null)}
            >
              {n.evidenceKey && n.state && n.state !== "none" && n.evaluable !== false && (
                <span aria-hidden="true" className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${STATE_DOT[n.state]}`} />
              )}
              {n.label}
              {(() => {
                const qw = qualityWord(n.evidenceKey);
                return n.evidenceKey && n.state && n.state !== "none" && n.evaluable !== false && qw
                  ? <span className="ml-1 opacity-60">· {qw}</span>
                  : null;
              })()}
            </button>
          );
        })}
      </div>

      {/* Narrow: clean list with identical information */}
      <ul className="mt-3 space-y-1.5 sm:hidden">
        {nodes.map((n) => (
          <li key={n.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-[#132238]">{n.dark ? "POC Trust" : n.label}</span>
            <span
              className={`mono ${n.statusPill ? "" : n.state === "fail" ? "text-[#C43D3D]" : n.state === "warn" ? "text-[#B7791F]" : "text-[#607087]"}`}
              style={n.statusPill ? { color: pillColor } : undefined}
            >
              {n.dark ? "evaluation" : n.statusPill ? n.label : stateWord(n)}
            </span>
          </li>
        ))}
      </ul>
      <p className="sr-only">
        Signal map of evidence health: {nodes.filter((n) => n.evidenceKey).map((n) => `${n.label} ${stateWord(n)}`).join("; ")}.
        Authoritative state: {status ?? "pending"}.
      </p>
    </section>
  );
}
