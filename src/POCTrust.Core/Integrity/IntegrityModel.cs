using POCTrust.Core.Entities;
using POCTrust.Core.Enums;

namespace POCTrust.Core.Integrity;

/// <summary>
/// The Result Integrity Record, the central artefact of POC Trust.
///
/// A portable, auditable, evidence-linked projection derived from an existing persisted
/// assessment (spec: "existing assessment + derived integrity projection rather than duplicate
/// sources of truth"). It makes explicit what evidence existed, what quality it was in, why the
/// operational disposition occurred, and what action follows.
///
/// This is an OPERATIONAL INTEGRITY ASSESSMENT. It is not a clinical truth judgement, a
/// diagnostic correctness score, a patient safety probability, or a medical confidence measure.
/// Every field below is a plain string/number so the record is self-describing when exported
/// (no enum encodings that a receiving system would have to guess).
/// </summary>
public sealed record ResultIntegrityRecord(
    string RecordVersion,
    Guid AssessmentId,
    string Result,
    string TestType,
    DateTimeOffset EventTimeUtc,
    string Disposition,
    string DispositionStatement,
    EvidenceQualitySummary EvidenceQuality,
    IReadOnlyList<IntegrityDomainEvidence> Domains,
    IReadOnlyList<string> DecisionDrivers,
    string RecommendedAction,
    IntegrityPolicy Policy,
    IntegrityAiContext AiContext,
    IntegrityAuditReference Audit,
    string BasisNote,
    DateTimeOffset ProjectedAtUtc,
    /// <summary>Structured decision causality: primary drivers, secondary considerations and
    /// informational context, derived from the engine's recorded findings (never invented).</summary>
    DecisionCausality? Causality = null,
    /// <summary>Evidence inconsistencies the record detected, conflicts between two recorded
    /// sources. Detection of inconsistency, never a clinical truth claim.</summary>
    IReadOnlyList<EvidenceConflict>? Conflicts = null,
    /// <summary>Compact integrity timeline: the decision and the evidence boundaries around it.</summary>
    IntegrityTimeline? Timeline = null
);

/// <summary>The four-dimension quality summary shown in the record header.</summary>
public sealed record EvidenceQualitySummary(
    EvidenceCoverageSummary Coverage,
    string Freshness,
    int AgingCount,
    int StaleCount,
    int ExpiredCount,
    string Consistency,
    int ConflictCount,
    string Traceability
);

/// <summary>How much of what the selected policy requires was actually available.</summary>
public sealed record EvidenceCoverageSummary(
    int RequiredAvailable,
    int RequiredTotal,
    string Statement,
    IReadOnlyList<CoverageItem> Items
);

public sealed record CoverageItem(
    string Domain,
    string Label,
    bool Available,
    string State
);

/// <summary>
/// One evidence domain row. Answers the questions the product definition asks of every
/// domain: is evidence available, what state is it in, where did it come from, when was it
/// recorded, did it contribute to the decision, and how was its identity verified.
/// </summary>
public sealed record IntegrityDomainEvidence(
    string Domain,
    string Label,
    bool RequiredByPolicy,
    bool Available,
    string State,
    string Source,
    string Recorded,
    bool ContributedToDecision,
    string Note,
    /// <summary>The identifier the source recorded for this item (device id, operator id, lot…).
    /// Never a fabricated handle: null when nothing was recorded.</summary>
    string? SourceIdentifier = null,
    /// <summary>What the record can and cannot claim about this item's verification. Deliberately
    /// preserves wording such as "Operator ID as claimed", identity is NOT authenticated here.</summary>
    string Verification = "",
    /// <summary>Where this row's detail can be checked inside the record itself.</summary>
    string? RecordReference = null,
    /// <summary>The deterministic rule IDs (from the stored decision) that involve this domain.</summary>
    IReadOnlyList<string>? RelatedRuleIds = null
);

/// <summary>
/// Lightweight policy context. The thresholds mirror the deterministic engine's existing
/// configuration exactly (7-day calibration review boundary, 14-day reagent near-expiry
/// boundary, 15–30 °C / 10–85 % environment ranges) and are explicitly labelled as a
/// demonstration policy, a configured prototype policy, not a clinically validated requirement.
/// The policy states WHAT evidence is expected; the deterministic rules decide how evidence maps
/// to the disposition. A policy can never override a rule outcome, and it gives the AI no authority.
/// </summary>
public sealed record IntegrityPolicy(
    string Name,
    string Version,
    string Kind,
    string Note,
    IReadOnlyList<string> RequiredDomains,
    IReadOnlyList<PolicyWindow> FreshnessWindows,
    IReadOnlyList<PolicyRange> SupportedEnvironment,
    /// <summary>Stable policy identifier (e.g. "rural-phc-demo").</summary>
    string Id = "",
    /// <summary>Domains the policy monitors as context: recorded when available, excluded from
    /// the coverage denominator, but still rule-relevant when the engine evaluates them.</summary>
    IReadOnlyList<string>? ContextualDomains = null,
    /// <summary>How this assessment came to be assessed under this policy, deterministic and disclosed.</summary>
    string SelectionNote = ""
);

public sealed record PolicyWindow(string Domain, string Boundary, int Days);

public sealed record PolicyRange(string Measure, double Minimum, double Maximum, string Unit);

/// <summary>Advisory context. The AI never produces or changes the disposition.</summary>
public sealed record IntegrityAiContext(
    bool Consulted,
    string? Summary,
    string Role,
    string Note
);

/// <summary>Reference into the sealed, append-only audit trail.</summary>
public sealed record IntegrityAuditReference(
    int Entries,
    int SealedEntries,
    string Algorithm,
    string Status,
    string Note
);

// ── Decision causality (spec section 12) ───────────────────────────────────────

/// <summary>One causal element of the disposition. Roles use the vocabulary
/// primary / secondary / informational, never numeric weights, which do not exist.</summary>
public sealed record DecisionDriver(
    string RuleId,
    string Statement,
    string Domain,
    string DomainLabel,
    string EvidenceState,
    string Role
);

/// <summary>
/// One simple deterministic counterfactual ("rule-based counterfactual" / "deterministic decision
/// comparison"): the same stored evidence re-run through the SAME deterministic rules with a
/// single, obvious evidence change. Only produced when the dependency is derivable, never by an
/// LLM, never with a probability, never framed as clinical prediction.
/// </summary>
public sealed record CounterfactualComparison(
    string Label,
    string Method,
    string ChangedEvidence,
    string Change,
    string CurrentDisposition,
    string CounterfactualDisposition,
    string Statement,
    string BasisNote
);

/// <summary>WHY did the disposition occur, derived from the engine's recorded findings.</summary>
public sealed record DecisionCausality(
    IReadOnlyList<DecisionDriver> PrimaryDrivers,
    IReadOnlyList<DecisionDriver> SecondaryConsiderations,
    IReadOnlyList<DecisionDriver> ContextualNotes,
    CounterfactualComparison? Counterfactual,
    /// <summary>How this causality was derived, stated honestly (re-derivation gate result).</summary>
    string DerivationNote,
    /// <summary>True when a fresh deterministic re-derivation reproduced the stored decision
    /// exactly (rule IDs and status), so the role classification below is engine-verified.</summary>
    bool Verified
);

// ── Evidence conflict (spec section 10) ────────────────────────────────────────

/// <summary>
/// A detected inconsistency between two recorded evidence sources. The application has detected
/// an EVIDENCE INCONSISTENCY, it has not discovered a clinical truth.
/// </summary>
public sealed record EvidenceConflict(
    string SourceA,
    string SourceAState,
    string SourceB,
    string SourceBState,
    string Conflict,
    string WhyItMatters,
    string RelatedRuleIds
);

// ── Integrity timeline (spec section 13) ───────────────────────────────────────

/// <summary>One entry in the integrity timeline. <see cref="Basis"/> states where the entry
/// comes from: "recorded" (straight from the stored assessment), "derived" (computed from
/// recorded timestamps and the configured policy window) or "demo-history" (a synthetic
/// demonstration-sequence record that WAS recorded through the real pipeline).</summary>
public sealed record IntegrityTimelineEntry(
    DateTimeOffset TimeUtc,
    string Kind,
    string Title,
    string Detail,
    string? EvidenceState = null,
    string? Disposition = null,
    string? Transition = null,
    string Basis = "recorded"
);

/// <summary>Compact decision-evolution view. When the store holds a demonstration decision
/// sequence for this record, the label says so, history is never passed off as production data.</summary>
public sealed record IntegrityTimeline(
    string Label,
    string Note,
    IReadOnlyList<IntegrityTimelineEntry> Entries
);

/// <summary>A sibling decision from a demonstration sequence (already stored; never re-computed).</summary>
public sealed record IntegrityHistoryPoint(
    Guid AssessmentId,
    DateTimeOffset DecidedAtUtc,
    ReliabilityStatus FinalStatus,
    IReadOnlyList<string> RuleIds,
    IReadOnlyList<string> Reasons
);

/// <summary>
/// Everything the projector needs, taken from the persisted assessment row and its audit
/// entries. No re-evaluation happens for the projection itself: it describes the state of the
/// evidence at decision time and is therefore anchored at <see cref="DecidedAtUtc"/>. The only
/// engine use is the guarded, disclosed causality re-derivation (which must reproduce the
/// stored decision before any of its classifications are shown).
/// </summary>
public sealed record IntegrityDecisionSnapshot(
    Guid AssessmentId,
    DiagnosticContext Input,
    ReliabilityStatus FinalStatus,
    IReadOnlyList<string> RuleIds,
    /// <summary>Persisted reason sentences in decision order ("[RULE_ID] sentence" format).</summary>
    IReadOnlyList<string> Reasons,
    string Action,
    bool AiConsulted,
    string? AiSummary,
    DateTimeOffset DecidedAtUtc,
    IntegrityAuditReference Audit,
    /// <summary>Sibling decisions from a demonstration decision sequence, when the record belongs
    /// to one. Null for ordinary records, the timeline then shows the decision-time view only.</summary>
    IReadOnlyList<IntegrityHistoryPoint>? History = null
);
