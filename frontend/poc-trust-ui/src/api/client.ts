import type { AssessmentSummary, AuditRow, DashboardSummary, Decision, DemoResetResult, DemoSeedResult, DemoStatus } from "../types";

/** Surfaces the API's safe error envelope ({"error":"..."}) instead of a bare status code. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    /* non-JSON error body — fall through to the status code */
  }
  return `API ${res.status}`;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  return res.json() as Promise<T>;
}

export const api = {
  /** Evaluate an assessment. `idempotencyKey` makes a retried submission (offline sync replay)
   *  return the original decision instead of creating a duplicate assessment. */
  evaluate: (body: unknown, idempotencyKey?: string) =>
    fetch("/api/assessments/evaluate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    }).then(json<Decision>),
  demoStatus: () => fetch("/api/demo/status").then(json<DemoStatus>),
  demoSeed: () => fetch("/api/demo/seed", { method: "POST" }).then(json<DemoSeedResult>),
  demoReset: () => fetch("/api/demo/reset", { method: "POST" }).then(json<DemoResetResult>),
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
