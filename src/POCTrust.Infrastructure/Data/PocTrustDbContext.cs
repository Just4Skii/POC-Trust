using Microsoft.EntityFrameworkCore;
using POCTrust.Core.Enums;

namespace POCTrust.Infrastructure.Data;

public sealed class AssessmentRecord
{
    public Guid Id { get; set; }
    public string Result { get; set; } = "";
    public string DeviceId { get; set; } = "";
    public bool QcPassed { get; set; }
    public DateTimeOffset TimestampUtc { get; set; }
    public string Provenance { get; set; } = "";
    public string InputJson { get; set; } = "{}";
    public ReliabilityStatus InitialStatus { get; set; }
    public ReliabilityStatus FinalStatus { get; set; }
    public string ReasonsJson { get; set; } = "[]";
    public string RuleIdsJson { get; set; } = "[]";
    public string Action { get; set; } = "";
    public string? AiSummary { get; set; }
    public bool AiConsulted { get; set; }
    public DateTimeOffset DecidedAtUtc { get; set; }
}

public sealed class AuditEntry
{
    public Guid Id { get; set; }
    public Guid AssessmentId { get; set; }
    public string InputJson { get; set; } = "{}";
    public ReliabilityStatus InitialStatus { get; set; }
    public bool AiConsulted { get; set; }
    public string? AiSummary { get; set; }
    public ReliabilityStatus FinalStatus { get; set; }
    public string Action { get; set; } = "";
    public DateTimeOffset TimestampUtc { get; set; }

    /// <summary>Hash of the previous entry in the append-only chain ("GENESIS" at a chain start).
    /// Empty for rows written before audit sealing was introduced — verification treats them as
    /// an unsealed legacy prefix.</summary>
    public string PrevHash { get; set; } = "";

    /// <summary>SHA-256 over this entry's content plus <see cref="PrevHash"/>. Tampering with any
    /// sealed entry (or anything it commits to) breaks every hash that follows it.</summary>
    public string Hash { get; set; } = "";
}

/// <summary>
/// Replay receipt for offline sync idempotency. When a client submits an assessment with an
/// <c>Idempotency-Key</c> header, the full original response is stored under that key; a replay
/// returns the stored bytes instead of evaluating a second time, so a retried sync can never
/// create a duplicate assessment.
/// </summary>
public sealed class SyncReceipt
{
    /// <summary>Client-supplied idempotency key (primary key, capped at 128 chars).</summary>
    public string Key { get; set; } = "";
    public Guid AssessmentId { get; set; }

    /// <summary>The exact evaluate response body served for this key (camelCase JSON).</summary>
    public string ResponseJson { get; set; } = "{}";
    public DateTimeOffset CreatedUtc { get; set; }
}

public sealed class PocTrustDbContext(DbContextOptions<PocTrustDbContext> options) : DbContext(options)
{
    public DbSet<AssessmentRecord> Assessments => Set<AssessmentRecord>();
    public DbSet<AuditEntry> Audit => Set<AuditEntry>();
    public DbSet<SyncReceipt> SyncReceipts => Set<SyncReceipt>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Idempotency keys are looked up on every sync replay — the PK index covers it.
        modelBuilder.Entity<SyncReceipt>().HasKey(r => r.Key);

        // Audit chain verification walks canonical order (timestamp, then id tie-break).
        modelBuilder.Entity<AuditEntry>().HasIndex(a => new { a.TimestampUtc, a.Id });
    }
}
