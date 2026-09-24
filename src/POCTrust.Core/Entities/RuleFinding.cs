using POCTrust.Core.Enums;

namespace POCTrust.Core.Entities;

public sealed record RuleFinding(string RuleId, ReliabilityStatus Severity, string Reason);
