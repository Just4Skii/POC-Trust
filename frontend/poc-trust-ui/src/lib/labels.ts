import { presentationLocale } from "./presentationLocale.ts";
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

// ── Evidence-quality taxonomy (Result Integrity Record) ─────────────────────
//
// Evidence is no longer only pass/fail. These classifications describe the QUALITY of recorded
// evidence under the selected demonstration policy; the relationship between a state and the
// TRUST/REVIEW/VERIFY disposition stays governed by the deterministic engine — these strings
// never decide anything. Every lookup has a humanized fallback (copy guard enforces it).

export const EVIDENCE_STATE_COPY: Record<string, { label: string; meaning: string }> = {
  valid: { label: "Valid", meaning: "Evidence exists and is current enough for the selected demonstration policy." },
  aging: { label: "Aging", meaning: "Evidence is still valid but approaching a configured review boundary." },
  missing: { label: "Missing", meaning: "Required evidence was not available for this event." },
  stale: { label: "Stale", meaning: "Evidence exists but is too old to confidently support the assessment." },
  expired: { label: "Expired", meaning: "Evidence has passed its configured validity boundary." },
  failed: { label: "Failed", meaning: "A control explicitly failed." },
  conflicting: { label: "Conflicting", meaning: "Evidence sources disagree or the evidence set is internally inconsistent." },
  "unverified-source": { label: "Unverified source", meaning: "Evidence exists but its provenance or source could not be sufficiently verified." },
};

export function evidenceStateCopy(state: string): { label: string; meaning: string } {
  return EVIDENCE_STATE_COPY[state] ?? {
    label: humanizeToken(state) || "Unclassified",
    meaning: "Evidence-quality classification recorded for this assessment.",
  };
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
//
// Spec section 11: dates and times are formatted through Intl with the ACTIVE locale, and
// fall back to en-ZA when the runtime lacks that locale's formatting data — verified, never
// assumed. Verification rule: a locale formatter is trusted only when the runtime resolves
// it to the same language; anything else (or a thrown RangeError) falls back to en-ZA.
// The internal day arithmetic always uses the fixed en-ZA numeric format so "days ago"
// comparisons stay correct regardless of presentation.

const TZ = "Africa/Johannesburg";
const dayFmt = new Intl.DateTimeFormat("en-ZA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

type TimePart = "time" | "date" | "weekday";
const PART_OPTIONS: Record<TimePart, Intl.DateTimeFormatOptions> = {
  time: { hour: "2-digit", minute: "2-digit", hour12: false },
  date: { day: "numeric", month: "short", year: "numeric" },
  weekday: { weekday: "long" },
};

/** Per-locale verified formatter cache — entries are always real formatters, never null. */
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmtFor(part: TimePart, locale: string): Intl.DateTimeFormat {
  const cacheKey = `${part}|${locale}`;
  const cached = fmtCache.get(cacheKey);
  if (cached) return cached;
  const build = (lng: string): Intl.DateTimeFormat | null => {
    try {
      const fmt = new Intl.DateTimeFormat(lng, { timeZone: TZ, ...PART_OPTIONS[part] });
      // Verify, do not assume (spec section 11): if the runtime silently resolved the
      // request to a DIFFERENT language, its formatting data is unavailable → fallback.
      const resolved = fmt.resolvedOptions().locale.split("-")[0].toLowerCase();
      if (!locale.toLowerCase().startsWith(resolved)) return null;
      return fmt;
    } catch {
      return null; // invalid tag or formatter construction failure → fallback
    }
  };
  // Step-wise fallback chain — the returned formatter can NEVER be null:
  // verified active locale → en-ZA → generic English → runtime default.
  let fmt = build(locale);
  if (!fmt) fmt = build("en-ZA");
  if (!fmt) fmt = build("en");
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat(undefined, { timeZone: TZ, ...PART_OPTIONS[part] });
    } catch {
      fmt = new Intl.DateTimeFormat(undefined, { timeZone: TZ });
    }
  }
  fmtCache.set(cacheKey, fmt);
  return fmt;
}

function dayNumber(d: Date): number {
  const [dd, mm, yyyy] = dayFmt.format(d).split("/").map(Number);
  return Math.floor(Date.UTC(yyyy, mm - 1, dd) / 864e5);
}

export interface EventTimeParts {
  /** "14:05" in the requested locale. */
  time: string;
  /** Long weekday name in the requested locale. */
  weekday: string;
  /** "12 Mar 2026" (locale equivalent) in the requested locale. */
  date: string;
  /** Whole days between the event and `now` (negative/0 = today). */
  dayDiff: number;
}

/** Locale-aware parts of an event timestamp; null when the timestamp is missing or invalid. */
export function eventTimeParts(iso?: string | null, now: Date = new Date(), lng?: string | null): EventTimeParts | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const locale = lng ?? presentationLocale() ?? "en-ZA";
  return {
    time: fmtFor("time", locale).format(d),
    weekday: fmtFor("weekday", locale).format(d),
    date: fmtFor("date", locale).format(d),
    dayDiff: dayNumber(now) - dayNumber(d),
  };
}

/**
 * "Today, 14:05" · "Yesterday, 09:30" · "Tuesday, 14:05" (within a week) · "12 Mar 2026, 14:05".
 * Date/time parts follow the presentation locale (verified, en-ZA fallback); the relative
 * words are English here — decision surfaces compose them from the catalog via
 * formatEventTimeLocal (src/i18n/strings.ts). Timezone stays Africa/Johannesburg.
 */
export function formatEventTime(iso?: string | null, now: Date = new Date()): string {
  const parts = eventTimeParts(iso, now);
  if (!parts) return "Time not recorded";
  if (parts.dayDiff <= 0) return `Today, ${parts.time}`;
  if (parts.dayDiff === 1) return `Yesterday, ${parts.time}`;
  if (parts.dayDiff < 7) return `${parts.weekday}, ${parts.time}`;
  return `${parts.date}, ${parts.time}`;
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

