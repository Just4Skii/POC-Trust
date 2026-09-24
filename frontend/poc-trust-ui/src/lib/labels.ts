import type { Status } from "../types";

/**
 * Central humanization layer — the ONLY place machine vocabulary becomes human language.
 *
 * Rules:
 * - Backend rule IDs (QC_FAILED, CAL_NEAR_DUE, …), exception names and raw identifiers never
 *   appear in primary UI text. They are mapped here to plain-language labels and sentences.
 * - Raw values remain available — only inside the "Technical details" disclosure, never primary.
 * - Every lookup has a humanized fallback, so a future/unknown rule ID can never leak
 *   machine tokens to the screen. The copy guard (scripts/copy-guard.mjs) enforces this.
 */

// ── Deterministic rule vocabulary (must match POCTrust.Core/Reliability/ReliabilityEngine) ──

export interface RuleCopy {
  /** Short plain-language name, e.g. "Calibration expired". */
  label: string;
  /** One plain sentence explaining what it means. */
  sentence: string;
  /** Human name of the status the rule pushes toward, for "why" context. */
  pushes: "Trust" | "Review" | "Verify";
}

export const RULE_COPY: Record<string, RuleCopy> = {
  QC_FAILED: { label: "Quality control failed", sentence: "The device quality-control check failed, so the result must not be relied on without verification.", pushes: "Verify" },
  CAL_EXPIRED: { label: "Calibration expired", sentence: "The device's calibration due date has passed.", pushes: "Verify" },
  CAL_NEAR_DUE: { label: "Calibration due soon", sentence: "The device's calibration is approaching its due date.", pushes: "Review" },
  REAGENT_EXPIRED: { label: "Reagent expired", sentence: "The reagent lot has passed its expiry date.", pushes: "Verify" },
  REAGENT_NEAR_EXPIRY: { label: "Reagent nearing expiry", sentence: "The reagent lot is approaching its expiry date.", pushes: "Review" },
  OPERATOR_NOT_COMPETENT: { label: "Operator competency not current", sentence: "The recorded operator competency is not current for this test.", pushes: "Review" },
  ENV_TEMP: { label: "Temperature outside range", sentence: "The ambient temperature was outside the supported range at the time of the test.", pushes: "Review" },
  ENV_HUMIDITY: { label: "Humidity outside range", sentence: "The ambient humidity was outside the supported range at the time of the test.", pushes: "Review" },
  POWER_INTERRUPTION: { label: "Power interruption recorded", sentence: "A power interruption was recorded around the time of the test.", pushes: "Review" },
  PROVENANCE_INCOMPLETE: { label: "Provenance incomplete", sentence: "One or more provenance fields — operator, reagent lot or location — were not recorded.", pushes: "Review" },
  MULTI_CONTEXT: { label: "Multiple contextual concerns", sentence: "Several contextual concerns apply to this result at the same time.", pushes: "Review" },
  ALL_CHECKS_PASS: { label: "All checks passed", sentence: "All deterministic quality checks passed.", pushes: "Trust" },
};

export const KNOWN_RULE_IDS = Object.keys(RULE_COPY);

/** "SOME_TOKEN_VALUE" → "Some token value"; "camelCaseValue" → "Camel case value". */
export function humanizeToken(token: string): string {
  const spaced = token
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-/]+/g, " ")
    .trim()
    .toLowerCase();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : "";
}

export function ruleCopy(ruleId: string): RuleCopy {
  return RULE_COPY[ruleId] ?? {
    label: humanizeToken(ruleId) || "Additional check",
    sentence: `${humanizeToken(ruleId) || "An additional check"} applied to this assessment.`,
    pushes: "Review",
  };
}

// --- Persisted reason strings ("[RULE_ID] text ...") ------------------------------------------

export interface HumanReason {
  /** Plain-language heading, e.g. "Calibration due soon". */
  label: string;
  /** Human-readable explanation (persisted text with machine tokens removed). */
  text: string;
  /** Raw rule id - for the technical-details disclosure only. */
  ruleId?: string;
  /** True when this reason reports the AI advisory being unavailable. */
  aiUnavailable?: boolean;
}

export function isAiUnavailableReason(reason: string): boolean {
  return /^AI unavailable\b/.test(reason);
}

/** Converts one persisted reason string into display-safe copy. Never returns machine text. */
export function humanizeReason(reason: string): HumanReason {
  if (isAiUnavailableReason(reason)) {
    return {
      label: "Contextual Analysis unavailable",
      text: "The advisory Contextual Analysis service could not be reached at decision time, so no advisory note was produced. The deterministic assessment is unaffected.",
      aiUnavailable: true,
    };
  }
  const m = /^\[([A-Z0-9_]+)\]\s*(.*)$/.exec(reason);
  if (m) {
    const [, ruleId, rest] = m;
    const copy = ruleCopy(ruleId);
    const detail = rest.trim();
    return {
      label: copy.label,
      text: detail && !/[A-Z0-9]_[A-Z0-9]/.test(detail) ? detail : copy.sentence,
      ruleId,
    };
  }
  // Unknown future format: never display raw - strip bracketed tokens, humanize the rest.
  const cleaned = reason.replace(/\[[A-Z0-9_]+\]/g, "").trim();
  return { label: "Decision note", text: cleaned || "Recorded decision note." };
}

// ── Status presentation ──────────────────────────────────────────────────────

export const STATUS_COPY: Record<Status, { meaning: string; strip: string }> = {
  Trust: {
    meaning: "All deterministic quality checks passed. The result may be relied on subject to routine controls.",
    strip: "Evidence passed all checks",
  },
  Review: {
    meaning: "Contextual concerns were detected. A trained operator should review the evidence before the result is relied on.",
    strip: "Concerns need review",
  },
  Verify: {
    meaning: "A hard-stop quality failure was detected. Do not rely on this result alone — repeat or confirm by another method.",
    strip: "Reliance blocked",
  },
};

// ── Time (Africa/Johannesburg — the deployment context of this prototype) ────

const TZ = "Africa/Johannesburg";
const timeFmt = new Intl.DateTimeFormat("en-ZA", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const dayFmt = new Intl.DateTimeFormat("en-ZA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("en-ZA", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const weekdayFmt = new Intl.DateTimeFormat("en-ZA", { timeZone: TZ, weekday: "long" });

function dayNumber(d: Date): number {
  const [dd, mm, yyyy] = dayFmt.format(d).split("/").map(Number);
  return Math.floor(Date.UTC(yyyy, mm - 1, dd) / 864e5);
}

/** "Today, 14:05" · "Yesterday, 09:30" · "Tuesday, 14:05" (within a week) · "12 Mar 2026, 14:05". */
export function formatEventTime(iso?: string | null, now: Date = new Date()): string {
  if (!iso) return "Time not recorded";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Time not recorded";
  const time = timeFmt.format(d);
  const diff = dayNumber(now) - dayNumber(d);
  if (diff <= 0) return `Today, ${time}`;
  if (diff === 1) return `Yesterday, ${time}`;
  if (diff < 7) return `${weekdayFmt.format(d)}, ${time}`;
  return `${dateFmt.format(d)}, ${time}`;
}

// ── Synthetic demonstration directory (presentation names for demo identifiers) ──

/** Friendly display names for the curated demo devices. Unknown ids pass through unchanged. */
export const DEMO_DEVICE_NAMES: Record<string, string> = {
  "POC-DXA-01": "POC Analyzer 01",
  "POC-DXB-02": "POC Analyzer 02",
  "POC-DXM-03": "Mobile POC Unit 03",
};

export function deviceLabel(id?: string | null): string {
  if (!id) return "Device not recorded";
  return DEMO_DEVICE_NAMES[id] ? `${DEMO_DEVICE_NAMES[id]} (${id})` : id;
}

export function operatorLabel(id?: string | null): string {
  return id && id.trim() ? id : "Operator not recorded";
}

/** First provenance segment is the facility; the raw string stays in technical details. */
export function facilityLabel(provenance?: string | null): string {
  const site = (provenance ?? "").split("/")[0]?.trim();
  return site || "Location not recorded";
}

export function isDemoRecord(demoKey?: string | null): boolean {
  return typeof demoKey === "string" && demoKey.startsWith("demo-");
}

// ── Machine-text detector (used by the copy guard, available to the UI) ──────

/**
 * Patterns that must never appear in primary human-facing copy. Raw rule IDs, exception names,
 * GUIDs, JSON fragments and uninitialised-value artefacts are all caught here. The automated
 * copy guard (scripts/copy-guard.mjs) runs this detector over everything this module produces.
 */
const MACHINE_PATTERNS: [RegExp, string][] = [
  [/\b[A-Z0-9]{2,}_[A-Z0-9_]+\b/, "raw UPPER_SNAKE token"],
  [/\b[A-Z][a-zA-Z]*Exception\b/, "exception type name"],
  [/\b(?:HttpRequest|InvalidOperation|Json|NullReference|Timeout)\w*Exception\b/, "exception type name"],
  [/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/, "raw GUID"],
  [/\[object Object\]/, "unserialised object"],
  [/\b(?:undefined|NaN)\b/, "uninitialised value artefact"],
  [/^\s*[{[]/, "raw JSON fragment"],
  [/"\w+"\s*:/, "raw JSON fragment"],
];

/** Returns a list of machine-text findings in `text`; empty means the text is human-safe. */
export function findMachineText(text: string): string[] {
  const found: string[] = [];
  for (const [pattern, why] of MACHINE_PATTERNS) {
    if (pattern.test(text)) found.push(why);
  }
  return found;
}

