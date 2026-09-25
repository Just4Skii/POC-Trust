import { useEffect, useRef, useState } from "react";

/**
 * Shared motion utilities, one place governs reduced-motion behaviour consistently (Section 33).
 * All decorative effects must consult these; data-driven effects must additionally be paused when
 * their element leaves the viewport or the tab is hidden (Section 31).
 */

/** True when the user prefers reduced motion. Live-updates on preference change. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/**
 * Soft cursor light for Level-2 surfaces (Section 21). Writes `--lx`/`--ly` as percentages,
 * throttled to one update per frame via requestAnimationFrame. Fine pointers only; disabled
 * under reduced motion. Never touches layout or text colour.
 */
export function usePointerLight<T extends HTMLElement>(enabled = true): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || reduced) return;
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let frame = 0;
    const move = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--lx", `${((e.clientX - r.left) / r.width) * 100}%`);
        el.style.setProperty("--ly", `${((e.clientY - r.top) / r.height) * 100}%`);
      });
    };
    el.addEventListener("pointermove", move);
    return () => {
      el.removeEventListener("pointermove", move);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled, reduced]);
  return ref;
}

/** True while the element intersects the viewport (ambient effects only run on-screen). */
export function useOnScreen<T extends HTMLElement>(ref: React.RefObject<T | null>): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver !== "function") return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return visible;
}

/**
 * Re-renders on a slow interval so relative times can refresh without a per-second tick
 * (Section 19). Interval of 0 disables ticking.
 */
export function useSlowTick(intervalMs: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (intervalMs <= 0) return;
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return tick;
}
