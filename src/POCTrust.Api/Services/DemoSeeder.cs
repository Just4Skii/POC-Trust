using Microsoft.EntityFrameworkCore;
using POCTrust.Core.Interfaces;
using POCTrust.Infrastructure.AI;
using POCTrust.Infrastructure.Data;

namespace POCTrust.Api.Services;

/// <summary>Outcome of a seeding pass — mapped 1:1 onto the demo lifecycle endpoint's response.</summary>
public sealed record DemoSeedReport(
    int Loaded,
    int Skipped,
    List<object> SeededKeys,
    List<string> AlreadyPresent,
    List<object> DistributionMismatches);

/// <summary>
/// Controlled demonstration-data seeding, shared by the guarded demo endpoints and the optional
/// startup auto-seed. Every seed is submitted through the REAL assessment pipeline — the
/// deterministic engine computes status, reasons, action and audit, and each result is compared
/// against the seed definition's expected status (a mismatch flags the seed definition, never the
/// engine). Advisory summaries during seeding come from the built-in stub provider: offline-safe,
/// reproducible, no external AI calls needed to load a demonstration.
///
/// Seeding is idempotent: it is keyed on the demo marker persisted inside the evidence JSON, so a
/// second pass skips everything already loaded. Only records carrying a demo marker can ever be
/// identified or reset — user-created records are never touched.
/// </summary>
public sealed class DemoSeeder(AssessmentOrchestrator orchestrator, PocTrustDbContext db)
{
    /// <summary>Demonstration seeding uses the built-in advisory provider so a demo load is fast,
    /// reproducible and works without network access. Only the advisory summary source differs —
    /// statuses, reasons, actions and audit still come from the real pipeline.</summary>
    public static readonly IAIProvider SeedAdvisory = new StubAiProvider();

    public const string MarkerPrefix = "\"demoKey\":\"demo-";

    public static string Marker(string key) => $"\"demoKey\":\"{key}\"";

    /// <summary>True when the assessment store holds no records at all — the only state in which
    /// the optional startup auto-seed loads demonstration data.</summary>
    public async Task<bool> StoreIsEmptyAsync(CancellationToken ct = default) =>
        !await db.Assessments.AnyAsync(ct);

    public async Task<DemoSeedReport> SeedAsync(CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;
        var loaded = new List<object>();
        var skipped = new List<string>();
        var mismatches = new List<object>();

        // Audit entries are stamped at RECORDING time (EfAuditStore), so the SHA-256 chain
        // always commits to append order — even when the demonstration decision history is
        // back-dated into a store that already holds records. No special handling needed here.

        foreach (var seed in DemoSeedData.All)
        {
            if (await db.Assessments.AnyAsync(a => a.InputJson.Contains(Marker(seed.Key)), ct))
            {
                skipped.Add(seed.Key);
                continue;
            }
            // Decision-history seeds are back-dated relative to the seed instant; ordinary
            // seeds anchor at "now". The engine's statuses depend only on relative offsets.
            var anchor = now;
            var decision = await orchestrator.EvaluateAsync(
                seed.Build(anchor), SeedAdvisory, ct, seed.DecisionAt?.Invoke(anchor));
            if (decision.FinalStatus != seed.Expected)
                mismatches.Add(new
                {
                    key = seed.Key,
                    expected = seed.Expected.ToString().ToUpperInvariant(),
                    computed = decision.FinalStatus.ToString().ToUpperInvariant(),
                });
            loaded.Add(new
            {
                key = seed.Key,
                id = decision.Id,
                title = seed.Title,
                status = decision.FinalStatus.ToString().ToUpperInvariant(),
                aiConsulted = decision.AiConsulted,
            });
        }

        return new DemoSeedReport(loaded.Count, skipped.Count, loaded, skipped, mismatches);
    }

    /// <summary>Remove ONLY demo-marked assessments and their audit rows. Returns (assessmentsRemoved, auditRemoved).</summary>
    public async Task<(int Assessments, int Audit)> ResetAsync(CancellationToken ct = default)
    {
        var demoIds = await db.Assessments
            .Where(a => a.InputJson.Contains(MarkerPrefix))
            .Select(a => a.Id)
            .ToListAsync(ct);

        var demoAssessments = await db.Assessments.Where(a => demoIds.Contains(a.Id)).ToListAsync(ct);
        var demoAudit = await db.Audit.Where(e => demoIds.Contains(e.AssessmentId)).ToListAsync(ct);
        // Audit entries carry a copy of the input JSON; remove marker-bearing ones not linked above (defensive).
        var orphanAudit = await db.Audit
            .Where(e => e.InputJson.Contains(MarkerPrefix) && !demoIds.Contains(e.AssessmentId))
            .ToListAsync(ct);

        db.Assessments.RemoveRange(demoAssessments);
        db.Audit.RemoveRange(demoAudit);
        db.Audit.RemoveRange(orphanAudit);
        await db.SaveChangesAsync(ct);

        return (demoAssessments.Count, demoAudit.Count + orphanAudit.Count);
    }

    /// <summary>Load the curated set on startup when configured (Demo:AutoSeed) and the store is
    /// empty. Never throws into startup: a failed demonstration load is logged, not fatal — the
    /// deterministic engine remains fully usable with an empty store.</summary>
    public async Task SeedOnStartupIfConfiguredAsync(ILogger logger, CancellationToken ct = default)
    {
        try
        {
            if (!await StoreIsEmptyAsync(ct))
            {
                logger.LogInformation("Demo auto-seed skipped — the assessment store already holds records.");
                return;
            }
            var report = await SeedAsync(ct);
            logger.LogInformation(
                "Demo auto-seed loaded {Loaded} synthetic demonstration records ({Mismatches} distribution mismatches). Synthetic data only — clearly labelled in the UI.",
                report.Loaded, report.DistributionMismatches.Count);
            if (report.DistributionMismatches.Count > 0)
                logger.LogWarning("Demo seed self-check reported mismatches — the seed definitions, not the engine, need attention.");
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Demo auto-seed failed — starting with an empty store. The engine is unaffected.");
        }
    }
}
