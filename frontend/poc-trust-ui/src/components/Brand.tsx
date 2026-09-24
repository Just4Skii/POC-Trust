export function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5" aria-label="POC Trust home">
      <svg width="34" height="34" viewBox="0 0 34 34" role="img" aria-label="POC Trust shield logo">
        <path d="M17 2 29 7v9c0 7.5-5.1 12.3-12 16C10.1 28.3 5 23.5 5 16V7L17 2z" fill="#0B1F3A" />
        <path d="M17 5.2 26 9v7c0 6-4.1 10-9 12.9C12.1 26 8 22 8 16V9l9-3.8z" fill="none" stroke="#0F8B8D" strokeWidth="1.6" />
        <circle cx="13" cy="15" r="2" fill="#FFFFFF" />
        <circle cx="21" cy="13" r="2" fill="#FFFFFF" />
        <circle cx="18" cy="21" r="2" fill="#FFFFFF" />
        <path d="M14.5 14l4.5-0.6M14.2 16.4l2.6 3M20 14.8l-1.2 4.4" stroke="#0F8B8D" strokeWidth="1.3" />
      </svg>
      {!collapsed && (
        <div className="leading-tight">
          <div className="font-bold text-[15px] tracking-tight text-white">POC Trust</div>
          <div className="text-[11px] text-slate-300">Diagnostic Integrity Layer</div>
        </div>
      )}
    </div>
  );
}
