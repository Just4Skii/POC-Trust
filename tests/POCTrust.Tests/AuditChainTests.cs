using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using POCTrust.Core.Entities;
using POCTrust.Core.Enums;
using POCTrust.Core.Reliability;
using POCTrust.Infrastructure.Data;
using POCTrust.Infrastructure.Services;

namespace POCTrust.Tests;

/// <summary>
/// Guards the tamper-evident audit trail: every row written through the real store is sealed into
/// a SHA-256 hash chain, verification accepts an intact chain (and an unsealed legacy prefix), and
/// any later edit to a sealed entry is reported with the first broken entry identified.
/// </summary>
public sealed class AuditChainTests
{
    private static PocTrustDbContext InMemory() => new(new DbContextOptionsBuilder<PocTrustDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static DiagnosticContext Context(DateTimeOffset now) => new(
        "Hb 9.1 g/dL", "DEV-02", true, now.AddDays(3), "OP-12", false,
        "LOT-44", now.AddDays(10), 24.0, now, "site-B/DEV-02/OP-12", TestType: "Hb");

    private static ReliabilityDecision DecisionFor(DiagnosticContext context) => new(
        Guid.NewGuid(), ReliabilityStatus.Review, ReliabilityStatus.Review,
        ["[OPERATOR_NOT_COMPETENT] Operator OP-12 competency expired/unverified."],
        ["OPERATOR_NOT_COMPETENT"],
        "Hold for trained-operator review; check flagged context before reliance.",
        null, false, DateTimeOffset.UtcNow);

    [Fact]
    public async Task Store_SealsEveryEntry_IntoAnIntactChain()
    {
        var db = InMemory();
        var store = new EfAuditStore(db);
        for (var i = 0; i < 5; i++)
            await store.SaveAsync(Context(DateTimeOffset.UtcNow.AddSeconds(-i)), DecisionFor(Context(DateTimeOffset.UtcNow)));

        var rows = await db.Audit.AsNoTracking().ToListAsync();

        Assert.All(rows, r => Assert.False(string.IsNullOrEmpty(r.Hash)));
        Assert.All(rows, r => Assert.False(string.IsNullOrEmpty(r.PrevHash)));

        var report = AuditChain.Verify(rows);
        Assert.True(report.Valid);
        Assert.Null(report.BrokenAt);
        Assert.Equal(5, report.SealedCount);
        Assert.Equal(0, report.LegacyCount);
    }

    [Fact]
    public async Task Verify_TamperingWithASealedEntry_IsDetectedAtThatEntry()
    {
        var db = InMemory();
        var store = new EfAuditStore(db);
        await store.SaveAsync(Context(DateTimeOffset.UtcNow), DecisionFor(Context(DateTimeOffset.UtcNow)));
        await store.SaveAsync(Context(DateTimeOffset.UtcNow), DecisionFor(Context(DateTimeOffset.UtcNow)));

        // Rewrite history: an edited audit row must break the chain at that row.
        var tampered = await db.Audit.OrderBy(a => a.TimestampUtc).FirstAsync();
        tampered.Action = "Rewritten after the fact.";
        var tracked = (EntityEntry<AuditEntry>)db.Entry(tampered);
        _ = tracked;
        await db.SaveChangesAsync();

        var report = AuditChain.Verify(await db.Audit.AsNoTracking().ToListAsync());
        Assert.False(report.Valid);
        Assert.Equal(tampered.Id, report.BrokenAt);
    }

    [Fact]
    public async Task Verify_LegacyUnsealedPrefix_IsReportedButNeverFailsTheChain()
    {
        var legacy = new AuditEntry
        {
            Id = Guid.NewGuid(), AssessmentId = Guid.NewGuid(), InputJson = "{}",
            Action = "written before sealing existed", TimestampUtc = DateTimeOffset.UtcNow.AddMinutes(-2),
            PrevHash = "", Hash = "",
        };

        var db = InMemory();
        var store = new EfAuditStore(db);
        await store.SaveAsync(Context(DateTimeOffset.UtcNow), DecisionFor(Context(DateTimeOffset.UtcNow)));

        var rows = new List<AuditEntry> { legacy };
        rows.AddRange(db.Audit.AsNoTracking().ToList());

        var report = AuditChain.Verify(rows);
        Assert.True(report.Valid);
        Assert.Equal(1, report.LegacyCount);
        Assert.Equal(1, report.SealedCount);
    }

    [Fact]
    public void Verify_EmptyTrail_IsValid()
    {
        var report = AuditChain.Verify([]);
        Assert.True(report.Valid);
        Assert.Equal(0, report.SealedCount);
    }

    [Fact]
    public void Seal_EmptyOrLegacyTrail_StartsAtGenesis()
    {
        var entry = new AuditEntry { Id = Guid.NewGuid(), Action = "x", TimestampUtc = DateTimeOffset.UtcNow };
        var (prev, hash) = AuditChain.Seal(entry, []);
        Assert.Equal(AuditChain.Genesis, prev);
        Assert.NotEqual(AuditChain.Genesis, hash);

        var legacyTail = new AuditEntry { Hash = "", PrevHash = "" };
        var (prev2, _) = AuditChain.Seal(entry, [legacyTail]);
        Assert.Equal(AuditChain.Genesis, prev2);
    }
}
