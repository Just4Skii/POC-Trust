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
  /** Compact integrity fields derived by the same projector as the full record (spec 27).
   *  Optional: rows render fine without it (older cached payload, unprojectable record). */
  integrity?: RowIntegrity | null;
}

/** Compact per-row integrity fields — the list-row mirror of the full Result Integrity Record. */
export interface RowIntegrity {
  coverageAvailable: number;
  coverageRequired: number;
  concerns: number;
  agingCount: number;
  expiredCount: number;
  failedCount: number;
  conflictCount: number;
  primaryDriverLabel: string | null;
  primaryDriverState: string | null;
  primaryDriverStatement: string | null;
  policy: string;
  auditEntries: number;
  auditSealed: number;
  auditAvailable: boolean;
}

/** Dashboard Integrity Overview aggregates (spec 26) — calculated from the stored records. */
export interface IntegrityOverview {
  assessments: number;
  coveragePercent: number;
  coverageStatement: string;
  assessmentsWithConcerns: number;
  conflicts: number;
  assessmentsWithAging: number;
  note: string;
}

/** One step of the stored demonstration decision sequence (spec 30). */
export interface DemonstrationStep {
  assessmentId: string;
  result: string;
  testType: string;
  decidedAtUtc: string;
  disposition: string;
  policy: string;
  change: string | null;
}

export interface DemonstrationSequence {
  available: boolean;
  label: string;
  note: string;
  aiInvolved: boolean;
  steps: DemonstrationStep[];
  source: string;
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
  integrity?: IntegrityOverview;
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
