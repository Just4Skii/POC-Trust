using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
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
/// Integrity upgrade regression matrix (spec chunk 4, sections 26–39):
///  - RIR reflects the real assessment (disposition equals the deterministic status, domains
///    match the assessment evidence, nothing fabricated);
///  - evidence taxonomy coverage;
///  - decision causality (primary/secondary from real rules, no invented percentages);
///  - policy (displayed, never changes the deterministic safety hierarchy — hard VERIFY stays VERIFY);
///  - historical (reopening reproduces the same RIR, evidence states and provenance consistent);
///  - AI (RIR independent of AI, REVIEW may show advisory context, VERIFY never, AI has no authority);
///  - dashboard integrity overview, list-row integrity and the demonstration sequence.
/// </summary>
public sealed class IntegrityUpgradeTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 24, 14, 3, 0, TimeSpan.Zero);

    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);

    private static PocTrustDbContext InMemory() => new(new DbContextOptionsBuilder<PocTrustDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static string[] Parse(string json) =>
        string.IsNullOrWhiteSpace(json) ? [] : (JsonSerializer.Deserialize<string[]>(json, WebJson) ?? []);

    private static readonly ReliabilityEngine Engine = new();

    private static async Task<(PocTrustDbContext Db, ReliabilityDecision Decision)> Evaluate(
        DiagnosticContext context, IAIProvider? ai = null)
    {
        var db = InMemory();
        var orchestrator = new AssessmentOrchestrator(Engine, ai ?? new StubAiProvider(), new EfAuditStore(db));
        var decision = await orchestrator.EvaluateAsync(context, null, CancellationToken.None);
        return (db, decision);
    }

    /// <summary>The exact reopen path: re-load the stored row + audit from the database and
    /// project again — the projection must be a function of stored data only.</summary>
    private static async Task<ResultIntegrityRecord> ReopenAndProject(PocTrustDbContext db, Guid id)
    {
        var stored = await db.Assessments.AsNoTracking().SingleAsync(a => a.Id == id);
        var audits = await db.Audit.AsNoTracking().Where(x => x.AssessmentId == id).ToListAsync();
        var input = JsonSerializer.Deserialize<DiagnosticContext>(stored.InputJson, WebJson)
            ?? throw new InvalidOperationException("stored input did not round-trip");
        var snapshot = new IntegrityDecisionSnapshot(
            stored.Id, input, stored.FinalStatus, Parse(stored.RuleIdsJson), Parse(stored.ReasonsJson),
            stored.Action, stored.AiConsulted, stored.AiSummary, stored.DecidedAtUtc,
            new IntegrityAuditReference(audits.Count, audits.Count(x => !string.IsNullOrEmpty(x.Hash)),
                "sha256-chain", "Sealed audit record available", ""));
        return ResultIntegrityProjector.Project(snapshot, Engine);
    }

    private static JsonElement AsJson(object? value) =>
        JsonDocument.Parse(JsonSerializer.Serialize(value, WebJson)).RootElement.Clone();

    // Scenario contexts (mirroring the demonstration scenarios)
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

    private static DiagnosticContext OfflineScenario() => new(
        "Malaria RDT negative", "POC-DXM-03", true, Now.AddDays(45), "OP-09", true,
        "LOT-OFF-7", Now.AddDays(60), 25.0, Now, "North Coast PHC (Demo)/POC-DXM-03/OP-09",
        TestType: "Malaria-RDT", Connectivity: "offline", LocalEventId: "local-offline-1");

    private static readonly string[] Taxonomy =
        ["valid", "aging", "missing", "stale", "expired", "failed", "conflicting", "unverified-source"];

    // ── RIR reflects the real assessment ────────────────────────────────────────

    [Fact]
    public async Task Rir_DispositionAlwaysEqualsTheDeterministicStatus_ForEveryScenarioKind()
    {
        foreach (var context in new[] { TrustScenario(), ReviewScenario(), VerifyScenario(), MissingScenario(), OfflineScenario() })
        {
            var (db, decision) = await Evaluate(context);
            var record = await ReopenAndProject(db, decision.Id);

            Assert.Equal(decision.Id, record.AssessmentId);
            Assert.Equal(context.Result, record.Result);
            Assert.Equal(decision.FinalStatus.ToString(), record.Disposition);
            Assert.Equal(decision.Action, record.RecommendedAction);
            // The recorded rule IDs the RIR exposes are exactly the stored ones.
            var causalityRules = new[] {
                record.Causality?.PrimaryDrivers.Select(d => d.RuleId) ?? [],
                record.Causality?.SecondaryConsiderations.Select(d => d.RuleId) ?? [],
            }.SelectMany(x => x).Where(r => r.Length > 0).ToHashSet();
            Assert.Subset(new HashSet<string>(decision.RuleIds), causalityRules);
        }
    }

    [Fact]
    public async Task Rir_NoFabricatedEvidence_DomainsMatchTheRecord()
    {
        var (db, decision) = await Evaluate(MissingScenario());
        var record = await ReopenAndProject(db, decision.Id);

        Assert.Equal(10, record.Domains.Count); // full canonical domain model, nothing invented
        Assert.All(record.Domains, d => Assert.Contains(d.State, Taxonomy));
        // Unrecorded evidence stays unrecorded — no invented identifiers or sources.
        Assert.Null(record.Domains.Single(d => d.Domain == "operator").SourceIdentifier);
        Assert.Null(record.Domains.Single(d => d.Domain == "reagent").SourceIdentifier);
        Assert.Null(record.Domains.Single(d => d.Domain == "provenance").SourceIdentifier);
        Assert.Equal("4 / 7 required domains available", record.EvidenceQuality.Coverage.Statement);
        // Coverage arithmetic is exactly the count of available required domains.
        var availableRequired = record.Domains.Count(d => d.RequiredByPolicy && d.Available);
        Assert.Equal(availableRequired, record.EvidenceQuality.Coverage.RequiredAvailable);
    }

    // ── Evidence taxonomy ───────────────────────────────────────────────────────

    [Fact]
    public async Task Taxonomy_RealRules_ProduceTheDocumentedStates()
    {
        var cases = new (DiagnosticContext Context, string Domain, string State)[]
        {
            (TrustScenario(), "device", "valid"),
            (new DiagnosticContext("Hb 9.1", "DEV-02", true, Now.AddDays(3), "OP-12", true,
                "LOT-44", Now.AddDays(10), 24.0, Now, "site-B/DEV-02/OP-12", TestType: "Hb"), "calibration", "aging"),
            (VerifyScenario(), "quality-control", "failed"),
            (VerifyScenario(), "calibration", "expired"),
            (MissingScenario(), "operator", "missing"),
            (new DiagnosticContext("Hb 9.1", "DEV-02", true, Now.AddDays(30), "OP-12", true,
                "", Now.AddDays(30), 24.0, Now, "site-B/DEV-02/OP-12", TestType: "Hb"), "provenance", "unverified-source"),
        };
        foreach (var (context, domain, expected) in cases)
        {
            var (db, _) = await Evaluate(context);
            var record = await ReopenAndProject(db, (await db.Assessments.AsNoTracking().SingleAsync()).Id);
            Assert.Equal(expected, record.Domains.Single(d => d.Domain == domain).State);
        }
        // STALE is part of the vocabulary but honestly reserved — no current engine rule produces it.
        Assert.Equal("stale", ResultIntegrityProjector.States.Stale);
    }

    // ── Decision causality ──────────────────────────────────────────────────────

    [Fact]
    public async Task Causality_PrimaryAndSecondaryComeFromRealRules_NeverPercentages()
    {
        var (db, decision) = await Evaluate(VerifyScenario());
        var record = await ReopenAndProject(db, decision.Id);
        var causality = record.Causality!;

        Assert.True(causality.Verified);
        // Primary = exactly the findings whose severity equals the final status.
        var verifyRuleIds = causality.PrimaryDrivers.Select(d => d.RuleId).ToHashSet();
        Assert.Contains("QC_FAILED", verifyRuleIds);
        Assert.Contains("CAL_EXPIRED", verifyRuleIds);
        Assert.Contains("REAGENT_EXPIRED", verifyRuleIds);
        // Secondary = real review-level rules from the same evaluation.
        Assert.Contains(causality.SecondaryConsiderations, d => d.RuleId == "ENV_TEMP");

        // No invented numeric contribution: no driver field is numeric, and the serialised
        // record carries no weight/percent/contribution/confidence keys at all.
        var numeric = typeof(POCTrust.Core.Integrity.DecisionDriver).GetProperties()
            .Where(p => p.PropertyType is { } t && (t == typeof(int) || t == typeof(double) || t == typeof(decimal)))
            .ToList();
        Assert.Empty(numeric);
        var json = JsonSerializer.Serialize(record, WebJson).ToLowerInvariant();
        Assert.DoesNotContain("\"weight", json);
        Assert.DoesNotContain("\"contribution", json);
        Assert.DoesNotContain("\"percent", json);
        Assert.DoesNotContain("\"confidence", json);
    }

    // ── Policy context ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Policy_IsDisplayedSelected_ButCanNeverSoftenAHardVerify()
    {
        // Same failing evidence, two different sites → two different policies, same VERIFY.
        var rural = VerifyScenario() with { Provenance = "North Coast PHC (Demo)/DEV-03/OP-03" };
        var general = VerifyScenario();

        var (dbRural, decisionRural) = await Evaluate(rural);
        var (dbGeneral, decisionGeneral) = await Evaluate(general);
        var ruralRecord = await ReopenAndProject(dbRural, decisionRural.Id);
        var generalRecord = await ReopenAndProject(dbGeneral, decisionGeneral.Id);

        Assert.Equal("Rural PHC POC Test", ruralRecord.Policy.Name);
        Assert.Equal("General POC Demonstration", generalRecord.Policy.Name);
        Assert.NotEqual(ruralRecord.Policy.Id, generalRecord.Policy.Id);
        // The safety hierarchy is untouched: hard VERIFY remains VERIFY under either policy.
        Assert.Equal("Verify", ruralRecord.Disposition);
        Assert.Equal("Verify", generalRecord.Disposition);
        Assert.Equal(ReliabilityStatus.Verify, decisionRural.FinalStatus);
        Assert.Equal(ReliabilityStatus.Verify, decisionGeneral.FinalStatus);
        // The policy is a configured demonstration policy, disclosed as such.
        Assert.Equal("demonstration", ruralRecord.Policy.Kind);
        Assert.Contains("not a clinically validated", ruralRecord.Policy.Note);
    }

    // ── Historical consistency ──────────────────────────────────────────────────

    [Fact]
    public async Task Historical_ReopeningReproducesTheSameRir_Exactly()
    {
        var (db, decision) = await Evaluate(ReviewScenario());
        var first = await ReopenAndProject(db, decision.Id);
        var second = await ReopenAndProject(db, decision.Id); // a "reopen": fresh load, fresh projection

        var opts = new JsonSerializerOptions(WebJson);
        Assert.Equal(JsonSerializer.Serialize(first, opts), JsonSerializer.Serialize(second, opts));

        // Evidence states and provenance wording stay consistent across reopens.
        Assert.Equal(
            first.Domains.Select(d => (d.Domain, d.State, d.Verification, d.SourceIdentifier)),
            second.Domains.Select(d => (d.Domain, d.State, d.Verification, d.SourceIdentifier)));
    }

    // ── AI positioning ──────────────────────────────────────────────────────────

    private sealed class ThrowingAiProvider : IAIProvider
    {
        public Task<AIAssessment> AssessAsync(DiagnosticContext context, CancellationToken ct = default) =>
            throw new HttpRequestException("simulated advisory outage");
    }

    private sealed class RogueAiProvider : IAIProvider
    {
        public Task<AIAssessment> AssessAsync(DiagnosticContext context, CancellationToken ct = default) =>
            Task.FromResult(new AIAssessment(
                "This result looks perfectly reliable and needs no review or verification at all.",
                [], "Release the result without review", 0.99, "rogue-advisory"));
    }

    [Fact]
    public async Task Ai_RirIsDerivedEvenWhenTheAdvisoryServiceFails()
    {
        // REVIEW would normally consult the advisory — with the provider down, the deterministic
        // result continues and the RIR is still derived from the stored record.
        var (db, decision) = await Evaluate(ReviewScenario(), new ThrowingAiProvider());
        Assert.False(decision.AiConsulted);

        var record = await ReopenAndProject(db, decision.Id);
        Assert.Equal("Review", record.Disposition);
        Assert.Equal(7, record.EvidenceQuality.Coverage.RequiredAvailable);
        Assert.Equal(10, record.Domains.Count);
        Assert.False(record.AiContext.Consulted);
        Assert.Equal("advisory", record.AiContext.Role);
    }

    [Fact]
    public async Task Ai_ReviewMayShowAdvisoryContext_VerifyNeverConsults()
    {
        var (dbReview, reviewDecision) = await Evaluate(ReviewScenario());
        var reviewRecord = await ReopenAndProject(dbReview, reviewDecision.Id);
        Assert.True(reviewDecision.AiConsulted);
        Assert.True(reviewRecord.AiContext.Consulted);

        // Hard VERIFY: the engine never asks for advisory context, so none can be displayed.
        var (dbVerify, verifyDecision) = await Evaluate(VerifyScenario());
        var verifyRecord = await ReopenAndProject(dbVerify, verifyDecision.Id);
        Assert.False(verifyDecision.AiConsulted);
        Assert.False(verifyRecord.AiContext.Consulted);
        Assert.Null(verifyRecord.AiContext.Summary);
    }

    [Fact]
    public async Task Ai_HasNoAuthorityOverTheDisposition()
    {
        // A rogue advisory claims "release without review" — the deterministic status must not move.
        var (dbReview, reviewDecision) = await Evaluate(ReviewScenario(), new RogueAiProvider());
        Assert.Equal(ReliabilityStatus.Review, reviewDecision.FinalStatus);
        var reviewRecord = await ReopenAndProject(dbReview, reviewDecision.Id);
        Assert.Equal("Review", reviewRecord.Disposition);

        var (_, verifyDecision) = await Evaluate(VerifyScenario(), new RogueAiProvider());
        Assert.Equal(ReliabilityStatus.Verify, verifyDecision.FinalStatus);

        // And the engine's hard invariant holds directly: VERIFY can never be downgraded.
        var rogueAssessment = await new RogueAiProvider().AssessAsync(TrustScenario(), CancellationToken.None);
        Assert.Equal(ReliabilityStatus.Verify, Engine.EnforceFinalStatus(ReliabilityStatus.Verify, rogueAssessment));
    }

    // ── Dashboard integrity overview (spec section 26) ──────────────────────────

    [Fact]
    public async Task Dashboard_IntegrityOverview_IsCalculatedFromRealRecords()
    {
        var db = InMemory();
        var orchestrator = new AssessmentOrchestrator(Engine, new StubAiProvider(), new EfAuditStore(db));
        await orchestrator.EvaluateAsync(TrustScenario(), null, CancellationToken.None);
        await orchestrator.EvaluateAsync(MissingScenario(), null, CancellationToken.None);
        var controller = new PlatformController(db, Engine);

        var result = await controller.Summary();
        var json = AsJson(Assert.IsType<OkObjectResult>(result).Value);
        var integrity = json.GetProperty("integrity");

        Assert.Equal(2, integrity.GetProperty("assessments").GetInt32());
        // (7/7 + 4/7) / 2 = 78.57% → 79, computed from the stored records only.
        Assert.Equal(79, integrity.GetProperty("coveragePercent").GetInt32());
        Assert.Equal("79% complete", integrity.GetProperty("coverageStatement").GetString());
        // Only the missing-evidence record carries concerns; no conflicts, no aging in this pair.
        Assert.Equal(1, integrity.GetProperty("assessmentsWithConcerns").GetInt32());
        Assert.Equal(0, integrity.GetProperty("conflicts").GetInt32());
        Assert.Equal(0, integrity.GetProperty("assessmentsWithAging").GetInt32());
        Assert.Contains("never preset", integrity.GetProperty("note").GetString());
    }

    [Fact]
    public async Task Dashboard_IntegrityOverview_EmptyStore_IsHonestZero()
    {
        var controller = new PlatformController(InMemory(), Engine);
        var json = AsJson(Assert.IsType<OkObjectResult>(await controller.Summary()).Value);
        var integrity = json.GetProperty("integrity");
        Assert.Equal(0, integrity.GetProperty("assessments").GetInt32());
        Assert.Equal("No assessments recorded yet", integrity.GetProperty("coverageStatement").GetString());
    }

    // ── History rows (spec section 27) ──────────────────────────────────────────

    [Fact]
    public async Task History_RowsCarryCompactIntegrity_ConsistentWithTheFullRecord()
    {
        var db = InMemory();
        var orchestrator = new AssessmentOrchestrator(Engine, new StubAiProvider(), new EfAuditStore(db));
        var trust = await orchestrator.EvaluateAsync(TrustScenario(), null, CancellationToken.None);
        var review = await orchestrator.EvaluateAsync(ReviewScenario(), null, CancellationToken.None);
        var controller = new PlatformController(db, Engine);

        var rows = AsJson(Assert.IsType<OkObjectResult>(await controller.History()).Value)
            .EnumerateArray().ToDictionary(r => r.GetProperty("id").GetString()!);

        var reviewRow = rows[review.Id.ToString()];
        var reviewIntegrity = reviewRow.GetProperty("integrity");
        Assert.Equal(7, reviewIntegrity.GetProperty("coverageAvailable").GetInt32());
        Assert.Equal(7, reviewIntegrity.GetProperty("coverageRequired").GetInt32());
        Assert.Equal(4, reviewIntegrity.GetProperty("concerns").GetInt32()); // 2 aging + 1 expired + 1 failed
        Assert.Equal(1, reviewIntegrity.GetProperty("conflictCount").GetInt32());
        Assert.Equal("General POC Demonstration", reviewIntegrity.GetProperty("policy").GetString());
        Assert.Equal("Calibration", reviewIntegrity.GetProperty("primaryDriverLabel").GetString());
        Assert.Equal("aging", reviewIntegrity.GetProperty("primaryDriverState").GetString());
        Assert.True(reviewIntegrity.GetProperty("auditAvailable").GetBoolean());
        Assert.True(reviewRow.GetProperty("aiConsulted").GetBoolean());

        var trustIntegrity = rows[trust.Id.ToString()].GetProperty("integrity");
        Assert.Equal(0, trustIntegrity.GetProperty("concerns").GetInt32());
        // No primary drivers on a TRUST record: the row falls back to the recorded driver sentence.
        Assert.Equal("All deterministic checks passed.", trustIntegrity.GetProperty("primaryDriverStatement").GetString());
        Assert.True(trustIntegrity.GetProperty("auditAvailable").GetBoolean());
    }

    // ── Demonstration sequence (spec section 30) ────────────────────────────────

    [Fact]
    public async Task Demonstration_Sequence_ShowsDeterministicTrustReviewVerify_WithDerivedChanges()
    {
        var db = InMemory();
        var orchestrator = new AssessmentOrchestrator(Engine, new StubAiProvider(), new EfAuditStore(db));
        var seedNow = DateTimeOffset.UtcNow;

        DiagnosticContext Step(DateTimeOffset eventTime, string key) => new(
            "Hb 12.0 g/dL", "POC-DXB-02", true, seedNow.AddDays(-1), "Operator B", true,
            "LOT-2016", seedNow.AddDays(90), 23.0, eventTime,
            "District PHC Node 04 (Synthetic)/POC-DXB-02/Operator B", TestType: "Hb", DemoKey: key);

        await orchestrator.EvaluateAsync(Step(seedNow.AddDays(-30).AddMinutes(-10), "demo-history-1"), null, CancellationToken.None, seedNow.AddDays(-30));
        await orchestrator.EvaluateAsync(Step(seedNow.AddDays(-5).AddMinutes(-10), "demo-history-2"), null, CancellationToken.None, seedNow.AddDays(-5));
        await orchestrator.EvaluateAsync(Step(seedNow.AddMinutes(-15), "demo-history-3"), null, CancellationToken.None, seedNow.AddMinutes(-5));

        var controller = new PlatformController(db, Engine);
        var json = AsJson(Assert.IsType<OkObjectResult>(await controller.Demonstration()).Value);

        Assert.True(json.GetProperty("available").GetBoolean());
        Assert.False(json.GetProperty("aiInvolved").GetBoolean()); // deterministic demonstration, no AI
        var steps = json.GetProperty("steps");
        Assert.Equal(3, steps.GetArrayLength());

        Assert.Equal("TRUST", steps[0].GetProperty("disposition").GetString());
        Assert.Null(steps[0].GetProperty("change").GetString());
        Assert.Equal("REVIEW", steps[1].GetProperty("disposition").GetString());
        Assert.Contains("New finding:", steps[1].GetProperty("change").GetString());
        Assert.Contains("Calibration due within 7 days", steps[1].GetProperty("change").GetString());
        Assert.Equal("VERIFY", steps[2].GetProperty("disposition").GetString());
        Assert.Contains("Calibration overdue", steps[2].GetProperty("change").GetString());
        // Every step discloses its policy, and the note labels the data as demonstration-only.
        Assert.All(steps.EnumerateArray().ToList(), s => Assert.Equal("General POC Demonstration", s.GetProperty("policy").GetString()));
        Assert.Contains("demonstration", json.GetProperty("note").GetString());
        Assert.Contains("deterministic engine only", json.GetProperty("source").GetString());
    }

    [Fact]
    public async Task Demonstration_EmptyStore_ReportsUnavailableWithoutInventingSteps()
    {
        var controller = new PlatformController(InMemory(), Engine);
        var json = AsJson(Assert.IsType<OkObjectResult>(await controller.Demonstration()).Value);
        Assert.False(json.GetProperty("available").GetBoolean());
        Assert.Equal(0, json.GetProperty("steps").GetArrayLength());
    }
}
