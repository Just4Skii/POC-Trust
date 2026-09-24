using POCTrust.Core.Entities;
using POCTrust.Core.Interfaces;

namespace POCTrust.Api.Services;

public sealed class AssessmentOrchestrator(IReliabilityEngine engine, IAIProvider ai, IAuditStore audit)
{
    public Task<ReliabilityDecision> EvaluateAsync(DiagnosticContext context, CancellationToken ct = default)
        => EvaluateAsync(context, null, ct);

    /// <param name="aiOverride">Optional advisory provider override (e.g. the built-in stub so
    /// demonstration seeding is offline-safe and reproducible). The deterministic engine and every
    /// safety invariant are unchanged — only the advisory summary source differs.</param>
    /// <param name="decidedAtUtc">Optional fixed decision instant for the demonstration decision
    /// history: the seeded sequence is recorded through this same real pipeline with historical
    /// timestamps, so the integrity timeline shows genuinely recorded evaluations. Ignored when it
    /// would be in the future (a decision can never be post-dated). Ordinary submissions are unaffected.</param>
    public async Task<ReliabilityDecision> EvaluateAsync(DiagnosticContext context, IAIProvider? aiOverride, CancellationToken ct = default, DateTimeOffset? decidedAtUtc = null)
    {
        // 1-2. receive + validate input
        ArgumentNullException.ThrowIfNull(context);
        if (string.IsNullOrWhiteSpace(context.Result)) throw new ArgumentException("Result is required.");
        var now = decidedAtUtc is { } fixedAt && fixedAt <= DateTimeOffset.UtcNow ? fixedAt : DateTimeOffset.UtcNow;

        // 3. evidence completeness is itself a rule (PROVENANCE_INCOMPLETE) — evaluated in engine
        // 4-5. deterministic engine + initial status
        var (initial, findings) = engine.EvaluateInitial(context, now);
        var reasons = findings.Select(f => $"[{f.RuleId}] {f.Reason}").ToList();

        // 6. determine whether AI is useful
        AIAssessment? assessment = null;
        var consulted = false;
        var finalStatus = initial;

        if (engine.NeedsAi(context, initial, findings, now))
        {
            try
            {
                // 7. optionally call AI with timeout guard
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(12));
                using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeout.Token);
                var raw = await (aiOverride ?? ai).AssessAsync(context, linked.Token);

                // 8. validate AI response (never trust authoritative status claims)
                assessment = ValidateAi(raw);
                consulted = true;
                reasons.Add("AI contextual assessment consulted.");
            }
            catch (Exception ex) when (ex is TimeoutException or TaskCanceledException or HttpRequestException or InvalidOperationException)
            {
                //  AI failure → deterministic result continues
                consulted = false;
                reasons.Add($"AI unavailable ({ex.GetType().Name}); deterministic result retained.");
            }
        }

        // 9. enforce deterministic safety constraints (VERIFY-locked)
        finalStatus = engine.EnforceFinalStatus(initial, assessment);

        // 10-11. final status + operational action
        var action = engine.BuildAction(finalStatus);

        var decision = new ReliabilityDecision(
            Guid.NewGuid(), initial, finalStatus, reasons,
            findings.Select(f => f.RuleId).ToList(), action,
            assessment, consulted, now);

        // 12-13. persist assessment + append-only audit
        await audit.SaveAsync(context, decision, ct);

        // 14. return structured response
        return decision;
    }

    public static AIAssessment? ValidateAi(AIAssessment? raw)
    {
        if (raw is null) return null;
        var summary = (raw.Summary ?? "").Trim();
        if (summary.Length < 40) return null;
        if (summary.Length > 2000) summary = summary[..2000];
        var anomalies = raw.Anomalies?.Where(a => !string.IsNullOrWhiteSpace(a)).Take(10).ToList() ?? [];
        var conf = double.IsNaN(raw.Confidence) ? 0.5 : Math.Clamp(raw.Confidence, 0, 1);
        return new AIAssessment(summary, anomalies, raw.RecommendedAction ?? "", conf, raw.Model ?? "unknown");
    }
}
