using POCTrust.Core.Entities;

namespace POCTrust.Core.Interfaces;

public interface IAuditStore
{
    Task SaveAsync(DiagnosticContext context, ReliabilityDecision decision, CancellationToken ct = default);
}
