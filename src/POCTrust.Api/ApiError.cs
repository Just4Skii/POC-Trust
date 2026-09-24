using System.Text.Json;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using POCTrust.Core.Entities;

namespace POCTrust.Api;

/// <summary>
/// Safe, client-facing error envelope: <c>{ "error": "...", "fields": ["..."] }</c>.
/// Never carries exception text, stack traces, file paths or binder internals.
/// </summary>
public sealed record ApiError(string Error, IReadOnlyList<string>? Fields = null)
{
    /// <summary>Field names the public contract actually exposes, in camelCase.</summary>
    private static readonly HashSet<string> KnownFields = typeof(DiagnosticContext)
        .GetProperties()
        .Select(p => JsonNamingPolicy.CamelCase.ConvertName(p.Name))
        .ToHashSet(StringComparer.OrdinalIgnoreCase);

    public static ApiError Message(string error) => new(error);

    /// <summary>
    /// Projects model-binding failures onto the public field contract. Binder keys such as
    /// <c>context</c> or JSON paths such as <c>$.result</c> are reduced to known field names;
    /// unknown or unusable keys are dropped instead of being echoed back to the client.
    /// </summary>
    public static ApiError From(string error, ModelStateDictionary modelState)
    {
        var fields = modelState.Keys
            .Select(Sanitise)
            .OfType<string>()
            .Where(KnownFields.Contains)
            .Select(f => char.ToLowerInvariant(f[0]) + f[1..])
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(f => f, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new ApiError(error, fields.Count == 0 ? null : fields);
    }

    private static string? Sanitise(string key)
    {
        var segment = key
            .Split('.', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .LastOrDefault(s => s.Length > 0 && char.IsLetter(s[0]));
        if (string.IsNullOrEmpty(segment)) return null;

        var cleaned = new string(segment.Where(char.IsLetterOrDigit).ToArray());
        return cleaned.Length == 0 ? null : cleaned;
    }
}
