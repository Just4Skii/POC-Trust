import { useEffect, useState } from "react";
import { api } from "../api/client";
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

export function DevicesPage() {
  const [items, setItems] = useState<unknown[]>([]);
  const [note, setNote] = useState("");
  useEffect(() => {
    api.devices().then((d) => { setItems(d.items); setNote(d.note); }).catch(() => {});
  }, []);
  return (
    <MetaPage title="Devices" note={note || "Observed devices from real assessments."}>
      {items.length === 0 ? <p className="text-sm text-[#607087]">No devices observed yet.</p> : (
        <ul className="divide-y divide-[#DCE3EC] text-sm">
          {(items as { deviceId: string; assessments: number; qcFailures: number; lastStatus: number }[]).map((d) => (
            <li key={d.deviceId} className="py-2">{d.deviceId} · {d.assessments} assessments · QC failures {d.qcFailures}</li>
          ))}
        </ul>
      )}
    </MetaPage>
  );
}

export function OperatorsPage() {
  const data = useJson(() => api.operators());
  return (
    <MetaPage title="Operators" note={data?.note ?? "Observed operators from real assessments."}>
      {!data || data.items.length === 0 ? <p className="text-sm text-[#607087]">No operators observed yet.</p> : (
        <ul className="divide-y divide-[#DCE3EC] text-sm">
          {(data.items as { operatorId: string; assessments: number }[]).map((o) => (
            <li key={o.operatorId || "?"} className="py-2">{o.operatorId || "(unknown)"} · {o.assessments} assessments</li>
          ))}
        </ul>
      )}
    </MetaPage>
  );
}

export function QualityPage() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { api.qc().then(setData).catch(() => {}); }, []);
  return (
    <MetaPage title="Quality Controls" note="Aggregated from real persisted assessments — not a certification system.">
      {!data ? <p className="text-sm text-[#607087]">No QC data yet.</p> : (
        <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          {(["total", "qcPassed", "qcFailed", "verifyCount"] as const).map((k) => (
            <div key={k} className="rounded-lg border border-[#DCE3EC] p-3">
              <dt className="text-xs text-[#607087]">{k}</dt>
              <dd className="text-2xl font-bold">{String(data[k] ?? 0)}</dd>
            </div>
          ))}
        </dl>
      )}
    </MetaPage>
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
                <button onClick={onReset} disabled={busy} className="pt-action rounded-md border border-[#C43D3D]/40 bg-white px-3 py-2 text-sm font-semibold text-[#C43D3D] disabled:opacity-50">
                  Clear demonstration data
                </button>
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
      <MetaPage title="Settings" note="Prototype preferences. AI keys are never entered here — backend user-secrets/env only.">
        <p className="text-xs text-[#607087]">IMPLEMENTED: demo lifecycle, offline queue (localStorage). FUTURE: roles, retention, production sync.</p>
      </MetaPage>
    </div>
  );
}
