using POCTrust.Core.Entities;
using POCTrust.Core.Enums;
using POCTrust.Core.Reliability;

namespace POCTrust.Tests;

/// <summary>
/// Boundary and invariant tests for the deterministic engine. The pass/fail boundaries were listed
/// by the independent QA pass as verified behaviour and must not drift.
/// </summary>
public sealed class ReliabilityBoundaryTests
{
    private readonly ReliabilityEngine _engine = new();
    private readonly DateTimeOffset _now = DateTimeOffset.UtcNow;

    private DiagnosticContext Base() => new(
        "Hb 14.2 g/dL", "DEV-01", true, _now.AddMonths(2), "OP-07", true,
        "LOT-GOOD", _now.AddMonths(3), 22.5, _now, "site-A/DEV-01/OP-07", TestType: "Hb");

    [Theory]
    [InlineData(15.0, ReliabilityStatus.Trust)]      // inclusive lower bound
    [InlineData(30.0, ReliabilityStatus.Trust)]      // inclusive upper bound
    [InlineData(14.999, ReliabilityStatus.Review)]
    [InlineData(30.001, ReliabilityStatus.Review)]
    public void TemperatureBoundary(double temperature, ReliabilityStatus expected)
    {
        var (status, findings) = _engine.EvaluateInitial(Base() with { TemperatureC = temperature }, _now);

        Assert.Equal(expected, status);
        Assert.Equal(expected == ReliabilityStatus.Review, findings.Any(f => f.RuleId == "ENV_TEMP"));
    }

    [Theory]
    [InlineData(10.0, ReliabilityStatus.Trust)]      // inclusive lower bound
    [InlineData(85.0, ReliabilityStatus.Trust)]      // inclusive upper bound
    [InlineData(9.9, ReliabilityStatus.Review)]
    [InlineData(85.1, ReliabilityStatus.Review)]
    public void HumidityBoundary(double humidity, ReliabilityStatus expected)
    {
        var (status, findings) = _engine.EvaluateInitial(Base() with { HumidityPct = humidity }, _now);

        Assert.Equal(expected, status);
        Assert.Equal(expected == ReliabilityStatus.Review, findings.Any(f => f.RuleId == "ENV_HUMIDITY"));
    }

    [Fact]
    public void CalibrationDueExactlyNow_IsNearDueNotExpired()
    {
        // Documented semantics: expiry comparison is strict, so "due now" is REVIEW, not VERIFY.
        var (status, findings) = _engine.EvaluateInitial(Base() with { CalibrationDueUtc = _now }, _now);

        Assert.Equal(ReliabilityStatus.Review, status);
        Assert.Contains(findings, f => f.RuleId == "CAL_NEAR_DUE");
        Assert.DoesNotContain(findings, f => f.RuleId == "CAL_EXPIRED");
    }

    [Fact]
    public void CalibrationOneSecondOverdue_IsExpiredVerify()
    {
        var (status, findings) = _engine.EvaluateInitial(Base() with { CalibrationDueUtc = _now.AddSeconds(-1) }, _now);

        Assert.Equal(ReliabilityStatus.Verify, status);
        Assert.Contains(findings, f => f.RuleId == "CAL_EXPIRED");
    }

    [Fact]
    public void ReagentExpiryUsesTheSameStrictBoundary()
    {
        var onBoundary = _engine.EvaluateInitial(Base() with { ReagentExpiryUtc = _now }, _now);
        var overdue = _engine.EvaluateInitial(Base() with { ReagentExpiryUtc = _now.AddSeconds(-1) }, _now);

        Assert.Equal(ReliabilityStatus.Review, onBoundary.Status);
        Assert.Contains(onBoundary.Findings, f => f.RuleId == "REAGENT_NEAR_EXPIRY");
        Assert.Equal(ReliabilityStatus.Verify, overdue.Status);
        Assert.Contains(overdue.Findings, f => f.RuleId == "REAGENT_EXPIRED");
    }

    [Fact]
    public void Verify_IsNeverSentToAi()
    {
        var context = Base() with { QcPassed = false };
        var (status, findings) = _engine.EvaluateInitial(context, _now);

        Assert.Equal(ReliabilityStatus.Verify, status);
        Assert.False(_engine.NeedsAi(context, status, findings, _now));
    }

    [Fact]
    public void Verify_IsNotDowngraded_EvenByAContradictingAdvisory()
    {
        var reassuring = new AIAssessment("Everything looks fine, no concerns at all.", [], "none", 1.0, "adversarial");

        Assert.Equal(ReliabilityStatus.Verify, _engine.EnforceFinalStatus(ReliabilityStatus.Verify, reassuring));
    }

    [Fact]
    public void EveryStatus_HasAnOperationalAction()
    {
        Assert.Contains("routine", _engine.BuildAction(ReliabilityStatus.Trust), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("review", _engine.BuildAction(ReliabilityStatus.Review), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("do not rely", _engine.BuildAction(ReliabilityStatus.Verify), StringComparison.OrdinalIgnoreCase);
    }
}
