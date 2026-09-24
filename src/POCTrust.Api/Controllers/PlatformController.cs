using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using POCTrust.Core.Entities;
using POCTrust.Core.Integrity;
using POCTrust.Infrastructure.Data;
using POCTrust.Infrastructure.Services;

namespace POCTrust.Api.Controllers;

[ApiController]
[Route("api")]
public sealed class PlatformController(PocTrustDbContext db) : ControllerBase
{
    // Stored evidence is camelCase (canonical since the persistence fix); PascalCase lookups are
    // still attempted so records written by earlier prototype builds keep rendering correctly.
    private static readonly JsonSerializerOptions PersistedJson = new(JsonSerializerDefaults.Web);

    private static List<AssessmentRecord> Sorted(IEnumerable<AssessmentRecord> rows, int take) =>
        rows.OrderByDescending(a => a.DecidedAtUtc)
            .ThenByDescending(a => a.Id)   // stable tie-break: timestamps vary in fractional precision
            .Take(take)
            .ToList();

    [HttpGet("assessments")]
    public async Task<ActionResult> History([FromQuery] int take = 100, CancellationToken ct = default)
    {
        take = Math.Clamp(take, 1, 500);
        var rows = await db.Assessments.AsNoTracking().ToListAsync(ct);
        return Ok(Sorted(rows, take).Select(a => new
        {
            a.Id, a.Result, a.DeviceId, a.Provenance, a.InitialStatus, a.FinalStatus,
            a.AiConsulted, a.Action, a.DecidedAtUtc, a.TimestampUtc,
            TestType = TryGet(a.InputJson, "TestType"),
            OperatorId = TryGet(a.InputJson, "OperatorId"),
            Connectivity = TryGet(a.InputJson, "Connectivity") ?? "online",
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

        var snapshot = new IntegrityDecisionSnapshot(
            a.Id, input, a.FinalStatus,
            ParseStringList(a.RuleIdsJson), ParseStringList(a.ReasonsJson),
            a.Action, a.AiConsulted, a.AiSummary, a.DecidedAtUtc, auditReference);

        return Ok(ResultIntegrityProjector.Project(snapshot));
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
            source = "real persisted assessments; empty on fresh install — use Demonstration Mode",
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
