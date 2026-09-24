using Microsoft.EntityFrameworkCore;
using POCTrust.Api.Services;
using POCTrust.Core.Entities;
using POCTrust.Core.Enums;
using POCTrust.Core.Reliability;
using POCTrust.Infrastructure.AI;
using POCTrust.Infrastructure.Data;
using POCTrust.Infrastructure.Services;

namespace POCTrust.Tests;

/// <summary>
/// Automated demonstration-data invariant check (spec Section 40). Iterates over EVERY seeded
/// scenario, runs it through the REAL pipeline (engine + advisory provider + audit store) and
/// asserts the cross-record invariants the demo depends on: status matches the declared
/// expectation, hard-stop states never consult AI, attention states never carry a hard-stop,
/// offline labels always carry offline metadata, reasons are humanized, the demo marker is
/// persisted, audit ordering holds, and the whole pass is deterministic.
/// </summary>
public sealed class DemoInvariantsTests
{
    private const string AllChecksPass = "ALL_CHECKS_PASS";
    private static readonly string[] HardStops = ["QC_FAILED", "CAL_EXPIRED", "REAGENT_EXPIRED"];

    private static readonly DateTimeOffset FixedNow = new(2026, 9, 24, 9, 0, 0, TimeSpan.Zero);

    private static AssessmentOrchestrator Orchestrator(PocTrustDbContext db) =>
        new(new ReliabilityEngine(), new StubAiProvider(), new EfAuditStore(db));

    private static PocTrustDbContext InMemoryDb() => new(new DbContextOptionsBuilder<PocTrustDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    /// <summary>Every seed evaluated through the real orchestrator, paired with its declaration.</summary>
    private static List<(DemoSeed Seed, ReliabilityDecision Decision)> EvaluateAll(PocTrustDbContext db)
    {
        var orchestrator = Orchestrator(db);
        return DemoSeedData.All
            .Select(s => (Seed: s, Decision: orchestrator.EvaluateAsync(s.Build(FixedNow), CancellationToken.None).GetAwaiter().GetResult()))
            .ToList();
    }

    [Fact]
    public void EverySeed_StatusMatchesExpectedDeclaration()
    {
        using var db = InMemoryDb();
        foreach (var (seed, decision) in EvaluateAll(db))
            Assert.True(decision.FinalStatus == seed.Expected,
                $"{seed.Key}: engine computed {decision.FinalStatus}, seed declared {seed.Expected}.");
    }

    [Fact]
    public void TrustSeeds_AllChecksPass_NoFailureOrExpiryReasons()
    {
        using var db = InMemoryDb();
        foreach (var (seed, decision) in EvaluateAll(db).Where(x => x.Seed.Expected == ReliabilityStatus.Trust))
        {
            Assert.Contains(AllChecksPass, decision.RuleIds);
            Assert.DoesNotContain(decision.RuleIds, HardStops.Contains);
            Assert.False(decision.Reasons.Any(r => r.Contains("fail", StringComparison.OrdinalIgnoreCase) || r.Contains("expired", StringComparison.OrdinalIgnoreCase)),
                $"{seed.Key}: a TRUST record must not carry failure or expiry reasons.");
        }
    }

    [Fact]
    public void VerifySeeds_HaveHardStopReason_NeverConsultAi()
    {
        using var db = InMemoryDb();
        foreach (var (seed, decision) in EvaluateAll(db).Where(x => x.Seed.Expected == ReliabilityStatus.Verify))
        {
            Assert.Contains(decision.RuleIds, HardStops.Contains);
            Assert.False(decision.AiConsulted, $"{seed.Key}: VERIFY hard-stop assessments never consult AI.");
            Assert.Null(decision.AiAssessment);
            Assert.False(string.IsNullOrWhiteSpace(decision.Action),
                $"{seed.Key}: VERIFY must state what to do next.");
        }
    }

    [Fact]
    public async Task VerifySeeds_AuditRecordsNoConsultation()
    {
        var db = InMemoryDb();
        var orchestrator = Orchestrator(db);
        foreach (var seed in DemoSeedData.All.Where(s => s.Expected == ReliabilityStatus.Verify))
        {
            var decision = await orchestrator.EvaluateAsync(seed.Build(FixedNow), CancellationToken.None);
            var audit = await db.Audit.SingleAsync(a => a.AssessmentId == decision.Id);
            Assert.False(audit.AiConsulted, $"{seed.Key}: the audit trail must not claim an AI consultation for VERIFY.");
        }
    }

    [Fact]
    public void ReviewSeeds_HaveFindings_NeverAHardStop()
    {
        using var db = InMemoryDb();
        foreach (var (seed, decision) in EvaluateAll(db).Where(x => x.Seed.Expected == ReliabilityStatus.Review))
        {
            Assert.NotEmpty(decision.RuleIds);
            Assert.DoesNotContain(decision.RuleIds, HardStops.Contains);
        }
    }

    [Fact]
    public void AiState_ConsultedExactlyWhenAdvisoryPayloadExists()
    {
        using var db = InMemoryDb();
        foreach (var (_, decision) in EvaluateAll(db))
            Assert.Equal(decision.AiConsulted, decision.AiAssessment is not null);
    }

    [Fact]
    public void OfflineLabels_AlwaysBackedByOfflineMetadata()
    {
        using var db = InMemoryDb();
        foreach (var (seed, decision) in EvaluateAll(db))
        {
            var context = seed.Build(FixedNow);
            var offlineMeta = string.Equals(context.Connectivity, "offline", StringComparison.OrdinalIgnoreCase)
                || !string.IsNullOrWhiteSpace(context.LocalEventId);
            var decisionMentionsOffline = decision.Reasons.Any(r => r.Contains("offline", StringComparison.OrdinalIgnoreCase));
            Assert.True(offlineMeta || !decisionMentionsOffline,
                $"{seed.Key}: an offline label appeared without offline metadata.");
        }
    }

    [Fact]
    public void IdenticalInputs_ProduceIdenticalDecisions()
    {
        using var db = InMemoryDb();
        var orchestrator = Orchestrator(db);
        foreach (var seed in DemoSeedData.All)
        {
            var first = orchestrator.EvaluateAsync(seed.Build(FixedNow), CancellationToken.None).GetAwaiter().GetResult();
            var second = orchestrator.EvaluateAsync(seed.Build(FixedNow), CancellationToken.None).GetAwaiter().GetResult();
            Assert.Equal(first.FinalStatus, second.FinalStatus);
            Assert.Equal(first.Action, second.Action);
            Assert.Equal(first.Reasons, second.Reasons);
            Assert.Equal(first.RuleIds, second.RuleIds);
        }
    }

    [Fact]
    public void Reasons_AreHumanized_NoMachineTokens()
    {
        using var db = InMemoryDb();
        foreach (var (seed, decision) in EvaluateAll(db))
        {
            foreach (var reason in decision.Reasons)
            {
                // The engine persists reasons as "[RULE_ID] Sentence." — the frontend humanizer
                // strips the bracketed machine prefix before display. The invariant asserts the
                // sentence part is clean, uppercase-opening and period-terminated.
                var idx = reason.IndexOf("] ", StringComparison.Ordinal);
                var sentence = idx >= 0 ? reason[(idx + 2)..] : reason;
                Assert.False(sentence.Contains('_'),
                    $"{seed.Key}: reason text must be humanized, found: '{reason}'.");
                Assert.True(sentence.Length > 0 && char.IsUpper(sentence[0]),
                    $"{seed.Key}: humanized reason must open with a capital: '{reason}'.");
            }
        }
    }

    [Fact]
    public async Task PersistedRecords_CarryDemoMarker_AndAuditInLogicalOrder()
    {
        var db = InMemoryDb();
        var orchestrator = Orchestrator(db);
        foreach (var seed in DemoSeedData.All)
        {
            var context = seed.Build(FixedNow);
            var decision = await orchestrator.EvaluateAsync(context, CancellationToken.None);
            var stored = await db.Assessments.SingleAsync(a => a.Id == decision.Id);
            Assert.Contains(DemoSeeder.Marker(seed.Key), stored.InputJson);
            var audit = await db.Audit.SingleAsync(a => a.AssessmentId == decision.Id);
            Assert.True(audit.TimestampUtc >= stored.TimestampUtc,
                $"{seed.Key}: audit event must not precede the assessment event.");
        }
    }

    [Fact]
    public void Seeds_ReferenceOnlyTheCuratedSyntheticDirectory()
    {
        var devices = new HashSet<string> { "POC-DXA-01", "POC-DXB-02", "POC-DXM-03" };
        var operators = new HashSet<string> { "Operator A", "Operator B", "Operator C" };
        foreach (var seed in DemoSeedData.All)
        {
            var context = seed.Build(FixedNow);
            Assert.True(devices.Contains(context.DeviceId), $"{seed.Key}: unknown device '{context.DeviceId}'.");
            // The provenance-incomplete scenario intentionally omits operator/reagent records —
            // that omission IS the scenario. An operator that IS recorded must be curated.
            if (!string.IsNullOrWhiteSpace(context.OperatorId))
                Assert.True(operators.Contains(context.OperatorId), $"{seed.Key}: unknown operator '{context.OperatorId}'.");
            if (!string.IsNullOrWhiteSpace(context.DeviceId) && !string.IsNullOrWhiteSpace(context.OperatorId))
            {
                Assert.Contains(context.DeviceId, context.Provenance);
                Assert.Contains(context.OperatorId, context.Provenance);
            }
        }
    }
}
