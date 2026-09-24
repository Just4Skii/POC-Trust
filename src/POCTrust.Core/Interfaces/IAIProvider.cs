using POCTrust.Core.Entities;

namespace POCTrust.Core.Interfaces;

public interface IAIProvider
{
    Task<AIAssessment> AssessAsync(DiagnosticContext context, CancellationToken ct = default);
}
