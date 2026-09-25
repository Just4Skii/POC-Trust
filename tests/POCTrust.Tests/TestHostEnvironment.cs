using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;

namespace POCTrust.Tests;

/// <summary>Shared test double for the hosting environment, lets controller tests choose the
/// environment (Development guards, demo endpoints, seeding) without an ASP.NET host.</summary>
public sealed class TestHostEnvironment(string environmentName = "Development") : IHostEnvironment
{
    public string EnvironmentName { get; set; } = environmentName;
    public string ApplicationName { get; set; } = "tests";
    public string ContentRootPath { get; set; } = ".";
    public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
}
