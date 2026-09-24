import type { Status } from "../types";

/**
 * Result Integrity Record (RIR) client types + pure presentation helpers.
 *
 * The record is DERIVED on the backend from the stored assessment and its sealed audit entries
 * (GET /api/assessments/{id}/integrity-record) — the UI never fabricates one and never keeps a
 * second copy of the derivation logic. These types mirror that canonical JSON exactly.
 *
 * Framing rule: a record is an operational integrity assessment under the configured
 * demonstration policy. It is never presented as clinical truth, a diagnostic correctness
 * score, a patient safety probability, or a medical confidence measure.
 */

export type EvidenceQualityState =
  | "valid"
  | "aging"
  | "missing"
  | "stale"
  | "expired"
  | "failed"
  | "conflicting"
  | "unverified-source";

export const EVIDENCE_STATES: EvidenceQualityState[] = [
  "valid", "aging", "missing", "stale", "expired", "failed", "conflicting", "unverified-source",
];

export function isEvidenceQualityState(v: unknown): v is EvidenceQualityState {
  return typeof v === "string" && (EVIDENCE_STATES as string[]).includes(v);
}

export interface RirCoverageItem {
  domain: string;
  label: string;
  available: boolean;
  state: EvidenceQualityState;
}

export interface RirCoverage {
  requiredAvailable: number;
  requiredTotal: number;
  statement: string;
  items: RirCoverageItem[];
}

export interface RirEvidenceQuality {
  coverage: RirCoverage;
  freshness: string;
  agingCount: number;
  staleCount: number;
  expiredCount: number;
  consistency: string;
  conflictCount: number;
  traceability: string;
}

export interface RirDomain {
  domain: string;
  label: string;
  requiredByPolicy: boolean;
  available: boolean;
  state: EvidenceQualityState;
  source: string;
  recorded: string;
  contributedToDecision: boolean;
  note: string;
}

export interface RirPolicyWindow { domain: string; boundary: string; days: number; }
export interface RirPolicyRange { measure: string; minimum: number; maximum: number; unit: string; }

export interface RirPolicy {
  name: string;
  version: string;
  kind: string;
  note: string;
  requiredDomains: string[];
  freshnessWindows: RirPolicyWindow[];
  supportedEnvironment: RirPolicyRange[];
}

export interface RirAiContext {
  consulted: boolean;
  summary?: string | null;
  role: string;
  note: string;
}

export interface RirAudit {
  entries: number;
  sealedEntries: number;
  algorithm: string;
  status: string;
  note: string;
}

export interface RirRecord {
  recordVersion: string;
  assessmentId: string;
  result: string;
  testType: string;
  eventTimeUtc: string;
  disposition: string;
  dispositionStatement: string;
  evidenceQuality: RirEvidenceQuality;
  domains: RirDomain[];
  decisionDrivers: string[];
  recommendedAction: string;
  policy: RirPolicy;
  aiContext: RirAiContext;
  audit: RirAudit;
  basisNote: string;
  projectedAtUtc: string;
}

/** Records whose disposition the existing status vocabulary can render. */
export function rirDispositionStatus(record: RirRecord): Status | null {
  return record.disposition === "Trust" || record.disposition === "Review" || record.disposition === "Verify"
    ? record.disposition
    : null;
}

/**
 * Chip tone per evidence-quality state, using the established Precision Instrument palette.
 * Pure strings (no JSX) so the contract tests can exercise this module directly.
 */
export const STATE_TONE: Record<EvidenceQualityState, { chip: string; dot: string }> = {
  valid: { chip: "bg-[#EAF7F1] text-[#167A5A]", dot: "#167A5A" },
  aging: { chip: "bg-[#FFF7E6] text-[#8A6116]", dot: "#B7791F" },
  missing: { chip: "bg-[#F0F3F8] text-[#607087]", dot: "#8A97A8" },
  stale: { chip: "bg-[#FFF7E6] text-[#B7791F]", dot: "#B7791F" },
  expired: { chip: "bg-[#FDEEEE] text-[#C43D3D]", dot: "#C43D3D" },
  failed: { chip: "bg-[#FDEEEE] text-[#C43D3D]", dot: "#C43D3D" },
  conflicting: { chip: "bg-[#EAF2FB] text-[#1E5AA8]", dot: "#1E5AA8" },
  "unverified-source": { chip: "bg-[#F0F3F8] text-[#8A6116]", dot: "#8A97A8" },
};

export function stateTone(state: EvidenceQualityState): { chip: string; dot: string } {
  return STATE_TONE[state] ?? STATE_TONE.missing;
}

/**
 * Coverage glyph for a required domain: ✓ when its evidence was available, ? when it was not.
 * Availability is about EXISTENCE of evidence — a failed control is still evidence the engine had.
 */
export function coverageGlyph(item: RirCoverageItem): string {
  return item.available ? "✓" : "?";
}

/** Unique human evidence-source list for the record's provenance section. */
export function evidenceSources(record: RirRecord): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of record.domains) {
    if (!d.available) continue;
    if (!seen.has(d.source)) {
      seen.add(d.source);
      out.push(d.source);
    }
  }
  return out;
}

/** Defensive parse of the endpoint payload — unknown shapes never reach the document view. */
export function parseRir(raw: unknown): RirRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.assessmentId !== "string" || typeof r.disposition !== "string") return null;
  const eq = (r.evidenceQuality ?? {}) as Record<string, unknown>;
  const coverage = (eq.coverage ?? {}) as Record<string, unknown>;
  const domains = Array.isArray(r.domains) ? r.domains : [];
  const policy = (r.policy ?? {}) as Record<string, unknown>;
  const ai = (r.aiContext ?? {}) as Record<string, unknown>;
  const audit = (r.audit ?? {}) as Record<string, unknown>;
  const normState = (s: unknown): EvidenceQualityState => (isEvidenceQualityState(s) ? s : "missing");
  return {
    recordVersion: typeof r.recordVersion === "string" ? r.recordVersion : "rir-v1",
    assessmentId: r.assessmentId,
    result: typeof r.result === "string" ? r.result : "Not recorded",
    testType: typeof r.testType === "string" ? r.testType : "Not recorded",
    eventTimeUtc: typeof r.eventTimeUtc === "string" ? r.eventTimeUtc : "",
    disposition: r.disposition,
    dispositionStatement: typeof r.dispositionStatement === "string" ? r.dispositionStatement : "",
    evidenceQuality: {
      coverage: {
        requiredAvailable: typeof coverage.requiredAvailable === "number" ? coverage.requiredAvailable : 0,
        requiredTotal: typeof coverage.requiredTotal === "number" ? coverage.requiredTotal : 0,
        statement: typeof coverage.statement === "string" ? coverage.statement : "",
        items: (Array.isArray(coverage.items) ? coverage.items : []).map((i) => {
          const c = (i ?? {}) as Record<string, unknown>;
          return {
            domain: typeof c.domain === "string" ? c.domain : "",
            label: typeof c.label === "string" ? c.label : humanFallback(c.domain),
            available: c.available === true,
            state: normState(c.state),
          };
        }),
      },
      freshness: typeof eq.freshness === "string" ? eq.freshness : "Not recorded",
      agingCount: typeof eq.agingCount === "number" ? eq.agingCount : 0,
      staleCount: typeof eq.staleCount === "number" ? eq.staleCount : 0,
      expiredCount: typeof eq.expiredCount === "number" ? eq.expiredCount : 0,
      consistency: typeof eq.consistency === "string" ? eq.consistency : "Not recorded",
      conflictCount: typeof eq.conflictCount === "number" ? eq.conflictCount : 0,
      traceability: typeof eq.traceability === "string" ? eq.traceability : "Not recorded",
    },
    domains: domains.map((d) => {
      const dom = (d ?? {}) as Record<string, unknown>;
      return {
        domain: typeof dom.domain === "string" ? dom.domain : "",
        label: typeof dom.label === "string" ? dom.label : humanFallback(dom.domain),
        requiredByPolicy: dom.requiredByPolicy === true,
        available: dom.available === true,
        state: normState(dom.state),
        source: typeof dom.source === "string" ? dom.source : "Not recorded",
        recorded: typeof dom.recorded === "string" ? dom.recorded : "Not recorded",
        contributedToDecision: dom.contributedToDecision === true,
        note: typeof dom.note === "string" ? dom.note : "",
      };
    }),
    decisionDrivers: (Array.isArray(r.decisionDrivers) ? r.decisionDrivers : []).filter(
      (x): x is string => typeof x === "string" && x.length > 0,
    ),
    recommendedAction: typeof r.recommendedAction === "string" ? r.recommendedAction : "",
    policy: {
      name: typeof policy.name === "string" ? policy.name : "Demonstration policy",
      version: typeof policy.version === "string" ? policy.version : "",
      kind: typeof policy.kind === "string" ? policy.kind : "demonstration",
      note: typeof policy.note === "string" ? policy.note : "",
      requiredDomains: (Array.isArray(policy.requiredDomains) ? policy.requiredDomains : []).filter(
        (x): x is string => typeof x === "string",
      ),
      freshnessWindows: (Array.isArray(policy.freshnessWindows) ? policy.freshnessWindows : []).map((w) => {
        const win = (w ?? {}) as Record<string, unknown>;
        return {
          domain: typeof win.domain === "string" ? win.domain : "",
          boundary: typeof win.boundary === "string" ? win.boundary : "",
          days: typeof win.days === "number" ? win.days : 0,
        };
      }),
      supportedEnvironment: (Array.isArray(policy.supportedEnvironment) ? policy.supportedEnvironment : []).map((g) => {
        const rng = (g ?? {}) as Record<string, unknown>;
        return {
          measure: typeof rng.measure === "string" ? rng.measure : "",
          minimum: typeof rng.minimum === "number" ? rng.minimum : 0,
          maximum: typeof rng.maximum === "number" ? rng.maximum : 0,
          unit: typeof rng.unit === "string" ? rng.unit : "",
        };
      }),
    },
    aiContext: {
      consulted: ai.consulted === true,
      summary: typeof ai.summary === "string" ? ai.summary : null,
      role: typeof ai.role === "string" ? ai.role : "advisory",
      note: typeof ai.note === "string" ? ai.note : "",
    },
    audit: {
      entries: typeof audit.entries === "number" ? audit.entries : 0,
      sealedEntries: typeof audit.sealedEntries === "number" ? audit.sealedEntries : 0,
      algorithm: typeof audit.algorithm === "string" ? audit.algorithm : "",
      status: typeof audit.status === "string" ? audit.status : "Assessment record available",
      note: typeof audit.note === "string" ? audit.note : "",
    },
    basisNote: typeof r.basisNote === "string" ? r.basisNote : "",
    projectedAtUtc: typeof r.projectedAtUtc === "string" ? r.projectedAtUtc : "",
  };
}

function humanFallback(domain: unknown): string {
  return typeof domain === "string" && domain.trim()
    ? domain.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())
    : "Evidence domain";
}
