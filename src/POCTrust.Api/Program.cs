using System.Text.Json;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Formatters;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using POCTrust.Api;
using POCTrust.Api.Security;
using POCTrust.Api.Services;
using POCTrust.Core.Interfaces;
using POCTrust.Core.Reliability;
using POCTrust.Infrastructure.AI;
using POCTrust.Infrastructure.Data;
using POCTrust.Infrastructure.Services;
using System.Threading.RateLimiting;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();

// Single client-facing error contract for rejected requests: {"error":"...","fields":[...]}.
// Malformed JSON must not surface binder/parser internals ("The context field is required.").
builder.Services.Configure<ApiBehaviorOptions>(o =>
{
    o.InvalidModelStateResponseFactory = ctx =>
    {
        // The JSON input formatter reports unreadable payloads either as an InputFormatterException
        // (JsonException) or as a model error keyed by JSON path ("$.result").
        var malformedJson = ctx.ModelState.Any(kv =>
            kv.Key.StartsWith('$') ||
            (kv.Value?.Errors.Any(e => e.Exception is JsonException or InputFormatterException) ?? false));

        var error = malformedJson
            ? "Request body is not valid JSON for the assessment contract."
            : "Request body is missing required fields.";

        return new BadRequestObjectResult(ApiError.From(error, ctx.ModelState));
    };
});

builder.Services.AddOpenApi();

// CORS origins are configurable for hosted deployments. In the packaged single-container mode the
// UI is served by the API itself (same origin), so this only matters for the dev Vite origin.
var corsOrigins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? ["http://localhost:5173"];
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins(corsOrigins).AllowAnyHeader().AllowAnyMethod().WithExposedHeaders("Idempotent-Replay")));

builder.Services.AddDbContext<PocTrustDbContext>(o =>
    o.UseSqlite(builder.Configuration.GetConnectionString("Default") ?? "Data Source=poctrust.db"));

builder.Services.AddScoped<IReliabilityEngine, ReliabilityEngine>();
builder.Services.AddScoped<IAuditStore, EfAuditStore>();
builder.Services.AddScoped<AssessmentOrchestrator>();
builder.Services.AddHttpClient<IAIProvider, OpenAiCompatibleProvider>();

// Demonstration appliance protections: a fixed per-IP window keeps a runaway script (or a stuck
// retry loop) from drowning the demo database, while staying far above anything a human-driven
// demonstration can generate. Configurable via RateLimit:PermitsPerWindow / RateLimit:WindowSeconds.
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.OnRejected = async (ctx, ct) =>
    {
        ctx.HttpContext.Response.ContentType = "application/json";
        await ctx.HttpContext.Response.WriteAsJsonAsync(
            ApiError.Message("Too many requests. Please retry shortly."), ct);
    };
    var permits = builder.Configuration.GetValue("RateLimit:PermitsPerWindow", 100);
    var windowSeconds = builder.Configuration.GetValue("RateLimit:WindowSeconds", 10);
    o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            httpContext.Connection.RemoteIpAddress?.ToString() ?? "anonymous",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = permits,
                Window = TimeSpan.FromSeconds(windowSeconds),
            }));
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<PocTrustDbContext>();
    db.Database.EnsureCreated();

    // Optional first-run demonstration load. Default: ON in Development, OFF elsewhere,
    // explicitly overridable in every environment via Demo:AutoSeed (env: Demo__AutoSeed).
    // Only an EMPTY store is seeded, only through the real pipeline, and a failed load never
    // blocks startup, the deterministic engine works with an empty store.
    var autoSeed = builder.Configuration.GetValue("Demo:AutoSeed", builder.Environment.IsDevelopment());
    if (autoSeed)
    {
        var orchestrator = scope.ServiceProvider.GetRequiredService<AssessmentOrchestrator>();
        var seeder = new DemoSeeder(orchestrator, db);
        await seeder.SeedOnStartupIfConfiguredAsync(app.Logger);
    }

    var aiConfigured = !string.IsNullOrWhiteSpace(builder.Configuration["AI:ApiKey"]);
    var aiModel = builder.Configuration["AI:Model"] ?? "gpt-4o-mini";
    app.Logger.LogInformation(
        "POC Trust starting, environment {Env}; advisory AI {AiMode} (model {Model}); deterministic rules authoritative; VERIFY downgrade-proof.",
        app.Environment.EnvironmentName, aiConfigured ? "configured" : "stub/offline fallback", aiModel);
}

// Safety net: unhandled failures return a safe envelope, never exception text or stack traces.
// Registered before the endpoints so it also supersedes the development exception page.
app.UseExceptionHandler(errApp => errApp.Run(async ctx =>
{
    var error = ctx.Features.Get<IExceptionHandlerFeature>()?.Error;
    var status = error is ArgumentException
        ? StatusCodes.Status400BadRequest
        : StatusCodes.Status500InternalServerError;

    ctx.Response.StatusCode = status;
    ctx.Response.ContentType = "application/json";
    await ctx.Response.WriteAsJsonAsync(ApiError.Message(
        status == StatusCodes.Status400BadRequest
            ? "Invalid request."
            : "Unexpected server error. The request was not completed."));
}));

// Liveness probe for the packaged appliance / compose healthcheck.
app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));

app.UseMiddleware<ApiKeyAuthMiddleware>();
app.UseRateLimiter();

// Packaged single-container mode: when a built UI is present in wwwroot, the API serves it,
// one origin, one port, one command. In development wwwroot does not exist and this is a no-op,
// leaving the Vite dev server (5173 → proxy 5183) untouched.
var indexFile = Path.Combine(app.Environment.ContentRootPath, "wwwroot", "index.html");
var serveFrontend = builder.Configuration.GetValue("Frontend:Serve", true) && File.Exists(indexFile);
if (serveFrontend)
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
}

if (app.Environment.IsDevelopment())
    app.MapOpenApi();

app.UseCors();
app.MapControllers();

if (serveFrontend)
{
    // SPA fallback that keeps the API's JSON 404 contract: unknown /api routes never receive HTML.
    app.MapFallback(async ctx =>
    {
        if (ctx.Request.Path.StartsWithSegments("/api"))
        {
            ctx.Response.StatusCode = StatusCodes.Status404NotFound;
            ctx.Response.ContentType = "application/json";
            await ctx.Response.WriteAsJsonAsync(ApiError.Message("Unknown API endpoint."));
            return;
        }
        ctx.Response.ContentType = "text/html; charset=utf-8";
        await ctx.Response.SendFileAsync(indexFile);
    });
}

app.Run();
