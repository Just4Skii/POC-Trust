using System.Text.Json;
using Microsoft.EntityFrameworkCore;
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
        // Append-only audit: never update, only insert. Each row is sealed into the SHA-256
        // hash chain (content + predecessor hash), making the trail tamper-evident.
        // The chain commits to RECORDING order: the audit entry is stamped when it is appended,
        // while the assessment row keeps the decision instant. For ordinary submissions the two
        // are milliseconds apart; for the back-dated demonstration decision history this keeps
        // the trail honest ("recorded now, evaluated for a historical instant") and the chain
        // valid, because a hash chain over timestamp order could never accept an older entry
        // after a newer one.
        var auditEntry = new AuditEntry
        {
            Id = Guid.NewGuid(),
            AssessmentId = decision.Id,
            InputJson = inputJson,
            InitialStatus = decision.InitialStatus,
            AiConsulted = decision.AiConsulted,
            AiSummary = decision.AiAssessment?.Summary,
            FinalStatus = decision.FinalStatus,
            Action = decision.Action,
            TimestampUtc = DateTimeOffset.UtcNow
        };
        // SQLite cannot ORDER BY DateTimeOffset server-side (repo-wide convention: order in
        // memory, a scale item, not a correctness item), so the chain head is found client-side.
        var rows = await db.Audit.AsNoTracking().ToListAsync(ct);
        var head = rows.OrderByDescending(a => a.TimestampUtc).ThenByDescending(a => a.Id).FirstOrDefault();
        (auditEntry.PrevHash, auditEntry.Hash) = AuditChain.Seal(auditEntry, head is null ? [] : [head]);
        db.Audit.Add(auditEntry);
        await db.SaveChangesAsync(ct);
    }
}
