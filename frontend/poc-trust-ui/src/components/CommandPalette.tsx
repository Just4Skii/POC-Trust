import { useEffect, useMemo, useRef, useState } from "react";
import { DEMO_SCENARIOS } from "../lib/scenarios";
import type { DemoStatus, Status } from "../types";

/**
 * Command palette + shortcut help (Section 20). Speed is a signal of premium technical
 * software: results appear instantly (no artificial delay), arrow keys navigate, Enter runs,
 * Esc closes. Backdrop blur is the permitted glass of Section 3.4. Fully keyboard operable
 * with a focus trap, labelled dialog semantics and screen-reader-friendly announcements.
 */

export interface RecentItem {
  id: string;
  result: string;
  deviceId: string;
  status: Status;
}

interface PaletteItem {
  id: string;
  section: string;
  label: string;
  hint: string;
  run: () => void;
}

export function CommandPalette({
  open, onClose, pages, onNav, demo, onSeed, onReset, onSync, onRunScenario, recent, onOpen,
}: {
  open: boolean;
  onClose: () => void;
  pages: { id: string; label: string }[];
  onNav: (id: string) => void;
  demo: DemoStatus | null;
  onSeed: () => void;
  onReset: () => void;
  onSync: () => void;
  onRunScenario: (key: string) => void;
  recent: RecentItem[];
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const demoActive = (demo?.demoRecords ?? 0) > 0;

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);
    const list: PaletteItem[] = [];
    for (const p of pages) {
      if (match(`go ${p.label} ${p.id}`)) {
        list.push({ id: `p-${p.id}`, section: "Pages", label: p.label, hint: "page", run: () => onNav(p.id) });
      }
    }
    const actions: [string, string, () => void][] = [
      ["New assessment", "action", () => onNav("new")],
      [demoActive ? "Clear demonstration data" : "Load demonstration data", "action", demoActive ? onReset : onSeed],
      ["Synchronise pending queue now", "action", onSync],
      ["Open audit trail", "action", () => onNav("audit")],
      ["Open settings", "action", () => onNav("settings")],
    ];
    for (const [label, hint, run] of actions) {
      if (match(`${label} action`)) list.push({ id: `a-${label}`, section: "Actions", label, hint, run });
    }
    if (demo) {
      for (const s of DEMO_SCENARIOS) {
        if (match(`run scenario ${s.story} ${s.expected}`)) {
          list.push({
            id: `s-${s.key}`,
            section: "Scenarios",
            label: `Run ${s.expected} scenario — ${s.story}`,
            hint: demoActive ? "scenario" : "loads data",
            run: () => onRunScenario(s.key),
          });
        }
      }
    }
    for (const r of recent.slice(0, 6)) {
      if (match(`open ${r.result} ${r.deviceId} ${r.status}`)) {
        list.push({ id: `r-${r.id}`, section: "Recent", label: `${r.result} · ${r.deviceId}`, hint: r.status, run: () => onOpen(r.id) });
      }
    }
    return list;
  }, [query, pages, onNav, demo, demoActive, onSeed, onReset, onSync, onRunScenario, recent, onOpen]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      // Entry ≤150ms: focus immediately so typing works on the first frame.
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, items.length - 1)));
  }, [items.length]);

  // Focus trap while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>("button, input, [tabindex]:not([tabindex='-1'])"),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const grouped: [string, PaletteItem[]][] = [];
  for (const item of items) {
    const last = grouped[grouped.length - 1];
    if (last && last[0] === item.section) last[1].push(item);
    else grouped.push([item.section, [item]]);
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Home") { e.preventDefault(); setSel(0); }
    else if (e.key === "End") { e.preventDefault(); setSel(Math.max(0, items.length - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[sel];
      if (item) { onClose(); item.run(); }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-navy/25 pt-glass" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        className="pt-fade relative w-full max-w-xl overflow-hidden rounded-xl border border-[#E3E8EF] bg-white shadow-[var(--shadow-2)]"
      >
        <label className="flex items-center gap-2 border-b border-[#E3E8EF] px-4 py-3">
          <span aria-hidden="true" className="text-[#607087]">⌕</span>
          <span className="sr-only">Search pages, actions, scenarios and records</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSel(0); }}
            placeholder="Search pages, actions, scenarios, records…"
            className="w-full bg-transparent text-sm outline-none"
            role="combobox"
            aria-expanded="true"
            aria-controls="pt-palette-list"
            aria-activedescendant={items[sel] ? `pt-pal-${items[sel].id}` : undefined}
            aria-autocomplete="list"
          />
          <span className="mono hidden text-[10px] text-[#8A97A8] sm:block">esc to close</span>
        </label>
        <div id="pt-palette-list" role="listbox" aria-label="Results" className="max-h-[52vh] overflow-y-auto p-2">
          {items.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-[#607087]">No matches. Try a page name, scenario or action.</p>
          )}
          {grouped.map(([section, group]) => (
            <div key={section} className="mb-1">
              <p className="pt-label px-3 pb-1 pt-2 text-[#8A97A8]">{section}</p>
              {group.map((item) => {
                const index = items.indexOf(item);
                const active = index === sel;
                return (
                  <button
                    key={item.id}
                    id={`pt-pal-${item.id}`}
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setSel(index)}
                    onClick={() => { onClose(); item.run(); }}
                    className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      active ? "bg-[#EDF3FB] text-[#0B1F3A]" : "text-[#132238]"
                    }`}
                  >
                    <span className="min-w-0 truncate">{item.label}</span>
                    <span className="mono shrink-0 text-[10px] uppercase tracking-wider text-[#8A97A8]">{item.hint}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {items.length} result{items.length === 1 ? "" : "s"}
        </p>
        <div className="flex items-center justify-between border-t border-[#E3E8EF] px-4 py-2">
          <span className="mono text-[10px] text-[#8A97A8]">↑↓ navigate · enter run · esc close</span>
          <span className="mono text-[10px] text-[#8A97A8]">POC Trust</span>
        </div>
      </div>
    </div>
  );
}

/** "?" help overlay — discoverable keyboard shortcuts, small accessible implementation. */
export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const rows: [string, string][] = [
    ["Ctrl / ⌘ + K", "Open the command palette"],
    ["?", "Show this shortcut guide"],
    ["↑ ↓", "Move through palette results"],
    ["Enter", "Run the selected result"],
    ["Esc", "Close overlays and dialogs"],
    ["Tab", "Move focus — every action is reachable"],
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-navy/25 pt-glass" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="pt-fade relative w-full max-w-md rounded-xl border border-[#E3E8EF] bg-white p-5 shadow-[var(--shadow-2)]"
      >
        <div className="flex items-center justify-between">
          <h2 className="pt-label text-[#0B1F3A]">Keyboard shortcuts</h2>
          <button onClick={onClose} aria-label="Close shortcuts" className="rounded p-1.5 text-[#607087] hover:bg-[#F7F9FC]">✕</button>
        </div>
        <dl className="mt-3 divide-y divide-[#EDF1F6]">
          {rows.map(([keys, what]) => (
            <div key={keys} className="flex items-center justify-between gap-4 py-2">
              <dt className="mono text-xs font-semibold text-[#0B1F3A]">{keys}</dt>
              <dd className="text-right text-sm text-[#5B6B80]">{what}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-[#607087]">Speed with restraint — every shortcut has a visible control too.</p>
      </div>
    </div>
  );
}
