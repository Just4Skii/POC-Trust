import type { Decision, EvidenceInput, StatusCode } from "../types";

/**
 * Rebuilds UI models from a persisted assessment.
 *
 * Persisted evidence is camelCase (canonical). Records written by earlier prototype builds are
 * PascalCase, so lookups here are case-insensitive: a reopened assessment must show the same
 * evidence values it was created with (operator competency, calibration, temperature, ...).
 */

function lookup(raw: unknown): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (typeof raw === "object" && raw !== null) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      map.set(key.toLowerCase(), value);
    }
  }
  return map;
}

const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const asBoolean = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const asNumber = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export function normaliseEvidenceInput(raw: unknown): EvidenceInput {
  const map = lookup(raw);
  const get = (key: keyof EvidenceInput) => map.get(String(key).toLowerCase());
  return {
    result: asString(get("result")),
    testType: asString(get("testType")),
    deviceId: asString(get("deviceId")),
    qcPassed: asBoolean(get("qcPassed")),
    calibrationDueUtc: asString(get("calibrationDueUtc")),
    operatorId: asString(get("operatorId")),
    operatorCompetent: asBoolean(get("operatorCompetent")),
    reagentLot: asString(get("reagentLot")),
    reagentExpiryUtc: asString(get("reagentExpiryUtc")),
    temperatureC: asNumber(get("temperatureC")),
    humidityPct: asNumber(get("humidityPct")),
    powerInterruption: asBoolean(get("powerInterruption")),
    provenance: asString(get("provenance")),
    connectivity: asString(get("connectivity")),
    localEventId: asString(get("localEventId")),
    timestampUtc: asString(get("timestampUtc")),
    demoKey: asString(get("demoKey")),
  };
}

export interface StoredAssessment {
  id: string;
  initialStatus: StatusCode;
  finalStatus: StatusCode;
  action: string;
  aiSummary?: string | null;
  aiConsulted: boolean;
  decidedAtUtc?: string;
}

/**
 * Reconstructs a decision from stored fields only. The record persists the advisory *summary*;
 * it does not persist a model name or confidence score, so none is presented for history.
 */
export function toDecision(assessment: StoredAssessment, reasons: unknown, ruleIds: unknown): Decision {
  const summary = (assessment.aiSummary ?? "").trim();
  return {
    id: assessment.id,
    initialStatus: assessment.initialStatus,
    finalStatus: assessment.finalStatus,
    reasons: asStringArray(reasons),
    ruleIds: asStringArray(ruleIds),
    action: assessment.action,
    aiAssessment: summary ? { summary } : null,
    aiConsulted: assessment.aiConsulted,
    decidedAtUtc: assessment.decidedAtUtc,
  };
}
