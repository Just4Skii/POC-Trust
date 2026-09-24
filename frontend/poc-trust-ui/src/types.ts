export type Status = "Trust" | "Review" | "Verify";
export type StatusCode = Status | number;

export interface AiAssessment {
  summary: string;
  /** Only populated when the provider/decision actually supplied them — never fabricated for history. */
  anomalies?: string[];
  recommendedAction?: string;
  confidence?: number;
  model?: string;
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
  /** Present only on controlled demonstration records (backend demo marker). */
  demoKey?: string;
}

/** /api/demo lifecycle payloads (Development-only endpoints). */
export interface DemoStatus {
  enabled: boolean;
  totalRecords: number;
  demoRecords: number;
  expectedRecords: number;
  seeded: string[];
}

export interface DemoSeedResult {
  loaded: number;
  skipped: number;
  seededKeys: { key: string; id: string; title: string; status: string; aiConsulted: boolean }[];
  alreadyPresent: string[];
  distributionMismatches: { key: string; expected: string; computed: string }[];
}

export interface DemoResetResult {
  removed: number;
  auditRemoved: number;
  remainingRecords: number;
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
