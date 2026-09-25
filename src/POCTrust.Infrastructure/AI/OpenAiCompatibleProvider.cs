using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using POCTrust.Core.Entities;
using POCTrust.Core.Interfaces;

namespace POCTrust.Infrastructure.AI;

public sealed class OpenAiCompatibleProvider(HttpClient http, IConfiguration config) : IAIProvider
{
    public async Task<AIAssessment> AssessAsync(DiagnosticContext c, CancellationToken ct = default)
    {
        var apiKey = config["AI:ApiKey"];
        var endpoint = config["AI:Endpoint"] ?? "https://api.openai.com/v1/chat/completions";
        var model = config["AI:Model"] ?? "gpt-4o-mini";

        if (string.IsNullOrWhiteSpace(apiKey))
            return await new StubAiProvider().AssessAsync(c, ct);

        var prompt = $"""
            You are a point-of-care testing reliability assistant. Do NOT diagnose, predict disease, or recommend treatment.
            Assess contextual reliability only. Evidence:
            Test={c.TestType} Result={c.Result}, Device={c.DeviceId} QCpassed={c.QcPassed},
            CalibrationDue={c.CalibrationDueUtc:O}, Operator={c.OperatorId} competent={c.OperatorCompetent},
            Reagent={c.ReagentLot} expiry={c.ReagentExpiryUtc:O}, Temp={c.TemperatureC}°C Humidity={c.HumidityPct}% PowerInterrupt={c.PowerInterruption},
            Connectivity={c.Connectivity} Time={c.TimestampUtc:O}.
            Reply in 2-3 sentences, reliability only. Do NOT output TRUST/REVIEW/VERIFY as your decision.
            """;

        var payload = JsonSerializer.Serialize(new
        {
            model,
            messages = new[]
            {
                new { role = "system", content = "You are a point-of-care testing reliability assistant. Write complete sentences only. Never output fragments." },
                new { role = "user", content = prompt },
            },
            max_tokens = 500,
            temperature = 0.2
        });

        // One bounded retry for transient provider failures (429/5xx): free-tier
        // rate limits often clear within seconds. Anything else, or a second
        // failure, propagates so the orchestrator falls back deterministically.
        // Total extra wait stays well inside the orchestrator's safety budget.
        async Task<HttpResponseMessage> SendWithOneRetryAsync()
        {
            static HttpRequestMessage Build(string key, string uri, string json)
            {
                var message = new HttpRequestMessage(HttpMethod.Post, uri);
                message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
                message.Content = new StringContent(json, Encoding.UTF8, "application/json");
                return message;
            }

            try
            {
                using var first = await http.SendAsync(Build(apiKey, endpoint, payload), ct);
                if ((int)first.StatusCode is not (429 or >= 500 and <= 599))
                    return first;
                first.Dispose();
            }
            catch (HttpRequestException ex) when (ex.StatusCode is System.Net.HttpStatusCode.TooManyRequests
                or >= System.Net.HttpStatusCode.InternalServerError and <= (System.Net.HttpStatusCode)599)
            {
                // fall through to the single retry below
            }

            await Task.Delay(TimeSpan.FromSeconds(3), ct);
            return await http.SendAsync(Build(apiKey, endpoint, payload), ct);
        }

        using var res = await SendWithOneRetryAsync();
        res.EnsureSuccessStatusCode();
        var json = await res.Content.ReadAsStringAsync(ct);
        string text;
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.TryGetProperty("choices", out var choices) && choices.GetArrayLength() > 0)
            {
                var first = choices[0];
                // A choice without usable content (e.g. finish_reason=length with no
                // message content) is malformed, never serialize the raw choice
                // object as a summary; the orchestrator falls back deterministically.
                if (first.TryGetProperty("message", out var msg)
                    && msg.TryGetProperty("content", out var content)
                    && content.ValueKind == JsonValueKind.String)
                    text = content.GetString() ?? "";
                else if (first.TryGetProperty("text", out var t) && t.ValueKind == JsonValueKind.String)
                    text = t.GetString() ?? "";
                else
                    throw new InvalidOperationException("AI provider returned no message content.");
            }
            else if (root.TryGetProperty("candidates", out var cands) && cands.GetArrayLength() > 0)
            {
                // Native Gemini shape fallback
                var parts = cands[0].GetProperty("content").GetProperty("parts");
                text = string.Join(" ", parts.EnumerateArray().Select(p => p.GetProperty("text").GetString()));
            }
            else
            {
                text = "";
            }
        }
        catch (Exception ex) when (ex is JsonException or KeyNotFoundException or IndexOutOfRangeException)
        {
            throw new InvalidOperationException("Malformed AI provider response.", ex);
        }
        if (string.IsNullOrWhiteSpace(text)) throw new InvalidOperationException("Empty AI provider response.");

        return new AIAssessment(text.Trim(), [], "See summary; deterministic rules remain authoritative.", 0.7, model);
    }
}
