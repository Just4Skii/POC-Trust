using POCTrust.Core.Entities;
using POCTrust.Core.Enums;

namespace POCTrust.Core.Integrity;

/// <summary>
/// The Result Integrity Record — the central artefact of POC Trust.
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
    DateTimeOffset ProjectedAtUtc
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
/// One evidence domain row. Answers the five questions the product definition asks of every
/// domain: is evidence available, what state is it in, where did it come from, when was it
/// recorded, and did it contribute to the decision.
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
    string Note
);

/// <summary>
/// Lightweight policy context. The thresholds mirror the deterministic engine's existing
/// configuration exactly (7-day calibration review boundary, 14-day reagent near-expiry
/// boundary, 15–30 °C / 10–85 % environment ranges) and are explicitly labelled as a
/// demonstration policy — a configured prototype policy, not a clinically validated requirement.
/// </summary>
public sealed record IntegrityPolicy(
    string Name,
    string Version,
    string Kind,
    string Note,
    IReadOnlyList<string> RequiredDomains,
    IReadOnlyList<PolicyWindow> FreshnessWindows,
    IReadOnlyList<PolicyRange> SupportedEnvironment
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

/// <summary>
/// Everything the projector needs, taken from the persisted assessment row and its audit
/// entries. No live engine call, no re-evaluation: the projection describes the state of the
/// evidence at decision time and is therefore anchored at <see cref="DecidedAtUtc"/>.
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
    IntegrityAuditReference Audit
);
