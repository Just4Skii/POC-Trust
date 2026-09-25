using System.Security.Cryptography;
using System.Text;
using POCTrust.Api;

namespace POCTrust.Api.Security;

/// <summary>
/// Optional transport-level gate for a demonstration appliance (an auth STUB, not an identity
/// system). With <c>Auth:Mode</c> set to <c>apikey</c>, every mutating (/api POST/PUT/PATCH/DELETE)
/// request must carry <c>X-Api-Key</c> matching the configured value; reads stay open so the
/// decision-first UI and audit review remain observable. The default mode is <c>none</c>, which
/// changes nothing, the product honestly records that operator identifiers are claimed, not
/// authenticated.
///
/// Comparison is constant-time over SHA-256 digests so key comparison does not leak timing or
/// length. Rejections use the product's safe error envelope, never middleware internals.
/// </summary>
public sealed class ApiKeyAuthMiddleware(RequestDelegate next, IConfiguration config, ILogger<ApiKeyAuthMiddleware> logger)
{
    private const string HeaderName = "X-Api-Key";

    public async Task InvokeAsync(HttpContext context)
    {
        var mode = config["Auth:Mode"] ?? "none";
        var isApi = context.Request.Path.StartsWithSegments("/api");
        var mutating = HttpMethods.IsPost(context.Request.Method)
                       || HttpMethods.IsPut(context.Request.Method)
                       || HttpMethods.IsPatch(context.Request.Method)
                       || HttpMethods.IsDelete(context.Request.Method);

        if (mode == "apikey" && isApi && mutating)
        {
            var expected = config["Auth:ApiKey"] ?? "";
            var provided = context.Request.Headers[HeaderName].ToString();

            if (!Matches(expected, provided))
            {
                logger.LogInformation("Rejected mutating request without a valid API key ({Path}).", context.Request.Path);
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsJsonAsync(ApiError.Message(
                    $"Missing or invalid {HeaderName} for this protected deployment."));
                return;
            }
        }

        await next(context);
    }

    private static bool Matches(string expected, string provided)
    {
        if (expected.Length == 0) return false;
        var a = SHA256.HashData(Encoding.UTF8.GetBytes(expected));
        var b = SHA256.HashData(Encoding.UTF8.GetBytes(provided));
        return CryptographicOperations.FixedTimeEquals(a, b);
    }
}
