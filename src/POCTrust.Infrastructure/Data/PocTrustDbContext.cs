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
}

public sealed class PocTrustDbContext(DbContextOptions<PocTrustDbContext> options) : DbContext(options)
{
    public DbSet<AssessmentRecord> Assessments => Set<AssessmentRecord>();
    public DbSet<AuditEntry> Audit => Set<AuditEntry>();
}
