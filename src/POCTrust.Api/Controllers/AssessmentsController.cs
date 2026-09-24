using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using POCTrust.Api.Services;
using POCTrust.Core.Entities;
using POCTrust.Infrastructure.Data;

namespace POCTrust.Api.Controllers;

[ApiController]
[Route("api/assessments")]
public sealed class AssessmentsController(AssessmentOrchestrator orchestrator, PocTrustDbContext db) : ControllerBase
{
    /// <summary>Demo scenarios this prototype actually implements.</summary>
    private static readonly string[] DemoKinds = ["trust", "review", "verify", "missing", "offline"];

    /// <summary>Matches the MVC web defaults, so a stored idempotent replay is byte-shape-identical
    /// to the response the first submission received.</summary>
    private static readonly JsonSerializerOptions ResponseJson = new(JsonSerializerDefaults.Web);

    private const int MaxIdempotencyKeyLength = 128;

    [HttpPost("evaluate")]
    public async Task<ActionResult<ReliabilityDecision>> Evaluate([FromBody] DiagnosticContext context, CancellationToken ct)
    {
        // Invalid evidence is a client error — answered as 400, never as a server fault with internals.
        if (string.IsNullOrWhiteSpace(context.Result))
            return BadRequest(ApiError.Message("Result is required."));

        // Offline sync idempotency: a client that retries a queued submission with the same
        // Idempotency-Key gets the ORIGINAL response replayed, so a retried sync can never create
        // a duplicate assessment. Keys are optional — submissions without one behave as before.
        var key = HttpContext?.Request.Headers.TryGetValue("Idempotency-Key", out var value) == true
            ? value.ToString().Trim()
            : "";
        if (key.Length > MaxIdempotencyKeyLength)
            return BadRequest(ApiError.Message($"Idempotency-Key must be at most {MaxIdempotencyKeyLength} characters."));

        if (key.Length > 0)
        {
            var existing = await db.SyncReceipts.AsNoTracking().FirstOrDefaultAsync(r => r.Key == key, ct);
            if (existing is not null) return Replay(existing);
        }

        var decision = await orchestrator.EvaluateAsync(context, ct);

        if (key.Length > 0)
        {
            db.SyncReceipts.Add(new SyncReceipt
            {
                Key = key,
                AssessmentId = decision.Id,
                ResponseJson = JsonSerializer.Serialize(decision, ResponseJson),
                CreatedUtc = DateTimeOffset.UtcNow,
            });
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException)
            {
                // Two submissions raced the same key: the winner's receipt is the replay answer.
                var winner = await db.SyncReceipts.AsNoTracking().FirstAsync(r => r.Key == key, ct);
                return Replay(winner);
            }
        }

        return Ok(decision);
    }

    private ContentResult Replay(SyncReceipt receipt)
    {
        Response.Headers["Idempotent-Replay"] = "true";
        return Content(receipt.ResponseJson, "application/json");
    }

    [HttpGet("demo/{kind}")]
    public async Task<ActionResult<ReliabilityDecision>> Demo(string kind, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        DiagnosticContext? context = kind.ToLowerInvariant() switch
        {
            "trust" => new DiagnosticContext("Hb 14.2 g/dL", "DEV-01", true, now.AddMonths(2), "OP-07", true, "LOT-GOOD", now.AddMonths(3), 22.5, now, "site-A/DEV-01/OP-07", TestType: "Hb"),
            "review" => new DiagnosticContext("Hb 9.1 g/dL", "DEV-02", true, now.AddDays(3), "OP-12", false, "LOT-44", now.AddDays(10), 24.0, now, "site-B/DEV-02/OP-12", TestType: "Hb", PowerInterruption: true),
            "missing" => new DiagnosticContext("Hb 11.0 g/dL", "DEV-04", true, now.AddMonths(1), "", true, "", now.AddMonths(1), 23.0, now, "", TestType: "Hb"),
            "offline" => new DiagnosticContext("Malaria RDT positive", "DEV-OFF-1", true, now.AddMonths(1), "OP-09", true, "LOT-OFF-7", now.AddMonths(2), 25.0, now, "site-mobile/DEV-OFF-1/OP-09", TestType: "Malaria-RDT", Connectivity: "offline", LocalEventId: $"local-{Guid.NewGuid():N}"[..12]),
            "verify" => new DiagnosticContext("CRP 68 mg/L", "DEV-03", false, now.AddDays(-9), "OP-03", true, "LOT-91", now.AddDays(-1), 31.5, now, "site-C/DEV-03/OP-03", TestType: "CRP", HumidityPct: 90),
            _ => null,
        };

        // Unknown scenario names are rejected: silently evaluating a different scenario
        // would persist misleading records.
        if (context is null)
            return BadRequest(ApiError.Message($"Unknown demo scenario. Expected one of: {string.Join(", ", DemoKinds)}."));

        return Ok(await orchestrator.EvaluateAsync(context, ct));
    }

    [HttpGet("audit")]
    public async Task<ActionResult> Audit([FromQuery] int take = 50, CancellationToken ct = default)
    {
        take = Math.Clamp(take, 1, 200);
        // Timestamps have variable fractional precision, so ID is the stable tie-break that keeps
        // ordering deterministic for same-timestamp rows.
        var rows = (await db.Audit.AsNoTracking().ToListAsync(ct))
            .OrderByDescending(a => a.TimestampUtc)
            .ThenByDescending(a => a.Id)
            .Take(take)
            .ToList();
        return Ok(rows);
    }
}
