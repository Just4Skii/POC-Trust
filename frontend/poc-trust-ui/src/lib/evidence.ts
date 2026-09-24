import type { EvidenceInput } from "../types";
import type { EvidenceQualityState } from "./rir.ts";
import { formatEventTime } from "./labels.ts";

export interface EvidenceItem {
  key: string;
  label: string;
  state: "ok" | "warn" | "fail";
  /** Rule-first evidence-quality classification (mirrors the backend record derivation). */
  quality: EvidenceQualityState;
  value: string;
  detail: string;
  /** Raw rule string — rendered ONLY inside the TechnicalDetails disclosure. */
  rule?: string;
  /** True when a deterministic rule fired for this row (drives attention-first ordering). */
  contributed: boolean;
}

function fmtDate(v?: string) {
  return v ? formatEventTime(v) : "Not recorded";
}

/**
 * Rule-first quality classification per evidence row — the SAME derivation the backend record
 * projector uses: states come from the engine's recorded rule IDs (never re-derived from raw
 * inputs), so presentation can never disagree with the decision.
 */
export function qualityFor(key: string, input: EvidenceInput, ruleIds: string[]): EvidenceQualityState {
  const has = (r: string) => ruleIds.includes(r);
  switch (key) {
    case "device":
      return input.deviceId ? "valid" : "missing";
    case "qc":
      return has("QC_FAILED") ? "failed" : "valid";
    case "cal":
      return has("CAL_EXPIRED") ? "expired" : has("CAL_NEAR_DUE") ? "aging" : "valid";
    case "op":
      return input.operatorId ? (has("OPERATOR_NOT_COMPETENT") ? "expired" : "valid") : "missing";
    case "reagent":
      return !input.reagentLot
        ? "missing"
        : has("REAGENT_EXPIRED") ? "expired" : has("REAGENT_NEAR_EXPIRY") ? "aging" : "valid";
    case "env":
      return has("ENV_TEMP") || has("ENV_HUMIDITY") ? "failed" : "valid";
    case "power":
      return has("POWER_INTERRUPTION") ? "failed" : "valid";
    case "prov":
      return !input.provenance ? "missing" : has("PROVENANCE_INCOMPLETE") ? "unverified-source" : "valid";
    default:
      return "valid"; // connectivity and other metadata rows carry no quality classification
  }
}

/**
 * Presentation of recorded evidence. State comes from the deterministic engine's rule IDs, so the
 * rows cannot disagree with the decision. Connectivity is deliberately shown as prototype
 * synchronisation metadata — offline is not a reliability rule in this build, and is not treated
 * as either reassuring or disqualifying.
 */
export function evidenceItems(input: EvidenceInput, ruleIds: string[]): EvidenceItem[] {
  const has = (r: string) => ruleIds.includes(r);
  const offline = (input.connectivity ?? "online") === "offline";
  return [
    { key: "device", label: "Device", state: "ok", quality: qualityFor("device", input, ruleIds), value: input.deviceId ?? "Not recorded", detail: `Source: event record · ${fmtDate(input.timestampUtc)}`, rule: undefined, contributed: false },
    { key: "qc", label: "Quality control", state: input.qcPassed ? "ok" : "fail", quality: qualityFor("qc", input, ruleIds), value: input.qcPassed ? "Passed" : "Failed", detail: `Device ${input.deviceId ?? "not recorded"} · Source: device QC record`, rule: has("QC_FAILED") ? "QC_FAILED → VERIFY" : undefined, contributed: has("QC_FAILED") },
    { key: "cal", label: "Calibration / maintenance", state: has("CAL_EXPIRED") ? "fail" : has("CAL_NEAR_DUE") ? "warn" : "ok", quality: qualityFor("cal", input, ruleIds), value: input.calibrationDueUtc ? `Due ${fmtDate(input.calibrationDueUtc)}` : "Not recorded", detail: "Source: calibration record", rule: has("CAL_EXPIRED") ? "CAL_EXPIRED → VERIFY" : has("CAL_NEAR_DUE") ? "CAL_NEAR_DUE → REVIEW" : undefined, contributed: has("CAL_EXPIRED") || has("CAL_NEAR_DUE") },
    { key: "op", label: "Operator", state: input.operatorCompetent ? "ok" : "warn", quality: qualityFor("op", input, ruleIds), value: input.operatorId ? `${input.operatorId} · ${input.operatorCompetent ? "competency current" : "competency not current"}` : "Operator not recorded", detail: "Source: operator competency record — prototype data, identity not authenticated.", rule: has("OPERATOR_NOT_COMPETENT") ? "OPERATOR_NOT_COMPETENT → REVIEW" : undefined, contributed: has("OPERATOR_NOT_COMPETENT") },
    { key: "reagent", label: "Reagent", state: has("REAGENT_EXPIRED") ? "fail" : has("REAGENT_NEAR_EXPIRY") ? "warn" : "ok", quality: qualityFor("reagent", input, ruleIds), value: input.reagentLot ? `${input.reagentLot} · expires ${fmtDate(input.reagentExpiryUtc)}` : "Lot not recorded", detail: "Source: consumable record", rule: has("REAGENT_EXPIRED") ? "REAGENT_EXPIRED → VERIFY" : has("REAGENT_NEAR_EXPIRY") ? "REAGENT_NEAR_EXPIRY → REVIEW" : undefined, contributed: has("REAGENT_EXPIRED") || has("REAGENT_NEAR_EXPIRY") },
    { key: "env", label: "Environment", state: has("ENV_TEMP") || has("ENV_HUMIDITY") ? "warn" : "ok", quality: qualityFor("env", input, ruleIds), value: `${input.temperatureC ?? "—"}°C · ${input.humidityPct ?? "—"}%`, detail: input.powerInterruption ? "Power interruption recorded · Source: site sensor" : "No power interruption recorded · Source: site sensor", rule: has("POWER_INTERRUPTION") ? "POWER_INTERRUPTION → REVIEW" : undefined, contributed: has("ENV_TEMP") || has("ENV_HUMIDITY") || has("POWER_INTERRUPTION") },
    { key: "prov", label: "Provenance", state: has("PROVENANCE_INCOMPLETE") ? "warn" : "ok", quality: qualityFor("prov", input, ruleIds), value: input.provenance || "Not fully recorded", detail: `Operator ID as claimed: ${input.operatorId || "not recorded"} · Where: ${input.provenance || "not recorded"} · ${fmtDate(input.timestampUtc)}`, rule: has("PROVENANCE_INCOMPLETE") ? "PROVENANCE_INCOMPLETE → REVIEW" : undefined, contributed: has("PROVENANCE_INCOMPLETE") },
    { key: "conn", label: "Connectivity", state: offline ? "warn" : "ok", quality: "valid", value: offline ? "Offline event" : "Online", detail: offline ? "Offline: synchronisation metadata only — the deterministic engine has no connectivity rule in this prototype, so this does not make the result more or less reliable. Full sync engine is FUTURE." : "Prototype offline metadata; full sync engine is FUTURE.", rule: undefined, contributed: false },
  ];
}
