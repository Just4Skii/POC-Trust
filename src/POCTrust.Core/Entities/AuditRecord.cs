using POCTrust.Core.Enums;

namespace POCTrust.Core.Entities;

public sealed record AuditRecord(
    Guid Id,
    Guid AssessmentId,
    string InputJson,
    ReliabilityStatus InitialStatus,
    bool AiConsulted,
    string? AiSummary,
    ReliabilityStatus FinalStatus,
    string Action,
    DateTimeOffset TimestampUtc
);
