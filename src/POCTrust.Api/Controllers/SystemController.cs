using Microsoft.AspNetCore.Mvc;
using POCTrust.Infrastructure.Data;

namespace POCTrust.Api.Controllers;

/// <summary>
/// Operational visibility for the demonstration. Reports how the system is configured, never
/// any secret material: the AI endpoint is reduced to its host, and the API key is only ever a
/// boolean. "Real AI required" for a live demo means the key is set through environment
/// configuration before startup; with no key the honest stub provider answers and the
/// deterministic result never depends on either.
/// </summary>
[ApiController]
[Route("api/system")]
public sealed class SystemController(IConfiguration config, PocTrustDbContext db, IHostEnvironment env) : ControllerBase
{
    [HttpGet("status")]
    public async Task<IActionResult> Status(CancellationToken ct)
    {
        var apiKey = config["AI:ApiKey"];
        var endpoint = config["AI:Endpoint"] ?? "https://api.openai.com/v1/chat/completions";
        var model = config["AI:Model"] ?? "gpt-4o-mini";
        var configured = !string.IsNullOrWhiteSpace(apiKey);

        // Host only, the path may embed provider-specific segments we never surface.
        string endpointHost = "unknown";
        try { endpointHost = new Uri(endpoint).Host; }
        catch (UriFormatException) { /* misconfigured endpoint, reported honestly below */ }

        return Ok(new
        {
            environment = env.EnvironmentName,
            database = await db.Database.CanConnectAsync(ct) ? "ok" : "unavailable",
            ai = new
            {
                provider = configured ? "openai-compatible" : "stub/offline",
                configured,
                model,
                endpointHost,
                advisoryOnly = true,
                note = configured
                    ? "Live advisory provider configured. AI never sets, changes or upgrades any status; VERIFY stays locked."
                    : "No AI key configured, the stub provider answers advisory calls. The deterministic result is unaffected either way.",
            },
            auditSealing = "sha256-chain",
            demoAutoSeed = config.GetValue("Demo:AutoSeed", env.IsDevelopment()),
            rateLimit = new
            {
                permitsPerWindow = config.GetValue("RateLimit:PermitsPerWindow", 100),
                windowSeconds = config.GetValue("RateLimit:WindowSeconds", 10),
            },
            auth = (config["Auth:Mode"] ?? "none") == "apikey" ? "api-key (mutating endpoints)" : "none (operators recorded as claimed)",
        });
    }
}
