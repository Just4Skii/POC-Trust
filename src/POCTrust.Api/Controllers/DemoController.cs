using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using POCTrust.Api.Services;
using POCTrust.Infrastructure.Data;

namespace POCTrust.Api.Controllers;

/// <summary>
/// Controlled demonstration-data lifecycle. Every action is environment-guarded: outside the
/// Development environment the endpoints return 404 and perform no work.
///
/// Guarantees:
/// - seeding is idempotent (keyed on a demo marker persisted inside the evidence JSON);
/// - every seed is submitted through the real assessment pipeline — the deterministic engine
///   computes status, reasons, action and audit, and the seed self-check compares the result
///   against the expected status (a mismatch flags the seed definition, never the engine);
/// - reset removes ONLY demo-marked assessments and their audit trail rows — any other
///   (real / demo-scenario / user-created) record is never touched;
/// - nothing is seeded automatically on startup.
/// </summary>
[ApiController]
[Route("api/demo")]
public sealed class DemoController(
    AssessmentOrchestrator orchestrator,
    PocTrustDbContext db,
    IHostEnvironment env) : ControllerBase
{
    private const string MarkerPrefix = "\"demoKey\":\"demo-";

    private static string Marker(string key) => $"\"demoKey\":\"{key}\"";

    [HttpGet("status")]
    public async Task<IActionResult> Status(CancellationToken ct)
    {
        if (!env.IsDevelopment()) return NotFound();
        var total = await db.Assessments.CountAsync(ct);
        var demo = await db.Assessments.CountAsync(a => a.InputJson.Contains(MarkerPrefix), ct);
        var keys = await db.Assessments
            .Where(a => a.InputJson.Contains(MarkerPrefix))
            .Select(a => a.InputJson)
            .ToListAsync(ct);
        return Ok(new
        {
            enabled = true,
            totalRecords = total,
            demoRecords = demo,
            expectedRecords = DemoSeedData.All.Count,
            seeded = keys.Select(k => DemoSeedData.All.FirstOrDefault(s => k.Contains(Marker(s.Key)))?.Key)
                         .Where(k => k is not null).OrderBy(k => k).ToArray(),
        });
    }

    [HttpPost("seed")]
    public async Task<IActionResult> Seed(CancellationToken ct)
    {
        if (!env.IsDevelopment()) return NotFound();
        var now = DateTimeOffset.UtcNow;
        var loaded = new List<object>();
        var skipped = new List<string>();
        var mismatches = new List<object>();

        foreach (var seed in DemoSeedData.All)
        {
            if (await db.Assessments.AnyAsync(a => a.InputJson.Contains(Marker(seed.Key)), ct))
            {
                skipped.Add(seed.Key);
                continue;
            }
            var decision = await orchestrator.EvaluateAsync(seed.Build(now), ct);
            if (decision.FinalStatus != seed.Expected)
                mismatches.Add(new { key = seed.Key, expected = seed.Expected.ToString().ToUpperInvariant(), computed = decision.FinalStatus.ToString().ToUpperInvariant() });
            loaded.Add(new { key = seed.Key, id = decision.Id, title = seed.Title, status = decision.FinalStatus.ToString().ToUpperInvariant(), aiConsulted = decision.AiConsulted });
        }

        return Ok(new
        {
            loaded = loaded.Count,
            skipped = skipped.Count,
            seededKeys = loaded,
            alreadyPresent = skipped,
            distributionMismatches = mismatches,   // empty when the engine confirms every seed
        });
    }

    [HttpPost("reset")]
    public async Task<IActionResult> Reset(CancellationToken ct)
    {
        if (!env.IsDevelopment()) return NotFound();

        // Identify demo-marked assessments first, then delete only those rows and their audit trail.
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

        return Ok(new
        {
            removed = demoAssessments.Count,
            auditRemoved = demoAudit.Count + orphanAudit.Count,
            remainingRecords = await db.Assessments.CountAsync(ct),
        });
    }
}
