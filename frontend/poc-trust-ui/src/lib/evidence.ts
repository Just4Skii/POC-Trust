import type { EvidenceInput } from "../types";

export interface EvidenceItem {
  key: string;
  label: string;
  state: "ok" | "warn" | "fail";
  value: string;
  detail: string;
  rule?: string;
}

function fmtDate(v?: string) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
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
    { key: "device", label: "Device", state: "ok", value: input.deviceId ?? "—", detail: `Source: event record · ${fmtDate(input.timestampUtc)}`, rule: undefined },
    { key: "qc", label: "Quality Control", state: input.qcPassed ? "ok" : "fail", value: input.qcPassed ? "QC passed" : "QC FAILED", detail: `Device ${input.deviceId ?? "—"} · Source: device QC record`, rule: has("QC_FAILED") ? "QC_FAILED → VERIFY" : undefined },
    { key: "cal", label: "Calibration / Maintenance", state: has("CAL_EXPIRED") ? "fail" : has("CAL_NEAR_DUE") ? "warn" : "ok", value: input.calibrationDueUtc ? `Due ${fmtDate(input.calibrationDueUtc)}` : "—", detail: "Source: calibration record", rule: has("CAL_EXPIRED") ? "CAL_EXPIRED → VERIFY" : has("CAL_NEAR_DUE") ? "CAL_NEAR_DUE → REVIEW" : undefined },
    { key: "op", label: "Operator", state: input.operatorCompetent ? "ok" : "warn", value: input.operatorId ? `${input.operatorId} · ${input.operatorCompetent ? "competent" : "not competent"}` : "Unknown operator", detail: "Source: operator competency record — prototype data, identity not authenticated.", rule: has("OPERATOR_NOT_COMPETENT") ? "OPERATOR_NOT_COMPETENT → REVIEW" : undefined },
    { key: "reagent", label: "Reagent", state: has("REAGENT_EXPIRED") ? "fail" : has("REAGENT_NEAR_EXPIRY") ? "warn" : "ok", value: input.reagentLot ? `${input.reagentLot} · exp ${fmtDate(input.reagentExpiryUtc)}` : "Missing lot", detail: "Source: consumable record", rule: has("REAGENT_EXPIRED") ? "REAGENT_EXPIRED → VERIFY" : has("REAGENT_NEAR_EXPIRY") ? "REAGENT_NEAR_EXPIRY → REVIEW" : undefined },
    { key: "env", label: "Environment", state: has("ENV_TEMP") || has("ENV_HUMIDITY") ? "warn" : "ok", value: `${input.temperatureC ?? "—"}°C · ${input.humidityPct ?? "—"}%`, detail: `Power interruption: ${input.powerInterruption ? "YES" : "no"} · Source: site sensor`, rule: has("POWER_INTERRUPTION") ? "POWER_INTERRUPTION → REVIEW" : undefined },
    { key: "prov", label: "Provenance", state: has("PROVENANCE_INCOMPLETE") ? "warn" : "ok", value: input.provenance || "Incomplete", detail: `Operator ID as claimed: ${input.operatorId || "not recorded"} · WHERE ${input.provenance || "not recorded"} · ${fmtDate(input.timestampUtc)}`, rule: has("PROVENANCE_INCOMPLETE") ? "PROVENANCE_INCOMPLETE → REVIEW" : undefined },
    { key: "conn", label: "Connectivity", state: offline ? "warn" : "ok", value: `${input.connectivity ?? "online"}${input.localEventId ? ` · ${input.localEventId}` : ""}`, detail: offline ? "Offline: synchronisation metadata only — the deterministic engine has no connectivity rule in this prototype, so this does not make the result more or less reliable. Full sync engine is FUTURE." : "Prototype offline metadata; full sync engine is FUTURE.", rule: undefined },
  ];
}
