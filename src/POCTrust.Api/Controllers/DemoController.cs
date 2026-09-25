using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using POCTrust.Api.Services;
using POCTrust.Infrastructure.Data;

namespace POCTrust.Api.Controllers;

/// <summary>
/// Controlled demonstration-data lifecycle. Every action is environment-guarded: outside the
/// Development environment the endpoints return 404 and perform no work.
///
/// Guarantees (implemented by <see cref="DemoSeeder"/>):
/// - seeding is idempotent (keyed on a demo marker persisted inside the evidence JSON);
/// - every seed is submitted through the real assessment pipeline, the deterministic engine
///   computes status, reasons, action and audit, and the seed self-check compares the result
///   against the expected status (a mismatch flags the seed definition, never the engine);
/// - advisory summaries during seeding come from the built-in stub provider: offline-safe,
///   reproducible, and no external AI calls are made to load a demonstration;
/// - reset removes ONLY demo-marked assessments and their audit trail rows, any other
///   (real / demo-scenario / user-created) record is never touched.
///
/// Ordinary server startup seeds nothing by default; the optional <c>Demo:AutoSeed</c> setting
/// (opt-in via configuration) loads the same curated set through this seeder when the store is
/// empty, and is also restricted to explicitly enabling environments.
/// </summary>
[ApiController]
[Route("api/demo")]
public sealed class DemoController(
    AssessmentOrchestrator orchestrator,
    PocTrustDbContext db,
    IHostEnvironment env) : ControllerBase
{
    private readonly DemoSeeder seeder = new(orchestrator, db);

    [HttpGet("status")]
    public async Task<IActionResult> Status(CancellationToken ct)
    {
        if (!env.IsDevelopment()) return NotFound();
        var total = await db.Assessments.CountAsync(ct);
        var demo = await db.Assessments.CountAsync(a => a.InputJson.Contains(DemoSeeder.MarkerPrefix), ct);
        var keys = await db.Assessments
            .Where(a => a.InputJson.Contains(DemoSeeder.MarkerPrefix))
            .Select(a => a.InputJson)
            .ToListAsync(ct);
        return Ok(new
        {
            enabled = true,
            totalRecords = total,
            demoRecords = demo,
            expectedRecords = DemoSeedData.All.Count,
            seeded = keys.Select(k => DemoSeedData.All.FirstOrDefault(s => k.Contains(DemoSeeder.Marker(s.Key)))?.Key)
                         .Where(k => k is not null).OrderBy(k => k).ToArray(),
        });
    }

    [HttpPost("seed")]
    public async Task<IActionResult> Seed(CancellationToken ct)
    {
        if (!env.IsDevelopment()) return NotFound();
        var report = await seeder.SeedAsync(ct);
        return Ok(new
        {
            loaded = report.Loaded,
            skipped = report.Skipped,
            seededKeys = report.SeededKeys,
            alreadyPresent = report.AlreadyPresent,
            distributionMismatches = report.DistributionMismatches,   // empty when the engine confirms every seed
        });
    }

    [HttpPost("reset")]
    public async Task<IActionResult> Reset(CancellationToken ct)
    {
        if (!env.IsDevelopment()) return NotFound();

        var (assessmentsRemoved, auditRemoved) = await seeder.ResetAsync(ct);

        return Ok(new
        {
            removed = assessmentsRemoved,
            auditRemoved,
            remainingRecords = await db.Assessments.CountAsync(ct),
        });
    }
}
