using POCTrust.Core.Entities;
using POCTrust.Core.Enums;

namespace POCTrust.Core.Entities;

public sealed record ReliabilityDecision(
    Guid Id,
    ReliabilityStatus InitialStatus,
    ReliabilityStatus FinalStatus,
    IReadOnlyList<string> Reasons,
    IReadOnlyList<string> RuleIds,
    string Action,
    AIAssessment? AiAssessment,
    bool AiConsulted,
    DateTimeOffset DecidedAtUtc
);
