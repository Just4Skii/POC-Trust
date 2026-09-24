using Microsoft.EntityFrameworkCore;
using POCTrust.Api.Services;
using POCTrust.Core.Interfaces;
using POCTrust.Core.Reliability;
using POCTrust.Infrastructure.AI;
using POCTrust.Infrastructure.Data;
using POCTrust.Infrastructure.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
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

if (app.Environment.IsDevelopment())
    app.MapOpenApi();

app.UseCors();
app.MapControllers();

app.Run();
