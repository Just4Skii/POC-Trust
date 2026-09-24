using POCTrust.Core.Entities;
using POCTrust.Core.Enums;

namespace POCTrust.Core.Interfaces;

public interface IReliabilityEngine
{
    (ReliabilityStatus Status, List<RuleFinding> Findings) EvaluateInitial(DiagnosticContext context, DateTimeOffset nowUtc);
    bool NeedsAi(DiagnosticContext context, ReliabilityStatus initialStatus, IReadOnlyList<RuleFinding> findings, DateTimeOffset nowUtc);
    ReliabilityStatus EnforceFinalStatus(ReliabilityStatus initialStatus, AIAssessment? ai);
    string BuildAction(ReliabilityStatus finalStatus);
}
