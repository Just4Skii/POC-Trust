using POCTrust.Core.Entities;

namespace POCTrust.Core.Integrity;

/// <summary>
/// The synthetic demonstration policies (spec sections 15–16).
///
/// Exactly two exist, both clearly synthetic, each defining:
///   • required evidence domains   → the coverage denominator;
///   • contextual evidence domains → monitored, but not required for coverage;
///   • demonstration freshness boundaries (mirroring the deterministic engine's configuration).
///
/// This is deliberately NOT a policy-authoring platform: no editors, no rule builders, no role
/// administration, no version management beyond a static version string. The policy states what
/// evidence is EXPECTED; the deterministic engine alone decides how evidence maps to the
/// disposition, and a policy can never override a rule outcome or give the AI any authority
/// (spec section 17: policy/context → deterministic rules → TRUST/REVIEW/VERIFY → optional AI).
/// </summary>
public static class DemonstrationPolicies
{
    public const string RuralId = "rural-phc-demo";
    public const string GeneralId = "general-poc-demo";
    public const string Version = "demo-v1";

    private static readonly string[] RuralRequired =
        ["device", "quality-control", "calibration", "operator", "reagent", "provenance"];

    private static readonly string[] GeneralRequired =
        ["device", "quality-control", "calibration", "operator", "reagent", "environment", "provenance"];

    private static readonly string[] RuralContextual = ["environment", "power", "connectivity"];
    private static readonly string[] GeneralContextual = ["power", "connectivity"];

    public static IntegrityPolicy Rural { get; } = new(
        Name: "Rural PHC POC Test",
        Version: Version,
        Kind: "demonstration",
        Note: "A synthetic demonstration policy for a rural primary-care point-of-care programme. " +
              "It states which evidence the assessment expects; the deterministic engine alone maps " +
              "that evidence to the disposition. Environment, power and connectivity are monitored as " +
              "contextual evidence, when the recorded environment snapshot sits outside the supported " +
              "ranges, the deterministic engine still raises a review-level concern. Configured, " +
              "explicit and deterministic; not a clinically validated requirement.",
        RequiredDomains: RuralRequired,
        FreshnessWindows:
        [
            new PolicyWindow("calibration", "Review boundary", 7),
            new PolicyWindow("reagent", "Near-expiry boundary", 14),
        ],
        SupportedEnvironment:
        [
            new PolicyRange("Temperature", 15, 30, "°C"),
            new PolicyRange("Humidity", 10, 85, "%"),
        ],
        Id: RuralId,
        ContextualDomains: RuralContextual,
        SelectionNote: "Selected because the event's recorded provenance identifies a rural PHC site. " +
                       "The site-to-policy mapping is fixed demonstration configuration, applied deterministically.");

    public static IntegrityPolicy General { get; } = new(
        Name: "General POC Demonstration",
        Version: Version,
        Kind: "demonstration",
        Note: "The default synthetic demonstration policy: the seven evidence families the " +
              "deterministic engine evaluates, with environment required for full coverage. Power and " +
              "connectivity are monitored as contextual evidence. It states which evidence the " +
              "assessment expects; the deterministic engine alone maps that evidence to the " +
              "disposition. Configured, explicit and deterministic; not a clinically validated requirement.",
        RequiredDomains: GeneralRequired,
        FreshnessWindows:
        [
            new PolicyWindow("calibration", "Review boundary", 7),
            new PolicyWindow("reagent", "Near-expiry boundary", 14),
        ],
        SupportedEnvironment:
        [
            new PolicyRange("Temperature", 15, 30, "°C"),
            new PolicyRange("Humidity", 10, 85, "%"),
        ],
        Id: GeneralId,
        ContextualDomains: GeneralContextual,
        SelectionNote: "Selected because the event's recorded provenance does not identify a rural PHC " +
                       "site; the general demonstration policy applies. The mapping is fixed " +
                       "demonstration configuration, applied deterministically.");

    /// <summary>
    /// Deterministic policy selection. The demonstration site registry recognises rural PHC sites
    /// by the site marker recorded in the event's provenance chain ("rural", or the demonstration
    /// rural site name). Every other recorded site falls under the general demonstration policy.
    /// The rule is fixed configuration, disclosed in the policy's SelectionNote, never inferred
    /// by an AI and never used to alter any rule outcome.
    /// </summary>
    public static IntegrityPolicy SelectFor(DiagnosticContext input)
    {
        var site = input.Provenance ?? string.Empty;
        var rural = site.Contains("rural", StringComparison.OrdinalIgnoreCase)
            || site.Contains("north coast", StringComparison.OrdinalIgnoreCase);
        return rural ? Rural : General;
    }
}
