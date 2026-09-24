import type { ReactNode } from "react";

/**
 * The ONLY place raw machine values (rule IDs, record identifiers, persisted payloads) may
 * appear. Everything here is opt-in, collapsed by default, and visually marked as technical —
 * primary UI copy always goes through src/lib/labels.ts instead.
 */
export function TechnicalDetails({ children, title = "Technical details" }: { children: ReactNode; title?: string }) {
  return (
    <details className="mt-2 rounded-lg border border-dashed border-[#DCE3EC] px-3 py-2">
      <summary className="cursor-pointer text-xs font-semibold text-[#607087] underline underline-offset-2">
        {title}
      </summary>
      <div className="mt-1.5 break-words font-mono text-xs leading-relaxed text-[#607087]">{children}</div>
    </details>
  );
}
