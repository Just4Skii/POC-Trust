using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using POCTrust.Api.Controllers;
using POCTrust.Api.Services;
using POCTrust.Core.Entities;
using POCTrust.Core.Enums;
using POCTrust.Core.Reliability;
using POCTrust.Infrastructure.AI;
using POCTrust.Infrastructure.Data;
using POCTrust.Infrastructure.Services;

namespace POCTrust.Tests;

/// <summary>
/// Guards the controlled demonstration-data lifecycle: seeds must go through the real
/// assessment pipeline (engine-computed outcomes, never hand-written), seeding must be
/// idempotent, every seeded record must carry a persistent demo marker, and reset must
/// remove ONLY demo-marked records. Endpoints are environment-guarded (Development only).
/// </summary>
public sealed class DemoLifecycleTests
{
    private sealed class FakeEnv(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "tests";
        public string ContentRootPath { get; set; } = ".";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private static (DemoController Controller, PocTrustDbContext Db) Build(string env = "Development")
    {
        var db = new PocTrustDbContext(new DbContextOptionsBuilder<PocTrustDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var orchestrator = new AssessmentOrchestrator(new ReliabilityEngine(), new StubAiProvider(), new EfAuditStore(db));
        return (new DemoController(orchestrator, db, new FakeEnv(env)), db);
    }

    [Fact]
    public async Task Seed_ComputesEveryScenarioThroughTheEngine_WithExpectedDistribution()
    {
        var (controller, db) = Build();
        var result = Assert.IsType<OkObjectResult>(await controller.Seed(default));

        var json = JsonSerializer.Serialize(result.Value);
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(13, doc.RootElement.GetProperty("loaded").GetInt32());
        Assert.Equal(0, doc.RootElement.GetProperty("distributionMismatches").GetArrayLength());

        Assert.Equal(13, await db.Assessments.CountAsync());
        Assert.Equal(5, await db.Assessments.CountAsync(a => a.FinalStatus == ReliabilityStatus.Trust));
        Assert.Equal(5, await db.Assessments.CountAsync(a => a.FinalStatus == ReliabilityStatus.Review));
        Assert.Equal(3, await db.Assessments.CountAsync(a => a.FinalStatus == ReliabilityStatus.Verify));
        // Every seeded record produced an audit row through the real pipeline.
        Assert.Equal(13, await db.Audit.CountAsync());
    }

    [Fact]
    public async Task Seed_IsIdempotent_SecondRunSkipsEverything()
    {
        var (controller, db) = Build();
        await controller.Seed(default);
        var result = Assert.IsType<OkObjectResult>(await controller.Seed(default));

        var json = JsonSerializer.Serialize(result.Value);
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(0, doc.RootElement.GetProperty("loaded").GetInt32());
        Assert.Equal(13, doc.RootElement.GetProperty("skipped").GetInt32());
        Assert.Equal(13, await db.Assessments.CountAsync());
        Assert.Equal(13, await db.Audit.CountAsync());
    }

    [Fact]
    public async Task Seed_PersistsDemoMarker_AndConsultsAiForReviewRecords()
    {
        var (controller, db) = Build();
        await controller.Seed(default);

        var marker = await db.Assessments.Select(a => a.InputJson).ToListAsync();
        // The family marker covers both demo-assess-* scenarios and the demo-history-* sequence.
        Assert.All(marker, j => Assert.Contains("\"demoKey\":\"demo-", j));
        Assert.Contains(marker, j => j.Contains("\"demoKey\":\"demo-assess-010\""));

        // REVIEW records consult the advisory provider exactly when the engine's NeedsAi predicate
        // says so: multi-finding reviews and provenance/power/interaction reviews do; a single
        // boundary finding (e.g. the decision-history AGING step) stays deterministic-only.
        var reviews = await db.Assessments.Where(a => a.FinalStatus == ReliabilityStatus.Review).ToListAsync();
        Assert.NotEmpty(reviews);
        Assert.All(reviews, r =>
        {
            var ruleIds = JsonSerializer.Deserialize<List<string>>(r.RuleIdsJson) ?? new List<string>();
            var expected = ruleIds.Count >= 2
                || ruleIds.Any(x => x is "PROVENANCE_INCOMPLETE" or "POWER_INTERRUPTION" or "MULTI_CONTEXT");
            Assert.True(r.AiConsulted == expected,
                $"REVIEW record {r.Id}: AiConsulted={r.AiConsulted} but NeedsAi predicate says {expected}.");
        });
        // VERIFY seeds are deterministic-only: AI is never consulted.
        var verifies = await db.Assessments.Where(a => a.FinalStatus == ReliabilityStatus.Verify).ToListAsync();
        Assert.All(verifies, v => Assert.False(v.AiConsulted));
    }

    [Fact]
    public async Task Reset_RemovesOnlyDemoMarkedRecords_AndTheirAudit()
    {
        var (controller, db) = Build();

        // A non-demo record created through the same pipeline (no demo key) must survive reset.
        var orchestrator = new AssessmentOrchestrator(new ReliabilityEngine(), new StubAiProvider(), new EfAuditStore(db));
        var now = DateTimeOffset.UtcNow;
        await orchestrator.EvaluateAsync(new DiagnosticContext(
            "Hb 14.2 g/dL", "DEV-01", true, now.AddMonths(2), "OP-07", true,
            "LOT-GOOD", now.AddMonths(3), 22.5, now, "site-A/DEV-01/OP-07", TestType: "Hb"), default);

        await controller.Seed(default);
        Assert.Equal(14, await db.Assessments.CountAsync());

        var result = Assert.IsType<OkObjectResult>(await controller.Reset(default));
        var json = JsonSerializer.Serialize(result.Value);
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(13, doc.RootElement.GetProperty("removed").GetInt32());
        Assert.Equal(13, doc.RootElement.GetProperty("auditRemoved").GetInt32());
        Assert.Equal(1, doc.RootElement.GetProperty("remainingRecords").GetInt32());

        var survivors = await db.Assessments.ToListAsync();
        Assert.Single(survivors);
        // Null demoKey is fine (marker absent); a demo marker value must not survive.
        Assert.DoesNotContain("\"demoKey\":\"demo-", survivors[0].InputJson);
        Assert.Single(await db.Audit.ToListAsync());
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public async Task AllEndpoints_AreEnvironmentGuarded_OutsideDevelopment(string env)
    {
        var (controller, db) = Build(env);
        Assert.IsType<NotFoundResult>(await controller.Seed(default));
        Assert.IsType<NotFoundResult>(await controller.Reset(default));
        Assert.IsType<NotFoundResult>(await controller.Status(default));
        Assert.Equal(0, await db.Assessments.CountAsync());
    }

    [Fact]
    public async Task Status_ReportsCountsAndSeededKeys()
    {
        var (controller, _) = Build();
        await controller.Seed(default);
        var result = Assert.IsType<OkObjectResult>(await controller.Status(default));
        var json = JsonSerializer.Serialize(result.Value);
        using var doc = JsonDocument.Parse(json);
        Assert.True(doc.RootElement.GetProperty("enabled").GetBoolean());
        Assert.Equal(13, doc.RootElement.GetProperty("demoRecords").GetInt32());
        Assert.Equal(13, doc.RootElement.GetProperty("expectedRecords").GetInt32());
        Assert.Equal(13, doc.RootElement.GetProperty("seeded").GetArrayLength());
    }
}
