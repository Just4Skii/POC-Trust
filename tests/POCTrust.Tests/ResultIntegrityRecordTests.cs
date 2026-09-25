using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using POCTrust.Api;
using POCTrust.Api.Controllers;
using POCTrust.Api.Services;
using POCTrust.Core.Entities;
using POCTrust.Core.Enums;
using POCTrust.Core.Interfaces;
using POCTrust.Core.Integrity;
using POCTrust.Core.Reliability;
using POCTrust.Infrastructure.AI;
using POCTrust.Infrastructure.Data;
using POCTrust.Infrastructure.Services;

namespace POCTrust.Tests;

/// <summary>
/// Result Integrity Record tests: the projection must be a pure, deterministic, rule-first
/// derivation of the STORED assessment, never a re-evaluation, never a second source of truth.
/// Scenario contexts mirror the demonstration scenarios in AssessmentsController.
/// </summary>
public sealed class ResultIntegrityRecordTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 24, 14, 3, 0, TimeSpan.Zero);

    private static PocTrustDbContext InMemory() => new(new DbContextOptionsBuilder<PocTrustDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    /// <summary>Evaluates a context through the REAL pipeline and returns the stored record plus
    /// its projection, exactly the path the API endpoint uses.</summary>
    private static async Task<(AssessmentRecord Stored, ResultIntegrityRecord Record, PocTrustDbContext Db)>
        EvaluateAndProject(DiagnosticContext context, IAIProvider? ai = null)
    {
        var db = InMemory();
        var orchestrator = new AssessmentOrchestrator(new ReliabilityEngine(), ai ?? new StubAiProvider(), new EfAuditStore(db));
        var decision = await orchestrator.EvaluateAsync(context);
        var stored = await db.Assessments.AsNoTracking().SingleAsync(a => a.Id == decision.Id);
        var audits = await db.Audit.AsNoTracking().Where(x => x.AssessmentId == decision.Id).ToListAsync();
        var snapshot = new IntegrityDecisionSnapshot(
            stored.Id, context, stored.FinalStatus,
            Parse(stored.RuleIdsJson), Parse(stored.ReasonsJson),
            stored.Action, stored.AiConsulted, stored.AiSummary, stored.DecidedAtUtc,
            new IntegrityAuditReference(audits.Count, audits.Count(x => !string.IsNullOrEmpty(x.Hash)),
                "sha256-chain", "Sealed audit record available", ""));
        return (stored, ResultIntegrityProjector.Project(snapshot), db);
    }

    private static string[] Parse(string json)
    {
        var list = new List<string>();
        if (!string.IsNullOrWhiteSpace(json))
        {
            foreach (var part in json.Trim('[', ']').Split(','))
            {
                var v = part.Trim().Trim('"');
                if (v.Length > 0) list.Add(v);
            }
        }
        return [.. list];
    }

    // Demonstration-scenario contexts (mirroring AssessmentsController.Demo)
    private static DiagnosticContext TrustScenario() => new(
        "Hb 14.2 g/dL", "DEV-01", true, Now.AddMonths(2), "OP-07", true,
        "LOT-GOOD", Now.AddMonths(3), 22.5, Now, "site-A/DEV-01/OP-07", TestType: "Hb");

    private static DiagnosticContext ReviewScenario() => new(
        "Hb 9.1 g/dL", "DEV-02", true, Now.AddDays(3), "OP-12", false,
        "LOT-44", Now.AddDays(10), 24.0, Now, "site-B/DEV-02/OP-12", TestType: "Hb", PowerInterruption: true);

    private static DiagnosticContext VerifyScenario() => new(
        "CRP 68 mg/L", "DEV-03", false, Now.AddDays(-9), "OP-03", true,
        "LOT-91", Now.AddDays(-1), 31.5, Now, "site-C/DEV-03/OP-03", TestType: "CRP", HumidityPct: 90);

    private static DiagnosticContext MissingScenario() => new(
        "Hb 11.0 g/dL", "DEV-04", true, Now.AddMonths(1), "", true,
        "", Now.AddMonths(1), 23.0, Now, "", TestType: "Hb");

    private static IntegrityDomainEvidence Domain(ResultIntegrityRecord r, string key) =>
        r.Domains.Single(d => d.Domain == key);

    private static readonly string[] AllStates =
        ["valid", "aging", "missing", "stale", "expired", "failed", "conflicting", "unverified-source"];

    [Fact]
    public async Task TrustScenario_CoverageComplete_AllEvidenceValid()
    {
        var (_, record, _) = await EvaluateAndProject(TrustScenario());

        Assert.Equal("Trust", record.Disposition);
        Assert.Equal("7 / 7 required domains available", record.EvidenceQuality.Coverage.Statement);
        Assert.Equal("All current", record.EvidenceQuality.Freshness);
        Assert.Equal("No conflicts", record.EvidenceQuality.Consistency);
        Assert.Equal("Complete", record.EvidenceQuality.Traceability);
        Assert.Equal("valid", Domain(record, "device").State);
        Assert.Equal("valid", Domain(record, "quality-control").State);
        Assert.Equal("valid", Domain(record, "calibration").State);
        Assert.Equal("valid", Domain(record, "operator").State);
        Assert.Equal("valid", Domain(record, "provenance").State);
        Assert.Contains("All deterministic checks passed.", record.DecisionDrivers);
    }

    [Fact]
    public async Task ReviewScenario_AgingAndLapsedEvidence_ClassifiedFromStoredRules()
    {
        var (_, record, _) = await EvaluateAndProject(ReviewScenario());

        Assert.Equal("Review", record.Disposition);
        Assert.Equal("aging", Domain(record, "calibration").State);
        Assert.Equal("aging", Domain(record, "reagent").State);
        Assert.Equal("expired", Domain(record, "operator").State);
        Assert.Equal("failed", Domain(record, "power").State);
        Assert.Equal("2 aging, 1 expired", record.EvidenceQuality.Freshness);
        // One interaction conflict (MULTI_CONTEXT), the honest conflict model replaces the
        // old inflated estimate: conflicts are detected inconsistencies between two sources.
        Assert.Equal(1, record.EvidenceQuality.ConflictCount);
        Assert.Equal("1 conflict", record.EvidenceQuality.Consistency);
        Assert.NotNull(record.Conflicts);
        Assert.Contains("Multiple recorded evidence sources", record.Conflicts![0].Conflict);
        Assert.Equal("7 / 7 required domains available", record.EvidenceQuality.Coverage.Statement);
    }

    [Fact]
    public async Task VerifyScenario_HardFailures_Classified_ButEvidenceStillCounted()
    {
        var (_, record, _) = await EvaluateAndProject(VerifyScenario());

        Assert.Equal("Verify", record.Disposition);
        Assert.Equal("failed", Domain(record, "quality-control").State);
        Assert.Equal("expired", Domain(record, "calibration").State);
        Assert.Equal("expired", Domain(record, "reagent").State);
        Assert.Equal("failed", Domain(record, "environment").State);
        // A failed control is still evidence the engine HAD, it must count as available.
        Assert.Equal("7 / 7 required domains available", record.EvidenceQuality.Coverage.Statement);
        Assert.Equal(2, record.EvidenceQuality.ExpiredCount);
        Assert.Contains("A control explicitly failed", Domain(record, "quality-control").Note);
    }

    [Fact]
    public async Task MissingScenario_UnrecordedEvidence_ReducesCoverage()
    {
        var (_, record, _) = await EvaluateAndProject(MissingScenario());

        Assert.Equal("missing", Domain(record, "operator").State);
        Assert.Equal("missing", Domain(record, "reagent").State);
        Assert.Equal("missing", Domain(record, "provenance").State);
        Assert.Equal("4 / 7 required domains available", record.EvidenceQuality.Coverage.Statement);
        Assert.Equal("Incomplete", record.EvidenceQuality.Traceability);
        // Missing evidence never invents a value, the consequence is stated instead.
        Assert.Contains("No operator was recorded with the event.", Domain(record, "operator").Note);
    }

    [Fact]
    public async Task Projection_IsDeterministic_SameStoredRecord_SameRecord()
    {
        var context = ReviewScenario();
        var db = InMemory();
        var orchestrator = new AssessmentOrchestrator(new ReliabilityEngine(), new StubAiProvider(), new EfAuditStore(db));
        var decision = await orchestrator.EvaluateAsync(context);
        var stored = await db.Assessments.AsNoTracking().SingleAsync(a => a.Id == decision.Id);
        var audits = await db.Audit.AsNoTracking().Where(x => x.AssessmentId == decision.Id).ToListAsync();

        IntegrityDecisionSnapshot Snapshot() => new(
            stored.Id, context, stored.FinalStatus,
            Parse(stored.RuleIdsJson), Parse(stored.ReasonsJson),
            stored.Action, stored.AiConsulted, stored.AiSummary, stored.DecidedAtUtc,
            new IntegrityAuditReference(audits.Count, audits.Count, "sha256-chain", "Sealed", ""));

        var a = ResultIntegrityProjector.Project(Snapshot());
        var b = ResultIntegrityProjector.Project(Snapshot());
        // Byte-identical canonical JSON, the strongest form of the determinism guarantee.
        var jsonOpts = new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web);
        Assert.Equal(System.Text.Json.JsonSerializer.Serialize(a, jsonOpts),
                     System.Text.Json.JsonSerializer.Serialize(b, jsonOpts));
        Assert.Equal(a.ProjectedAtUtc, stored.DecidedAtUtc); // anchored at decision time, not "now"
    }

    [Fact]
    public async Task Projection_NeverReEvaluates_MirrorsStoredDispositionEvenIfInputDisagrees()
    {
        // A hand-built snapshot whose stored decision says TRUST/ALL_CHECKS_PASS while the raw
        // input would fail QC. The projector must mirror the STORED decision, re-deciding is
        // the engine's job, and detecting tampering is the audit chain's job.
        var input = TrustScenario() with { QcPassed = false };
        var snapshot = new IntegrityDecisionSnapshot(
            Guid.NewGuid(), input, ReliabilityStatus.Trust,
            ["ALL_CHECKS_PASS"], ["[ALL_CHECKS_PASS] All deterministic checks passed."],
            "Result may enter clinical workflow under routine controls.",
            AiConsulted: false, AiSummary: null, Now,
            new IntegrityAuditReference(1, 1, "sha256-chain", "Sealed audit record available", ""));

        var record = ResultIntegrityProjector.Project(snapshot);

        Assert.Equal("Trust", record.Disposition);
        Assert.Equal("valid", Domain(record, "quality-control").State);
        Assert.Equal("valid", Domain(record, "calibration").State);
    }

    [Fact]
    public async Task Projection_DomainStates_AlwaysUseKnownVocabulary()
    {
        foreach (var scenario in new[] { TrustScenario(), ReviewScenario(), VerifyScenario(), MissingScenario() })
        {
            var (_, record, _) = await EvaluateAndProject(scenario);
            Assert.All(record.Domains, d => Assert.Contains(d.State, AllStates));
            Assert.Equal(10, record.Domains.Count); // full canonical domain model
            Assert.All(record.Domains.Where(d => d.RequiredByPolicy),
                d => Assert.Contains(d.Domain, record.Policy.RequiredDomains));
        }
    }

    [Fact]
    public async Task Projection_PolicyIsExplicitlyDemonstration_WithEngineMirroredThresholds()
    {
        var (_, record, _) = await EvaluateAndProject(TrustScenario());

        Assert.Equal("demonstration", record.Policy.Kind);
        Assert.Equal(7, record.Policy.RequiredDomains.Count);
        Assert.Contains(record.Policy.FreshnessWindows, w => w.Domain == "calibration" && w.Days == 7);
        Assert.Contains(record.Policy.FreshnessWindows, w => w.Domain == "reagent" && w.Days == 14);
        Assert.Contains(record.Policy.SupportedEnvironment, r => r.Measure == "Temperature" && r.Minimum == 15 && r.Maximum == 30);
        Assert.Contains(record.Policy.SupportedEnvironment, r => r.Measure == "Humidity" && r.Minimum == 10 && r.Maximum == 85);
        Assert.Contains("not a clinically validated", record.Policy.Note);
    }

    [Fact]
    public async Task Projection_DecisionDrivers_ExcludePipelineNotes_AndMachinePrefixes()
    {
        // Review scenario consults the (stub) advisory provider, that pipeline note must not
        // appear as a decision driver.
        var (_, record, _) = await EvaluateAndProject(ReviewScenario());

        Assert.All(record.DecisionDrivers, d => Assert.DoesNotContain("[", d));
        Assert.All(record.DecisionDrivers, d => Assert.False(d.StartsWith("AI ", StringComparison.Ordinal)));
        Assert.Contains("Calibration due within 7 days.", record.DecisionDrivers);
        // cal + reagent + operator + power + multi-context (AI pipeline note excluded)
        Assert.Equal(5, record.DecisionDrivers.Count);
    }

    [Fact]
    public async Task Projection_AuditReference_ReportsSealedTrail()
    {
        var (_, record, _) = await EvaluateAndProject(TrustScenario());
        Assert.Equal(1, record.Audit.Entries);
        Assert.Equal(1, record.Audit.SealedEntries);
        Assert.Equal("sha256-chain", record.Audit.Algorithm);
        Assert.Equal("Sealed audit record available", record.Audit.Status);
    }

    [Fact]
    public async Task Projection_RecordCarriesHonestBasisNote()
    {
        var (_, record, _) = await EvaluateAndProject(TrustScenario());
        Assert.Equal("rir-v1", record.RecordVersion);
        Assert.Contains("Operational integrity assessment", record.BasisNote);
        Assert.Contains("not a measure of clinical validity", record.BasisNote);
        Assert.Equal("advisory", record.AiContext.Role);
    }

    // ── API endpoint ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task IntegrityRecordEndpoint_ReturnsDerivedRecord()
    {
        var db = InMemory();
        var orchestrator = new AssessmentOrchestrator(new ReliabilityEngine(), new StubAiProvider(), new EfAuditStore(db));
        var decision = await orchestrator.EvaluateAsync(TrustScenario());
        var controller = new PlatformController(db, new ReliabilityEngine());

        var result = await controller.IntegrityRecord(decision.Id);

        var ok = Assert.IsType<OkObjectResult>(result);
        var record = Assert.IsType<ResultIntegrityRecord>(ok.Value);
        Assert.Equal(decision.Id, record.AssessmentId);
        Assert.Equal("Trust", record.Disposition);
        Assert.Equal("7 / 7 required domains available", record.EvidenceQuality.Coverage.Statement);
    }

    [Fact]
    public async Task IntegrityRecordEndpoint_UnknownId_Returns404WithSafeError()
    {
        var controller = new PlatformController(InMemory(), new ReliabilityEngine());

        var result = await controller.IntegrityRecord(Guid.NewGuid());

        var notFound = Assert.IsType<NotFoundObjectResult>(result);
        var error = Assert.IsType<ApiError>(notFound.Value);
        Assert.Contains("No assessment with this id exists.", error.Error);
    }
}
