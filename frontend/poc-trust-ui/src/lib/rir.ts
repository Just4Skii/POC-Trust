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
  sourceIdentifier?: string | null;
  verification: string;
  recordReference?: string | null;
  relatedRuleIds: string[];
}

export interface RirPolicyWindow { domain: string; boundary: string; days: number; }
export interface RirPolicyRange { measure: string; minimum: number; maximum: number; unit: string; }

export interface RirPolicy {
  id: string;
  name: string;
  version: string;
  kind: string;
  note: string;
  requiredDomains: string[];
  contextualDomains: string[];
  freshnessWindows: RirPolicyWindow[];
  supportedEnvironment: RirPolicyRange[];
  selectionNote: string;
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

// ── Decision causality (spec sections 12/14) ─────────────────────────────────

export interface RirDecisionDriver {
  ruleId: string;
  statement: string;
  domain: string;
  domainLabel: string;
  evidenceState: EvidenceQualityState;
  role: string;
}

export interface RirCounterfactual {
  label: string;
  method: string;
  changedEvidence: string;
  change: string;
  currentDisposition: string;
  counterfactualDisposition: string;
  statement: string;
  basisNote: string;
}

export interface RirCausality {
  primaryDrivers: RirDecisionDriver[];
  secondaryConsiderations: RirDecisionDriver[];
  contextualNotes: RirDecisionDriver[];
  counterfactual: RirCounterfactual | null;
  derivationNote: string;
  verified: boolean;
}

// ── Evidence conflict (spec section 10) ──────────────────────────────────────

export interface RirConflict {
  sourceA: string;
  sourceAState: string;
  sourceB: string;
  sourceBState: string;
  conflict: string;
  whyItMatters: string;
  relatedRuleIds: string;
}

// ── Integrity timeline (spec section 13) ─────────────────────────────────────

export interface RirTimelineEntry {
  timeUtc: string;
  kind: string;
  title: string;
  detail: string;
  evidenceState: EvidenceQualityState | null;
  disposition: string | null;
  transition: string | null;
  basis: string;
}

export interface RirTimeline {
  label: string;
  note: string;
  entries: RirTimelineEntry[];
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
  causality: RirCausality | null;
  conflicts: RirConflict[];
  timeline: RirTimeline | null;
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

/** Domain states that count as concerns in the summary card's "Quality" tile. */
export const CONCERN_STATES: EvidenceQualityState[] = [
  "aging", "stale", "expired", "failed", "conflicting", "unverified-source",
];

/**
 * The summary card's quality line: how many evidence domains are in a concerning state, with a
 * deterministic breakdown phrase ("1 aging · 1 expired"). Derived ONLY from the record's own
 * domain rows — never invented client-side.
 */
export function qualityConcerns(record: RirRecord): { count: number; breakdown: string } {
  const counts = new Map<EvidenceQualityState, number>();
  for (const d of record.domains) {
    if (!CONCERN_STATES.includes(d.state)) continue;
    counts.set(d.state, (counts.get(d.state) ?? 0) + 1);
  }
  const order = CONCERN_STATES.filter((s) => counts.has(s));
  const count = [...counts.values()].reduce((a, b) => a + b, 0);
  const breakdown = order.map((s) => `${counts.get(s)} ${s.replace("-", " ")}`).join(" · ");
  return { count, breakdown };
}

/** Role vocabulary for decision drivers — qualitative only, never numeric weights. */
export const DRIVER_ROLES = ["primary", "secondary", "informational"] as const;

/** Short uppercase evidence-state word for chips and signal-map nodes. */
export function stateWord(state: EvidenceQualityState): string {
  return state.replace("-", " ").toUpperCase();
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
  const causalityRaw = (r.causality ?? null) as Record<string, unknown> | null;
  const normState = (s: unknown): EvidenceQualityState => (isEvidenceQualityState(s) ? s : "missing");

  const parseDriver = (d: unknown): RirDecisionDriver => {
    const v = (d ?? {}) as Record<string, unknown>;
    return {
      ruleId: typeof v.ruleId === "string" ? v.ruleId : "",
      statement: typeof v.statement === "string" ? v.statement : "",
      domain: typeof v.domain === "string" ? v.domain : "",
      domainLabel: typeof v.domainLabel === "string" ? v.domainLabel : "",
      evidenceState: normState(v.evidenceState),
      role: typeof v.role === "string" ? v.role : "informational",
    };
  };
  const parseDrivers = (v: unknown): RirDecisionDriver[] =>
    Array.isArray(v) ? v.map(parseDriver) : [];

  const parseCounterfactual = (v: unknown): RirCounterfactual | null => {
    if (typeof v !== "object" || v === null) return null;
    const c = v as Record<string, unknown>;
    return {
      label: typeof c.label === "string" ? c.label : "Deterministic decision comparison",
      method: typeof c.method === "string" ? c.method : "Rule-based counterfactual",
      changedEvidence: typeof c.changedEvidence === "string" ? c.changedEvidence : "",
      change: typeof c.change === "string" ? c.change : "",
      currentDisposition: typeof c.currentDisposition === "string" ? c.currentDisposition : "",
      counterfactualDisposition: typeof c.counterfactualDisposition === "string" ? c.counterfactualDisposition : "",
      statement: typeof c.statement === "string" ? c.statement : "",
      basisNote: typeof c.basisNote === "string" ? c.basisNote : "",
    };
  };

  const parseConflicts = (v: unknown): RirConflict[] =>
    (Array.isArray(v) ? v : []).map((c) => {
      const w = (c ?? {}) as Record<string, unknown>;
      return {
        sourceA: typeof w.sourceA === "string" ? w.sourceA : "",
        sourceAState: typeof w.sourceAState === "string" ? w.sourceAState : "",
        sourceB: typeof w.sourceB === "string" ? w.sourceB : "",
        sourceBState: typeof w.sourceBState === "string" ? w.sourceBState : "",
        conflict: typeof w.conflict === "string" ? w.conflict : "",
        whyItMatters: typeof w.whyItMatters === "string" ? w.whyItMatters : "",
        relatedRuleIds: typeof w.relatedRuleIds === "string" ? w.relatedRuleIds : "",
      };
    });

  const parseTimeline = (v: unknown): RirTimeline | null => {
    if (typeof v !== "object" || v === null) return null;
    const t = v as Record<string, unknown>;
    const entries = (Array.isArray(t.entries) ? t.entries : []).map((e) => {
      const w = (e ?? {}) as Record<string, unknown>;
      return {
        timeUtc: typeof w.timeUtc === "string" ? w.timeUtc : "",
        kind: typeof w.kind === "string" ? w.kind : "",
        title: typeof w.title === "string" ? w.title : "",
        detail: typeof w.detail === "string" ? w.detail : "",
        evidenceState: w.evidenceState == null ? null : normState(w.evidenceState),
        disposition: typeof w.disposition === "string" ? w.disposition : null,
        transition: typeof w.transition === "string" ? w.transition : null,
        basis: typeof w.basis === "string" ? w.basis : "recorded",
      };
    });
    return {
      label: typeof t.label === "string" ? t.label : "Integrity timeline",
      note: typeof t.note === "string" ? t.note : "",
      entries,
    };
  };

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
        sourceIdentifier: typeof dom.sourceIdentifier === "string" ? dom.sourceIdentifier : null,
        verification: typeof dom.verification === "string" ? dom.verification : "",
        recordReference: typeof dom.recordReference === "string" ? dom.recordReference : null,
        relatedRuleIds: (Array.isArray(dom.relatedRuleIds) ? dom.relatedRuleIds : []).filter(
          (x): x is string => typeof x === "string",
        ),
      };
    }),
    decisionDrivers: (Array.isArray(r.decisionDrivers) ? r.decisionDrivers : []).filter(
      (x): x is string => typeof x === "string" && x.length > 0,
    ),
    recommendedAction: typeof r.recommendedAction === "string" ? r.recommendedAction : "",
    policy: {
      id: typeof policy.id === "string" ? policy.id : "",
      name: typeof policy.name === "string" ? policy.name : "Demonstration policy",
      version: typeof policy.version === "string" ? policy.version : "",
      kind: typeof policy.kind === "string" ? policy.kind : "demonstration",
      note: typeof policy.note === "string" ? policy.note : "",
      requiredDomains: (Array.isArray(policy.requiredDomains) ? policy.requiredDomains : []).filter(
        (x): x is string => typeof x === "string",
      ),
      contextualDomains: (Array.isArray(policy.contextualDomains) ? policy.contextualDomains : []).filter(
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
      selectionNote: typeof policy.selectionNote === "string" ? policy.selectionNote : "",
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
    causality: causalityRaw === null ? null : {
      primaryDrivers: parseDrivers(causalityRaw.primaryDrivers),
      secondaryConsiderations: parseDrivers(causalityRaw.secondaryConsiderations),
      contextualNotes: parseDrivers(causalityRaw.contextualNotes),
      counterfactual: parseCounterfactual(causalityRaw.counterfactual),
      derivationNote: typeof causalityRaw.derivationNote === "string" ? causalityRaw.derivationNote : "",
      verified: causalityRaw.verified === true,
    },
    conflicts: parseConflicts(r.conflicts),
    timeline: parseTimeline(r.timeline),
  };
}

function humanFallback(domain: unknown): string {
  return typeof domain === "string" && domain.trim()
    ? domain.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())
    : "Evidence domain";
}
