using POCTrust.Core.Entities;
using POCTrust.Core.Enums;

namespace POCTrust.Core.Integrity;

/// <summary>
/// Derives a <see cref="ResultIntegrityRecord"/> from an already-decided assessment.
///
/// Hard rules for this class:
///  - It NEVER re-evaluates or re-interprets the decision. The disposition, action and rule
///    findings come straight from the stored record; the deterministic reliability engine is
///    not called.
///  - It is a pure function of the snapshot: the same stored assessment always projects the
///    same record (relative-time wording is anchored at the decision time, not "now").
///  - Evidence-quality states are classifications of the recorded evidence under the
///    demonstration policy. They are not medical rules, and they never override the engine.
/// </summary>
public static class ResultIntegrityProjector
{
    public const string RecordVersion = "rir-v1";

    /// <summary>Evidence-quality vocabulary (string-valued so the exported record is self-describing).</summary>
    public static class States
    {
        public const string Valid = "valid";
        public const string Aging = "aging";
        public const string Missing = "missing";
        public const string Stale = "stale";          // reserved: no current engine rule produces it
        public const string Expired = "expired";
        public const string Failed = "failed";
        public const string Conflicting = "conflicting";
        public const string UnverifiedSource = "unverified-source";
    }

    private const string Device = "device";
    private const string QualityControl = "quality-control";
    private const string Calibration = "calibration";
    private const string Operator = "operator";
    private const string Reagent = "reagent";
    private const string Environment = "environment";
    private const string Power = "power";
    private const string Connectivity = "connectivity";
    private const string Provenance = "provenance";
    private const string Maintenance = "maintenance";

    /// <summary>The domains this prototype's demonstration policy requires — exactly the rule
    /// families the deterministic engine evaluates (identity plus the six rule families).</summary>
    private static readonly string[] RequiredDomains =
        [Device, QualityControl, Calibration, Operator, Reagent, Environment, Provenance];

    private static readonly string[] ContextualRuleIds =
        ["CAL_NEAR_DUE", "CAL_EXPIRED", "REAGENT_NEAR_EXPIRY", "REAGENT_EXPIRED",
         "OPERATOR_NOT_COMPETENT", "ENV_TEMP", "ENV_HUMIDITY", "POWER_INTERRUPTION", "PROVENANCE_INCOMPLETE"];

    public static ResultIntegrityRecord Project(IntegrityDecisionSnapshot s)
    {
        var rules = new HashSet<string>(s.RuleIds ?? []);
        var input = s.Input;
        var now = s.DecidedAtUtc;

        var domains = BuildDomains(input, rules, now);
        var byKey = domains.ToDictionary(d => d.Domain, d => d);

        var coverageItems = RequiredDomains
            .Select(k => new CoverageItem(k, byKey[k].Label, byKey[k].Available, byKey[k].State))
            .ToList();
        var requiredAvailable = coverageItems.Count(i => i.Available);
        var coverage = new EvidenceCoverageSummary(
            requiredAvailable, RequiredDomains.Length,
            $"{requiredAvailable} / {RequiredDomains.Length} required domains available",
            coverageItems);

        var aging = domains.Count(d => d.State == States.Aging);
        var stale = domains.Count(d => d.State == States.Stale);
        var expired = domains.Count(d => d.State == States.Expired);
        var freshnessParts = new List<string>();
        if (aging > 0) freshnessParts.Add($"{aging} aging");
        if (stale > 0) freshnessParts.Add($"{stale} stale");
        if (expired > 0) freshnessParts.Add($"{expired} expired");
        var freshness = freshnessParts.Count == 0 ? "All current" : string.Join(", ", freshnessParts);

        var conflicts = rules.Contains("MULTI_CONTEXT")
            ? Math.Max(2, ContextualRuleIds.Count(rules.Contains))
            : 0;
        var consistency = conflicts == 0 ? "No conflicts" : $"{conflicts} conflict" + (conflicts == 1 ? "" : "s");

        var traceability = byKey[Provenance].State == States.Valid ? "Complete" : "Incomplete";

        return new ResultIntegrityRecord(
            RecordVersion,
            s.AssessmentId,
            input.Result,
            string.IsNullOrWhiteSpace(input.TestType) ? "Not recorded" : input.TestType,
            input.TimestampUtc,
            s.FinalStatus.ToString(),
            DispositionStatement(s.FinalStatus),
            new EvidenceQualitySummary(coverage, freshness, aging, stale, expired, consistency, conflicts, traceability),
            domains,
            DecisionDrivers(s),
            s.Action,
            Policy(),
            new IntegrityAiContext(
                s.AiConsulted,
                string.IsNullOrWhiteSpace(s.AiSummary) ? null : s.AiSummary,
                "advisory",
                "Advisory only — recorded for context. It never produces or changes the disposition."),
            s.Audit,
            "Operational integrity assessment generated from the evidence recorded at decision time. " +
            "It states whether operational reliance is supported under the configured demonstration policy — " +
            "it is not a measure of clinical validity.",
            now);
    }

    private static string DispositionStatement(ReliabilityStatus status) => status switch
    {
        ReliabilityStatus.Trust => "Evidence supports routine operational reliance.",
        ReliabilityStatus.Review => "Clinical reliance requires review.",
        ReliabilityStatus.Verify => "Result must not be relied upon without verification.",
        _ => "Hold for review.",
    };

    /// <summary>
    /// Decision drivers = the persisted deterministic reason sentences, with the "[RULE_ID] "
    /// prefix stripped and pipeline notes (AI consulted / AI unavailable) excluded — pipeline
    /// notes are not reasons the disposition rested on.
    /// </summary>
    private static IReadOnlyList<string> DecisionDrivers(IntegrityDecisionSnapshot s)
    {
        var drivers = new List<string>();
        foreach (var raw in s.Reasons ?? [])
        {
            if (string.IsNullOrWhiteSpace(raw)) continue;
            if (raw.StartsWith("AI ", StringComparison.Ordinal)) continue;
            var text = raw;
            if (text.StartsWith('['))
            {
                var close = text.IndexOf(']');
                if (close > 0 && close + 1 < text.Length && text[close + 1] == ' ')
                    text = text[(close + 2)..].Trim();
            }
            if (text.Length > 0) drivers.Add(text);
        }
        return drivers;
    }

    private static IReadOnlyList<IntegrityDomainEvidence> BuildDomains(
        DiagnosticContext input, HashSet<string> rules, DateTimeOffset now)
    {
        var list = new List<IntegrityDomainEvidence>(10);

        var deviceAvailable = !string.IsNullOrWhiteSpace(input.DeviceId);
        list.Add(new IntegrityDomainEvidence(
            Device, "Device identity", RequiredByPolicy: true, deviceAvailable,
            deviceAvailable ? States.Valid : States.Missing,
            "Event record", Recorded(input.TimestampUtc, now), ContributedToDecision: false,
            deviceAvailable ? "Recorded with the event." : "No device was recorded with the event."));

        // Rule-first classification: every quality state below comes from the rule IDs the engine
        // actually recorded at decision time — never re-derived from the raw input, so the
        // projection can never quietly re-decide a stored assessment.
        list.Add(new IntegrityDomainEvidence(
            QualityControl, "Quality control", RequiredByPolicy: true, Available: true,
            rules.Contains("QC_FAILED") ? States.Failed : States.Valid,
            "Device quality-control record", Recorded(input.TimestampUtc, now),
            rules.Contains("QC_FAILED"),
            rules.Contains("QC_FAILED")
                ? "A control explicitly failed — the engine applies a hard stop."
                : "A hard control — recorded as passed at event time."));

        var calState = rules.Contains("CAL_EXPIRED") ? States.Expired
            : rules.Contains("CAL_NEAR_DUE") ? States.Aging
            : States.Valid;
        list.Add(new IntegrityDomainEvidence(
            Calibration, "Calibration", RequiredByPolicy: true, Available: true, calState,
            "Calibration record", Recorded(input.TimestampUtc, now),
            rules.Contains("CAL_EXPIRED") || rules.Contains("CAL_NEAR_DUE"),
            calState switch
            {
                States.Expired => "Past its configured validity boundary.",
                States.Aging => "Valid, approaching the configured review boundary.",
                _ => "Within the configured review boundary.",
            }));

        var operatorAvailable = !string.IsNullOrWhiteSpace(input.OperatorId);
        var operatorState = !operatorAvailable ? States.Missing
            : rules.Contains("OPERATOR_NOT_COMPETENT") ? States.Expired
            : States.Valid;
        list.Add(new IntegrityDomainEvidence(
            Operator, "Operator competency", RequiredByPolicy: true, operatorAvailable, operatorState,
            "Operator competency record", Recorded(input.TimestampUtc, now),
            rules.Contains("OPERATOR_NOT_COMPETENT"),
            operatorState switch
            {
                States.Missing => "No operator was recorded with the event.",
                States.Expired => "Competency is not current per the operator record.",
                _ => "Competency current per the operator record.",
            }));

        var reagentAvailable = !string.IsNullOrWhiteSpace(input.ReagentLot);
        var reagentState = !reagentAvailable ? States.Missing
            : rules.Contains("REAGENT_EXPIRED") ? States.Expired
            : rules.Contains("REAGENT_NEAR_EXPIRY") ? States.Aging
            : States.Valid;
        list.Add(new IntegrityDomainEvidence(
            Reagent, "Reagent lot", RequiredByPolicy: true, reagentAvailable, reagentState,
            "Consumable record", Recorded(input.TimestampUtc, now),
            rules.Contains("REAGENT_EXPIRED") || rules.Contains("REAGENT_NEAR_EXPIRY"),
            reagentState switch
            {
                States.Missing => "No reagent lot was recorded with the event.",
                States.Expired => "Past its configured validity boundary.",
                States.Aging => "Valid, approaching the configured review boundary.",
                _ => "Within the configured review boundary.",
            }));

        var envFailed = rules.Contains("ENV_TEMP") || rules.Contains("ENV_HUMIDITY");
        var envNote = envFailed
            ? "Outside the configured demonstration ranges for this test."
            : "Inside the configured demonstration ranges.";
        if (rules.Contains("POWER_INTERRUPTION")) envNote += " Power interruption recorded with the event.";
        list.Add(new IntegrityDomainEvidence(
            Environment, "Environment", RequiredByPolicy: true, Available: true,
            envFailed ? States.Failed : States.Valid,
            "Site environment snapshot", Recorded(input.TimestampUtc, now),
            envFailed, envNote));

        var powerFailed = rules.Contains("POWER_INTERRUPTION");
        list.Add(new IntegrityDomainEvidence(
            Power, "Power", RequiredByPolicy: false, Available: true,
            powerFailed ? States.Failed : States.Valid,
            "Site environment snapshot", Recorded(input.TimestampUtc, now),
            powerFailed,
            powerFailed
                ? "A power interruption was recorded around the event. Monitored alongside the environment snapshot; not part of the coverage denominator in this policy."
                : "No interruption recorded. Monitored alongside the environment snapshot; not part of the coverage denominator in this policy."));

        var offline = (input.Connectivity ?? "online") == "offline";
        list.Add(new IntegrityDomainEvidence(
            Connectivity, "Connectivity", RequiredByPolicy: false, Available: true, States.Valid,
            "Event synchronisation metadata", Recorded(input.TimestampUtc, now), ContributedToDecision: false,
            offline
                ? "Event captured offline. Synchronisation metadata only — connectivity is not a reliability rule in this prototype."
                : "Event captured online. Synchronisation metadata only — connectivity is not a reliability rule in this prototype."));

        var provenanceAvailable = !string.IsNullOrWhiteSpace(input.Provenance);
        var provenanceState = !provenanceAvailable ? States.Missing
            : rules.Contains("PROVENANCE_INCOMPLETE") ? States.UnverifiedSource
            : States.Valid;
        list.Add(new IntegrityDomainEvidence(
            Provenance, "Provenance", RequiredByPolicy: true, provenanceAvailable, provenanceState,
            "Event provenance record", Recorded(input.TimestampUtc, now),
            rules.Contains("PROVENANCE_INCOMPLETE"),
            provenanceState switch
            {
                States.Missing => "No location or identity chain was recorded.",
                States.UnverifiedSource => "Recorded claims could not be fully verified against operator, reagent and location fields.",
                _ => "Operator, reagent and location recorded.",
            }));

        list.Add(new IntegrityDomainEvidence(
            Maintenance, "Maintenance", RequiredByPolicy: false, Available: false, States.Missing,
            "Not captured in this prototype", "Not recorded", ContributedToDecision: false,
            "Independent maintenance evidence is not captured in this prototype and is not required by the " +
            "selected demonstration policy, so it does not reduce coverage."));

        return list;
    }

    /// <summary>Deterministic relative wording, anchored at the decision time.</summary>
    private static string Recorded(DateTimeOffset? recordedUtc, DateTimeOffset decidedAtUtc)
    {
        if (recordedUtc is null) return "Not recorded";
        var days = (decidedAtUtc.Date - recordedUtc.Value.Date).Days;
        return days switch
        {
            <= 0 => "Recorded with the event",
            1 => "Recorded 1 day before the decision",
            _ => $"Recorded {days} days before the decision",
        };
    }

    private static IntegrityPolicy Policy() => new(
        "POC Trust demonstration policy",
        "demo-v1",
        "demonstration",
        "Prototype policy used for demonstration thresholds. It is configured, explicit and deterministic — " +
        "it is not a clinically validated universal requirement.",
        RequiredDomains,
        [
            new PolicyWindow(Calibration, "Review boundary", 7),
            new PolicyWindow(Reagent, "Near-expiry boundary", 14),
        ],
        [
            new PolicyRange("Temperature", 15, 30, "°C"),
            new PolicyRange("Humidity", 10, 85, "%"),
        ]);
}
