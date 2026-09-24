using POCTrust.Core.Entities;
using POCTrust.Core.Enums;
using POCTrust.Core.Interfaces;

namespace POCTrust.Core.Reliability;

public sealed class ReliabilityEngine : IReliabilityEngine
{
    public (ReliabilityStatus Status, List<RuleFinding> Findings) EvaluateInitial(DiagnosticContext c, DateTimeOffset nowUtc)
    {
        var findings = new List<RuleFinding>();
        var status = ReliabilityStatus.Trust;

        void Add(string ruleId, ReliabilityStatus severity, string reason)
        {
            findings.Add(new RuleFinding(ruleId, severity, reason));
            if (severity > status) status = severity;
        }

        // 1. QC — hard VERIFY
        if (!c.QcPassed)
            Add("QC_FAILED", ReliabilityStatus.Verify, "QC failed — result must not be relied upon without verification.");

        // 2. Calibration — expired → VERIFY
        if (c.CalibrationDueUtc < nowUtc)
            Add("CAL_EXPIRED", ReliabilityStatus.Verify, $"Calibration overdue since {c.CalibrationDueUtc:yyyy-MM-dd}.");
        else if (c.CalibrationDueUtc < nowUtc.AddDays(7))
            Add("CAL_NEAR_DUE", ReliabilityStatus.Review, "Calibration due within 7 days.");

        // 3. Reagent — expired → VERIFY
        if (c.ReagentExpiryUtc < nowUtc)
            Add("REAGENT_EXPIRED", ReliabilityStatus.Verify, $"Reagent lot {c.ReagentLot} expired {c.ReagentExpiryUtc:yyyy-MM-dd}.");
        else if (c.ReagentExpiryUtc < nowUtc.AddDays(14))
            Add("REAGENT_NEAR_EXPIRY", ReliabilityStatus.Review, $"Reagent lot {c.ReagentLot} nearing expiry ({c.ReagentExpiryUtc:yyyy-MM-dd}).");

        // 4. Operator competency → REVIEW
        if (!c.OperatorCompetent)
            Add("OPERATOR_NOT_COMPETENT", ReliabilityStatus.Review, $"Operator {c.OperatorId} competency expired/unverified.");

        // 5. Environment → REVIEW
        if (c.TemperatureC is < 15 or > 30)
            Add("ENV_TEMP", ReliabilityStatus.Review, $"Temperature {c.TemperatureC:F1}°C outside 15–30°C range.");
        if (c.HumidityPct is < 10 or > 85)
            Add("ENV_HUMIDITY", ReliabilityStatus.Review, $"Humidity {c.HumidityPct:F0}% outside 10–85% range.");

        // 6. Power interruption → REVIEW
        if (c.PowerInterruption)
            Add("POWER_INTERRUPTION", ReliabilityStatus.Review, "Power interruption associated with event.");

        // 7. Provenance → REVIEW
        if (string.IsNullOrWhiteSpace(c.OperatorId) || string.IsNullOrWhiteSpace(c.ReagentLot) || string.IsNullOrWhiteSpace(c.Provenance))
            Add("PROVENANCE_INCOMPLETE", ReliabilityStatus.Review, "Missing required provenance (who/device/reagent/where).");

        // 8. Multiple contextual concerns → REVIEW (explicit marker when >=2 review-level findings)
        var reviewCount = findings.Count(f => f.Severity == ReliabilityStatus.Review);
        if (reviewCount >= 2 && status == ReliabilityStatus.Review)
            Add("MULTI_CONTEXT", ReliabilityStatus.Review, $"Multiple contextual concerns ({reviewCount}) — interaction review warranted.");

        if (status == ReliabilityStatus.Trust && findings.Count == 0)
            findings.Add(new RuleFinding("ALL_CHECKS_PASS", ReliabilityStatus.Trust, "All deterministic checks passed."));

        return (status, findings);
    }

    public bool NeedsAi(DiagnosticContext c, ReliabilityStatus initialStatus, IReadOnlyList<RuleFinding> findings, DateTimeOffset nowUtc)
    {
        // TRUST with all controls passing → no AI
        if (initialStatus == ReliabilityStatus.Trust && findings.All(f => f.RuleId == "ALL_CHECKS_PASS"))
            return false;
        // Hard VERIFY → deterministic only, AI unnecessary for decision
        if (initialStatus == ReliabilityStatus.Verify)
            return false;
        // REVIEW with multiple/interacting concerns or missing evidence → AI useful
        if (findings.Count >= 2)
            return true;
        if (findings.Any(f => f.RuleId is "PROVENANCE_INCOMPLETE" or "POWER_INTERRUPTION" or "MULTI_CONTEXT"))
            return true;
        return false;
    }

    public ReliabilityStatus EnforceFinalStatus(ReliabilityStatus initialStatus, AIAssessment? ai)
    {
        // HARD SAFETY INVARIANT: VERIFY can never be downgraded, AI is advisory only.
        if (initialStatus == ReliabilityStatus.Verify)
            return ReliabilityStatus.Verify;
        // AI never produces authoritative status; ignore any such claim.
        return initialStatus;
    }

    public string BuildAction(ReliabilityStatus finalStatus) => finalStatus switch
    {
        ReliabilityStatus.Trust => "Result may enter clinical workflow under routine controls.",
        ReliabilityStatus.Review => "Hold for trained-operator review; check flagged context before reliance.",
        ReliabilityStatus.Verify => "Do not rely — verify/repeat/confirm per applicable workflow.",
        _ => "Hold for review."
    };
}
