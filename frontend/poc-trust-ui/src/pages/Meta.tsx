import { useEffect, useState } from "react";
import { api } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";
import { deviceLabel } from "../lib/labels";
import { DEMO_SCENARIOS } from "../lib/scenarios";
import type { DemoStatus } from "../types";
import { MetaPage } from "./Overview";

function useJson<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let live = true;
    loader().then((d) => live && setData(d)).catch(() => live && setData(null));
    return () => { live = false; };
  }, [loader]);
  return data;
}

/** Operational device view (spec Section 26): derived from real persisted records, each row
 *  drilling into the assessments list. Table-like on desktop, stacked on mobile. */
export function DevicesPage({ onViewAssessments }: { onViewAssessments: (deviceId: string) => void }) {
  const data = useJson(() => api.devices());
  const items = (data?.items ?? []) as { deviceId: string; assessments: number; qcFailures: number; lastStatus: number }[];
  return (
    <MetaPage title="Devices" note={data?.note || "Observed devices from real assessments. Operational state is derived from recorded quality evidence."}>
      {items.length === 0 ? (
        <EmptyState title="No devices observed yet" note="Devices appear here once assessments are recorded — load the demonstration data to populate this page." />
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {items.map((d) => {
            const attention = d.qcFailures > 0;
            return (
              <li key={d.deviceId} className="rounded-lg border border-[#DCE3EC] p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#132238]">{deviceLabel(d.deviceId)}</p>
                    <p className="text-xs text-[#607087]">{d.deviceId}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${attention ? "bg-[#FFF7E6] text-[#8A6116]" : "bg-[#EAF7F1] text-[#167A5A]"}`}>
                    {attention ? "Attention — QC failure recorded" : "Operational"}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#607087]">
                  <span><b className="tabnum text-[#132238]">{d.assessments}</b> assessments</span>
                  <span><b className="tabnum text-[#132238]">{d.qcFailures}</b> QC failures</span>
                  <span className="flex items-center gap-1">Latest state <StatusBadge value={d.lastStatus} size="sm" /></span>
                </div>
                <button
                  onClick={() => onViewAssessments(d.deviceId)}
                  className="mt-2 min-h-[44px] rounded-md border border-[#0B1F3A] bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1F3A] hover:bg-[#F7F9FC]"
                >
                  View this device&apos;s assessments
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </MetaPage>
  );
}

export function OperatorsPage({ onViewAssessments }: { onViewAssessments: (operatorId: string) => void }) {
  const data = useJson(() => api.operators());
  return (
    <MetaPage title="Operators" note={data?.note ?? "Observed operators from real assessments. Identity is as recorded at the point of care — the prototype does not authenticate operators."}>
      {!data || data.items.length === 0 ? (
        <EmptyState title="No operators observed yet" note="Operator references appear here once assessments are recorded." />
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {(data.items as { operatorId: string; assessments: number }[]).map((o) => (
            <li key={o.operatorId || "unknown"} className="rounded-lg border border-[#DCE3EC] p-4">
              <p className="text-sm font-semibold text-[#132238]">{o.operatorId || "Operator not recorded"}</p>
              <p className="mt-0.5 text-xs text-[#607087]"><b className="tabnum text-[#132238]">{o.assessments}</b> assessments recorded</p>
              {o.operatorId && (
                <button
                  onClick={() => onViewAssessments(o.operatorId)}
                  className="mt-2 min-h-[44px] rounded-md border border-[#0B1F3A] bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1F3A] hover:bg-[#F7F9FC]"
                >
                  View this operator&apos;s assessments
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </MetaPage>
  );
}

export function QualityPage() {
  const data = useJson(() => api.qc());
  return (
    <MetaPage title="Quality Controls" note="Aggregated from real persisted assessments — not a certification system.">
      {!data ? (
        <EmptyState title="No quality-control data yet" note="Control outcomes appear here once assessments are recorded." />
      ) : (
        <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          {([
            ["total", "Total assessments"],
            ["qcPassed", "QC passed"],
            ["qcFailed", "QC failed"],
            ["verifyCount", "Verification required"],
          ] as const).map(([k, label]) => (
            <div key={k} className="rounded-lg border border-[#DCE3EC] p-3">
              <dt className="text-xs text-[#607087]">{label}</dt>
              <dd className="tabnum mt-1 text-2xl font-bold text-[#132238]">{String(data[k] ?? 0)}</dd>
            </div>
          ))}
        </dl>
      )}
    </MetaPage>
  );
}

function ResetConfirm({ busy, onReset }: { busy: boolean; onReset: () => void }) {
  const [arming, setArming] = useState(false);
  if (!arming) {
    return (
      <button onClick={() => setArming(true)} disabled={busy} className="pt-action rounded-md border border-[#C43D3D]/40 bg-white px-3 py-2 text-sm font-semibold text-[#C43D3D] disabled:opacity-50">
        Reset demonstration data
      </button>
    );
  }
  return (
    <div className="rounded-lg border border-[#C43D3D]/30 bg-[#FDEEEE] p-3" role="alertdialog" aria-label="Confirm demonstration data reset">
      <p className="text-sm font-semibold text-[#132238]">Reset demonstration data?</p>
      <p className="mt-1 text-xs text-[#607087]">
        This removes only demo-marked records. Assessments you created yourself are never touched.
        Reloading afterwards restores the identical ten-scenario set.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button onClick={() => { setArming(false); onReset(); }} disabled={busy} className="pt-action rounded-md bg-[#C43D3D] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
          Confirm reset
        </button>
        <button onClick={() => setArming(false)} disabled={busy} className="rounded-md border border-[#DCE3EC] bg-white px-3 py-2 text-sm font-semibold text-[#607087]">
          Keep the data
        </button>
      </div>
    </div>
  );
}

export function SettingsPage({
  demo, busy, onSeed, onReset,
}: {
  demo: DemoStatus | null;
  busy: boolean;
  onSeed: () => void;
  onReset: () => void;
}) {
  const demoActive = (demo?.demoRecords ?? 0) > 0;
  return (
    <div className="space-y-4">
      <MetaPage title="Demonstration data" note="Controlled synthetic data for evaluation. Every record is computed by the real assessment pipeline, clearly labelled, and removable without touching anything else.">
        {!demo ? (
          <p className="text-sm text-[#607087]">Demonstration controls are available in the development environment only.</p>
        ) : (
          <>
            <p className="text-sm text-[#132238]">
              {demo.demoRecords} of {demo.expectedRecords} scenarios loaded · {demo.totalRecords} records in total.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {demoActive ? (
                <ResetConfirm busy={busy} onReset={onReset} />
              ) : (
                <button onClick={onSeed} disabled={busy} className="pt-action pt-primary rounded-md px-3 py-2 text-sm font-semibold disabled:opacity-50">
                  Load demonstration data
                </button>
              )}
            </div>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {DEMO_SCENARIOS.map((s, i) => {
                const loaded = demo.seeded.includes(s.key);
                return (
                  <li key={s.key} className="pt-lume pt-lift rounded-lg bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="mono rounded bg-[#0B1F3A] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        SCN-{String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="pt-label text-[#607087]">{loaded ? "loaded" : "not loaded"}{s.offline ? " · offline" : ""}</span>
                    </div>
                    <p className="mt-1.5 text-sm font-medium text-[#132238]">{s.story}</p>
                    <p className="mt-0.5 text-xs text-[#607087]">{s.summary}</p>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </MetaPage>
      <MetaPage title="Settings" note="What this prototype does today, where its boundary sits, and what is planned next. AI keys are never entered here — backend user-secrets/env only.">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-[#DCE3EC] p-4">
            <p className="pt-label font-semibold text-[#167A5A]">Implemented</p>
            <ul className="mt-2 space-y-1 text-xs text-[#607087]">
              <li>Deterministic reliability evaluation</li>
              <li>Assessment persistence (SQLite)</li>
              <li>Append-only audit trail with hash-chain sealing</li>
              <li>Advisory Contextual Analysis (never changes a decision)</li>
              <li>Offline queue with idempotent synchronisation</li>
              <li>Demonstration data lifecycle (load / reset / scenarios)</li>
            </ul>
          </div>
          <div className="rounded-lg border border-[#DCE3EC] p-4">
            <p className="pt-label font-semibold text-[#8A6116]">Prototype boundary</p>
            <ul className="mt-2 space-y-1 text-xs text-[#607087]">
              <li>All data is synthetic demonstration data</li>
              <li>No authentication in this prototype</li>
              <li>Connectivity affects synchronisation only — never reliability</li>
              <li>Not clinically validated; no regulatory approval claimed</li>
              <li>Not deployed in any clinical environment</li>
            </ul>
          </div>
          <div className="rounded-lg border border-[#DCE3EC] p-4">
            <p className="pt-label font-semibold text-[#1E5AA8]">Future</p>
            <ul className="mt-2 space-y-1 text-xs text-[#607087]">
              <li>Live device integrations</li>
              <li>LIS / NHLS integration</li>
              <li>Production authentication and roles</li>
              <li>Retention policy and operational hardening</li>
              <li>Full offline deterministic execution</li>
            </ul>
          </div>
        </div>
      </MetaPage>
    </div>
  );
}
