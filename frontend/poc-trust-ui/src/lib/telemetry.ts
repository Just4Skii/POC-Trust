/**
 * Deterministic, seeded sample generation for presentation telemetry (Section 9, 29).
 *
 * TRUTHFULNESS CONTRACT: everything in this module is PRESENTATION MOTION over already-true
 * data. Sample arrays are cosmetic trace shapes seeded from stable record identifiers, the
 * same scenario always produces the same trace, and the *recorded* value is always the one
 * shown to the user in text. No drifting or scanning effect may ever alter a displayed value.
 */

/** FNV-1a string hash → uint32. Stable across runs and platforms. */
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 PRNG, small, fast, fully deterministic from a seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `count` values in [center − amplitude, center + amplitude], seeded by `seedText`.
 * Same seed → identical array (verified by contract checks).
 */
export function seededSamples(seedText: string, count: number, center: number, amplitude: number): number[] {
  const rand = mulberry32(hashSeed(seedText));
  const out: number[] = [];
  // Mild autocorrelation keeps the trace readable as a gentle wave rather than pure noise.
  let prev = center;
  for (let i = 0; i < count; i++) {
    const target = center + (rand() * 2 - 1) * amplitude;
    prev = prev + (target - prev) * 0.55;
    out.push(prev);
  }
  return out;
}

/** Normalise arbitrary samples to 0..1 for plotting (returns 0.5 flat line for degenerate input). */
export function normalise(samples: number[]): number[] {
  const lo = Math.min(...samples);
  const hi = Math.max(...samples);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo < 1e-9) return samples.map(() => 0.5);
  return samples.map((v) => (v - lo) / (hi - lo));
}

/**
 * SVG polyline `d` for a trace, drawn into `width × height` with `padding` on both ends.
 * Uses pathLength-friendly straight segments, hairline accuracy, no smoothing surprises.
 */
export function tracePathD(samples: number[], width: number, height: number, padding = 3): string {
  const norm = normalise(samples);
  const usableW = width - padding * 2;
  const usableH = height - padding * 2;
  return norm
    .map((v, i) => {
      const x = padding + (norm.length === 1 ? usableW / 2 : (i / (norm.length - 1)) * usableW);
      const y = padding + (1 - v) * usableH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

/** x/y pixel coordinates of the last sample, where the marker dot sits. */
export function traceLatest(samples: number[], width: number, height: number, padding = 3): { x: number; y: number } {
  const norm = normalise(samples);
  const v = norm[norm.length - 1] ?? 0.5;
  return {
    x: width - padding,
    y: padding + (1 - v) * (height - padding * 2),
  };
}
