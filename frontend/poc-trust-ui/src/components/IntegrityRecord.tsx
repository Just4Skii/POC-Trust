
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import { StatusBadge } from "./StatusBadge";

import { evidenceStateLocal, formatEventTimeLocal } from "../i18n/strings";
import {
  coverageGlyph, evidenceSources, parseRir, qualityConcerns, rirDispositionStatus, stateTone,
  type RirCausality, type RirDomain, type RirRecord,
} from "../lib/rir";

/**
 * The Result Integrity Record, the central artefact of POC Trust.
 *
 * Everything shown comes from the backend derivation over the STORED assessment (spec section 4:
 * "The exact values must come from the actual assessment record. DO NOT hard-code a fake
 * UI-only RIR."). While an offline-pending event has not reached the store yet, the record
 * shows its designed waiting state instead of inventing data.
 *
 * Progressive disclosure (spec section 18): the compact RESULT INTEGRITY summary card is always
 * visible; decision drivers and conflicts follow; the full document (provenance, policy, audit)
 * stays behind the [Inspect Integrity Record] toggle.
 */

export type RirLoad =
  | { kind: "loading" }
  | { kind: "ready"; record: RirRecord }
  | { kind: "pending" }
  | { kind: "error"; message: string };

export function useIntegrityRecord(id: string): RirLoad {
  const [load, setLoad] = useState<RirLoad>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    setLoad({ kind: "loading" });
    api
      .integrityRecord(id)
      .then((raw) => {
        if (!alive) return;
        const record = parseRir(raw);
        if (record) setLoad({ kind: "ready", record });
        else setLoad({ kind: "error", message: "The integrity record could not be read." });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 404) setLoad({ kind: "pending" });
        else if (err instanceof ApiError) setLoad({ kind: "error", message: err.message });
        else setLoad({ kind: "error", message: "The integrity record service could not be reached." });
      });
    return () => {
      alive = false;
    };
  }, [id]);

  return load;
}

// ── Summary card (spec section 19) + policy chip (section 22) ───────────────

export function ResultIntegritySummary({
  load, open, onToggle,
}: {
  load: RirLoad;
  open: boolean;
  onToggle: () => void;
}) {
  const [policyOpen, setPolicyOpen] = useState(false);

  if (load.kind !== "ready") {
    return (
      <section aria-label="Result integrity" className="pt-card p-5">
        <SummaryHeading />
        {load.kind === "loading" && <div className="mt-3 skeleton h-24 rounded-lg" aria-hidden="true" />}
        {load.kind === "pending" && (
          <p className="mt-3 rounded-lg border border-[#DCE3EC] bg-[#F7F9FC] px-4 py-3 text-sm text-[#607087]">
            The Result Integrity Record is created by the pipeline when the event is evaluated and
            stored. This event has not reached the store yet, the record appears here once it has
            been synchronised. No record is invented in the meantime.
          </p>
        )}
        {load.kind === "error" && (
          <p role="alert" className="mt-3 rounded-lg border border-[#F3D6D6] bg-[#FDEEEE] px-4 py-3 text-sm text-[#C43D3D]">
            {load.message} The evidence sections below remain available.
          </p>
        )}
      </section>
    );
  }

  const r = load.record;
  const status = rirDispositionStatus(r);
  const q = r.evidenceQuality;
  const concerns = qualityConcerns(r);

  return (
    <section aria-label="Result integrity" className="pt-card-2 p-5 pt-fade">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SummaryHeading />
        <PolicyChip record={r} open={policyOpen} onToggle={() => setPolicyOpen((o) => !o)} />
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Evidence" value={`${q.coverage.requiredAvailable} / ${q.coverage.requiredTotal}`} note="required available" />
        <Metric
          label="Quality"
          value={concerns.count === 0 ? "No concerns" : `${concerns.count} concern${concerns.count === 1 ? "" : "s"}`}
          note={concerns.breakdown || "all evidence current"}
          tone={concerns.count === 0 ? undefined : "warn"}
        />
        <Metric
          label="Consistency"
          value={q.conflictCount === 0 ? "No conflicts" : `${q.conflictCount} conflict${q.conflictCount === 1 ? "" : "s"}`}
          note={q.conflictCount === 0 ? "sources agree" : "detected inconsistency"}
          tone={q.conflictCount === 0 ? undefined : "warn"}
        />
        <Metric label="Traceability" value={q.traceability} note="sealed audit reference" />
        <div className={`rounded-lg border p-3 ${dispositionTone(r.disposition)}`}>
          <p className="pt-label text-[#8A97A8]">Disposition</p>
          <p className="mt-1 flex items-center gap-2 font-bold text-[#132238]">
            {status && <StatusBadge value={status} size="sm" />}
            {!status && r.disposition}
          </p>
          <p className="mt-1 text-xs text-[#607087]">{r.dispositionStatement}</p>
        </div>
      </div>

      {policyOpen && <PolicyPanel record={r} />}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={onToggle}
          aria-expanded={open}
          className="pt-action min-h-[44px] rounded-md bg-[#0B1F3A] px-4 py-2 text-sm font-semibold text-white hover:bg-[#13294a]"
        >
          {open ? "Hide Integrity Record" : "Inspect Integrity Record"}
        </button>
        <span className="text-xs text-[#607087]">
          Full provenance, policy context and the sealed audit reference live in the record document.
        </span>
      </div>
    </section>
  );
}

function SummaryHeading() {
  return (
    <div>
      <h3 className="pt-label text-[#0B1F3A]">Result integrity</h3>
      <p className="mt-0.5 text-xs text-[#607087]">
        Evidence-linked, policy-aware, derived from the stored assessment, never re-decided.
      </p>
    </div>
  );
}

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "warn" }) {
  return (
    <div className={`rounded-lg border p-3 ${tone === "warn" ? "border-[#B7791F]/40 bg-[#FFF7E6]/60" : "border-[#DCE3EC] bg-white"}`}>
      <p className="pt-label text-[#8A97A8]">{label}</p>
      <p className="mt-1 text-sm font-semibold text-[#132238]">{value}</p>
      <p className="mt-0.5 text-xs text-[#607087]">{note}</p>
    </div>
  );
}

function PolicyChip({ record, open, onToggle }: { record: RirRecord; open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      title="How does this assessment know what evidence matters?"
      className="mono inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-[#0B1F3A]/30 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#0B1F3A] hover:bg-[#F7F9FC]"
    >
      <span aria-hidden="true" className="rounded bg-[#0B1F3A] px-1.5 py-0.5 text-[9px] text-white">Policy</span>
      {record.policy.name} · {record.policy.kind}
      <span aria-hidden="true" className={`transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
    </button>
  );
}

function PolicyPanel({ record }: { record: RirRecord }) {
  const p = record.policy;
  return (
    <div className="pt-fade mt-4 rounded-lg border border-[#DCE3EC] bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-bold text-[#132238]">{p.name}</p>
        <p className="mono text-[10px] text-[#607087]">{p.id || "policy"} · v{p.version} · {p.kind}</p>
      </div>
      <p className="mt-1 text-xs text-[#607087]">{p.note}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="pt-label text-[#8A97A8]">Required evidence</p>
          <p className="mt-1 text-sm text-[#132238]">
            {p.requiredDomains.map((d) => domainLabel(record, d)).join(" · ") || "·"}
          </p>
          <p className="mt-1 text-xs text-[#607087]">
            These set the coverage denominator: what the assessment expects to find.
          </p>
        </div>
        <div>
          <p className="pt-label text-[#8A97A8]">Contextual evidence</p>
          <p className="mt-1 text-sm text-[#132238]">
            {p.contextualDomains.length > 0
              ? p.contextualDomains.map((d) => domainLabel(record, d)).join(" · ")
              : "None in this policy"}
          </p>
          <p className="mt-1 text-xs text-[#607087]">
            Monitored when recorded; still rule-relevant when the deterministic engine evaluates them.
          </p>
        </div>
      </div>
      {p.freshnessWindows.length > 0 && (
        <p className="mt-3 text-xs text-[#607087]">
          Freshness configuration:{" "}
          {p.freshnessWindows.map((w) => `${domainLabel(record, w.domain)}, ${w.boundary.toLowerCase()} ${w.days} days`).join(" · ")}
        </p>
      )}
      {p.supportedEnvironment.length > 0 && (
        <p className="mt-1 text-xs text-[#607087]">
          Supported environment:{" "}
          {p.supportedEnvironment.map((g) => `${g.measure.toLowerCase()} ${g.minimum}–${g.maximum} ${g.unit}`).join(" · ")}
        </p>
      )}
      <p className="mt-3 rounded-md bg-[#F7F9FC] px-3 py-2 text-xs text-[#607087]">
        <b className="text-[#132238]">How does this assessment know what evidence matters?</b> {p.selectionNote}
        {" "}The policy states what is expected; the deterministic rules alone map evidence to the
        disposition, and it gives the advisory AI no authority.
      </p>
    </div>
  );
}

function domainLabel(record: RirRecord, domain: string): string {
  const row = record.domains.find((d) => d.domain === domain);
  return row?.label ?? domain.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function dispositionTone(disposition: string): string {
  return disposition === "Trust"
    ? "border-[#167A5A]/40 bg-[#EAF7F1]"
    : disposition === "Verify"
      ? "border-[#C43D3D]/40 bg-[#FDEEEE]"
      : "border-[#B7791F]/40 bg-[#FFF7E6]";
}

// ── Decision drivers + conflicts + counterfactual (sections 10/12/14/21) ────

export function DecisionDriversPanel({ load }: { load: RirLoad }) {
  if (load.kind !== "ready") return null;
  const r = load.record;
  const causality = r.causality;

  return (
    <section aria-label="Decision drivers" className="pt-card p-5">
      <h3 className="pt-label text-[#0B1F3A]">Decision drivers</h3>
      <p className="mt-1 text-xs text-[#607087]">
        Why this disposition occurred, derived from the deterministic engine&apos;s recorded findings.
        Roles are qualitative (primary / secondary / informational); no numeric weights exist in this system.
      </p>

      {causality && <ConflictCards conflicts={r.conflicts} />}

      {causality && causality.verified ? (
        <div className="mt-4 space-y-4">
          <DriverGroup
            roleLabel="Primary driver"
            emptyText="No adverse primary driver, the disposition rests on the evidence below."
            drivers={causality.primaryDrivers}
            bar="primary"
          />
          <DriverGroup
            roleLabel="Secondary considerations"
            emptyText="None, no lower-severity concerns were recorded alongside the primary driver."
            drivers={causality.secondaryConsiderations}
            bar="secondary"
          />
          <DriverGroup
            roleLabel="Contextual (did not drive the decision)"
            emptyText=""
            drivers={causality.contextualNotes}
            bar="informational"
          />
          {causality.counterfactual && <CounterfactualBlock cf={causality.counterfactual} />}
          <p className="text-[11px] text-[#607087]">{causality.derivationNote}</p>
        </div>
      ) : (
        <div className="mt-4">
          <p className="pt-label text-[#8A97A8]">Recorded reasons</p>
          {r.decisionDrivers.length === 0 ? (
            <p className="mt-1 text-sm text-[#607087]">No deterministic findings were recorded for this assessment.</p>
          ) : (
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-[#132238]">
              {r.decisionDrivers.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function DriverGroup({
  roleLabel, drivers, bar, emptyText,
}: {
  roleLabel: string;
  drivers: RirCausality["primaryDrivers"];
  bar: "primary" | "secondary" | "informational";
  emptyText: string;
}) {
  return (
    <div>
      <p className="pt-label text-[#8A97A8]">{roleLabel}</p>
      {drivers.length === 0 ? (
        emptyText ? <p className="mt-1 text-sm text-[#607087]">{emptyText}</p> : null
      ) : (
        <ul className="mt-2 space-y-2">
          {drivers.map((d, i) => (
            <li key={`${d.ruleId}-${i}`} className="rounded-lg border border-[#DCE3EC] bg-white px-3 py-2">
              <span
                aria-hidden="true"
                className={
                  bar === "primary"
                    ? "block h-1.5 w-full rounded-full bg-[#0B1F3A]"
                    : bar === "secondary"
                      ? "block h-1.5 w-2/3 rounded-full bg-[#1E5AA8]/70"
                      : "block h-0 border-t border-dashed border-[#8A97A8]"
                }
              />
              <p className="mt-2 text-sm font-semibold text-[#132238]">{d.statement}</p>
              <p className="mt-0.5 text-xs text-[#607087]">
                {d.domainLabel}
                {d.domainLabel && d.evidenceState ? " · " : ""}
                {d.evidenceState && <span className="uppercase tracking-wide">{d.evidenceState.replace("-", " ")}</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConflictCards({ conflicts }: { conflicts: RirRecord["conflicts"] }) {
  if (conflicts.length === 0) return null;
  return (
    <div className="mt-4" role="note" aria-label="Evidence conflict">
      <p className="mono inline-block rounded bg-[#1E5AA8] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-white">
        Evidence conflict
      </p>
      <ul className="mt-2 space-y-2">
        {conflicts.map((c, i) => (
          <li key={i} className="rounded-lg border border-[#1E5AA8]/40 bg-[#EAF2FB] p-3">
            <p className="text-sm font-semibold text-[#132238]">{c.conflict}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="rounded-md border border-[#DCE3EC] bg-white px-3 py-2">
                <p className="pt-label text-[#8A97A8]">Source A</p>
                <p className="mt-0.5 text-sm font-semibold text-[#132238]">{c.sourceA}</p>
                <p className="mono text-[10px] uppercase tracking-wide text-[#1E5AA8]">{c.sourceAState}</p>
              </div>
              <div className="rounded-md border border-[#DCE3EC] bg-white px-3 py-2">
                <p className="pt-label text-[#8A97A8]">Source B</p>
                <p className="mt-0.5 text-sm font-semibold text-[#132238]">{c.sourceB}</p>
                <p className="mono text-[10px] uppercase tracking-wide text-[#C43D3D]">{c.sourceBState}</p>
              </div>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[#132238]">
              <b>Why it matters:</b> {c.whyItMatters}
            </p>
            <p className="mt-1 text-[11px] text-[#607087]">
              This is a detected evidence inconsistency about the operating context: it states that two
              recorded sources disagree, nothing more.
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CounterfactualBlock({ cf }: { cf: NonNullable<RirCausality["counterfactual"]> }) {
  return (
    <div className="rounded-lg border border-[#0F8B8D]/35 bg-[#F2FAFA] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono rounded bg-[#0F8B8D] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-white">
          {cf.label || "Deterministic decision comparison"}
        </span>
        <span className="mono text-[10px] uppercase tracking-[0.08em] text-[#0F8B8D]">{cf.method || "Rule-based counterfactual"}</span>
      </div>
      <div className="mt-3 grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <div className="rounded-md border border-[#C43D3D]/40 bg-[#FDEEEE] px-3 py-2 text-center">
          <p className="pt-label text-[#8A97A8]">Current</p>
          <p className="mono text-sm font-bold text-[#C43D3D]">{cf.currentDisposition}</p>
        </div>
        <span aria-hidden="true" className="text-center text-lg text-[#607087]">→</span>
        <div className="rounded-md border border-[#B7791F]/40 bg-[#FFF7E6] px-3 py-2 text-center">
          <p className="pt-label text-[#8A97A8]">Counterfactual</p>
          <p className="mono text-sm font-bold text-[#8A6116]">{cf.counterfactualDisposition}</p>
        </div>
      </div>
      <p className="mt-3 text-sm font-semibold text-[#132238]">{cf.statement}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-[#607087]">{cf.change} {cf.basisNote}</p>
    </div>
  );
}

// ── Integrity timeline (spec section 13) ────────────────────────────────────

export function IntegrityTimelinePanel({ load }: { load: RirLoad }) {
  if (load.kind !== "ready") return null;
  const timeline = load.record.timeline;
  if (!timeline) return null;
  const isDemoHistory = timeline.label === "Demonstration decision history";

  return (
    <section aria-label="Integrity timeline" className="pt-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="pt-label text-[#0B1F3A]">Integrity timeline</h3>
        {isDemoHistory && (
          <span className="mono rounded-full border border-[#E7B25C]/70 bg-[#FFF7E6] px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.09em] text-[#8A6116]">
            Demonstration decision history
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-[#607087]">{timeline.note}</p>

      <ol className="mt-4 space-y-0">
        {timeline.entries.map((e, i) => {
          const tone = e.evidenceState ? stateTone(e.evidenceState) : null;
          const last = i === timeline.entries.length - 1;
          return (
            <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
              {!last && <span aria-hidden="true" className="absolute left-[7px] top-4 h-full w-px bg-[#DCE3EC]" />}
              <span
                aria-hidden="true"
                className={`relative z-10 mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 bg-white ${
                  e.kind === "decision"
                    ? e.disposition === "TRUST"
                      ? "border-[#167A5A]"
                      : e.disposition === "VERIFY"
                        ? "border-[#C43D3D]"
                        : "border-[#B7791F]"
                    : e.kind === "transition"
                      ? "border-[#1E5AA8]"
                      : tone
                        ? "border-current"
                        : "border-[#8A97A8]"
                }`}
                style={tone && e.kind !== "decision" && e.kind !== "transition" ? { borderColor: tone.dot } : undefined}
              />
              <div className="min-w-0 flex-1">
                <p className="mono text-[10px] text-[#8A97A8]">
                  {formatEventTimeLocal(e.timeUtc)}
                  <span className="ml-2 rounded bg-[#F0F3F8] px-1.5 py-0.5 text-[9px] uppercase tracking-wide">
                    {e.basis === "demo-history" ? "demo sequence" : e.basis}
                  </span>
                </p>
                <p className="mt-0.5 text-sm font-semibold text-[#132238]">
                  {e.title}
                  {e.transition && (
                    <span className="mono ml-2 rounded bg-[#EAF2FB] px-1.5 py-0.5 text-[10px] font-semibold text-[#1E5AA8]">
                      {e.transition}
                    </span>
                  )}
                </p>
                {e.detail && <p className="mt-0.5 text-xs leading-relaxed text-[#607087]">{e.detail}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 border-t border-[#DCE3EC] pt-2 text-[11px] text-[#607087]">
        Decision causality made visible: each entry states where it comes from, recorded, derived from
        the policy windows, or part of the labelled demonstration sequence.
      </p>
    </section>
  );
}

// ── Full record document (provenance / policy / audit) ──────────────────────

export function IntegrityRecordDocument({
  load, open, onToggle,
}: {
  load: RirLoad;
  open: boolean;
  onToggle: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const record = load.kind === "ready" ? load.record : null;
  const canonicalJson = useMemo(() => (record ? JSON.stringify(record, null, 2) : null), [record]);

  function download() {
    if (!canonicalJson) return;
    const blob = new Blob([canonicalJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `result-integrity-record-${record?.assessmentId ?? "record"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    if (!canonicalJson) return;
    try {
      await navigator.clipboard.writeText(canonicalJson);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable, the download button remains the portability path */
    }
  }

  if (!open || load.kind !== "ready") {
    return open && load.kind === "pending" ? (
      <section aria-label="Result Integrity Record" className="pt-card p-5">
        <RecordHeading />
        <p className="mt-3 rounded-lg border border-[#DCE3EC] bg-[#F7F9FC] px-4 py-3 text-sm text-[#607087]">
          The Result Integrity Record is created by the pipeline when the event is evaluated and
          stored. This event has not reached the store yet, no record is invented in the meantime.
        </p>
      </section>
    ) : null;
  }

  const r = record!;
  const status = rirDispositionStatus(r);
  const tone = stateToneSafeForDisposition(r.disposition);
  const q = r.evidenceQuality;
  const dimensions: [string, string][] = [
    ["Coverage", q.coverage.statement],
    ["Freshness", q.freshness],
    ["Consistency", q.consistency],
    ["Traceability", q.traceability],
  ];

  return (
    <section aria-label="Result Integrity Record" id="pt-integrity-record" className="pt-card-2 p-5 pt-fade">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <RecordHeading />
        <div className="flex flex-wrap gap-2">
          <button
            onClick={download}
            className="pt-action min-h-[44px] rounded-md border border-[#0B1F3A] bg-white px-3 py-2 text-sm font-semibold text-[#0B1F3A] hover:bg-[#F7F9FC]"
          >
            Download record (JSON)
          </button>
          <button
            onClick={copy}
            className="pt-action min-h-[44px] rounded-md border border-[#DCE3EC] bg-white px-3 py-2 text-sm font-semibold text-[#607087] hover:bg-[#F7F9FC]"
          >
            {copied ? "Copied" : "Copy record"}
          </button>
          <button
            onClick={onToggle}
            aria-expanded={open}
            className="pt-action min-h-[44px] rounded-md border border-[#DCE3EC] bg-white px-3 py-2 text-sm font-semibold text-[#607087] hover:bg-[#F7F9FC]"
          >
            Collapse
          </button>
        </div>
      </div>

      {/* Identity */}
      <div className="mt-4 grid gap-3 rounded-lg border border-[#DCE3EC] bg-white p-4 sm:grid-cols-3">
        <div>
          <p className="pt-label text-[#607087]">Result</p>
          <p className="mt-1 font-semibold text-[#132238]">{r.result}</p>
        </div>
        <div>
          <p className="pt-label text-[#607087]">Test</p>
          <p className="mt-1 font-semibold text-[#132238]">Point-of-care {r.testType}</p>
        </div>
        <div>
          <p className="pt-label text-[#607087]">Event</p>
          <p className="mt-1 font-semibold text-[#132238]">{formatEventTimeLocal(r.eventTimeUtc)}</p>
        </div>
      </div>

      {/* Disposition */}
      <div className={`mt-4 rounded-lg border-2 ${tone.border} ${tone.bg} p-4`}>
        <div className="flex flex-wrap items-center gap-3">
          {status && <StatusBadge value={status} size="md" />}
          {!status && <span className="font-bold text-[#132238]">{r.disposition}</span>}
          <p className="font-semibold text-[#132238]">{r.dispositionStatement}</p>
        </div>
        <p className="mt-2 text-xs text-[#607087]">
          Integrity disposition, an operational decision about reliance under the selected
          demonstration policy, derived from the evidence below.
        </p>
      </div>

      {/* Evidence quality */}
      <div className="mt-4">
        <p className="pt-label text-[#607087]">Evidence quality</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {dimensions.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-[#DCE3EC] bg-white p-3">
              <p className="pt-label text-[#8A97A8]">{label}</p>
              <p className="mt-1 text-sm font-semibold text-[#132238]">{value}</p>
            </div>
          ))}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Evidence coverage by required domain">
          {q.coverage.items.map((item) => (
            <li key={item.domain} className="flex items-center gap-1.5 text-[#132238]">
              <span aria-hidden="true" className={item.available ? "font-bold text-[#167A5A]" : "font-bold text-[#B7791F]"}>
                {coverageGlyph(item)}
              </span>
              {item.label}
            </li>
          ))}
        </ul>
      </div>

      {/* Evidence domains, state, source, freshness, contribution (spec section 20) */}
      <div className="mt-4">
        <p className="pt-label text-[#607087]">Evidence domains</p>
        <ul className="mt-2 divide-y divide-[#DCE3EC] rounded-lg border border-[#DCE3EC] bg-white">
          {r.domains.map((d) => (
            <DomainRow
              key={d.domain}
              domain={d}
              expanded={expandedRow === d.domain}
              onToggle={() => setExpandedRow((cur) => (cur === d.domain ? null : d.domain))}
            />
          ))}
        </ul>
      </div>

      {/* Recorded reason sentences (the structured drivers are shown in the drivers panel) */}
      <div className="mt-4">
        <p className="pt-label text-[#607087]">Decision drivers (recorded reasons)</p>
        {r.decisionDrivers.length === 0 ? (
          <p className="mt-1 text-sm text-[#607087]">No deterministic findings were recorded for this assessment.</p>
        ) : (
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-[#132238]">
            {r.decisionDrivers.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        )}
      </div>

      {/* Recommended action */}
      <div className="mt-4 rounded-lg border border-[#0B1F3A]/20 bg-[#F7F9FC] p-4">
        <p className="pt-label text-[#607087]">Recommended action</p>
        <p className="mt-1 text-sm font-semibold text-[#132238]">{r.recommendedAction}</p>
      </div>

      {/* Provenance: where the evidence came from */}
      <div className="mt-4">
        <p className="pt-label text-[#607087]">Provenance</p>
        <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Evidence sources">
          {evidenceSources(r).map((s) => (
            <li key={s} className="rounded bg-white px-2 py-0.5 text-xs font-medium text-[#607087] ring-1 ring-[#DCE3EC]">
              {s}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-[#607087]">
          Verification wording is deliberate: identities are recorded claims (as claimed), not
          authenticated identities, and no cryptographic provenance is fabricated beyond the sealed
          audit trail itself.
        </p>
      </div>

      {/* Demonstration policy context */}
      <div className="mt-4 rounded-lg border border-[#DCE3EC] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="pt-label text-[#607087]">Policy applied</p>
          <PolicyChipStatic record={r} />
        </div>
        <p className="mt-1 text-sm font-semibold text-[#132238]">
          {r.policy.name} · {r.policy.version}
        </p>
        <p className="mt-1 text-xs text-[#607087]">{r.policy.selectionNote}</p>
        <p className="mt-1 text-xs text-[#607087]">{r.policy.note}</p>
        {r.policy.freshnessWindows.length > 0 && (
          <p className="mt-1.5 text-xs text-[#607087]">
            Freshness boundaries:{" "}
            {r.policy.freshnessWindows.map((w) => `${domainLabel(r, w.domain)} ${w.boundary.toLowerCase()} ${w.days} days`).join(" · ")}
          </p>
        )}
        {r.policy.supportedEnvironment.length > 0 && (
          <p className="mt-1 text-xs text-[#607087]">
            Supported environment:{" "}
            {r.policy.supportedEnvironment.map((g) => `${g.minimum}–${g.maximum} ${g.unit} ${g.measure.toLowerCase()}`).join(" · ")}
          </p>
        )}
      </div>

      {/* Advisory context */}
      {r.aiContext.consulted && (
        <div className="mt-4 rounded-lg border border-[#0F8B8D]/30 bg-[#EAF7F7] p-4">
          <p className="pt-label text-[#0F8B8D]">Contextual note (advisory)</p>
          {r.aiContext.summary && <p className="mt-1 text-sm text-[#132238]">{r.aiContext.summary}</p>}
          <p className="mt-1 text-xs text-[#607087]">{r.aiContext.note}</p>
        </div>
      )}

      {/* Audit */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#DCE3EC] bg-white p-4">
        <div>
          <p className="pt-label text-[#607087]">Audit</p>
          <p className="mt-1 text-sm font-semibold text-[#132238]">{r.audit.status}</p>
        </div>
        <p className="text-xs text-[#607087]">
          {r.audit.entries} entr{r.audit.entries === 1 ? "y" : "ies"} · {r.audit.sealedEntries} sealed · {r.audit.note}
        </p>
      </div>

      <p className="mt-3 text-xs text-[#607087]">{r.basisNote}</p>
    </section>
  );
}

function PolicyChipStatic({ record }: { record: RirRecord }) {
  return (
    <span className="mono rounded-full border border-[#0B1F3A]/30 bg-white px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[#0B1F3A]">
      {record.policy.id || "policy"} · v{record.policy.version}
    </span>
  );
}

/** One evidence-domain row: state, source, freshness, contribution + a details disclosure. */
function DomainRow({ domain: d, expanded, onToggle }: { domain: RirDomain; expanded: boolean; onToggle: () => void }) {
  const st = evidenceStateLocal(d.state);
  const chip = stateTone(d.state);
  const contribution = d.contributedToDecision
    ? { text: "Contributed to the decision", cls: "bg-[#FFF7E6] text-[#8A6116]" }
    : { text: "Contextual, did not drive this decision", cls: "bg-[#F0F3F8] text-[#607087]" };
  const hasDetails = Boolean(d.verification || d.sourceIdentifier || (d.relatedRuleIds && d.relatedRuleIds.length > 0) || d.note);

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <span className="min-w-[9rem] flex-1 text-sm font-semibold text-[#132238]">
          {d.label}
          {!d.requiredByPolicy && (
            <span className="ml-1.5 rounded bg-[#F0F3F8] px-1.5 py-0.5 text-[10px] font-semibold text-[#607087]">
              Contextual (not required by policy)
            </span>
          )}
        </span>
        <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${chip.chip}`} title={st.meaning}>
          {st.label}
        </span>
        <span className="text-xs text-[#607087]">
          {d.available ? d.source : "No evidence available"} · {d.recorded}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${contribution.cls}`}>
          ↳ {contribution.text}
        </span>
        {hasDetails && (
          <button
            onClick={onToggle}
            aria-expanded={expanded}
            className="pt-action rounded border border-[#DCE3EC] px-2 py-0.5 text-[10px] font-semibold text-[#1E5AA8] hover:bg-[#F7F9FC]"
          >
            {expanded ? "Hide details" : "View details"}
          </button>
        )}
      </div>
      <div className="pt-expand" data-open={expanded}>
        <div>
          <dl className="pt-fade mt-2 grid gap-x-6 gap-y-1 rounded-md bg-[#F7F9FC] px-3 py-2 text-xs sm:grid-cols-2">
            {d.sourceIdentifier && (
              <div className="flex gap-2">
                <dt className="text-[#8A97A8]">Source identifier</dt>
                <dd className="mono text-[#132238]">{d.sourceIdentifier}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="text-[#8A97A8]">Recorded</dt>
              <dd className="text-[#132238]">{d.recorded}</dd>
            </div>
            {d.recordReference && (
              <div className="flex gap-2">
                <dt className="text-[#8A97A8]">Record reference</dt>
                <dd className="mono text-[#132238]">{d.recordReference}</dd>
              </div>
            )}
            <div className="flex gap-2 sm:col-span-2">
              <dt className="shrink-0 text-[#8A97A8]">Verification</dt>
              <dd className="text-[#132238]">{d.verification || "·"}</dd>
            </div>
            {d.relatedRuleIds && d.relatedRuleIds.length > 0 && (
              <div className="flex gap-2 sm:col-span-2">
                <dt className="shrink-0 text-[#8A97A8]">Rules involved</dt>
                <dd className="mono text-[#132238]">{d.relatedRuleIds.join(", ")}</dd>
              </div>
            )}
            {d.note && (
              <div className="flex gap-2 sm:col-span-2">
                <dt className="shrink-0 text-[#8A97A8]">Note</dt>
                <dd className="text-[#132238]">{d.note}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </li>
  );
}

function RecordHeading() {
  return (
    <div>
      <h3 className="text-base font-bold text-[#0B1F3A]">Result Integrity Record</h3>
      <p className="text-xs text-[#607087]">
        Portable, auditable, evidence-linked, derived from the stored assessment, never re-decided.
      </p>
    </div>
  );
}

function stateToneSafeForDisposition(disposition: string): { border: string; bg: string } {
  return disposition === "Trust"
    ? { border: "border-[#167A5A]", bg: "bg-[#EAF7F1]" }
    : disposition === "Verify"
      ? { border: "border-[#C43D3D]", bg: "bg-[#FDEEEE]" }
      : { border: "border-[#B7791F]", bg: "bg-[#FFF7E6]" };
}
