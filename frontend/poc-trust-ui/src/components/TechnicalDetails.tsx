import { useState, type ReactNode } from "react";

/**
 * The ONLY place raw machine values (rule IDs, record identifiers, persisted payloads) may
 * appear. Everything here is opt-in, collapsed by default, and visually marked as technical —
 * primary UI copy always goes through src/lib/labels.ts instead.
 */
export function TechnicalDetails({ children, title = "Technical details" }: { title?: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  async function copy(e: React.MouseEvent) {
    e.preventDefault();
    const text = (e.currentTarget.parentElement?.parentElement?.querySelector(".pt-copy-source") as HTMLElement | null)?.innerText ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1300);
    } catch { /* clipboard unavailable — silently keep the text visible */ }
  }
  return (
    <details className="mt-2 rounded-lg border border-dashed border-[#DCE3EC] px-3 py-2">
      <summary className="cursor-pointer text-xs font-semibold text-[#607087] underline underline-offset-2">
        {title}
      </summary>
      <div className="mt-1.5 flex items-start justify-between gap-2">
        <div className="pt-copy-source break-words font-mono text-xs leading-relaxed text-[#607087]">{children}</div>
        <button
          onClick={copy}
          className="relative shrink-0 rounded border border-[#DCE3EC] px-2 py-0.5 text-[11px] font-semibold text-[#607087] hover:bg-[#F7F9FC]"
          aria-label="Copy technical details"
        >
          {copied ? <span aria-hidden="true">✓</span> : <span aria-hidden="true">⧉</span>}
          {copied && <span className="pt-copied sr-only">Copied</span>}
        </button>
      </div>
    </details>
  );
}
