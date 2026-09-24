import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import { StatusBadge } from "./StatusBadge";
import { evidenceStateCopy, formatEventTime } from "../lib/labels";
import {
  coverageGlyph, evidenceSources, parseRir, rirDispositionStatus, stateTone,
  type RirRecord,
} from "../lib/rir";

type Load = { kind: "loading" } | { kind: "ready"; record: RirRecord } | { kind: "pending" } | { kind: "error"; message: string };

/**
 * The Result Integrity Record — the central artefact of POC Trust, rendered as a document.
 *
 * Everything shown comes from the backend derivation over the STORED assessment (spec section 4:
 * "The exact values must come from the actual assessment record. DO NOT hard-code a fake
 * UI-only RIR."). While an offline-pending event has not reached the store yet, the record
 * shows its designed waiting state instead of inventing data.
 */
export function IntegrityRecord({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [copied, setCopied] = useState(false);

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

  const canonicalJson = useMemo(
    () => (load.kind === "ready" ? JSON.stringify(load.record, null, 2) : null),
    [load],
  );

  function download() {
    if (!canonicalJson) return;
    const blob = new Blob([canonicalJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `result-integrity-record-${id}.json`;
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
      /* clipboard unavailable — the download button remains the portability path */
    }
  }

  if (load.kind === "loading") {
    return (
      <section aria-label="Result Integrity Record" className="pt-card p-5">
        <RecordHeading />
        <div className="mt-3 skeleton h-40 rounded-lg" aria-hidden="true" />
      </section>
    );
  }

  if (load.kind === "pending") {
    return (
      <section aria-label="Result Integrity Record" className="pt-card p-5">
        <RecordHeading />
        <p className="mt-3 rounded-lg border border-[#DCE3EC] bg-[#F7F9FC] px-4 py-3 text-sm text-[#607087]">
          The Result Integrity Record is created by the pipeline when the event is evaluated and
          stored. This event has not reached the store yet — the record appears here once it has
          been synchronised. No record is invented in the meantime.
        </p>
      </section>
    );
  }

  if (load.kind === "error") {
    return (
      <section aria-label="Result Integrity Record" className="pt-card p-5">
        <RecordHeading />
        <p role="alert" className="mt-3 rounded-lg border border-[#F3D6D6] bg-[#FDEEEE] px-4 py-3 text-sm text-[#C43D3D]">
          {load.message} The evidence and audit sections below remain available.
        </p>
      </section>
    );
  }

  const r = load.record;
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
    <section aria-label="Result Integrity Record" className="pt-card-2 p-5 pt-fade">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <RecordHeading />
        <div className="flex gap-2">
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
          <p className="mt-1 font-semibold text-[#132238]">{formatEventTime(r.eventTimeUtc)}</p>
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
          Integrity disposition — an operational decision about reliance under the demonstration
          policy, derived from the evidence below.
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

      {/* Evidence domains */}
      <div className="mt-4">
        <p className="pt-label text-[#607087]">Evidence domains</p>
        <ul className="mt-2 divide-y divide-[#DCE3EC] rounded-lg border border-[#DCE3EC] bg-white">
          {r.domains.map((d) => {
            const st = evidenceStateCopy(d.state);
            const chip = stateTone(d.state);
            return (
              <li key={d.domain} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3">
                <span className="min-w-[9rem] flex-1 text-sm font-semibold text-[#132238]">
                  {d.label}
                  {!d.requiredByPolicy && (
                    <span className="ml-1.5 rounded bg-[#F0F3F8] px-1.5 py-0.5 text-[10px] font-semibold text-[#607087]">
                      Not required by policy
                    </span>
                  )}
                </span>
                <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${chip.chip}`} title={st.meaning}>
                  {st.label}
                </span>
                <span className="text-xs text-[#607087]">
                  {d.available ? d.source : "No evidence available"} · {d.recorded}
                  {d.contributedToDecision && (
                    <span className="ml-1.5 rounded bg-[#FFF7E6] px-1.5 py-0.5 text-[10px] font-semibold text-[#8A6116]">
                      Contributed to the decision
                    </span>
                  )}
                </span>
                {d.note && <p className="w-full text-xs text-[#607087]">{d.note}</p>}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Decision drivers */}
      <div className="mt-4">
        <p className="pt-label text-[#607087]">Decision drivers</p>
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
      </div>

      {/* Demonstration policy context */}
      <div className="mt-4 rounded-lg border border-[#DCE3EC] p-4">
        <p className="pt-label text-[#607087]">Policy applied</p>
        <p className="mt-1 text-sm font-semibold text-[#132238]">
          {r.policy.name} · {r.policy.version}
        </p>
        <p className="mt-1 text-xs text-[#607087]">{r.policy.note}</p>
        {r.policy.freshnessWindows.length > 0 && (
          <p className="mt-1.5 text-xs text-[#607087]">
            Freshness boundaries:{" "}
            {r.policy.freshnessWindows.map((w) => `${w.domain} ${w.boundary.toLowerCase()} ${w.days} days`).join(" · ")}
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

function RecordHeading() {
  return (
    <div>
      <h3 className="text-base font-bold text-[#0B1F3A]">Result Integrity Record</h3>
      <p className="text-xs text-[#607087]">
        Portable, auditable, evidence-linked — derived from the stored assessment, never re-decided.
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
