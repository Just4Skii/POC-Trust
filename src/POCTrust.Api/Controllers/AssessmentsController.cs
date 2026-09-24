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
    [HttpPost("evaluate")]
    public async Task<ActionResult<ReliabilityDecision>> Evaluate([FromBody] DiagnosticContext context, CancellationToken ct)
    {
        var decision = await orchestrator.EvaluateAsync(context, ct);
        return Ok(decision);
    }

    [HttpGet("demo/{kind}")]
    public async Task<ActionResult<ReliabilityDecision>> Demo(string kind, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        DiagnosticContext context = kind.ToLowerInvariant() switch
        {
            "trust" => new DiagnosticContext("Hb 14.2 g/dL", "DEV-01", true, now.AddMonths(2), "OP-07", true, "LOT-GOOD", now.AddMonths(3), 22.5, now, "site-A/DEV-01/OP-07", TestType: "Hb"),
            "review" => new DiagnosticContext("Hb 9.1 g/dL", "DEV-02", true, now.AddDays(3), "OP-12", false, "LOT-44", now.AddDays(10), 24.0, now, "site-B/DEV-02/OP-12", TestType: "Hb", PowerInterruption: true),
            "missing" => new DiagnosticContext("Hb 11.0 g/dL", "DEV-04", true, now.AddMonths(1), "", true, "", now.AddMonths(1), 23.0, now, "", TestType: "Hb"),
            "offline" => new DiagnosticContext("Malaria RDT positive", "DEV-OFF-1", true, now.AddMonths(1), "OP-09", true, "LOT-OFF-7", now.AddMonths(2), 25.0, now, "site-mobile/DEV-OFF-1/OP-09", TestType: "Malaria-RDT", Connectivity: "offline", LocalEventId: $"local-{Guid.NewGuid():N}"[..12]),
            _ => new DiagnosticContext("CRP 68 mg/L", "DEV-03", false, now.AddDays(-9), "OP-03", true, "LOT-91", now.AddDays(-1), 31.5, now, "site-C/DEV-03/OP-03", TestType: "CRP", HumidityPct: 90),
        };
        return Ok(await orchestrator.EvaluateAsync(context, ct));
    }

    [HttpGet("audit")]
    public async Task<ActionResult> Audit([FromQuery] int take = 50, CancellationToken ct = default)
    {
        take = Math.Clamp(take, 1, 200);
        var rows = (await db.Audit.AsNoTracking().ToListAsync(ct))
            .OrderByDescending(a => a.TimestampUtc)
            .Take(take)
            .ToList();
        return Ok(rows);
    }
}
