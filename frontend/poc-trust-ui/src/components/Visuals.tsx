import { statusName, type StatusCode } from "../types";
import { bandLeftPct, bandRightPct, markerPct, type Signal } from "../lib/signals";

/**
 * Small technical visualisations (Section 23): hairline axes, thin strokes, mono numerals,
 * draw-in once then static. Every visual carries a text alternative; decision colours appear
 * only where they encode decision states.
 */

const STATE_COLOR: Record<string, string> = { ok: "#167A5A", warn: "#B7791F", fail: "#C43D3D" };
const DECISION_COLOR: Record<"Trust" | "Review" | "Verify", string> = {
  Trust: "#167A5A",
  Review: "#B7791F",
  Verify: "#C43D3D",
};

/** Slim segmented distribution bar, TRUST | REVIEW | VERIFY, never a pie or donut. */
export function SegmentedBar({ counts }: { counts: { trust: number; review: number; verify: number; total: number } }) {
  const total = counts.total || 1;
  const segs = [
    ["Trust", counts.trust, DECISION_COLOR.Trust] as const,
    ["Review", counts.review, DECISION_COLOR.Review] as const,
    ["Verify", counts.verify, DECISION_COLOR.Verify] as const,
  ];
  return (
    <div>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-[#EDF1F6]"
        role="img"
        aria-label={`Reliability distribution: Trust ${counts.trust}, Review ${counts.review}, Verify ${counts.verify}`}
      >
        {segs.map(([label, n, color], i) => (
          <span
            key={label}
            className="h-full origin-left"
            style={{
              width: `${(n / total) * 100}%`,
              background: color,
              animation: "pt-grow var(--motion-decision) var(--ease-standard) both",
              animationDelay: `${i * 60}ms`,
            }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {segs.map(([label, n, color]) => (
          <span key={label} className="mono flex items-center gap-1.5 text-[11px] text-[#5B6B80]">
            <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: color }} />
            {label} <b className="tabnum text-[#132238]">{n}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Sparkline trend for one metric per day, draws in once, then completely static. */
export function Sparkline({ points, label }: { points: { day: string; value: number }[]; label: string }) {
  const w = 220;
  const h = 44;
  const max = Math.max(1, ...points.map((p) => p.value));
  const d = points
    .map((p, i) => {
      const x = points.length === 1 ? w / 2 : (i / (points.length - 1)) * (w - 4) + 2;
      const y = h - 4 - (p.value / max) * (h - 10);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const sum = points.reduce((a, p) => a + p.value, 0);
  return (
    <figure className="m-0">
      <figcaption className="pt-label text-[#607087]">{label}</figcaption>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="mt-1 h-11 w-full max-w-[240px]"
        role="img"
        aria-label={`${label}: ${points.map((p) => `${p.day} ${p.value}`).join(", ")}. Total ${sum}.`}
      >
        <line x1="0" y1={h - 2} x2={w} y2={h - 2} stroke="#E3E8EF" strokeWidth="1" />
        <path
          d={d}
          fill="none"
          stroke="#1E5AA8"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          className="pt-draw"
        />
      </svg>
      <p className="mono text-[10px] text-[#607087]">total {sum} over {points.length} days</p>
    </figure>
  );
}

/**
 * Evidence Signal rail (Section 8): hairline rail, tinted acceptable band, marker dot eased
 * into its real position on first reveal, mono value, plain-language note beneath.
 */
export function SignalRailViz({ signal, delay = 0 }: { signal: Signal; delay?: number }) {
  const color = STATE_COLOR[signal.state];
  return (
    <div className="pt-fade" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="pt-label text-[#5B6B80]">{signal.label}</span>
        <span className="mono text-sm font-semibold text-[#132238]">{signal.valueText}</span>
      </div>
      {signal.rail ? (
        <div className="relative mt-2 h-4" role="img" aria-label={`${signal.label}: ${signal.valueText}. ${signal.note}`}>
          {/* acceptable range band */}
          <span
            className="absolute top-1/2 h-3 -translate-y-1/2 rounded-sm"
            style={{
              left: `${bandLeftPct(signal.rail)}%`,
              right: `${bandRightPct(signal.rail)}%`,
              background: `${color}14`,
              borderTop: `1px solid ${color}33`,
              borderBottom: `1px solid ${color}33`,
            }}
          />
          {/* hairline rail */}
          <span className="absolute left-0 right-0 top-1/2 h-[2px] -translate-y-1/2 rounded bg-[#E3E8EF]" />
          {/* marker dot, eases in once, then stays still */}
          <span
            className="pt-marker-in absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm"
            style={{ left: `${markerPct(signal.rail)}%`, background: color, animationDelay: `${delay + 350}ms` }}
          />
        </div>
      ) : null}
      <p className="mt-1 text-xs text-[#607087]">{signal.note}</p>
    </div>
  );
}

export interface ArcSegment {
  key: string;
  label: string;
  state: "ok" | "warn" | "fail";
}

/**
 * Reliability Arc (Section 13): one segment per evidence category, drawn clockwise with a
 * stagger; the centre shows the authoritative state word, never an invented score.
 */
export function ReliabilityArc({
  segments, status, highlight, onHighlight,
}: {
  segments: ArcSegment[];
  status: StatusCode;
  highlight: string | null;
  onHighlight: (key: string | null) => void;
}) {
  const name = statusName(status);
  const size = 132;
  const r = 54;
  const cx = size / 2;
  const cy = size / 2;
  const n = Math.max(1, segments.length);
  const gapDeg = 7;
  const sweep = 360 / n;

  const polar = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" onMouseLeave={() => onHighlight(null)}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#EDF1F6" strokeWidth="7" />
          {segments.map((s, i) => {
            const start = i * sweep + gapDeg / 2;
            const end = (i + 1) * sweep - gapDeg / 2;
            const p0 = polar(start);
            const p1 = polar(end);
            const large = end - start > 180 ? 1 : 0;
            const active = highlight === s.key;
            return (
              <path
                key={s.key}
                d={`M${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A${r} ${r} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`}
                fill="none"
                stroke={STATE_COLOR[s.state]}
                strokeWidth={active ? 10 : 7}
                strokeLinecap="round"
                pathLength={1}
                className="pt-draw transition-[stroke-width] duration-150"
                style={{ ["--d" as string]: `${i * 50}ms` }}
                tabIndex={0}
                role="img"
                aria-label={`${s.label}: ${s.state === "ok" ? "passed" : s.state === "warn" ? "needs attention" : "failed"}`}
                onMouseEnter={() => onHighlight(s.key)}
                onFocus={() => onHighlight(s.key)}
                onBlur={() => onHighlight(null)}
              />
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={`text-xl font-bold tracking-[0.04em] ${name === "Trust" ? "text-[#167A5A]" : name === "Review" ? "text-[#B7791F]" : "text-[#C43D3D]"}`}
          >
            {name.toUpperCase()}
          </span>
          <span className="pt-label text-[#607087]">state</span>
        </div>
      </div>
      <ul className="sr-only">
        {segments.map((s) => (
          <li key={s.key}>{s.label}: {s.state === "ok" ? "passed" : s.state === "warn" ? "needs attention" : "failed"}</li>
        ))}
        <li>Authoritative state: {name}</li>
      </ul>
    </div>
  );
}
