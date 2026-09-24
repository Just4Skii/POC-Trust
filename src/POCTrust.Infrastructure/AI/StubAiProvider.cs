using POCTrust.Core.Entities;
using POCTrust.Core.Interfaces;

namespace POCTrust.Infrastructure.AI;

public sealed class StubAiProvider : IAIProvider
{
    public Task<AIAssessment> AssessAsync(DiagnosticContext c, CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        var anomalies = new List<string>();
        if (c.CalibrationDueUtc < DateTimeOffset.UtcNow.AddDays(7))
            anomalies.Add("Calibration overdue or due imminently.");
        if (c.ReagentExpiryUtc < DateTimeOffset.UtcNow.AddDays(14))
            anomalies.Add($"Reagent lot {c.ReagentLot} nearing expiry.");
        if (!c.QcPassed)
            anomalies.Add("QC failure present despite result being reported.");
        if (!c.OperatorCompetent)
            anomalies.Add("Operator competency not current.");
        if (c.PowerInterruption)
            anomalies.Add("Power interruption associated with event.");
        if (string.IsNullOrWhiteSpace(c.OperatorId) || string.IsNullOrWhiteSpace(c.ReagentLot))
            anomalies.Add("Provenance gaps present.");

        var summary = anomalies.Count == 0
            ? "No contextual anomalies detected. Evidence supports reliance subject to routine controls."
            : $"Several contextual anomalies are present ({anomalies.Count}). Recommend verification before clinical reliance. This is a reliability note, not a diagnosis.";

        return Task.FromResult(new AIAssessment(
            summary,
            anomalies,
            anomalies.Count == 0 ? "No extra action." : "Verify device/calibration/reagent and repeat control if needed.",
            anomalies.Count == 0 ? 0.92 : 0.71,
            "stub/offline"));
    }
}

/// Test doubles for failure modes.
public sealed class ThrowingAiProvider : IAIProvider
{
    public Task<AIAssessment> AssessAsync(DiagnosticContext c, CancellationToken ct = default)
        => throw new HttpRequestException("simulated provider outage");
}

public sealed class MalformedAiProvider : IAIProvider
{
    public Task<AIAssessment> AssessAsync(DiagnosticContext c, CancellationToken ct = default)
        => Task.FromResult(new AIAssessment("", [], "", double.NaN, ""));
}
