import type { StepDomainState } from "../lib/pipeline";

/**
 * PipelineRail (Section 10) — a compact vertical rail, never a full-screen loader or modal.
 *
 * While the evaluation is in flight, steps advance as presentation motion over the real request.
 * When the authoritative decision arrives, every step paints its TRUE outcome: a domain that
 * surfaced a problem shows an attention or fail mark rather than a check — the rail can never
 * settle all-green for a REVIEW or VERIFY result. With reduced motion, states update instantly.
 */

export type RailOutcome = StepDomainState | "queued";

const ICON_BOX = "relative flex h-6 w-6 items-center justify-center";

function StepIcon({ state }: { state: "pending" | "active" | "ok" | "warn" | "fail" | "queued" }) {
  if (state === "pending") {
    return (
      <span className={ICON_BOX} aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="5.5" fill="none" stroke="#C7D0DC" strokeWidth="1.5" /></svg>
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className={ICON_BOX} aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 18 18">
          <circle cx="9" cy="9" r="8" fill="none" stroke="#1E5AA8" strokeOpacity="0.3" strokeWidth="1.5" />
          <circle cx="9" cy="9" r="4.5" fill="#1E5AA8" />
        </svg>
      </span>
    );
  }
  if (state === "queued") {
    return (
      <span className={ICON_BOX} aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 18 18">
          <circle cx="9" cy="9" r="5.5" fill="none" stroke="#1E5AA8" strokeWidth="1.5" strokeDasharray="2 2.5" />
          <circle cx="9" cy="9" r="2" fill="#1E5AA8" />
        </svg>
      </span>
    );
  }
  if (state === "warn") {
    return (
      <span className={ICON_BOX} aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 18 18">
          <circle cx="9" cy="9" r="6.5" fill="#FFF7E6" stroke="#B7791F" strokeWidth="1.5" />
          <path d="M9 5.5v4" stroke="#B7791F" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="9" cy="12.2" r="1" fill="#B7791F" />
        </svg>
      </span>
    );
  }
  if (state === "fail") {
    return (
      <span className={ICON_BOX} aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 18 18">
          <circle cx="9" cy="9" r="6.5" fill="#FDEEEE" stroke="#C43D3D" strokeWidth="1.5" />
          <path d="M6.6 6.6l4.8 4.8M11.4 6.6l-4.8 4.8" stroke="#C43D3D" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  // complete check — draws in with stroke-dashoffset (~180ms)
  return (
    <span className={ICON_BOX} aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 18 18">
        <circle cx="9" cy="9" r="7.5" fill="#EAF7F1" stroke="#167A5A" strokeWidth="1.2" />
        <path d="M5.6 9.2l2.4 2.4 4.4-5" fill="none" stroke="#167A5A" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="pt-check-draw" />
      </svg>
    </span>
  );
}

const OUTCOME_WORD: Record<RailOutcome, string> = {
  ok: "passed",
  warn: "attention noted",
  fail: "problem found",
  queued: "queued",
};

export function PipelineRail({
  steps, index, outcomes, settling = false,
}: {
  steps: { key: string; label: string }[];
  /** Highest step reached while running (0-based). */
  index: number;
  /** Authoritative per-step outcomes — present only once the decision is known. */
  outcomes?: Record<string, RailOutcome> | null;
  /** Dim for the ~100 ms settle before the decision reveal (Section 11). */
  settling?: boolean;
}) {
  const stateFor = (i: number): "pending" | "active" | "ok" | "warn" | "fail" | "queued" => {
    if (outcomes) return outcomes[steps[i].key] ?? "ok";
    if (i < index) return "ok";
    if (i === index) return "active";
    return "pending";
  };
  const reached = (i: number) => Boolean(outcomes) || i < index;
  const liveText = outcomes
    ? "Evaluation complete — every step shows its recorded outcome."
    : index >= 0 && index < steps.length
      ? `Step ${index + 1} of ${steps.length}: ${steps[index].label}`
      : "Preparing evaluation";

  return (
    <section
      aria-label="Assessment pipeline"
      className={`pt-card p-4 transition-opacity duration-100 ${settling ? "opacity-70" : "opacity-100"}`}
    >
      <h3 className="pt-label text-[#0B1F3A]">Evaluation pipeline</h3>
      <p className="mt-1 text-xs text-[#607087]">
        {outcomes
          ? "Each step shows the outcome recorded for this decision — concerns are never hidden behind a green tick."
          : "Running the deterministic checks — evidence → rules → decision."}
      </p>
      <ol className="mt-3">
        {steps.map((s, i) => {
          const st = stateFor(i);
          return (
            <li
              key={s.key}
              className="pt-stagger relative grid grid-cols-[24px_1fr] gap-x-3 pb-3 last:pb-0"
              style={{ ["--d" as string]: `${i * 50}ms` }}
              aria-current={st === "active" ? "step" : undefined}
            >
              {i < steps.length - 1 && (
                <span className="absolute left-[11px] top-6 h-[calc(100%-8px)] w-[2px] overflow-hidden rounded" aria-hidden="true">
                  <span className="absolute inset-0 bg-[#E3E8EF]" />
                  <span
                    className="absolute inset-0 origin-top bg-gradient-to-b from-[#0B1F3A] via-[#1E5AA8] to-[#0F8B8D] transition-transform duration-200"
                    style={{ transform: reached(i) ? "scaleY(1)" : "scaleY(0)" }}
                  />
                </span>
              )}
              <span className="relative z-10 flex h-6 items-center justify-center rounded-full bg-white">
                <StepIcon state={st} />
              </span>
              <span className={`flex flex-wrap items-baseline gap-x-2 pt-1 text-sm ${st === "pending" ? "text-[#8A97A8]" : "text-[#132238]"}`}>
                {s.label}
                {outcomes && outcomes[s.key] && outcomes[s.key] !== "ok" && (
                  <span className={`pt-label ${outcomes[s.key] === "fail" ? "text-[#C43D3D]" : outcomes[s.key] === "queued" ? "text-[#1E5AA8]" : "text-[#B7791F]"}`}>
                    {OUTCOME_WORD[outcomes[s.key]]}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      <p role="status" aria-live="polite" className="sr-only">{liveText}</p>
    </section>
  );
}
