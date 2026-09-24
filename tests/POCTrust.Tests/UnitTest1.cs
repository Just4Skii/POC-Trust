using Microsoft.EntityFrameworkCore;
using POCTrust.Api.Services;
using POCTrust.Core.Entities;
using POCTrust.Core.Enums;
using POCTrust.Core.Interfaces;
using POCTrust.Core.Reliability;
using POCTrust.Infrastructure.AI;
using POCTrust.Infrastructure.Data;
using POCTrust.Infrastructure.Services;

namespace POCTrust.Tests;

public sealed class ReliabilityEngineTests
{
    private static DiagnosticContext Base(DateTimeOffset now) => new(
        "Hb 14.2 g/dL", "DEV-01", true, now.AddMonths(2), "OP-07", true,
        "LOT-GOOD", now.AddMonths(3), 22.5, now, "site-A/DEV-01/OP-07");

    private readonly ReliabilityEngine _engine = new();
    private readonly DateTimeOffset _now = DateTimeOffset.UtcNow;

    [Fact] public void ValidCase_Trust()
    {
        var (s, f) = _engine.EvaluateInitial(Base(_now), _now);
        Assert.Equal(ReliabilityStatus.Trust, s);
    }

    [Fact] public void FailedQc_Verify()
    {
        var c = Base(_now) with { QcPassed = false };
        var (s, _) = _engine.EvaluateInitial(c, _now);
        Assert.Equal(ReliabilityStatus.Verify, s);
    }

    [Fact] public void ExpiredCalibration_Verify()
    {
        var c = Base(_now) with { CalibrationDueUtc = _now.AddDays(-1) };
        var (s, _) = _engine.EvaluateInitial(c, _now);
        Assert.Equal(ReliabilityStatus.Verify, s);
    }

    [Fact] public void ExpiredReagent_Verify()
    {
        var c = Base(_now) with { ReagentExpiryUtc = _now.AddDays(-1) };
        var (s, _) = _engine.EvaluateInitial(c, _now);
        Assert.Equal(ReliabilityStatus.Verify, s);
    }

    [Fact] public void OperatorNotCompetent_Review()
    {
        var c = Base(_now) with { OperatorCompetent = false };
        var (s, _) = _engine.EvaluateInitial(c, _now);
        Assert.Equal(ReliabilityStatus.Review, s);
    }

    [Fact] public void EnvironmentConcern_Review()
    {
        var c = Base(_now) with { TemperatureC = 33 };
        var (s, _) = _engine.EvaluateInitial(c, _now);
        Assert.Equal(ReliabilityStatus.Review, s);
    }

    [Fact] public void PowerInterruption_Review()
    {
        var c = Base(_now) with { PowerInterruption = true };
        var (s, _) = _engine.EvaluateInitial(c, _now);
        Assert.Equal(ReliabilityStatus.Review, s);
    }

    [Fact] public void MissingProvenance_Review()
    {
        var c = Base(_now) with { OperatorId = "", ReagentLot = "", Provenance = "" };
        var (s, _) = _engine.EvaluateInitial(c, _now);
        Assert.Equal(ReliabilityStatus.Review, s);
    }

    [Fact] public void MultipleContextual_Review()
    {
        var c = Base(_now) with { OperatorCompetent = false, PowerInterruption = true };
        var (s, f) = _engine.EvaluateInitial(c, _now);
        Assert.Equal(ReliabilityStatus.Review, s);
        Assert.Contains(f, x => x.RuleId == "MULTI_CONTEXT");
    }

    [Fact] public void VerifyCannotBeDowngraded()
    {
        var ai = new AIAssessment("low concern", [], "none", 0.99, "evil-model");
        Assert.Equal(ReliabilityStatus.Verify, _engine.EnforceFinalStatus(ReliabilityStatus.Verify, ai));
    }

    [Fact] public void SameInput_SameDeterministicResult()
    {
        var c = Base(_now) with { TemperatureC = 33 };
        var (s1, _) = _engine.EvaluateInitial(c, _now);
        var (s2, _) = _engine.EvaluateInitial(c, _now);
        Assert.Equal(s1, s2);
    }

    private static PocTrustDbContext InMemory() => new(new DbContextOptionsBuilder<PocTrustDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static AssessmentOrchestrator Orchestrator(IAIProvider ai)
        => new(new ReliabilityEngine(), ai, new EfAuditStore(InMemory()));

    [Fact] public async Task Verify_AiUnavailable_StaysVerify()
    {
        var c = Base(_now) with { QcPassed = false };
        // Hard VERIFY → AI not consulted by policy
        var d = await Orchestrator(new ThrowingAiProvider()).EvaluateAsync(c);
        Assert.Equal(ReliabilityStatus.Verify, d.FinalStatus);
    }

    [Fact] public async Task Review_AiAvailable_StaysReviewOrVerify()
    {
        var c = Base(_now) with { OperatorCompetent = false, PowerInterruption = true };
        var d = await Orchestrator(new StubAiProvider()).EvaluateAsync(c);
        Assert.Equal(ReliabilityStatus.Review, d.InitialStatus);
        Assert.True(d.AiConsulted);
        Assert.Equal(ReliabilityStatus.Review, d.FinalStatus);
    }

    [Fact] public void MalformedAi_PreservesDeterministic()
    {
        var validated = AssessmentOrchestrator.ValidateAi(new AIAssessment("", [], "", double.NaN, ""));
        Assert.Null(validated);
    }

    [Fact] public async Task AiTimeout_DeterministicPreserved()
    {
        var c = Base(_now) with { OperatorCompetent = false, PowerInterruption = true };
        var slow = new CancelledAiProvider();
        var d = await Orchestrator(slow).EvaluateAsync(c);
        Assert.Equal(ReliabilityStatus.Review, d.FinalStatus);
    }

    private sealed class CancelledAiProvider : IAIProvider
    {
        public Task<AIAssessment> AssessAsync(DiagnosticContext c, CancellationToken ct = default)
            => throw new TaskCanceledException("simulated timeout");
    }
}
