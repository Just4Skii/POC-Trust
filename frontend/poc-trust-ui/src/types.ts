export type Status = "Trust" | "Review" | "Verify";
export type StatusCode = Status | number;

export interface AiAssessment {
  summary: string;
  anomalies: string[];
  recommendedAction: string;
  confidence: number;
  model: string;
}

export interface Decision {
  id: string;
  initialStatus: StatusCode;
  finalStatus: StatusCode;
  reasons: string[];
  ruleIds: string[];
  action: string;
  aiAssessment?: AiAssessment | null;
  aiConsulted: boolean;
  decidedAtUtc?: string;
}

export interface AssessmentSummary {
  id: string;
  result: string;
  deviceId: string;
  provenance?: string;
  initialStatus: StatusCode;
  finalStatus: StatusCode;
  aiConsulted: boolean;
  action: string;
  decidedAtUtc: string;
  timestampUtc?: string;
  testType?: string;
  operatorId?: string;
  connectivity?: string;
}

export interface AuditRow {
  id: string;
  assessmentId: string;
  initialStatus: StatusCode;
  finalStatus: StatusCode;
  aiConsulted: boolean;
  aiSummary?: string | null;
  action: string;
  timestampUtc: string;
  inputJson?: string;
}

export interface DashboardSummary {
  counts: { trust: number; review: number; verify: number; total: number };
  offlineCount: number;
  aiConsultedCount: number;
  recent: AssessmentSummary[];
  recentAudit: AuditRow[];
  source: string;
}

export interface EvidenceInput {
  result?: string;
  testType?: string;
  deviceId?: string;
  qcPassed?: boolean;
  calibrationDueUtc?: string;
  operatorId?: string;
  operatorCompetent?: boolean;
  reagentLot?: string;
  reagentExpiryUtc?: string;
  temperatureC?: number;
  humidityPct?: number;
  powerInterruption?: boolean;
  provenance?: string;
  connectivity?: string;
  localEventId?: string;
  timestampUtc?: string;
}

export const statusName = (s: StatusCode): Status =>
  typeof s === "string" ? (s as Status) : (["Trust", "Review", "Verify"] as Status[])[s] ?? "Review";

export const statusIcon = (s: StatusCode): string => {
  const n = statusName(s);
  return n === "Trust" ? "✓" : n === "Review" ? "!" : "■";
};

export const canRelyText = (s: StatusCode): string => {
  const n = statusName(s);
  return n === "Trust"
    ? "Yes — may proceed subject to routine controls."
    : n === "Review"
      ? "Not yet — trained-operator review required."
      : "No — do not rely on this result alone.";
};
