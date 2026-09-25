import { useEffect, useState } from "react";
import { formatEventTime } from "../lib/labels";

/**
 * Live-system indicators (Sections 7, 18, 24). Ambient animation budget: this chip's slow ring
 * pulse counts as one of at most two ambient motions in a viewport. Every state shown here is
 * DATA-DRIVEN, real connectivity, the real queue length, and the real completion of a sync.
 */

/** Numeric value transition: short vertical cross-fade, tabular numerals, never a slot machine. */
export function Ticker({ value, className = "" }: { value: string | number; className?: string }) {
  return (
    <span key={String(value)} className={`pt-ticker tabnum ${className}`}>
      {value}
    </span>
  );
}

export type SyncView = "online" | "offline" | "syncing" | "synced";

const CHIP: Record<SyncView, { label: string; cls: string; dot: string }> = {
  online: { label: "Online", cls: "border-[#167A5A]/30 bg-[#EAF7F1] text-[#167A5A]", dot: "bg-[#167A5A]" },
  offline: { label: "Offline", cls: "border-[#B7791F]/40 bg-[#FFF7E6] text-[#B7791F]", dot: "bg-[#B7791F]" },
  syncing: { label: "Syncing", cls: "border-[#1E5AA8]/35 bg-[#EDF3FB] text-[#1E5AA8]", dot: "bg-[#1E5AA8]" },
  synced: { label: "Synced", cls: "border-[#0F8B8D]/40 bg-[#EAF7F7] text-[#0B6E70]", dot: "bg-[#0F8B8D]" },
};

/** Status chip with pending ticker, thin progress line while syncing, polite live announcements. */
export function StatusChip({
  view, pending, lastSynced,
}: { view: SyncView; pending: number; lastSynced: string | null }) {
  const c = CHIP[view];
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span
        role="status"
        aria-live="polite"
        className={`relative inline-flex items-center gap-1.5 overflow-hidden rounded-full border px-2.5 py-1 text-xs font-semibold ${c.cls}`}
      >
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${c.dot} ${view === "online" ? "pt-dot-pulse" : ""}`}
        />
        {view === "synced" && <span aria-hidden="true">✓</span>}
        {c.label}
        {pending > 0 && (
          <span className="mono text-[11px] opacity-80">
            · pending <Ticker value={pending} />
          </span>
        )}
        {view === "syncing" && (
          <span
            aria-hidden="true"
            className="absolute bottom-0 left-0 h-[2px] w-full origin-left bg-gradient-to-r from-[#0B1F3A] via-[#1E5AA8] to-[#0F8B8D]"
            style={{ animation: "pt-grow 900ms var(--ease-standard) infinite alternate" }}
          />
        )}
      </span>
      <span className="mono text-[10px] text-[#607087]">
        {pending > 0
          ? `${pending} queued`
          : lastSynced
            ? `synced ${formatEventTime(lastSynced)}`
            : "queue clear"}
      </span>
    </span>
  );
}

/**
 * System Pulse chip (Section 24): luminous hairline, slow dot pulse, mono environment label.
 * The tooltip lists only what is genuinely operational in this build.
 */
export function SystemPulse() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-describedby="pt-pulse-tip"
        onClick={() => setOpen((o) => !o)}
        className="pt-lume flex items-center gap-2 rounded-full py-1.5 pl-3 pr-3.5 text-left"
      >
        <span aria-hidden="true" className="pt-dot-pulse h-2.5 w-2.5 rounded-full bg-[#0F8B8D] text-[#0F8B8D]" />
        <span>
          <span className="pt-label block text-[#0B1F3A]">System ready</span>
          <span className="block text-[11px] leading-tight text-[#5B6B80]">Evidence pipeline operational</span>
        </span>
      </button>
      <span
        id="pt-pulse-tip"
        role="tooltip"
        hidden={!open}
        className="pt-fade absolute right-0 top-[calc(100%+8px)] z-20 w-56 rounded-lg border border-[#E3E8EF] bg-white p-3 text-left shadow-[var(--shadow-2)]"
      >
        <span className="pt-label block text-[#607087]">Demonstration environment</span>
        <ul className="mt-1.5 space-y-1 text-xs text-[#132238]">
          <li>✓ Evidence pipeline, deterministic evaluation</li>
          <li>✓ Audit log, append-only decision records</li>
          <li>✓ Offline sync queue, local, prototype scope</li>
        </ul>
        <span className="mt-1.5 block text-[11px] text-[#607087]">No live clinical integration claimed.</span>
      </span>
    </span>
  );
}
