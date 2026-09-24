using System.Text.Json;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Formatters;
using Microsoft.EntityFrameworkCore;
using POCTrust.Api;
using POCTrust.Api.Services;
using POCTrust.Core.Interfaces;
using POCTrust.Core.Reliability;
using POCTrust.Infrastructure.AI;
using POCTrust.Infrastructure.Data;
using POCTrust.Infrastructure.Services;

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
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins("http://localhost:5173").AllowAnyHeader().AllowAnyMethod()));

builder.Services.AddDbContext<PocTrustDbContext>(o =>
    o.UseSqlite(builder.Configuration.GetConnectionString("Default") ?? "Data Source=poctrust.db"));

builder.Services.AddScoped<IReliabilityEngine, ReliabilityEngine>();
builder.Services.AddScoped<IAuditStore, EfAuditStore>();
builder.Services.AddScoped<AssessmentOrchestrator>();
builder.Services.AddHttpClient<IAIProvider, OpenAiCompatibleProvider>();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<PocTrustDbContext>();
    db.Database.EnsureCreated();
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

if (app.Environment.IsDevelopment())
    app.MapOpenApi();

app.UseCors();
app.MapControllers();

app.Run();
