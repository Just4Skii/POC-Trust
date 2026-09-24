import { statusIcon, statusName, type StatusCode } from "../types";

const styles: Record<string, string> = {
  Trust: "bg-[#EAF7F1] text-[#167A5A] border-[#167A5A]/30",
  Review: "bg-[#FFF7E6] text-[#B7791F] border-[#B7791F]/40",
  Verify: "bg-[#FDEEEE] text-[#C43D3D] border-[#C43D3D]/30",
};

export function StatusBadge({ value, size = "md" }: { value: StatusCode; size?: "sm" | "md" | "lg" }) {
  const name = statusName(value);
  const pad = size === "lg" ? "px-6 py-3 text-2xl" : size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm";
  return (
    <span
      role="status"
      aria-label={`Reliability status ${name}`}
      className={`inline-flex items-center gap-2 rounded-md border font-semibold tracking-[0.03em] pt-fade ${pad} ${styles[name]}`}
    >
      <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-[13px] leading-none">
        {statusIcon(value)}
      </span>
      {name.toUpperCase()}
    </span>
  );
}
