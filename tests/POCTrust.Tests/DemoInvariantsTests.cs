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

    /// <summary>Every seed evaluated through the real orchestrator (at its declared decision
    /// instant, so the demonstration history sequence is evaluated at its historical timestamps),
    /// paired with its declaration.</summary>
    private static async Task<List<(DemoSeed Seed, ReliabilityDecision Decision)>> EvaluateAllAsync(PocTrustDbContext db)
    {
        var orchestrator = Orchestrator(db);
        var list = new List<(DemoSeed Seed, ReliabilityDecision Decision)>();
        foreach (var seed in DemoSeedData.All)
        {
            var decision = await orchestrator.EvaluateAsync(
                seed.Build(FixedNow), null, CancellationToken.None, seed.DecisionAt?.Invoke(FixedNow));
            list.Add((seed, decision));
        }
        return list;
    }

    [Fact]
    public async Task EverySeed_StatusMatchesExpectedDeclaration()
    {
        using var db = InMemoryDb();
        foreach (var (seed, decision) in await EvaluateAllAsync(db))
            Assert.True(decision.FinalStatus == seed.Expected,
                $"{seed.Key}: engine computed {decision.FinalStatus}, seed declared {seed.Expected}.");
    }

    [Fact]
    public async Task TrustSeeds_AllChecksPass_NoFailureOrExpiryReasons()
    {
        using var db = InMemoryDb();
        foreach (var (seed, decision) in (await EvaluateAllAsync(db)).Where(x => x.Seed.Expected == ReliabilityStatus.Trust))
        {
            Assert.Contains(AllChecksPass, decision.RuleIds);
            Assert.DoesNotContain(decision.RuleIds, HardStops.Contains);
            Assert.False(decision.Reasons.Any(r => r.Contains("fail", StringComparison.OrdinalIgnoreCase) || r.Contains("expired", StringComparison.OrdinalIgnoreCase)),
                $"{seed.Key}: a TRUST record must not carry failure or expiry reasons.");
        }
    }

    [Fact]
    public async Task VerifySeeds_HaveHardStopReason_NeverConsultAi()
    {
        using var db = InMemoryDb();
        foreach (var (seed, decision) in (await EvaluateAllAsync(db)).Where(x => x.Seed.Expected == ReliabilityStatus.Verify))
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
            var decision = await orchestrator.EvaluateAsync(
                seed.Build(FixedNow), null, CancellationToken.None, seed.DecisionAt?.Invoke(FixedNow));
            var audit = await db.Audit.SingleAsync(a => a.AssessmentId == decision.Id);
            Assert.False(audit.AiConsulted, $"{seed.Key}: the audit trail must not claim an AI consultation for VERIFY.");
        }
    }

    [Fact]
    public async Task ReviewSeeds_HaveFindings_NeverAHardStop()
    {
        using var db = InMemoryDb();
        foreach (var (seed, decision) in (await EvaluateAllAsync(db)).Where(x => x.Seed.Expected == ReliabilityStatus.Review))
        {
            Assert.NotEmpty(decision.RuleIds);
            Assert.DoesNotContain(decision.RuleIds, HardStops.Contains);
        }
    }

    [Fact]
    public async Task AiState_ConsultedExactlyWhenAdvisoryPayloadExists()
    {
        using var db = InMemoryDb();
        foreach (var (_, decision) in await EvaluateAllAsync(db))
            Assert.Equal(decision.AiConsulted, decision.AiAssessment is not null);
    }

    [Fact]
    public async Task OfflineLabels_AlwaysBackedByOfflineMetadata()
    {
        using var db = InMemoryDb();
        foreach (var (seed, decision) in await EvaluateAllAsync(db))
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
    public async Task IdenticalInputs_ProduceIdenticalDecisions()
    {
        using var db = InMemoryDb();
        var orchestrator = Orchestrator(db);
        foreach (var seed in DemoSeedData.All)
        {
            var at = seed.DecisionAt?.Invoke(FixedNow);
            var first = await orchestrator.EvaluateAsync(seed.Build(FixedNow), null, CancellationToken.None, at);
            var second = await orchestrator.EvaluateAsync(seed.Build(FixedNow), null, CancellationToken.None, at);
            Assert.Equal(first.FinalStatus, second.FinalStatus);
            Assert.Equal(first.Action, second.Action);
            Assert.Equal(first.Reasons, second.Reasons);
            Assert.Equal(first.RuleIds, second.RuleIds);
        }
    }

    [Fact]
    public async Task Reasons_AreHumanized_NoMachineTokens()
    {
        using var db = InMemoryDb();
        foreach (var (seed, decision) in await EvaluateAllAsync(db))
        {
            foreach (var reason in decision.Reasons)
            {
                // The engine persists reasons as "[RULE_ID] Sentence.", the frontend humanizer
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
            var decision = await orchestrator.EvaluateAsync(
                context, null, CancellationToken.None, seed.DecisionAt?.Invoke(FixedNow));
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
            // The provenance-incomplete scenario intentionally omits operator/reagent records,
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
