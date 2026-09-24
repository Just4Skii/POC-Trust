import type { AssessmentSummary, AuditRow, DashboardSummary, Decision } from "../types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  evaluate: (body: unknown) =>
    fetch("/api/assessments/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(json<Decision>),
  demo: (kind: string) => fetch(`/api/assessments/demo/${kind}`).then(json<Decision>),
  assessments: (take = 100) => fetch(`/api/assessments?take=${take}`).then(json<AssessmentSummary[]>),
  assessmentDetail: (id: string) =>
    fetch(`/api/assessments/${id}`).then(
      json<{
        assessment: Record<string, unknown>;
        input: Record<string, unknown>;
        reasons: string[];
        ruleIds: string[];
        audit: AuditRow[];
      }>,
    ),
  audit: (take = 100) => fetch(`/api/assessments/audit?take=${take}`).then(json<AuditRow[]>),
  auditDetail: (assessmentId: string) => fetch(`/api/audit/${assessmentId}`).then(json<AuditRow[]>),
  summary: () => fetch("/api/dashboard/summary").then(json<DashboardSummary>),
  devices: () => fetch("/api/devices").then(json<{ items: unknown[]; note: string }>),
  operators: () => fetch("/api/operators").then(json<{ items: unknown[]; note: string }>),
  qc: () => fetch("/api/quality-controls").then(json<Record<string, unknown>>),
};
