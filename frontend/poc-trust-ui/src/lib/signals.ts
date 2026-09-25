import type { EvidenceInput } from "../types";
import { formatEventTime } from "./labels.ts";

/**
 * Evidence telemetry rails (Section 8), an EVIDENCE SIGNALS visualisation, not patient vitals.
 *
 * TRUTHFULNESS: every marker position is computed from the real recorded value against the
 * deterministic engine's own supported ranges (temperature 15–30 °C, humidity 10–85 %,
 * calibration ≥ 7 days, the thresholds the rules fire at). Nothing is randomised; a missing
 * value renders "Not recorded" with no rail rather than an invented position.
 */

export interface SignalRail {
  min: number;
  max: number;
  /** Acceptable band, the subtly tinted region behind the rail. */
  bandLo: number;
  bandHi: number;
  /** Current value clamped into [min, max]. */
  value: number;
}

export interface Signal {
  key: string;
  label: string;
  /** Human value with unit, ready for mono display. */
  valueText: string;
  state: "ok" | "warn" | "fail";
  /** Short plain-language status beneath the rail. */
  note: string;
  rail?: SignalRail;
}

const pct = (v: number, min: number, max: number) => Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));

/** Pixel-free position helpers shared with the SignalRail component. */
export const bandLeftPct = (r: SignalRail) => pct(r.bandLo, r.min, r.max);
export const bandRightPct = (r: SignalRail) => 100 - pct(r.bandHi, r.min, r.max);
export const markerPct = (r: SignalRail) => pct(r.value, r.min, r.max);

function temperatureSignal(input: EvidenceInput, has: (rule: string) => boolean): Signal {
  const t = input.temperatureC;
  const outside = has("ENV_TEMP");
  if (typeof t !== "number" || !Number.isFinite(t)) {
    return { key: "temp", label: "Temperature", valueText: "Not recorded", state: "ok", note: "No temperature recorded for this event." };
  }
  return {
    key: "temp",
    label: "Temperature",
    valueText: `${t.toFixed(1)} °C`,
    state: outside ? "warn" : "ok",
    note: outside ? "Outside the supported 15–30 °C range." : "Within the supported 15–30 °C range.",
    rail: { min: 10, max: 40, bandLo: 15, bandHi: 30, value: t },
  };
}

function humiditySignal(input: EvidenceInput, has: (rule: string) => boolean): Signal {
  const h = input.humidityPct;
  const outside = has("ENV_HUMIDITY");
  if (typeof h !== "number" || !Number.isFinite(h)) {
    return { key: "hum", label: "Humidity", valueText: "Not recorded", state: "ok", note: "No humidity recorded for this event." };
  }
  return {
    key: "hum",
    label: "Humidity",
    valueText: `${Math.round(h)} %`,
    state: outside ? "warn" : "ok",
    note: outside ? "Outside the supported 10–85 % range." : "Within the supported 10–85 % range.",
    rail: { min: 0, max: 100, bandLo: 10, bandHi: 85, value: h },
  };
}

function calibrationSignal(input: EvidenceInput, has: (rule: string) => boolean): Signal {
  if (!input.calibrationDueUtc) {
    return { key: "cal", label: "Calibration", valueText: "Not recorded", state: "warn", note: "No calibration due date recorded." };
  }
  const due = new Date(input.calibrationDueUtc);
  if (Number.isNaN(due.getTime())) {
    return { key: "cal", label: "Calibration", valueText: "Not recorded", state: "warn", note: "Calibration date could not be read." };
  }
  const ref = input.timestampUtc ? new Date(input.timestampUtc) : new Date();
  const days = Math.floor((due.getTime() - ref.getTime()) / 86_400_000);
  const state: Signal["state"] = has("CAL_EXPIRED") || days < 0 ? "fail" : has("CAL_NEAR_DUE") || days < 7 ? "warn" : "ok";
  const note =
    state === "fail"
      ? `Overdue, due ${formatEventTime(input.calibrationDueUtc)}.`
      : state === "warn"
        ? "Due within the next 7 days."
        : `Due ${formatEventTime(input.calibrationDueUtc)}, at least 7 days of margin.`;
  return {
    key: "cal",
    label: "Calibration",
    valueText: days < 0 ? `Overdue ${Math.abs(days)} d` : `Due in ${days} d`,
    state,
    note,
    // Rail spans −30 d … 365 d; the acceptable band starts at the engine's 7-day threshold.
    rail: { min: -30, max: 365, bandLo: 7, bandHi: 365, value: days },
  };
}

/** The three genuinely continuous evidence signals. Discrete checks stay in the evidence list. */
export function evidenceSignals(input: EvidenceInput, ruleIds: string[]): Signal[] {
  const has = (rule: string) => ruleIds.includes(rule);
  return [temperatureSignal(input, has), humiditySignal(input, has), calibrationSignal(input, has)];
}
