import type { Decision } from "../types";
import { statusName } from "../types";

export function ContextualAnalysis({ decision }: { decision: Decision }) {
  // VERIFY hard-stop: NO Contextual Analysis panel is rendered at all — not hidden, absent
  // (Section 26). REVIEW keeps a persistent line that the deterministic state remains authoritative.
  if (!decision.aiConsulted || !decision.aiAssessment) return null;
  if (statusName(decision.finalStatus) === "Verify") return null;
  const ai = decision.aiAssessment;
  const anomalies = ai.anomalies ?? [];
  const isReview = statusName(decision.finalStatus) === "Review";
  // Only metadata that actually arrived with this decision is shown. Historical records persist the
  // advisory summary alone, so no confidence score or model name is invented for them.
  const meta = [
    ai.recommendedAction ? `Suggested review: ${ai.recommendedAction}` : "",
    typeof ai.confidence === "number" ? `confidence ${ai.confidence}` : "",
    ai.model ? `model ${ai.model}` : "",
  ].filter(Boolean);

  return (
    <section aria-label="Contextual analysis" className="pt-fade rounded-xl border border-[#0F8B8D]/40 bg-[#EAF7F7] px-4 py-3">
      <h3 className="font-semibold text-[#0B1F3A]">Contextual Analysis</h3>
      <p className="text-xs text-[#607087]">AI-assisted explanation based on recorded quality evidence — advisory only, below deterministic reasoning.</p>
      <p className="mt-2 text-sm text-[#132238]">{ai.summary}</p>
      {anomalies.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-sm text-[#132238]">
          {anomalies.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      )}
      {isReview && (
        <p className="mt-2 rounded-md border border-[#B7791F]/40 bg-[#FFF7E6] px-3 py-1.5 text-xs font-semibold text-[#8A6216]">
          Review remains the authoritative decision — this note does not change it.
        </p>
      )}
      {meta.length > 0 ? (
        <p className="mt-1 text-xs text-[#607087]">{meta.join(" · ")}</p>
      ) : (
        <p className="mt-1 text-xs text-[#607087]">Stored record keeps the advisory summary only — no confidence score or model name was persisted for this assessment.</p>
      )}
    </section>
  );
}

export function AiFallback({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p role="note" className="rounded-lg border border-[#DCE3EC] bg-white px-3 py-2 text-xs text-[#607087]">
      Contextual analysis unavailable — deterministic result retained. No safety impact.
    </p>
  );
}
