using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using POCTrust.Api.Services;
using POCTrust.Core.Entities;
using POCTrust.Core.Enums;
using POCTrust.Core.Integrity;
using POCTrust.Core.Reliability;
using POCTrust.Infrastructure.AI;
using POCTrust.Infrastructure.Data;
using POCTrust.Infrastructure.Services;

namespace POCTrust.Tests;

/// <summary>
/// Integrity upgrade tests (spec chunk 3, sections 10–16): evidence conflicts, decision
/// causality derived from the engine's recorded findings, the single guarded rule-based
/// counterfactual, policy selection, the integrity timeline (including the demonstration
/// decision history), and provenance wording that never implies authentication.
/// </summary>
public sealed class IntegrityCausalityTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 24, 14, 3, 0, TimeSpan.Zero);

    private static PocTrustDbContext InMemory() => new(new DbContextOptionsBuilder<PocTrustDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);

    private static string[] Parse(string json) =>
        string.IsNullOrWhiteSpace(json) ? [] : (JsonSerializer.Deserialize<string[]>(json, WebJson) ?? []);

    private static async Task<(PocTrustDbContext Db, ReliabilityDecision Decision, ResultIntegrityRecord Record)>
        EvaluateAndProject(DiagnosticContext context, DateTimeOffset? decidedAtUtc = null, bool withHistory = false)
    {
        var db = InMemory();
        var orchestrator = new AssessmentOrchestrator(new ReliabilityEngine(), new StubAiProvider(), new EfAuditStore(db));
        var decision = await orchestrator.EvaluateAsync(context, null, CancellationToken.None, decidedAtUtc);
        var record = await ProjectFrom(db, decision.Id, withHistory);
        return (db, decision, record);
    }

    /// <summary>Mirrors the API endpoint: load the stored row, its audit reference, optionally the
    /// demonstration history siblings, then project with the real engine.</summary>
    private static async Task<ResultIntegrityRecord> ProjectFrom(PocTrustDbContext db, Guid id, bool withHistory)
    {
        var stored = await db.Assessments.AsNoTracking().SingleAsync(a => a.Id == id);
        var audits = await db.Audit.AsNoTracking().Where(x => x.AssessmentId == id).ToListAsync();
        var auditRef = new IntegrityAuditReference(
            audits.Count, audits.Count(x => !string.IsNullOrEmpty(x.Hash)),
            "sha256-chain", "Sealed audit record available", "");
        List<IntegrityHistoryPoint>? history = null;
        if (withHistory)
        {
            history = (await db.Assessments.AsNoTracking().OrderBy(a => a.DecidedAtUtc).ToListAsync())
                .Select(r => new IntegrityHistoryPoint(
                    r.Id, r.DecidedAtUtc, r.FinalStatus, Parse(r.RuleIdsJson), Parse(r.ReasonsJson)))
                .ToList();
        }
        var input = JsonSerializer.Deserialize<DiagnosticContext>(stored.InputJson, WebJson)
            ?? throw new InvalidOperationException("stored input did not round-trip");
        var snapshot = new IntegrityDecisionSnapshot(
            stored.Id, input, stored.FinalStatus, Parse(stored.RuleIdsJson), Parse(stored.ReasonsJson),
            stored.Action, stored.AiConsulted, stored.AiSummary, stored.DecidedAtUtc, auditRef, history);
        return ResultIntegrityProjector.Project(snapshot, new ReliabilityEngine());
    }

    private static IntegrityDomainEvidence Domain(ResultIntegrityRecord r, string key) =>
        r.Domains.Single(d => d.Domain == key);

    // ── Policy selection (sections 15–16) ───────────────────────────────────────

    [Fact]
    public async Task Policy_RuralSiteMarker_SelectsRuralPolicy_WithSixRequiredDomains()
    {
        var context = new DiagnosticContext(
            "Malaria RDT negative", "POC-DXM-03", true, Now.AddDays(45), "Operator C", true,
            "LOT-2077", Now.AddDays(60), 25.0, Now, "North Coast PHC (Demo)/POC-DXM-03/Operator C",
            TestType: "Malaria-RDT", HumidityPct: 55);

        var (_, _, record) = await EvaluateAndProject(context);

        Assert.Equal("rural-phc-demo", record.Policy.Id);
        Assert.Equal("Rural PHC POC Test", record.Policy.Name);
        Assert.Equal(6, record.Policy.RequiredDomains.Count);
        Assert.Contains("environment", record.Policy.ContextualDomains!);
        Assert.DoesNotContain("environment", record.Policy.RequiredDomains);
        Assert.False(Domain(record, "environment").RequiredByPolicy);
        Assert.Equal("6 / 6 required domains available", record.EvidenceQuality.Coverage.Statement);
        Assert.Contains("rural PHC site", record.Policy.SelectionNote);
        // The engine still evaluates contextual evidence: policy shapes expectations, rules decide.
        Assert.False(Domain(record, "environment").ContributedToDecision);
    }

    [Fact]
    public async Task Policy_OrdinarySite_SelectsGeneralDemonstrationPolicy()
    {
        var context = new DiagnosticContext(
            "Hb 14.2 g/dL", "DEV-01", true, Now.AddMonths(2), "OP-07", true,
            "LOT-GOOD", Now.AddMonths(3), 22.5, Now, "site-A/DEV-01/OP-07", TestType: "Hb");

        var (_, _, record) = await EvaluateAndProject(context);

        Assert.Equal("general-poc-demo", record.Policy.Id);
        Assert.Equal("General POC Demonstration", record.Policy.Name);
        Assert.Equal(7, record.Policy.RequiredDomains.Count);
        Assert.True(Domain(record, "environment").RequiredByPolicy);
        Assert.Equal("7 / 7 required domains available", record.EvidenceQuality.Coverage.Statement);
        Assert.Equal("demo-v1", record.Policy.Version);
        Assert.Equal("demonstration", record.Policy.Kind);
        Assert.Contains("not a clinically validated", record.Policy.Note);
    }

    // ── Decision causality (section 12) ─────────────────────────────────────────

    [Fact]
    public async Task Causality_RolesClassifiedFromEngineFindings_VerifiedAgainstStoredDecision()
    {
        var context = new DiagnosticContext(
            "CRP 68 mg/L", "DEV-03", false, Now.AddDays(-9), "OP-03", true,
            "LOT-91", Now.AddDays(-1), 31.5, Now, "site-C/DEV-03/OP-03", TestType: "CRP", HumidityPct: 90);

        var (_, _, record) = await EvaluateAndProject(context);

        var causality = record.Causality!;
        Assert.True(causality.Verified);
        Assert.Equal("Verify", record.Disposition);
        // VERIFY-level findings are the primary drivers; review-level findings are secondary.
        Assert.All(causality.PrimaryDrivers, d => Assert.Equal("primary", d.Role));
        Assert.Contains(causality.PrimaryDrivers, d => d.RuleId == "QC_FAILED");
        Assert.Contains(causality.PrimaryDrivers, d => d.RuleId == "CAL_EXPIRED");
        Assert.Contains(causality.PrimaryDrivers, d => d.RuleId == "REAGENT_EXPIRED");
        Assert.Contains(causality.SecondaryConsiderations, d => d.RuleId == "ENV_TEMP");
        // A failed hard control can never be softened into a counterfactual suggestion.
        Assert.Null(causality.Counterfactual);
        // Valid, non-contributing evidence is stated as informational context.
        Assert.Contains(causality.ContextualNotes, d => d.Statement == "Device identity evidence is valid.");
        Assert.Contains(causality.ContextualNotes, d => d.Statement == "Provenance evidence is valid.");
        // Evidence state rides along with each driver.
        var calDriver = causality.PrimaryDrivers.Single(d => d.RuleId == "CAL_EXPIRED");
        Assert.Equal("Calibration", calDriver.DomainLabel);
        Assert.Equal("expired", calDriver.EvidenceState);
    }

    [Fact]
    public async Task Causality_WithoutEngine_FallsBackConservatively()
    {
        var context = new DiagnosticContext(
            "Hb 9.1 g/dL", "DEV-02", true, Now.AddDays(3), "OP-12", false,
            "LOT-44", Now.AddDays(10), 24.0, Now, "site-B/DEV-02/OP-12", TestType: "Hb");
        var db = InMemory();
        var orchestrator = new AssessmentOrchestrator(new ReliabilityEngine(), new StubAiProvider(), new EfAuditStore(db));
        var decision = await orchestrator.EvaluateAsync(context, null, CancellationToken.None);
        var stored = await db.Assessments.AsNoTracking().SingleAsync(a => a.Id == decision.Id);
        var snapshot = new IntegrityDecisionSnapshot(
            stored.Id, context, stored.FinalStatus, Parse(stored.RuleIdsJson), Parse(stored.ReasonsJson),
            stored.Action, stored.AiConsulted, stored.AiSummary, stored.DecidedAtUtc,
            new IntegrityAuditReference(1, 1, "sha256-chain", "Sealed audit record available", ""));

        var record = ResultIntegrityProjector.Project(snapshot); // no engine supplied

        Assert.NotNull(record.Causality);
        Assert.False(record.Causality!.Verified);
        Assert.Empty(record.Causality.PrimaryDrivers);
        Assert.Contains("not available", record.Causality.DerivationNote);
    }

    // ── Rule-based counterfactual (section 14) ──────────────────────────────────

    [Fact]
    public async Task Counterfactual_CalibrationExpiredWithOperatorConcern_ResultsInReview()
    {
        var context = new DiagnosticContext(
            "Hb 9.4 g/dL", "DEV-21", true, Now.AddDays(-9), "OP-11", false,
            "LOT-31", Now.AddDays(60), 22.0, Now, "site-X/DEV-21/OP-11", TestType: "Hb");

        var (_, decision, record) = await EvaluateAndProject(context);

        Assert.Equal(ReliabilityStatus.Verify, decision.FinalStatus);
        var cf = record.Causality!.Counterfactual;
        Assert.NotNull(cf);
        Assert.Equal("Deterministic decision comparison", cf!.Label);
        Assert.Equal("Rule-based counterfactual", cf.Method);
        Assert.Equal("VERIFY", cf.CurrentDisposition);
        Assert.Equal("REVIEW", cf.CounterfactualDisposition);
        Assert.Contains("If calibration evidence were current", cf.Statement);
        Assert.Contains("operator competency", cf.Statement);
        Assert.Contains("REVIEW", cf.Statement);
        Assert.Contains("no probability", cf.BasisNote);
    }

    [Fact]
    public async Task Counterfactual_Absent_WhenTwoPrimaryDriversExist()
    {
        var context = new DiagnosticContext(
            "CRP 5.2 mg/L", "DEV-23", true, Now.AddDays(-9), "OP-13", true,
            "LOT-91", Now.AddDays(-1), 22.0, Now, "site-Z/DEV-23/OP-13", TestType: "CRP");

        var (_, decision, record) = await EvaluateAndProject(context);

        Assert.Equal(ReliabilityStatus.Verify, decision.FinalStatus);
        Assert.Equal(2, record.Causality!.PrimaryDrivers.Count); // CAL_EXPIRED + REAGENT_EXPIRED
        Assert.Null(record.Causality.Counterfactual);
    }

    [Fact]
    public async Task Counterfactual_Absent_WhenSingleConcernWouldNotChangeTheOutcome()
    {
        // QC failed alone: no "make current" mutation exists for a failed hard control, and no
        // single evidence change would flip the disposition.
        var context = new DiagnosticContext(
            "Hb 8.0 g/dL", "DEV-24", false, Now.AddDays(30), "OP-14", true,
            "LOT-33", Now.AddDays(60), 22.0, Now, "site-W/DEV-24/OP-14", TestType: "Hb");

        var (_, decision, record) = await EvaluateAndProject(context);

        Assert.Equal(ReliabilityStatus.Verify, decision.FinalStatus);
        Assert.Null(record.Causality!.Counterfactual);
    }

    // ── Evidence conflict (section 10) ──────────────────────────────────────────

    [Fact]
    public async Task Conflict_EnvironmentOutOfRangeWhileQcPassed_IsDetectedAsInconsistency()
    {
        var context = new DiagnosticContext(
            "Hb 13.0 g/dL", "DEV-22", true, Now.AddDays(30), "OP-12", true,
            "LOT-32", Now.AddDays(60), 35.0, Now, "site-Y/DEV-22/OP-12", TestType: "Hb");

        var (_, _, record) = await EvaluateAndProject(context);

        Assert.Equal("Review", record.Disposition);
        var conflict = Assert.Single(record.Conflicts!);
        Assert.Equal("Device quality-control record", conflict.SourceA);
        Assert.Equal("VALID", conflict.SourceAState);
        Assert.Equal("Site environment snapshot", conflict.SourceB);
        Assert.Equal("FAILED", conflict.SourceBState);
        Assert.Contains("evidence inconsistency", conflict.WhyItMatters);
        Assert.DoesNotContain("clinical truth", conflict.WhyItMatters, StringComparison.OrdinalIgnoreCase);
        Assert.Equal("ENV_TEMP", conflict.RelatedRuleIds);
        Assert.Equal(1, record.EvidenceQuality.ConflictCount);
        Assert.Equal("1 conflict", record.EvidenceQuality.Consistency);
    }

    [Fact]
    public async Task Conflict_ConsistentlyBadEvidence_ProducesNoConflict()
    {
        // QC failed AND environment out of range: nothing disagrees, the sources are consistent.
        var context = new DiagnosticContext(
            "Hb 8.4 g/dL", "DEV-25", false, Now.AddDays(30), "OP-15", true,
            "LOT-35", Now.AddDays(60), 35.0, Now, "site-V/DEV-25/OP-15", TestType: "Hb");

        var (_, _, record) = await EvaluateAndProject(context);

        Assert.Equal("Verify", record.Disposition);
        Assert.Empty(record.Conflicts!);
        Assert.Equal("No conflicts", record.EvidenceQuality.Consistency);
    }

    // ── Integrity timeline (section 13) ─────────────────────────────────────────

    [Fact]
    public async Task Timeline_SingleRecord_IsALabelledDecisionTimeView()
    {
        var context = new DiagnosticContext(
            "Hb 14.2 g/dL", "DEV-01", true, Now.AddMonths(2), "OP-07", true,
            "LOT-GOOD", Now.AddMonths(3), 22.5, Now, "site-A/DEV-01/OP-07", TestType: "Hb");

        var (_, _, record) = await EvaluateAndProject(context);

        var timeline = record.Timeline!;
        Assert.Equal("Decision-time integrity view", timeline.Label);
        Assert.Contains("single evaluation per event", timeline.Note);
        Assert.Contains(timeline.Entries, e => e.Kind == "event" && e.Basis == "recorded");
        var decisions = timeline.Entries.Where(e => e.Kind == "decision").ToList();
        Assert.Single(decisions);
        Assert.Equal("TRUST", decisions[0].Disposition);
        Assert.DoesNotContain(timeline.Entries, e => e.Kind == "transition");
    }

    [Fact]
    public async Task Timeline_DemoHistorySequence_ShowsGenuinelyRecordedEvolution()
    {
        var db = InMemory();
        var orchestrator = new AssessmentOrchestrator(new ReliabilityEngine(), new StubAiProvider(), new EfAuditStore(db));
        var seedNow = DateTimeOffset.UtcNow; // decisions must not be post-dated

        DiagnosticContext HistoryStep(DateTimeOffset eventTime, string key) => new(
            "Hb 12.0 g/dL", "POC-DXB-02", true, seedNow.AddDays(-1), "Operator B", true,
            "LOT-2016", seedNow.AddDays(90), 23.0, eventTime,
            "District PHC Node 04 (Synthetic)/POC-DXB-02/Operator B", TestType: "Hb", DemoKey: key);

        var steps = new[]
        {
            (Event: seedNow.AddDays(-30).AddMinutes(-10), Decided: seedNow.AddDays(-30), Key: "demo-history-1"),
            (Event: seedNow.AddDays(-5).AddHours(-1).AddMinutes(-10), Decided: seedNow.AddDays(-5).AddHours(-1), Key: "demo-history-2"),
            (Event: seedNow.AddMinutes(-15), Decided: seedNow.AddMinutes(-5), Key: "demo-history-3"),
        };
        foreach (var step in steps)
            await orchestrator.EvaluateAsync(HistoryStep(step.Event, step.Key), null, CancellationToken.None, step.Decided);

        // The oldest→newest audit chain must hold: each entry sealed against the timestamp-ordered head.
        Assert.True(AuditChain.Verify(await db.Audit.AsNoTracking().ToListAsync()).Valid);

        var stored = await db.Assessments.AsNoTracking().OrderBy(a => a.DecidedAtUtc).ToListAsync();
        Assert.Equal(3, stored.Count);
        Assert.Equal(ReliabilityStatus.Trust, stored[0].FinalStatus);
        Assert.Equal(ReliabilityStatus.Review, stored[1].FinalStatus);
        Assert.Equal(ReliabilityStatus.Verify, stored[2].FinalStatus);

        // Project the LAST record the way the endpoint does (with the history siblings attached).
        var lastId = stored[2].Id;
        var audits = await db.Audit.AsNoTracking().Where(x => x.AssessmentId == lastId).ToListAsync();
        var auditRef = new IntegrityAuditReference(audits.Count, audits.Count, "sha256-chain", "Sealed audit record available", "");
        var history = stored.Select(r => new IntegrityHistoryPoint(
            r.Id, r.DecidedAtUtc, r.FinalStatus, Parse(r.RuleIdsJson), Parse(r.ReasonsJson))).ToList();
        var input = JsonSerializer.Deserialize<DiagnosticContext>(stored[2].InputJson, WebJson)!;
        var snapshot = new IntegrityDecisionSnapshot(
            lastId, input, stored[2].FinalStatus, Parse(stored[2].RuleIdsJson), Parse(stored[2].ReasonsJson),
            stored[2].Action, stored[2].AiConsulted, stored[2].AiSummary, stored[2].DecidedAtUtc, auditRef, history);

        var record = ResultIntegrityProjector.Project(snapshot, new ReliabilityEngine());

        var timeline = record.Timeline!;
        Assert.Equal("Demonstration decision history", timeline.Label);
        Assert.Contains("REAL assessment pipeline", timeline.Note);
        Assert.Contains("not claimed production history", timeline.Note);

        var dispositions = timeline.Entries.Where(e => e.Kind == "decision").Select(e => e.Disposition).ToList();
        Assert.Equal(new[] { "TRUST", "REVIEW", "VERIFY" }, dispositions);
        Assert.All(timeline.Entries.Where(e => e.Kind == "decision"), e => Assert.Equal("demo-history", e.Basis));

        var transitions = timeline.Entries.Where(e => e.Kind == "transition").Select(e => e.Transition).ToList();
        Assert.Equal(new[] { "TRUST → REVIEW", "REVIEW → VERIFY" }, transitions);
        // The transition explanation is derived from the newly appeared stored rule, not invented.
        var reviewTransition = timeline.Entries.First(e => e.Transition == "TRUST → REVIEW");
        Assert.Contains("New finding:", reviewTransition.Detail);
        Assert.Contains("Calibration due within 7 days", reviewTransition.Detail);

        // The derived evidence boundary for the expired calibration is part of the story.
        Assert.Contains(timeline.Entries, e =>
            e.Kind == "evidence" && e.EvidenceState == "expired" && e.Basis == "derived"
            && e.Title == "Calibration validity boundary passed");

        // Entry ordering is chronological.
        Assert.Equal(timeline.Entries.OrderBy(e => e.TimeUtc).ToList(), timeline.Entries.ToList());
    }

    // ── Provenance wording (section 11) ─────────────────────────────────────────

    [Fact]
    public async Task Provenance_OperatorAsClaimed_NeverImpliesAuthentication_NoHashLikeIdentifiers()
    {
        // Provenance chain incomplete (reagent lot missing) while operator + location ARE recorded:
        // the operator claim stays an unverified claim, and provenance becomes an unverified source.
        var context = new DiagnosticContext(
            "Hb 9.1 g/dL", "DEV-02", true, Now.AddDays(3), "OP-12", false,
            "", Now.AddDays(10), 24.0, Now, "site-B/DEV-02/OP-12", TestType: "Hb");

        var (_, _, record) = await EvaluateAndProject(context);

        Assert.Contains("as claimed", Domain(record, "operator").Verification);
        Assert.Equal("OP-12", Domain(record, "operator").SourceIdentifier);
        Assert.Null(Domain(record, "reagent").SourceIdentifier);
        Assert.Contains("not part of this prototype", Domain(record, "device").Verification);
        Assert.Contains("unverified source", Domain(record, "provenance").Verification);
        Assert.Equal("unverified-source", Domain(record, "provenance").State);

        // No fabricated cryptographic provenance: no 64-hex-char token anywhere in the record.
        var json = JsonSerializer.Serialize(record, WebJson);
        Assert.False(
            System.Text.RegularExpressions.Regex.IsMatch(json, @"\b[0-9a-fA-F]{64}\b"),
            "the record must not contain hash-like identifiers");
    }

    [Fact]
    public async Task DomainRows_CarryRelatedRuleIds_FromTheStoredDecision()
    {
        var context = new DiagnosticContext(
            "Hb 9.1 g/dL", "DEV-02", true, Now.AddDays(3), "OP-12", false,
            "LOT-44", Now.AddDays(10), 24.0, Now, "site-B/DEV-02/OP-12", TestType: "Hb", PowerInterruption: true);

        var (_, _, record) = await EvaluateAndProject(context);

        Assert.Equal(["CAL_NEAR_DUE"], Domain(record, "calibration").RelatedRuleIds);
        Assert.Equal(["OPERATOR_NOT_COMPETENT"], Domain(record, "operator").RelatedRuleIds);
        Assert.Equal(["POWER_INTERRUPTION"], Domain(record, "power").RelatedRuleIds);
        Assert.Empty(Domain(record, "connectivity").RelatedRuleIds!);
    }

    // ── Seeding the history into a populated store (audit-chain monotonicity) ────

    [Fact]
    public async Task DemoSeed_IntoStoreWithExistingRecords_KeepsAuditChainValidAndStatusesExact()
    {
        var db = InMemory();
        var orchestrator = new AssessmentOrchestrator(new ReliabilityEngine(), new StubAiProvider(), new EfAuditStore(db));

        // A pre-existing record from "earlier", the mixed-store case a real demo can hit when
        // demonstration data is loaded after the store already holds assessments.
        var existing = new DiagnosticContext(
            "Hb 14.2 g/dL", "DEV-01", true, Now.AddDays(30), "OP-07", true,
            "LOT-GOOD", Now.AddDays(60), 22.5, Now, "site-A/DEV-01/OP-07", TestType: "Hb");
        await orchestrator.EvaluateAsync(existing, null, CancellationToken.None, Now);

        var seeder = new DemoSeeder(orchestrator, db);
        var report = await seeder.SeedAsync();

        // The rigid translation keeps every engine-computed status exactly as declared.
        Assert.Empty(report.DistributionMismatches);
        Assert.Equal(DemoSeedData.All.Count, report.Loaded);

        // The assessment rows keep the back-dated decision instants (the timeline story), while
        // the audit entries were stamped at recording time, so the chain must stay intact.
        var historyAssessments = await db.Assessments.AsNoTracking().ToListAsync();
        var historyDecisions = historyAssessments
            .Where(a => a.InputJson.Contains("\"demoKey\":\"demo-history-"))
            .Select(a => a.DecidedAtUtc)
            .OrderBy(t => t)
            .ToList();
        Assert.Equal(3, historyDecisions.Count);
        Assert.All(historyDecisions, t => Assert.True(t < DateTimeOffset.UtcNow,
            "the demonstration history must carry back-dated decision instants"));

        var chain = AuditChain.Verify(await db.Audit.AsNoTracking().ToListAsync());
        Assert.True(chain.Valid, "audit chain must remain valid after seeding into a populated store");
        Assert.Equal(DemoSeedData.All.Count + 1, chain.SealedCount);
    }
}
