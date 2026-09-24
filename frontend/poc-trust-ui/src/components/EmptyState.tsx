/**
 * Designed empty state (spec Section 20) — used wherever a list can be genuinely empty
 * (demo data reset, fresh install). Replaces bare one-line sentences and large dead areas.
 * A calm panel: quiet glyph, heading, one line of support, and real actions.
 */
export function EmptyState({
  title,
  note,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  title: string;
  note: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#C9D4E3] bg-[#F7F9FC] px-6 py-10 text-center"
    >
      <span
        aria-hidden="true"
        className="flex h-11 w-11 items-center justify-center rounded-full border border-[#DCE3EC] bg-white text-lg text-[#607087]"
      >
        ◇
      </span>
      <p className="mt-3 text-sm font-semibold text-[#132238]">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-[#607087]">{note}</p>
      {(primaryLabel || secondaryLabel) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {primaryLabel && (
            <button
              onClick={onPrimary}
              className="pt-action pt-primary min-h-[44px] rounded-lg px-4 py-2.5 text-sm font-semibold"
            >
              {primaryLabel}
            </button>
          )}
          {secondaryLabel && (
            <button
              onClick={onSecondary}
              className="pt-action min-h-[44px] rounded-lg border border-[#0B1F3A] bg-white px-4 py-2.5 text-sm font-semibold text-[#0B1F3A]"
            >
              {secondaryLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
