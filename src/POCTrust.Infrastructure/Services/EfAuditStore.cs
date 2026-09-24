using System.Text.Json;
using POCTrust.Core.Entities;
using POCTrust.Core.Interfaces;
using POCTrust.Infrastructure.Data;

namespace POCTrust.Infrastructure.Services;

public sealed class EfAuditStore(PocTrustDbContext db) : IAuditStore
{
    /// <summary>
    /// Canonical persisted evidence format: camelCase (web defaults) so stored records read back
    /// with the same property names the public API and UI contract use (result, deviceId,
    /// operatorCompetent, calibrationDueUtc...). Records written by earlier builds are PascalCase;
    /// readers therefore also accept case-insensitive lookups.
    /// </summary>
    private static readonly JsonSerializerOptions PersistedJson = new(JsonSerializerDefaults.Web);

    public async Task SaveAsync(DiagnosticContext context, ReliabilityDecision decision, CancellationToken ct = default)
    {
        var inputJson = JsonSerializer.Serialize(context, PersistedJson);
        db.Assessments.Add(new AssessmentRecord
        {
            Id = decision.Id,
            Result = context.Result,
            DeviceId = context.DeviceId,
            QcPassed = context.QcPassed,
            TimestampUtc = context.TimestampUtc,
            Provenance = context.Provenance,
            InputJson = inputJson,
            InitialStatus = decision.InitialStatus,
            FinalStatus = decision.FinalStatus,
            ReasonsJson = JsonSerializer.Serialize(decision.Reasons),
            RuleIdsJson = JsonSerializer.Serialize(decision.RuleIds),
            Action = decision.Action,
            AiSummary = decision.AiAssessment?.Summary,
            AiConsulted = decision.AiConsulted,
            DecidedAtUtc = decision.DecidedAtUtc
        });
        // Append-only audit: never update, only insert.
        db.Audit.Add(new AuditEntry
        {
            Id = Guid.NewGuid(),
            AssessmentId = decision.Id,
            InputJson = inputJson,
            InitialStatus = decision.InitialStatus,
            AiConsulted = decision.AiConsulted,
            AiSummary = decision.AiAssessment?.Summary,
            FinalStatus = decision.FinalStatus,
            Action = decision.Action,
            TimestampUtc = decision.DecidedAtUtc
        });
        await db.SaveChangesAsync(ct);
    }
}
