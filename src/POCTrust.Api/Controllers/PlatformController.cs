using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using POCTrust.Api.Services;
using POCTrust.Core.Entities;
using POCTrust.Core.Integrity;
using POCTrust.Core.Interfaces;
using POCTrust.Infrastructure.Data;
using POCTrust.Infrastructure.Services;

namespace POCTrust.Api.Controllers;

[ApiController]
[Route("api")]
public sealed class PlatformController(PocTrustDbContext db, IReliabilityEngine engine) : ControllerBase
{
    /// <summary>Demonstration decision-history family marker: records whose demo key starts with
    /// this prefix form ONE synthetic sequence, evaluated through the real pipeline at historical
    /// instants. Only demo-marked records can ever match.</summary>
    private const string HistoryFamilyMarker = "\"demoKey\":\"demo-history-";

    // Stored evidence is camelCase (canonical since the persistence fix); PascalCase lookups are
    // still attempted so records written by earlier prototype builds keep rendering correctly.
    private static readonly JsonSerializerOptions PersistedJson = new(JsonSerializerDefaults.Web);

    private static List<AssessmentRecord> Sorted(IEnumerable<AssessmentRecord> rows, int take) =>
        rows.OrderByDescending(a => a.DecidedAtUtc)
            .ThenByDescending(a => a.Id)   // stable tie-break: timestamps vary in fractional precision
            .Take(take)
            .ToList();

    private static DiagnosticContext? TryParseInput(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<DiagnosticContext>(
                string.IsNullOrWhiteSpace(json) ? "{}" : json, PersistedJson);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static IntegrityAuditReference AuditReferenceFor(int total, int sealedCount) =>
        new(total, sealedCount, "sha256-chain",
            total > 0 && sealedCount == total ? "Sealed audit record available" : "Assessment record available",
            "Counts reference the append-only audit trail for this assessment; sealing makes the trail tamper-evident.");

    /// <summary>
    /// Compact integrity fields for one history-list row (spec section 27), derived by the SAME
    /// projector the full record endpoint uses — never a parallel derivation, so a row can never
    /// disagree with the record it links to. The engine is used only for the gated causality
    /// re-derivation; the stored decision itself is never re-decided.
    /// </summary>
    private static object? RowIntegrity(
        AssessmentRecord a, DiagnosticContext input, string[] rules, string[] reasons,
        IntegrityAuditReference auditRef, IReliabilityEngine engine)
    {
        try
        {
            var snapshot = new IntegrityDecisionSnapshot(
                a.Id, input, a.FinalStatus, rules, reasons,
                a.Action, a.AiConsulted, a.AiSummary, a.DecidedAtUtc, auditRef);
            var record = ResultIntegrityProjector.Project(snapshot, engine);
            var primary = record.Causality is { Verified: true, PrimaryDrivers.Count: > 0 } c
                ? c.PrimaryDrivers[0]
                : null;
            return new
            {
                coverageAvailable = record.EvidenceQuality.Coverage.RequiredAvailable,
                coverageRequired = record.EvidenceQuality.Coverage.RequiredTotal,
                concerns = IntegrityMetrics.ConcernCount(record),
                agingCount = record.EvidenceQuality.AgingCount,
                expiredCount = record.EvidenceQuality.ExpiredCount,
                failedCount = record.Domains.Count(d => d.State == ResultIntegrityProjector.States.Failed),
                conflictCount = record.EvidenceQuality.ConflictCount,
                primaryDriverLabel = primary?.DomainLabel,
                primaryDriverState = primary?.EvidenceState,
                primaryDriverStatement = primary?.Statement ?? record.DecisionDrivers.FirstOrDefault(),
                policy = record.Policy.Name,
                auditEntries = auditRef.Entries,
                auditSealed = auditRef.SealedEntries,
                auditAvailable = auditRef.Entries > 0,
            };
        }
        catch
        {
            // A row whose stored payload cannot be projected keeps rendering WITHOUT integrity
            // fields — it never renders invented ones.
            return null;
        }
    }

    [HttpGet("assessments")]
    public async Task<ActionResult> History([FromQuery] int take = 100, CancellationToken ct = default)
    {
        take = Math.Clamp(take, 1, 500);
        var rows = await db.Assessments.AsNoTracking().ToListAsync(ct);
        var audits = await db.Audit.AsNoTracking().ToListAsync(ct);
        var auditCounts = audits.GroupBy(x => x.AssessmentId)
            .ToDictionary(g => g.Key, g => (Total: g.Count(), Sealed: g.Count(x => !string.IsNullOrEmpty(x.Hash))));
        return Ok(Sorted(rows, take).Select(a =>
        {
            var counts = auditCounts.TryGetValue(a.Id, out var c) ? c : (Total: 0, Sealed: 0);
            var input = TryParseInput(a.InputJson);
            var integrity = input is null
                ? null
                : RowIntegrity(a, input, ParseStringList(a.RuleIdsJson), ParseStringList(a.ReasonsJson),
                    AuditReferenceFor(counts.Total, counts.Sealed), engine);
            return new
            {
                a.Id, a.Result, a.DeviceId, a.Provenance, a.InitialStatus, a.FinalStatus,
                a.AiConsulted, a.Action, a.DecidedAtUtc, a.TimestampUtc,
                TestType = TryGet(a.InputJson, "TestType"),
                OperatorId = TryGet(a.InputJson, "OperatorId"),
                Connectivity = TryGet(a.InputJson, "Connectivity") ?? "online",
                integrity,
            };
        }));
    }

    [HttpGet("assessments/{id:guid}")]
    public async Task<ActionResult> Detail(Guid id, CancellationToken ct = default)
    {
        var a = await db.Assessments.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a is null) return NotFound();
        var audits = await db.Audit.AsNoTracking().ToListAsync(ct);
        return Ok(new
        {
            assessment = a,
            input = JsonDocument.Parse(string.IsNullOrWhiteSpace(a.InputJson) ? "{}" : a.InputJson),
            reasons = JsonDocument.Parse(string.IsNullOrWhiteSpace(a.ReasonsJson) ? "[]" : a.ReasonsJson),
            ruleIds = JsonDocument.Parse(string.IsNullOrWhiteSpace(a.RuleIdsJson) ? "[]" : a.RuleIdsJson),
            audit = audits.Where(x => x.AssessmentId == id).OrderBy(x => x.TimestampUtc).ThenBy(x => x.Id).ToList(),
        });
    }

    /// <summary>
    /// The Result Integrity Record for one assessment: a portable, auditable, evidence-linked
    /// projection derived from the persisted assessment and its sealed audit entries — never a
    /// re-evaluation and never a second copy of the data. The record states what evidence the
    /// engine had, its classified quality under the demonstration policy, why the disposition
    /// occurred, and what action follows. It is an operational integrity assessment, not a
    /// measure of clinical validity.
    /// </summary>
    [HttpGet("assessments/{id:guid}/integrity-record")]
    public async Task<ActionResult> IntegrityRecord(Guid id, CancellationToken ct = default)
    {
        var a = await db.Assessments.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a is null)
            return NotFound(ApiError.Message("No assessment with this id exists."));

        DiagnosticContext input;
        try
        {
            input = JsonSerializer.Deserialize<DiagnosticContext>(
                string.IsNullOrWhiteSpace(a.InputJson) ? "{}" : a.InputJson, PersistedJson)
                ?? throw new JsonException("Stored evidence was empty.");
        }
        catch (JsonException)
        {
            return UnprocessableEntity(ApiError.Message("Stored evidence for this assessment could not be interpreted."));
        }

        var audits = await db.Audit.AsNoTracking().Where(x => x.AssessmentId == id).ToListAsync(ct);
        var sealedCount = audits.Count(x => !string.IsNullOrEmpty(x.Hash));
        var auditReference = new IntegrityAuditReference(
            audits.Count,
            sealedCount,
            "sha256-chain",
            audits.Count > 0 && sealedCount == audits.Count
                ? "Sealed audit record available"
                : "Assessment record available",
            "Counts reference the append-only audit trail for this assessment; sealing makes the trail tamper-evident.");

        // Demonstration decision history: when this record belongs to the seeded sequence, load the
        // sibling decisions (already stored — never re-computed) so the integrity timeline can show
        // genuinely recorded evolution. Non-demo records never take this path.
        List<IntegrityHistoryPoint>? history = null;
        if (input.DemoKey is { } demoKey && demoKey.StartsWith("demo-history-", StringComparison.Ordinal))
        {
            var rows = await db.Assessments.AsNoTracking()
                .Where(a => a.InputJson.Contains(HistoryFamilyMarker))
                .ToListAsync(ct);
            history = rows
                .Select(row => new
                {
                    row.Id, row.FinalStatus, row.DecidedAtUtc,
                    Rules = ParseStringList(row.RuleIdsJson),
                    Reasons = ParseStringList(row.ReasonsJson),
                })
                .OrderBy(h => h.DecidedAtUtc).ThenBy(h => h.Id)
                .Select(h => new IntegrityHistoryPoint(h.Id, h.DecidedAtUtc, h.FinalStatus, h.Rules, h.Reasons))
                .ToList();
        }

        var snapshot = new IntegrityDecisionSnapshot(
            a.Id, input, a.FinalStatus,
            ParseStringList(a.RuleIdsJson), ParseStringList(a.ReasonsJson),
            a.Action, a.AiConsulted, a.AiSummary, a.DecidedAtUtc, auditReference, history);

        // The engine is used ONLY for the gated causality re-derivation inside the projector:
        // the re-run must reproduce the stored decision exactly before any of its classifications
        // are shown. The stored decision itself is never re-decided.
        return Ok(ResultIntegrityProjector.Project(snapshot, engine));
    }

    private static string[] ParseStringList(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json);
            return doc.RootElement.ValueKind == JsonValueKind.Array
                ? doc.RootElement.EnumerateArray()
                    .Where(e => e.ValueKind == JsonValueKind.String)
                    .Select(e => e.GetString() ?? "")
                    .ToArray()
                : [];
        }
        catch { return []; }
    }

    [HttpGet("dashboard/summary")]
    public async Task<ActionResult> Summary(CancellationToken ct = default)
    {
        var assessments = await db.Assessments.AsNoTracking().ToListAsync(ct);
        var audits = await db.Audit.AsNoTracking().ToListAsync(ct);
        var ordered = assessments.OrderByDescending(a => a.DecidedAtUtc).ToList();

        // Integrity overview (spec section 26): aggregates over the SAME projection the detail
        // records use, computed from the stored records at request time — never preset, never
        // sampled. No engine is needed here: coverage/concern/aging/conflict counts are pure
        // projections of stored data, and causality roles are intentionally not asserted here.
        var auditCounts = audits.GroupBy(x => x.AssessmentId)
            .ToDictionary(g => g.Key, g => (Total: g.Count(), Sealed: g.Count(x => !string.IsNullOrEmpty(x.Hash))));
        var projected = new List<ResultIntegrityRecord>(ordered.Count);
        foreach (var a in ordered)
        {
            var input = TryParseInput(a.InputJson);
            if (input is null) continue;
            var counts = auditCounts.TryGetValue(a.Id, out var c) ? c : (Total: 0, Sealed: 0);
            var snapshot = new IntegrityDecisionSnapshot(
                a.Id, input, a.FinalStatus, ParseStringList(a.RuleIdsJson), ParseStringList(a.ReasonsJson),
                a.Action, a.AiConsulted, a.AiSummary, a.DecidedAtUtc, AuditReferenceFor(counts.Total, counts.Sealed));
            projected.Add(ResultIntegrityProjector.Project(snapshot));
        }
        var covered = projected.Where(r => r.EvidenceQuality.Coverage.RequiredTotal > 0).ToList();
        var coveragePercent = covered.Count == 0
            ? 0
            : (int)Math.Round(covered.Average(IntegrityMetrics.CoverageRatio) * 100, MidpointRounding.AwayFromZero);

        return Ok(new
        {
            counts = new
            {
                trust = ordered.Count(a => (int)a.FinalStatus == 0),
                review = ordered.Count(a => (int)a.FinalStatus == 1),
                verify = ordered.Count(a => (int)a.FinalStatus == 2),
                total = ordered.Count,
            },
            offlineCount = ordered.Count(a => (TryGet(a.InputJson, "Connectivity") ?? "online") == "offline"),
            aiConsultedCount = ordered.Count(a => a.AiConsulted),
            recent = ordered.Take(8).Select(a => new { a.Id, a.Result, a.DeviceId, a.FinalStatus, a.DecidedAtUtc }),
            recentAudit = audits.OrderByDescending(a => a.TimestampUtc).ThenByDescending(a => a.Id).Take(8).ToList(),
            integrity = new
            {
                assessments = projected.Count,
                coveragePercent,
                coverageStatement = projected.Count == 0 ? "No assessments recorded yet" : $"{coveragePercent}% complete",
                assessmentsWithConcerns = projected.Count(IntegrityMetrics.HasConcerns),
                conflicts = projected.Sum(r => r.EvidenceQuality.ConflictCount),
                assessmentsWithAging = projected.Count(r => r.EvidenceQuality.AgingCount > 0),
                note = "Calculated from the stored assessment records at request time — never preset. Under demonstration mode these records are synthetic.",
            },
            source = "real persisted assessments; empty on fresh install — use Demonstration Mode",
        });
    }

    /// <summary>
    /// The demonstration moment (spec section 30): the stored demonstration decision sequence —
    /// one result becoming TRUST, then REVIEW, then VERIFY as the evidence quality changes — with
    /// the reason for each change derived from the STORED findings (the same derivation the
    /// integrity timeline uses). Entirely deterministic; the advisory AI plays no part.
    /// </summary>
    [HttpGet("dashboard/demonstration")]
    public async Task<ActionResult> Demonstration(CancellationToken ct = default)
    {
        var rows = await db.Assessments.AsNoTracking()
            .Where(a => a.InputJson.Contains(HistoryFamilyMarker))
            .ToListAsync(ct);
        var ordered = rows
            .Select(a => new
            {
                a.Id, a.Result, a.FinalStatus, a.AiConsulted, a.DecidedAtUtc,
                Input = TryParseInput(a.InputJson),
                Rules = ParseStringList(a.RuleIdsJson),
                Reasons = ParseStringList(a.ReasonsJson),
            })
            .Where(x => x.Input is not null)
            .OrderBy(x => x.DecidedAtUtc).ThenBy(x => x.Id)
            .ToList();

        var steps = new List<object>();
        IntegrityHistoryPoint? previous = null;
        foreach (var x in ordered)
        {
            var point = new IntegrityHistoryPoint(x.Id, x.DecidedAtUtc, x.FinalStatus, x.Rules, x.Reasons);
            steps.Add(new
            {
                assessmentId = x.Id,
                result = x.Result,
                testType = string.IsNullOrWhiteSpace(x.Input!.TestType) ? "POC test" : x.Input.TestType,
                decidedAtUtc = x.DecidedAtUtc,
                disposition = x.FinalStatus.ToString().ToUpperInvariant(),
                policy = DemonstrationPolicies.SelectFor(x.Input!).Name,
                change = previous is null ? null : ResultIntegrityProjector.DescribeTransition(previous, point),
            });
            previous = point;
        }

        return Ok(new
        {
            available = steps.Count >= 2,
            label = "Watch one result become trustworthy, then watch its integrity context change.",
            note = "A synthetic three-step sequence recorded through the REAL deterministic pipeline at fixed historical instants: same device and operator, only the evidence quality changes. Clearly labelled demonstration data — never presented as production history.",
            aiInvolved = ordered.Any(x => x.AiConsulted),
            steps,
            source = "Stored demonstration records; every disposition comes from the deterministic engine only.",
        });
    }

    [HttpGet("devices")]
    public async Task<ActionResult> Devices(CancellationToken ct = default)
    {
        var rows = await db.Assessments.AsNoTracking().ToListAsync(ct);
        var devices = rows.GroupBy(a => a.DeviceId).Select(g => new
        {
            deviceId = g.Key,
            assessments = g.Count(),
            lastSeenUtc = g.Max(a => a.DecidedAtUtc),
            qcFailures = g.Count(a => !a.QcPassed),
            lastStatus = g.OrderByDescending(a => a.DecidedAtUtc).First().FinalStatus,
        }).OrderByDescending(d => d.lastSeenUtc).ToList();
        return Ok(new { items = devices, note = "Observed devices from real assessments only (synthetic demo data when in Demonstration Mode)." });
    }

    [HttpGet("operators")]
    public async Task<ActionResult> Operators(CancellationToken ct = default)
    {
        var rows = await db.Assessments.AsNoTracking().ToListAsync(ct);
        var ops = rows.GroupBy(a => TryGet(a.InputJson, "OperatorId") ?? "?").Select(g => new
        {
            operatorId = g.Key,
            assessments = g.Count(),
            lastSeenUtc = g.Max(a => a.DecidedAtUtc),
        }).OrderByDescending(o => o.lastSeenUtc).ToList();
        return Ok(new { items = ops, note = "Observed operators from real assessments only." });
    }

    [HttpGet("quality-controls")]
    public async Task<ActionResult> QualityControls(CancellationToken ct = default)
    {
        var rows = await db.Assessments.AsNoTracking().ToListAsync(ct);
        return Ok(new
        {
            total = rows.Count,
            qcPassed = rows.Count(a => a.QcPassed),
            qcFailed = rows.Count(a => !a.QcPassed),
            verifyCount = rows.Count(a => (int)a.FinalStatus == 2),
            note = "Aggregated from real persisted assessments.",
        });
    }

    [HttpGet("audit/{assessmentId:guid}")]
    public async Task<ActionResult> AuditDetail(Guid assessmentId, CancellationToken ct = default)
    {
        var rows = await db.Audit.AsNoTracking().ToListAsync(ct);
        return Ok(rows.Where(a => a.AssessmentId == assessmentId).OrderBy(a => a.TimestampUtc).ThenBy(a => a.Id).ToList());
    }

    /// <summary>
    /// Tamper-evidence check for the append-only audit trail: recomputes the SHA-256 hash chain in
    /// canonical order and reports the first broken entry, if any. Entries written before audit
    /// sealing was introduced are reported as an unsealed legacy prefix, never as a failure.
    /// </summary>
    [HttpGet("audit/verify")]
    public async Task<ActionResult> AuditVerify(CancellationToken ct = default)
    {
        var rows = await db.Audit.AsNoTracking().ToListAsync(ct);
        var report = AuditChain.Verify(rows);
        return Ok(new
        {
            valid = report.Valid,
            sealedEntries = report.SealedCount,
            legacyUnsealedEntries = report.LegacyCount,
            totalEntries = rows.Count,
            brokenAt = report.BrokenAt,
            algorithm = "sha256-chain",
            note = "Sealing proves the sealed trail has not been altered since each entry was written; it does not attest that the underlying event occurred.",
        });
    }

    private static string? TryGet(string json, string prop)
    {
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "{}" : json);
            foreach (var name in new[] { prop, char.ToLowerInvariant(prop[0]) + prop[1..] })
                if (doc.RootElement.TryGetProperty(name, out var el))
                    return el.ValueKind == JsonValueKind.String ? el.GetString() : el.ToString();
            return null;
        }
        catch { return null; }
    }
}
