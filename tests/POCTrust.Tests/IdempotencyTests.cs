using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.FileProviders;
using POCTrust.Api.Controllers;
using POCTrust.Api.Security;
using POCTrust.Api.Services;
using POCTrust.Core.Entities;
using POCTrust.Core.Enums;
using POCTrust.Core.Reliability;
using POCTrust.Infrastructure.AI;
using POCTrust.Infrastructure.Data;
using POCTrust.Infrastructure.Services;

namespace POCTrust.Tests;

/// <summary>
/// Guards the offline-sync idempotency contract: a retried submission carrying the same
/// Idempotency-Key is answered with the ORIGINAL response (no duplicate assessment), keys are
/// optional, oversized keys are a client error, and a submission without a key always evaluates.
/// </summary>
public sealed class IdempotencyTests
{
    private static PocTrustDbContext InMemory() => new(new DbContextOptionsBuilder<PocTrustDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static (AssessmentsController Controller, PocTrustDbContext Db, DefaultHttpContext Http) Build()
    {
        var db = InMemory();
        var orchestrator = new AssessmentOrchestrator(new ReliabilityEngine(), new StubAiProvider(), new EfAuditStore(db));
        var controller = new AssessmentsController(orchestrator, db);
        var http = new DefaultHttpContext();
        controller.ControllerContext = new ControllerContext { HttpContext = http };
        return (controller, db, http);
    }

    private static DiagnosticContext Context(DateTimeOffset now, string result = "Hb 14.2 g/dL") => new(
        result, "DEV-01", true, now.AddMonths(2), "OP-07", true,
        "LOT-GOOD", now.AddMonths(3), 22.5, now, "site-A/DEV-01/OP-07", TestType: "Hb");

    [Fact]
    public async Task Evaluate_SameKeyTwice_ReplaysOriginalResponse_WithoutDuplicateAssessment()
    {
        var (controller, db, http) = Build();
        http.Request.Headers["Idempotency-Key"] = "sync-abc-123";

        var first = await controller.Evaluate(Context(DateTimeOffset.UtcNow), default);
        var firstDecision = Assert.IsType<ReliabilityDecision>(Assert.IsType<OkObjectResult>(first.Result).Value);

        // A retry (e.g. the offline queue re-posting after a lost connection) with the SAME key
        // must return the original decision — even if the payload differs.
        var second = await controller.Evaluate(
            Context(DateTimeOffset.UtcNow, "Glucose 11.2 mmol/L"), default);

        var replay = Assert.IsType<ContentResult>(second.Result);
        Assert.Equal("true", controller.Response.Headers["Idempotent-Replay"].ToString());
        using var doc = JsonDocument.Parse(replay.Content!);
        Assert.Equal(firstDecision.Id, doc.RootElement.GetProperty("id").GetGuid());
        Assert.Equal((int)firstDecision.FinalStatus, doc.RootElement.GetProperty("finalStatus").GetInt32());

        Assert.Equal(1, await db.Assessments.CountAsync());
        Assert.Equal(1, await db.Audit.CountAsync());
        Assert.Equal(1, await db.SyncReceipts.CountAsync());
    }

    [Fact]
    public async Task Evaluate_DifferentKey_EvaluatesAndPersistsSeparately()
    {
        var (controller, db, http) = Build();
        http.Request.Headers["Idempotency-Key"] = "key-one";
        await controller.Evaluate(Context(DateTimeOffset.UtcNow), default);
        http.Request.Headers["Idempotency-Key"] = "key-two";
        await controller.Evaluate(Context(DateTimeOffset.UtcNow), default);

        Assert.Equal(2, await db.Assessments.CountAsync());
        Assert.Equal(2, await db.SyncReceipts.CountAsync());
    }

    [Fact]
    public async Task Evaluate_WithoutKey_BehavesAsBefore()
    {
        var (controller, db, _) = Build();
        await controller.Evaluate(Context(DateTimeOffset.UtcNow), default);
        await controller.Evaluate(Context(DateTimeOffset.UtcNow), default);

        Assert.Equal(2, await db.Assessments.CountAsync());
        Assert.Equal(0, await db.SyncReceipts.CountAsync());
    }

    [Fact]
    public async Task Evaluate_OversizedKey_IsAClientError_AndPersistsNothing()
    {
        var (controller, db, http) = Build();
        http.Request.Headers["Idempotency-Key"] = new string('x', 129);

        var response = await controller.Evaluate(Context(DateTimeOffset.UtcNow), default);

        Assert.IsType<BadRequestObjectResult>(response.Result);
        Assert.Equal(0, await db.Assessments.CountAsync());
        Assert.Equal(0, await db.SyncReceipts.CountAsync());
    }

    [Fact]
    public async Task Evaluate_ReplayResponse_MatchesTheStoredReceiptBytes()
    {
        var (controller, db, http) = Build();
        http.Request.Headers["Idempotency-Key"] = "byte-check";
        await controller.Evaluate(Context(DateTimeOffset.UtcNow), default);

        var stored = (await db.SyncReceipts.AsNoTracking().SingleAsync()).ResponseJson;
        var replay = Assert.IsType<ContentResult>((await controller.Evaluate(Context(DateTimeOffset.UtcNow), default)).Result);

        Assert.Equal(stored, replay.Content);
    }
}

/// <summary>
/// Guards the optional first-run demonstration load: it fills an EMPTY store through the real
/// pipeline, never duplicates into a populated one, and the audit trail it produces verifies.
/// </summary>
public sealed class StartupSeedingTests
{
    private static (DemoSeeder Seeder, PocTrustDbContext Db) Build()
    {
        var db = new PocTrustDbContext(new DbContextOptionsBuilder<PocTrustDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var orchestrator = new AssessmentOrchestrator(new ReliabilityEngine(), new StubAiProvider(), new EfAuditStore(db));
        return (new DemoSeeder(orchestrator, db), db);
    }

    [Fact]
    public async Task AutoSeed_EmptyStore_LoadsTheCuratedSet_WithAnIntactAuditChain()
    {
        var (seeder, db) = Build();
        Assert.True(await seeder.StoreIsEmptyAsync());

        await seeder.SeedOnStartupIfConfiguredAsync(NullLogger.Instance);

        Assert.Equal(DemoSeedData.All.Count, await db.Assessments.CountAsync());
        Assert.Equal(DemoSeedData.All.Count, await db.Audit.CountAsync());
        Assert.True(AuditChain.Verify(await db.Audit.AsNoTracking().ToListAsync()).Valid);
    }

    [Fact]
    public async Task AutoSeed_PopulatedStore_IsSkipped()
    {
        var (seeder, db) = Build();
        await seeder.SeedAsync();
        Assert.False(await seeder.StoreIsEmptyAsync());

        await seeder.SeedOnStartupIfConfiguredAsync(NullLogger.Instance);

        Assert.Equal(DemoSeedData.All.Count, await db.Assessments.CountAsync());
    }
}

/// <summary>Guards the optional API-key gate: default mode changes nothing; apikey mode blocks
/// mutating /api calls without the key, admits them with it, and never blocks reads or /health.</summary>
public sealed class ApiKeyGateTests
{
    private static IConfiguration Config(string mode, string key = "demo-secret") =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Auth:Mode"] = mode,
            ["Auth:ApiKey"] = key,
        }).Build();

    private static async Task<HttpContext> RunAsync(IConfiguration config, string method, string path, string? key = null)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = method;
        context.Request.Path = path;
        if (key is not null) context.Request.Headers["X-Api-Key"] = key;

        var reachedNext = false;
        var middleware = new ApiKeyAuthMiddleware(
            _ => { reachedNext = true; return Task.CompletedTask; },
            config,
            NullLogger<ApiKeyAuthMiddleware>.Instance);
        await middleware.InvokeAsync(context);
        Assert.True(reachedNext || context.Response.StatusCode == 401, "middleware must either pass through or reject");
        return context;
    }

    [Fact]
    public async Task DefaultMode_NeverBlocksAnything()
    {
        var config = Config("none");
        var post = await RunAsync(config, "POST", "/api/assessments/evaluate");
        Assert.Equal(200, post.Response.StatusCode);
    }

    [Fact]
    public async Task ApiKeyMode_MutatingWithoutKey_IsRejectedWithSafeEnvelope()
    {
        var config = Config("apikey");
        var context = await RunAsync(config, "POST", "/api/assessments/evaluate");
        Assert.Equal(401, context.Response.StatusCode);
    }

    [Fact]
    public async Task ApiKeyMode_MutatingWithTheCorrectKey_PassesThrough()
    {
        var config = Config("apikey");
        var context = await RunAsync(config, "POST", "/api/assessments/evaluate", "demo-secret");
        Assert.Equal(200, context.Response.StatusCode);
    }

    [Fact]
    public async Task ApiKeyMode_WrongKey_IsRejected()
    {
        var config = Config("apikey");
        var context = await RunAsync(config, "POST", "/api/assessments/evaluate", "not-the-key");
        Assert.Equal(401, context.Response.StatusCode);
    }

    [Theory]
    [InlineData("GET", "/api/dashboard/summary")]
    [InlineData("GET", "/health")]
    [InlineData("POST", "/health")]
    public async Task ApiKeyMode_ReadsAndHealth_AreNeverBlocked(string method, string path)
    {
        var config = Config("apikey");
        var context = await RunAsync(config, method, path);
        Assert.Equal(200, context.Response.StatusCode);
    }
}

/// <summary>Guards operational status reporting: it describes the AI configuration without ever
/// exposing key material, and honestly reports the stub when no key is set.</summary>
public sealed class SystemStatusTests
{
    private sealed class FakeEnv(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "tests";
        public string ContentRootPath { get; set; } = ".";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    [Fact]
    public async Task Status_WithoutKey_ReportsStubAndNeverLeaksMaterial()
    {
        var db = new PocTrustDbContext(new DbContextOptionsBuilder<PocTrustDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["AI:ApiKey"] = "",
            ["AI:Model"] = "gemini-2.0-flash",
            ["AI:Endpoint"] = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        }).Build();

        var result = await new SystemController(config, db, new FakeEnv("Development")).Status(default);
        var json = JsonSerializer.Serialize(Assert.IsType<OkObjectResult>(result).Value);

        Assert.Contains("\"provider\":\"stub/offline\"", json);
        Assert.Contains("\"configured\":false", json);
        Assert.Contains("generativelanguage.googleapis.com", json);
        Assert.DoesNotContain("supersecret", json);
    }

    [Fact]
    public async Task Status_WithKey_ReportsLiveProvider()
    {
        var db = new PocTrustDbContext(new DbContextOptionsBuilder<PocTrustDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["AI:ApiKey"] = "supersecret-value",
            ["AI:Model"] = "gemini-2.0-flash",
        }).Build();

        var result = await new SystemController(config, db, new FakeEnv("Development")).Status(default);
        var json = JsonSerializer.Serialize(Assert.IsType<OkObjectResult>(result).Value);

        Assert.Contains("\"configured\":true", json);
        Assert.DoesNotContain("supersecret-value", json);
    }
}
