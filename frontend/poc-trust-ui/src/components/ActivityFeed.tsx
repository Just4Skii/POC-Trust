
import { formatEventTimeLocal } from "../i18n/strings";
import { useSlowTick } from "../lib/hooks";
import type { AuditRow } from "../types";

/**
 * System Activity feed (Section 19) — generated ONLY from real persisted records: audit rows
 * (a decision was actually recorded) and the real last-synchronisation timestamp. No invented
 * events, no random animation. Relative times refresh on a slow interval, never per second.
 * Dot colours use neutral/brand hues — the reserved TRUST/REVIEW/VERIFY palette stays exclusive
 * to decision states.
 */

interface Entry {
  id: string;
  kind: "decision" | "sync";
  text: string;
  at: string;
  assessmentId?: string;
}

function relative(iso: string, now: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "time not recorded";
  const mins = Math.floor((now - t) / 60_000);
  if (mins < 1) return "just now";
  return formatEventTimeLocal(iso);
}

export function ActivityFeed({
  rows, lastSynced, onOpen,
}: {
  rows: AuditRow[];
  lastSynced: string | null;
  onOpen: (id: string) => void;
}) {
  useSlowTick(45_000); // slow refresh of relative wording — no per-second tick
  const now = Date.now();
  const decisions: Entry[] = rows.slice(0, 4).map((a) => ({
    id: `d-${a.id}`,
    kind: "decision",
    text: `Decision recorded — ${a.action.slice(0, 90)}`,
    at: a.timestampUtc,
    assessmentId: a.assessmentId,
  }));
  const syncs: Entry[] = lastSynced
    ? [{ id: "sync-last", kind: "sync", text: "Synchronisation completed", at: lastSynced }]
    : [];
  const entries = [...decisions, ...syncs]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 5);

  return (
    <section aria-label="System activity" className="pt-card p-5">
      <h3 className="pt-label text-[#0B1F3A]">System activity</h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-[#607087]">No recorded activity yet — run a demonstration scenario.</p>
      ) : (
        <ul className="mt-3 space-y-2.5 pt-stagger">
          {entries.map((e, i) => (
            <li key={e.id} style={{ ["--d" as string]: `${i * 55}ms` }}>
              {e.assessmentId ? (
                <button
                  onClick={() => onOpen(e.assessmentId!)}
                  className="flex w-full items-start gap-2.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-[#F7F9FC]"
                >
                  <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#1E5AA8]" />
                  <span className="min-w-0 flex-1 break-words text-sm text-[#132238]">{e.text}</span>
                  <span className="mono shrink-0 text-[11px] text-[#607087]">{relative(e.at, now)}</span>
                </button>
              ) : (
                <span className="flex items-start gap-2.5 px-1 py-0.5">
                  <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#0F8B8D]" />
                  <span className="min-w-0 flex-1 break-words text-sm text-[#132238]">{e.text}</span>
                  <span className="mono shrink-0 text-[11px] text-[#607087]">{relative(e.at, now)}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-[#607087]">Sourced from persisted audit records and the local sync queue — nothing here is simulated.</p>
    </section>
  );
}
