using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using POCTrust.Api.Controllers;
using POCTrust.Core.Entities;
using POCTrust.Core.Reliability;
using POCTrust.Core.Enums;
using POCTrust.Infrastructure.Data;
using POCTrust.Infrastructure.Services;

namespace POCTrust.Tests;

/// <summary>
/// Regression tests for the evidence persistence defect found in the independent QA pass: persisted
/// evidence was written as PascalCase while the UI reads camelCase, so a reopened assessment showed
/// wrong evidence (operator competency wrong, calibration and temperature rendered as "-").
/// </summary>
public sealed class EvidencePersistenceTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private static PocTrustDbContext InMemory() => new(new DbContextOptionsBuilder<PocTrustDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static DiagnosticContext Context(DateTimeOffset now) => new(
        "Hb 9.1 g/dL", "DEV-02", true, now.AddDays(3), "OP-12", false,
        "LOT-44", now.AddDays(10), 24.0, now, "site-B/DEV-02/OP-12",
        TestType: "Hb", HumidityPct: 55, PowerInterruption: true);

    private static ReliabilityDecision DecisionFor(DiagnosticContext context) => new(
        Guid.NewGuid(), ReliabilityStatus.Review, ReliabilityStatus.Review,
        ["[OPERATOR_NOT_COMPETENT] Operator OP-12 competency expired/unverified."],
        ["OPERATOR_NOT_COMPETENT"],
        "Hold for trained-operator review; check flagged context before reliance.",
        null, false, DateTimeOffset.UtcNow);

    [Fact]
    public async Task PersistedEvidence_RoundTripsWithIdenticalValues()
    {
        var context = Context(DateTimeOffset.UtcNow);
        var db = InMemory();

        await new EfAuditStore(db).SaveAsync(context, DecisionFor(context));

        var saved = await db.Assessments.AsNoTracking().SingleAsync();
        var reloaded = JsonSerializer.Deserialize<DiagnosticContext>(saved.InputJson, Web);

        Assert.NotNull(reloaded);
        Assert.Equal(context, reloaded);                                      // whole evidence record
        Assert.Equal(context.OperatorCompetent, reloaded!.OperatorCompetent);  // values the UI renders
        Assert.Equal(context.CalibrationDueUtc, reloaded.CalibrationDueUtc);
        Assert.Equal(context.TemperatureC, reloaded.TemperatureC);
        Assert.Equal(context.HumidityPct, reloaded.HumidityPct);
        Assert.Equal(context.PowerInterruption, reloaded.PowerInterruption);
    }

    [Fact]
    public async Task PersistedEvidence_UsesCanonicalCamelCaseKeys()
    {
        var context = Context(DateTimeOffset.UtcNow);
        var db = InMemory();

        await new EfAuditStore(db).SaveAsync(context, DecisionFor(context));

        var json = (await db.Assessments.AsNoTracking().SingleAsync()).InputJson;
        Assert.Contains("\"operatorCompetent\"", json);
        Assert.Contains("\"calibrationDueUtc\"", json);
        Assert.Contains("\"temperatureC\"", json);
        Assert.DoesNotContain("\"OperatorCompetent\"", json);
        Assert.DoesNotContain("\"CalibrationDueUtc\"", json);
    }

    [Fact]
    public async Task AuditRow_CarriesTheSameEvidenceJsonAndLink()
    {
        var context = Context(DateTimeOffset.UtcNow);
        var decision = DecisionFor(context);
        var db = InMemory();

        await new EfAuditStore(db).SaveAsync(context, decision);

        var assessment = await db.Assessments.AsNoTracking().SingleAsync();
        var audit = await db.Audit.AsNoTracking().SingleAsync();
        Assert.Equal(assessment.InputJson, audit.InputJson);
        Assert.Equal(decision.Id, audit.AssessmentId);
    }

    [Fact]
    public async Task History_ReadsLegacyPascalCaseRecords()
    {
        var db = InMemory();
        db.Assessments.Add(LegacyRecord("OP-99", "DEV-LEGACY"));
        await db.SaveChangesAsync();

        var json = Serialize(await new PlatformController(db, new ReliabilityEngine()).History(100, default));

        Assert.Contains("\"operatorId\":\"OP-99\"", json);
        Assert.Contains("\"testType\":\"Hb\"", json);
        Assert.Contains("\"connectivity\":\"offline\"", json);
    }

    [Fact]
    public async Task History_OrderIsStable_WhenTimestampsMatchExactly()
    {
        var db = InMemory();
        var instant = DateTimeOffset.UtcNow;
        var ids = new List<Guid>();
        for (var i = 0; i < 5; i++)
        {
            var record = LegacyRecord($"OP-{i:00}", $"DEV-{i:00}");
            record.DecidedAtUtc = instant;             // timestamps carry no ordering information
            ids.Add(record.Id);
            db.Assessments.Add(record);
        }
        await db.SaveChangesAsync();

        var controller = new PlatformController(db, new ReliabilityEngine());
        var first = Ids(await controller.History(100, default));
        var second = Ids(await controller.History(100, default));

        var expected = ids.OrderByDescending(id => id).ToList();
        Assert.Equal(expected, first);
        Assert.Equal(expected, second);                // identical ordering on repeat reads
    }

    [Fact]
    public async Task AuditDetail_ReturnsOnlyThatAssessmentsRows()
    {
        var now = DateTimeOffset.UtcNow;
        var db = InMemory();
        var store = new EfAuditStore(db);
        var first = Context(now);
        var second = Context(now) with { Result = "Hb 15.0 g/dL", DeviceId = "DEV-09" };
        var firstDecision = DecisionFor(first);
        var secondDecision = DecisionFor(second);

        await store.SaveAsync(first, firstDecision);
        await store.SaveAsync(second, secondDecision);

        Assert.Equal(2, await db.Assessments.CountAsync());
        Assert.Equal(2, await db.Audit.CountAsync());

        var json = Serialize(await new PlatformController(db, new ReliabilityEngine()).AuditDetail(firstDecision.Id, default));
        Assert.Contains(firstDecision.Id.ToString(), json);
        Assert.DoesNotContain(secondDecision.Id.ToString(), json);
    }

    private static AssessmentRecord LegacyRecord(string operatorId, string deviceId) => new()
    {
        Id = Guid.NewGuid(),
        Result = "Hb 11.0 g/dL",
        DeviceId = deviceId,
        QcPassed = true,
        TimestampUtc = DateTimeOffset.UtcNow,
        Provenance = $"site-L/{deviceId}/{operatorId}",
        // Written by an earlier prototype build: PascalCase keys.
        InputJson = $$"""
            {"Result":"Hb 11.0 g/dL","DeviceId":"{{deviceId}}","QcPassed":true,
             "CalibrationDueUtc":"2026-01-01T00:00:00+00:00","OperatorId":"{{operatorId}}",
             "OperatorCompetent":false,"ReagentLot":"LOT-L","ReagentExpiryUtc":"2026-01-01T00:00:00+00:00",
             "TemperatureC":26.5,"TimestampUtc":"2026-01-01T00:00:00+00:00",
             "Provenance":"site-L/{{deviceId}}/{{operatorId}}",
             "TestType":"Hb","HumidityPct":60,"PowerInterruption":false,"Connectivity":"offline",
             "LocalEventId":"local-legacy"}
            """,
        InitialStatus = ReliabilityStatus.Review,
        FinalStatus = ReliabilityStatus.Review,
        Action = "Hold for trained-operator review.",
        AiConsulted = false,
        DecidedAtUtc = DateTimeOffset.UtcNow,
    };

    private static string Serialize(ActionResult result) =>
        JsonSerializer.Serialize(Assert.IsType<OkObjectResult>(result).Value, Web);

    private static List<Guid> Ids(ActionResult result)
    {
        using var document = JsonDocument.Parse(Serialize(result));
        return document.RootElement.EnumerateArray().Select(e => e.GetProperty("id").GetGuid()).ToList();
    }
}
