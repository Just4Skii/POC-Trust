using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.EntityFrameworkCore;
using POCTrust.Api;
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
/// Regression tests for the API contract defects found in the independent QA pass:
/// invalid evidence used to surface as an HTTP 500 with a stack trace and internal file paths,
/// and unknown demo scenarios used to be silently mapped onto the VERIFY scenario.
/// </summary>
public sealed class ApiContractTests
{
    private static PocTrustDbContext InMemory() => new(new DbContextOptionsBuilder<PocTrustDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static (AssessmentsController Controller, PocTrustDbContext Db) Build()
    {
        var db = InMemory();
        var orchestrator = new AssessmentOrchestrator(new ReliabilityEngine(), new StubAiProvider(), new EfAuditStore(db));
        return (new AssessmentsController(orchestrator, db, new TestHostEnvironment()), db);
    }

    private static DiagnosticContext Valid(DateTimeOffset now) => new(
        "Hb 14.2 g/dL", "DEV-01", true, now.AddMonths(2), "OP-07", true,
        "LOT-GOOD", now.AddMonths(3), 22.5, now, "site-A/DEV-01/OP-07", TestType: "Hb");

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\t\n")]
    public async Task Evaluate_EmptyOrWhitespaceResult_Returns400WithSafeError(string result)
    {
        var (controller, _) = Build();

        var response = await controller.Evaluate(Valid(DateTimeOffset.UtcNow) with { Result = result }, default);

        var bad = Assert.IsType<BadRequestObjectResult>(response.Result);
        var error = Assert.IsType<ApiError>(bad.Value);
        Assert.Equal("Result is required.", error.Error);
    }

    [Fact]
    public async Task Evaluate_ValidEvidence_ReturnsDecisionAndPersists()
    {
        var (controller, db) = Build();

        var response = await controller.Evaluate(Valid(DateTimeOffset.UtcNow), default);

        var ok = Assert.IsType<OkObjectResult>(response.Result);
        var decision = Assert.IsType<ReliabilityDecision>(ok.Value);
        Assert.Equal(ReliabilityStatus.Trust, decision.FinalStatus);
        Assert.Equal(1, await db.Assessments.CountAsync());
        Assert.Equal(1, await db.Audit.CountAsync());
    }

    [Fact]
    public async Task Evaluate_RejectedInput_PersistsNothing()
    {
        var (controller, db) = Build();

        await controller.Evaluate(Valid(DateTimeOffset.UtcNow) with { Result = "  " }, default);

        Assert.Equal(0, await db.Assessments.CountAsync());
        Assert.Equal(0, await db.Audit.CountAsync());
    }

    [Theory]
    [InlineData("bogus")]
    [InlineData("verify-ish")]
    [InlineData("TRUSTX")]
    public async Task Demo_UnknownKind_Returns400AndPersistsNothing(string kind)
    {
        var (controller, db) = Build();

        var response = await controller.Demo(kind, default);

        var bad = Assert.IsType<BadRequestObjectResult>(response.Result);
        var error = Assert.IsType<ApiError>(bad.Value);
        Assert.Contains("Unknown demo scenario", error.Error);
        Assert.DoesNotContain(kind, error.Error);          // untrusted input is not echoed back
        Assert.Equal(0, await db.Assessments.CountAsync()); // the defect persisted a VERIFY record instead
    }

    [Theory]
    [InlineData("trust", ReliabilityStatus.Trust)]
    [InlineData("review", ReliabilityStatus.Review)]
    [InlineData("missing", ReliabilityStatus.Review)]
    [InlineData("verify", ReliabilityStatus.Verify)]
    [InlineData("offline", ReliabilityStatus.Trust)]
    [InlineData("TRUST", ReliabilityStatus.Trust)]
    public async Task Demo_KnownKind_StillEvaluates(string kind, ReliabilityStatus expected)
    {
        var (controller, _) = Build();

        var response = await controller.Demo(kind, default);

        var ok = Assert.IsType<OkObjectResult>(response.Result);
        var decision = Assert.IsType<ReliabilityDecision>(ok.Value);
        Assert.Equal(expected, decision.FinalStatus);
    }

    [Fact]
    public void ApiError_ProjectsOnlyKnownFieldsInCamelCase()
    {
        var modelState = new ModelStateDictionary();
        modelState.AddModelError("OperatorId", "The OperatorId field is required.");
        modelState.AddModelError("$.result", "unreadable payload");
        modelState.AddModelError("context", "The context field is required.");

        var error = ApiError.From("Request body is missing required fields.", modelState);

        Assert.Equal(new List<string> { "operatorId", "result" }, error.Fields);
    }

    [Fact]
    public void ApiError_DropsBinderInternals()
    {
        var modelState = new ModelStateDictionary();
        modelState.AddModelError("$", "Expected depth to be zero at the end of the JSON payload.");
        modelState.AddModelError("context", "The context field is required.");

        var error = ApiError.From("Request body is not valid JSON for the assessment contract.", modelState);

        Assert.Null(error.Fields);
        Assert.DoesNotContain("context", error.Error);
    }
}
