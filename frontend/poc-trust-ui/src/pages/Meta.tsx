import { useEffect, useState } from "react";
import { api } from "../api/client";
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

export function SettingsPage({ demoMode, onDemoMode }: { demoMode: boolean; onDemoMode: (v: boolean) => void }) {
  return (
    <MetaPage title="Settings" note="Prototype preferences. AI keys are never entered here — backend user-secrets/env only.">
      <label className="flex min-h-[44px] items-center gap-2 text-sm">
        <input type="checkbox" checked={demoMode} onChange={(e) => onDemoMode(e.target.checked)} />
        Demonstration Mode (labels synthetic data)
      </label>
      <p className="mt-2 text-xs text-[#607087]">IMPLEMENTED: demo toggle, offline queue (localStorage). FUTURE: roles, retention, production sync.</p>
    </MetaPage>
  );
}
