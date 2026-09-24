using POCTrust.Core.Entities;
using POCTrust.Core.Enums;
using POCTrust.Core.Interfaces;

namespace POCTrust.Core.Integrity;

/// <summary>
/// Derives a <see cref="ResultIntegrityRecord"/> from an already-decided assessment.
///
/// Hard rules for this class:
///  - The STORED decision is never re-decided or re-interpreted. The disposition, action and rule
///    findings come straight from the persisted record.
///  - It is a pure function of the snapshot: the same stored assessment always projects the same
///    record (relative-time wording is anchored at the decision time, not "now").
///  - The ONE exception is the disclosed decision-causality re-derivation: when an engine is
///    supplied, the SAME deterministic rules are re-run on the SAME stored input at the SAME
///    decision instant. That re-run must reproduce the stored decision exactly (status AND rule
///    IDs) before any of its classifications (primary/secondary roles, the single rule-based
///    counterfactual) are shown. It therefore can never quietly replace the stored decision —
///    and the counterfactual is always labelled, never a probability, never clinical.
///  - Evidence-quality states are classifications of the recorded evidence under the selected
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

    /// <summary>The deterministic rule IDs that involve each evidence domain (from the frozen engine).</summary>
    private static readonly Dictionary<string, string[]> DomainRules = new()
    {
        [Device] = [],
        [QualityControl] = ["QC_FAILED"],
        [Calibration] = ["CAL_NEAR_DUE", "CAL_EXPIRED"],
        [Operator] = ["OPERATOR_NOT_COMPETENT"],
        [Reagent] = ["REAGENT_NEAR_EXPIRY", "REAGENT_EXPIRED"],
        [Environment] = ["ENV_TEMP", "ENV_HUMIDITY"],
        [Power] = ["POWER_INTERRUPTION"],
        [Connectivity] = [],
        [Provenance] = ["PROVENANCE_INCOMPLETE"],
        [Maintenance] = [],
    };

    private static (string Domain, string Label) DomainOf(string ruleId) => ruleId switch
    {
        "QC_FAILED" => (QualityControl, "Quality control"),
        "CAL_EXPIRED" or "CAL_NEAR_DUE" => (Calibration, "Calibration"),
        "REAGENT_EXPIRED" or "REAGENT_NEAR_EXPIRY" => (Reagent, "Reagent lot"),
        "OPERATOR_NOT_COMPETENT" => (Operator, "Operator competency"),
        "ENV_TEMP" or "ENV_HUMIDITY" => (Environment, "Environment"),
        "POWER_INTERRUPTION" => (Power, "Power"),
        "PROVENANCE_INCOMPLETE" => (Provenance, "Provenance"),
        _ => ("", "Multiple evidence sources"),
    };

    public static ResultIntegrityRecord Project(IntegrityDecisionSnapshot s, IReliabilityEngine? engine = null)
    {
        var rules = new HashSet<string>(s.RuleIds ?? []);
        var input = s.Input;
        var now = s.DecidedAtUtc;
        var policy = DemonstrationPolicies.SelectFor(input);

        var domains = BuildDomains(input, rules, policy, now);
        var byKey = domains.ToDictionary(d => d.Domain, d => d);

        // Coverage is policy-driven: the denominator is exactly what the selected policy requires.
        var coverageItems = policy.RequiredDomains
            .Select(k => new CoverageItem(k, byKey[k].Label, byKey[k].Available, byKey[k].State))
            .ToList();
        var requiredAvailable = coverageItems.Count(i => i.Available);
        var coverage = new EvidenceCoverageSummary(
            requiredAvailable, policy.RequiredDomains.Count,
            $"{requiredAvailable} / {policy.RequiredDomains.Count} required domains available",
            coverageItems);

        var aging = domains.Count(d => d.State == States.Aging);
        var stale = domains.Count(d => d.State == States.Stale);
        var expired = domains.Count(d => d.State == States.Expired);
        var freshnessParts = new List<string>();
        if (aging > 0) freshnessParts.Add($"{aging} aging");
        if (stale > 0) freshnessParts.Add($"{stale} stale");
        if (expired > 0) freshnessParts.Add($"{expired} expired");
        var freshness = freshnessParts.Count == 0 ? "All current" : string.Join(", ", freshnessParts);

        var conflicts = BuildConflicts(input, rules, byKey);
        var conflictCount = conflicts.Count;
        var consistency = conflictCount == 0 ? "No conflicts" : $"{conflictCount} conflict" + (conflictCount == 1 ? "" : "s");

        var traceability = byKey[Provenance].State == States.Valid ? "Complete" : "Incomplete";

        var causality = BuildCausality(s, domains, engine);

        return new ResultIntegrityRecord(
            RecordVersion,
            s.AssessmentId,
            input.Result,
            string.IsNullOrWhiteSpace(input.TestType) ? "Not recorded" : input.TestType,
            input.TimestampUtc,
            s.FinalStatus.ToString(),
            DispositionStatement(s.FinalStatus),
            new EvidenceQualitySummary(coverage, freshness, aging, stale, expired, consistency, conflictCount, traceability),
            domains,
            DecisionDrivers(s),
            s.Action,
            policy,
            new IntegrityAiContext(
                s.AiConsulted,
                string.IsNullOrWhiteSpace(s.AiSummary) ? null : s.AiSummary,
                "advisory",
                "Advisory only — recorded for context. It never produces or changes the disposition."),
            s.Audit,
            "Operational integrity assessment generated from the evidence recorded at decision time. " +
            "It states whether operational reliance is supported under the configured demonstration policy — " +
            "it is not a measure of clinical validity.",
            now,
            causality,
            conflicts,
            BuildTimeline(s));
    }

    private static string DispositionStatement(ReliabilityStatus status) => status switch
    {
        ReliabilityStatus.Trust => "Evidence supports routine operational reliance.",
        ReliabilityStatus.Review => "Clinical reliance requires review.",
        ReliabilityStatus.Verify => "Result must not be relied upon without verification.",
        _ => "Hold for review.",
    };

    /// <summary>
    /// Decision drivers (sentence form) = the persisted deterministic reason sentences, with the
    /// "[RULE_ID] " prefix stripped and pipeline notes (AI consulted / AI unavailable) excluded —
    /// pipeline notes are not reasons the disposition rested on. The structured, role-classified
    /// form lives in <see cref="DecisionCausality"/>.
    /// </summary>
    private static IReadOnlyList<string> DecisionDrivers(IntegrityDecisionSnapshot s)
    {
        var drivers = new List<string>();
        foreach (var raw in s.Reasons ?? [])
        {
            if (string.IsNullOrWhiteSpace(raw)) continue;
            if (raw.StartsWith("AI ", StringComparison.Ordinal)) continue;
            var text = StripRulePrefix(raw);
            if (text.Length > 0) drivers.Add(text);
        }
        return drivers;
    }

    private static string StripRulePrefix(string raw)
    {
        var text = raw;
        if (text.StartsWith('['))
        {
            var close = text.IndexOf(']');
            if (close > 0 && close + 1 < text.Length && text[close + 1] == ' ')
                text = text[(close + 2)..].Trim();
        }
        return text;
    }

    // ── Evidence domains ─────────────────────────────────────────────────────────

    private static IReadOnlyList<IntegrityDomainEvidence> BuildDomains(
        DiagnosticContext input, HashSet<string> rules, IntegrityPolicy policy, DateTimeOffset now)
    {
        var list = new List<IntegrityDomainEvidence>(10);
        var required = new HashSet<string>(policy.RequiredDomains);
        var eventRef = string.IsNullOrWhiteSpace(input.LocalEventId) ? null : input.LocalEventId;

        var deviceAvailable = !string.IsNullOrWhiteSpace(input.DeviceId);
        list.Add(new IntegrityDomainEvidence(
            Device, "Device identity", required.Contains(Device), deviceAvailable,
            deviceAvailable ? States.Valid : States.Missing,
            "Event record", Recorded(input.TimestampUtc, now), ContributedToDecision: false,
            deviceAvailable ? "Recorded with the event." : "No device was recorded with the event.",
            SourceIdentifier: input.DeviceId,
            Verification: "Device identity as recorded with the event. Device-registry authentication is not part of this prototype.",
            RecordReference: eventRef,
            RelatedRuleIds: DomainRules[Device].Where(rules.Contains).ToArray()));

        // Rule-first classification: every quality state below comes from the rule IDs the engine
        // actually recorded at decision time — never re-derived from the raw input, so the
        // projection can never quietly re-decide a stored assessment.
        list.Add(new IntegrityDomainEvidence(
            QualityControl, "Quality control", required.Contains(QualityControl), Available: true,
            rules.Contains("QC_FAILED") ? States.Failed : States.Valid,
            "Device quality-control record", Recorded(input.TimestampUtc, now),
            rules.Contains("QC_FAILED"),
            rules.Contains("QC_FAILED")
                ? "A control explicitly failed — the engine applies a hard stop."
                : "A hard control — recorded as passed at event time.",
            SourceIdentifier: input.DeviceId,
            Verification: "Recorded QC outcome as captured with the event; QC records are taken at face value in this prototype.",
            RecordReference: eventRef,
            RelatedRuleIds: DomainRules[QualityControl].Where(rules.Contains).ToArray()));

        var calState = rules.Contains("CAL_EXPIRED") ? States.Expired
            : rules.Contains("CAL_NEAR_DUE") ? States.Aging
            : States.Valid;
        list.Add(new IntegrityDomainEvidence(
            Calibration, "Calibration", required.Contains(Calibration), Available: true, calState,
            "Calibration record", Recorded(input.TimestampUtc, now),
            rules.Contains("CAL_EXPIRED") || rules.Contains("CAL_NEAR_DUE"),
            calState switch
            {
                States.Expired => "Past its configured validity boundary.",
                States.Aging => "Valid, approaching the configured review boundary.",
                _ => "Within the configured review boundary.",
            },
            SourceIdentifier: null,
            Verification: "Boundary evaluated against the configured policy window at the recorded decision time. No separate calibration record identifier is captured in this prototype.",
            RecordReference: eventRef,
            RelatedRuleIds: DomainRules[Calibration].Where(rules.Contains).ToArray()));

        var operatorAvailable = !string.IsNullOrWhiteSpace(input.OperatorId);
        var operatorState = !operatorAvailable ? States.Missing
            : rules.Contains("OPERATOR_NOT_COMPETENT") ? States.Expired
            : States.Valid;
        list.Add(new IntegrityDomainEvidence(
            Operator, "Operator competency", required.Contains(Operator), operatorAvailable, operatorState,
            "Operator competency record", Recorded(input.TimestampUtc, now),
            rules.Contains("OPERATOR_NOT_COMPETENT"),
            operatorState switch
            {
                States.Missing => "No operator was recorded with the event.",
                States.Expired => "Competency is not current per the operator record.",
                _ => "Competency current per the operator record.",
            },
            SourceIdentifier: operatorAvailable ? input.OperatorId : null,
            Verification: operatorAvailable
                ? "Operator ID as claimed — competency is taken from the operator record; identity authentication is not part of this prototype."
                : "No operator was recorded, so there is nothing to verify.",
            RecordReference: eventRef,
            RelatedRuleIds: DomainRules[Operator].Where(rules.Contains).ToArray()));

        var reagentAvailable = !string.IsNullOrWhiteSpace(input.ReagentLot);
        var reagentState = !reagentAvailable ? States.Missing
            : rules.Contains("REAGENT_EXPIRED") ? States.Expired
            : rules.Contains("REAGENT_NEAR_EXPIRY") ? States.Aging
            : States.Valid;
        list.Add(new IntegrityDomainEvidence(
            Reagent, "Reagent lot", required.Contains(Reagent), reagentAvailable, reagentState,
            "Consumable record", Recorded(input.TimestampUtc, now),
            rules.Contains("REAGENT_EXPIRED") || rules.Contains("REAGENT_NEAR_EXPIRY"),
            reagentState switch
            {
                States.Missing => "No reagent lot was recorded with the event.",
                States.Expired => "Past its configured validity boundary.",
                States.Aging => "Valid, approaching the configured review boundary.",
                _ => "Within the configured review boundary.",
            },
            SourceIdentifier: reagentAvailable ? input.ReagentLot : null,
            Verification: "Lot identity as recorded with the event; lot genealogy tracking is not part of this prototype.",
            RecordReference: eventRef,
            RelatedRuleIds: DomainRules[Reagent].Where(rules.Contains).ToArray()));

        var envFailed = rules.Contains("ENV_TEMP") || rules.Contains("ENV_HUMIDITY");
        var envNote = envFailed
            ? "Outside the configured demonstration ranges for this test."
            : "Inside the configured demonstration ranges.";
        if (rules.Contains("POWER_INTERRUPTION")) envNote += " Power interruption recorded with the event.";
        if (!required.Contains(Environment))
            envNote += " Environment is a contextual domain under the selected policy — monitored, but not counted in the coverage denominator.";
        list.Add(new IntegrityDomainEvidence(
            Environment, "Environment", required.Contains(Environment), Available: true,
            envFailed ? States.Failed : States.Valid,
            "Site environment snapshot", Recorded(input.TimestampUtc, now),
            envFailed, envNote,
            SourceIdentifier: null,
            Verification: "Snapshot values as recorded with the event; independent sensor attestation is not part of this prototype.",
            RecordReference: eventRef,
            RelatedRuleIds: DomainRules[Environment].Where(rules.Contains).ToArray()));

        var powerFailed = rules.Contains("POWER_INTERRUPTION");
        list.Add(new IntegrityDomainEvidence(
            Power, "Power", required.Contains(Power), Available: true,
            powerFailed ? States.Failed : States.Valid,
            "Site environment snapshot", Recorded(input.TimestampUtc, now),
            powerFailed,
            powerFailed
                ? "A power interruption was recorded around the event. Monitored alongside the environment snapshot; not part of the coverage denominator in this policy."
                : "No interruption recorded. Monitored alongside the environment snapshot; not part of the coverage denominator in this policy.",
            SourceIdentifier: null,
            Verification: "Recorded with the site environment snapshot; no independent power telemetry exists in this prototype.",
            RecordReference: eventRef,
            RelatedRuleIds: DomainRules[Power].Where(rules.Contains).ToArray()));

        var offline = (input.Connectivity ?? "online") == "offline";
        list.Add(new IntegrityDomainEvidence(
            Connectivity, "Connectivity", required.Contains(Connectivity), Available: true, States.Valid,
            "Event synchronisation metadata", Recorded(input.TimestampUtc, now), ContributedToDecision: false,
            offline
                ? "Event captured offline. Synchronisation metadata only — connectivity is not a reliability rule in this prototype."
                : "Event captured online. Synchronisation metadata only — connectivity is not a reliability rule in this prototype.",
            SourceIdentifier: offline ? "Offline capture" : "Online capture",
            Verification: "Synchronisation metadata as recorded by the capturing client.",
            RecordReference: eventRef,
            RelatedRuleIds: []));

        var provenanceAvailable = !string.IsNullOrWhiteSpace(input.Provenance);
        var provenanceState = !provenanceAvailable ? States.Missing
            : rules.Contains("PROVENANCE_INCOMPLETE") ? States.UnverifiedSource
            : States.Valid;
        list.Add(new IntegrityDomainEvidence(
            Provenance, "Provenance", required.Contains(Provenance), provenanceAvailable, provenanceState,
            "Event provenance record", Recorded(input.TimestampUtc, now),
            rules.Contains("PROVENANCE_INCOMPLETE"),
            provenanceState switch
            {
                States.Missing => "No location or identity chain was recorded.",
                States.UnverifiedSource => "Recorded claims could not be fully verified against operator, reagent and location fields.",
                _ => "Operator, reagent and location recorded.",
            },
            SourceIdentifier: provenanceAvailable ? Truncate(input.Provenance!, 64) : null,
            Verification: provenanceState switch
            {
                States.Valid => "Operator, reagent and location claims recorded and mutually consistent. Claims are as recorded — identity authentication is not part of this prototype.",
                States.UnverifiedSource => "Recorded claims could not be fully verified — treated as an unverified source, not as an authenticated identity.",
                _ => "No provenance chain recorded.",
            },
            RecordReference: eventRef,
            RelatedRuleIds: DomainRules[Provenance].Where(rules.Contains).ToArray()));

        list.Add(new IntegrityDomainEvidence(
            Maintenance, "Maintenance", required.Contains(Maintenance), Available: false, States.Missing,
            "Not captured in this prototype", "Not recorded", ContributedToDecision: false,
            "Independent maintenance evidence is not captured in this prototype and is not required by the " +
            "selected demonstration policy, so it does not reduce coverage.",
            SourceIdentifier: null,
            Verification: "Not captured in this prototype.",
            RelatedRuleIds: []));

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

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..(max - 1)] + "…";

    // ── Evidence conflicts (spec section 10) ─────────────────────────────────────

    /// <summary>
    /// Detected inconsistencies between two recorded evidence sources. The application has
    /// detected an EVIDENCE INCONSISTENCY — it has not discovered a clinical truth. Every conflict
    /// below is derived from the stored rule IDs and recorded values; none is invented.
    /// </summary>
    private static IReadOnlyList<EvidenceConflict> BuildConflicts(
        DiagnosticContext input, HashSet<string> rules, Dictionary<string, IntegrityDomainEvidence> byKey)
    {
        var list = new List<EvidenceConflict>();
        string StateOf(string domain) =>
            byKey.TryGetValue(domain, out var row) ? row.State.ToUpperInvariant().Replace("-", " ") : "UNKNOWN";

        var envFailed = rules.Contains("ENV_TEMP") || rules.Contains("ENV_HUMIDITY");
        if (envFailed && input.QcPassed)
        {
            var envRules = string.Join(", ", new[] { "ENV_TEMP", "ENV_HUMIDITY" }.Where(rules.Contains));
            list.Add(new EvidenceConflict(
                "Device quality-control record",
                StateOf(QualityControl),
                "Site environment snapshot",
                StateOf(Environment),
                "Quality control was recorded as passed while the environment snapshot sits outside the policy's supported operating ranges.",
                "Control validity depends on the operating context. The record treats this as an evidence inconsistency about the operating context — the deterministic engine raises a review-level concern rather than accepting either source alone.",
                envRules));
        }

        if (rules.Contains("MULTI_CONTEXT"))
        {
            var contributing = rules
                .Where(r => r is not ("MULTI_CONTEXT" or "ALL_CHECKS_PASS"))
                .Where(r => DomainOf(r).Domain != "")
                .Select(r => DomainOf(r))
                .Distinct()
                .ToList();
            var a = contributing.Count > 0 ? contributing[0] : ("", "Multiple evidence sources");
            var b = contributing.Count > 1 ? contributing[1] : a;
            list.Add(new EvidenceConflict(
                a.Item2, StateOf(a.Item1),
                b.Item2, StateOf(b.Item1),
                "Multiple recorded evidence sources raise separate concerns about the same operating context.",
                "Concerns recorded together can share a cause or compound each other. The deterministic engine flags interaction review when two or more contextual concerns are present — an inconsistency of context, not a clinical finding.",
                "MULTI_CONTEXT"));
        }

        return list;
    }

    // ── Decision causality (spec section 12) + counterfactual (section 14) ──────

    /// <summary>
    /// WHY did the disposition occur — derived from the engine's recorded findings. The engine is
    /// re-run ONLY as a gated verification: the re-run must reproduce the stored decision exactly
    /// before any role classification is shown. Roles are primary / secondary / informational —
    /// never numeric weights, which do not exist in this system.
    /// </summary>
    private static DecisionCausality BuildCausality(
        IntegrityDecisionSnapshot s, IReadOnlyList<IntegrityDomainEvidence> domains, IReliabilityEngine? engine)
    {
        var storedRules = s.RuleIds ?? [];
        List<RuleFinding>? findings = null;
        var verified = false;

        if (engine is not null)
        {
            try
            {
                var (status, computed) = engine.EvaluateInitial(s.Input, s.DecidedAtUtc);
                verified = status == s.FinalStatus
                    && computed.Select(f => f.RuleId).SequenceEqual(storedRules);
                if (verified) findings = computed;
            }
            catch
            {
                verified = false;
            }
        }

        var byDomain = domains.ToDictionary(d => d.Domain, d => d);
        DecisionDriver DriverFor(RuleFinding f, string role)
        {
            var (dom, label) = DomainOf(f.RuleId);
            var state = byDomain.TryGetValue(dom, out var row) ? row.State : States.Valid;
            return new DecisionDriver(f.RuleId, f.Reason, dom, label, state, role);
        }

        if (!verified || findings is null)
        {
            return new DecisionCausality(
                [], [], [],
                Counterfactual: null,
                DerivationNote: "Deterministic re-derivation was not available for this record, so no driver roles are asserted. The recorded reason sentences under Decision drivers remain the source of truth.",
                Verified: false);
        }

        var primary = findings
            .Where(f => f.Severity == s.FinalStatus && f.RuleId is not ("MULTI_CONTEXT" or "ALL_CHECKS_PASS"))
            .Select(f => DriverFor(f, "primary"))
            .ToList();
        var secondary = findings
            .Where(f => f.Severity < s.FinalStatus || f.RuleId == "MULTI_CONTEXT")
            .Where(f => f.RuleId != "ALL_CHECKS_PASS")
            .Select(f => DriverFor(f, "secondary"))
            .ToList();

        // Informational context: evidence that was valid and did NOT drive the decision.
        var contextual = new List<DecisionDriver>();
        var allPass = findings.FirstOrDefault(f => f.RuleId == "ALL_CHECKS_PASS");
        if (allPass is not null)
            contextual.Add(new DecisionDriver("ALL_CHECKS_PASS", allPass.Reason, "", "Deterministic checks", States.Valid, "informational"));
        foreach (var domain in new[] { Device, Environment, Power, Connectivity, Provenance })
        {
            if (!byDomain.TryGetValue(domain, out var row)) continue;
            if (!row.Available || row.State != States.Valid || row.ContributedToDecision) continue;
            contextual.Add(new DecisionDriver("", $"{row.Label} evidence is valid.", row.Domain, row.Label, row.State, "informational"));
        }

        var counterfactual = verified && engine is not null
            ? BuildCounterfactual(s, primary, engine)
            : null;
        var note = counterfactual is not null
            ? "Roles derived from the engine's recorded findings; the re-derivation reproduced the stored decision exactly. The counterfactual is a rule-based comparison, not a prediction."
            : "Roles derived from the engine's recorded findings; the re-derivation reproduced the stored decision exactly.";

        return new DecisionCausality(primary, secondary, contextual, counterfactual, note, true);
    }

    /// <summary>
    /// ONE simple deterministic counterfactual, only where the rule dependency is obvious:
    /// exactly one primary driver, that driver has a well-defined "made current" mutation, no
    /// failed hard control anywhere, and the mutation actually changes the outcome. The mutated
    /// context is re-evaluated by the SAME deterministic engine at the SAME decision instant.
    /// Never an LLM output, never a probability, never clinical prediction.
    /// </summary>
    private static CounterfactualComparison? BuildCounterfactual(
        IntegrityDecisionSnapshot s, List<DecisionDriver> primary, IReliabilityEngine engine)
    {
        if (primary.Count != 1) return null;                       // no single obvious dependency
        var storedRules = s.RuleIds ?? [];
        if (storedRules.Contains("QC_FAILED")) return null;        // never suggest bypassing a failed hard control

        var input = s.Input;
        var at = s.DecidedAtUtc;

        (DiagnosticContext Mutated, string Phrase, string Changed)? plan = primary[0].RuleId switch
        {
            "CAL_EXPIRED" => (input with { CalibrationDueUtc = at.AddDays(30) },
                "calibration evidence were current", "Calibration"),
            "CAL_NEAR_DUE" => (input with { CalibrationDueUtc = at.AddDays(30) },
                "calibration evidence were current (beyond its review window)", "Calibration"),
            "REAGENT_EXPIRED" => (input with { ReagentExpiryUtc = at.AddDays(30) },
                "reagent evidence were current", "Reagent"),
            "REAGENT_NEAR_EXPIRY" => (input with { ReagentExpiryUtc = at.AddDays(30) },
                "reagent evidence were current (beyond its near-expiry boundary)", "Reagent"),
            "OPERATOR_NOT_COMPETENT" => (input with { OperatorCompetent = true },
                "operator competency evidence were current", "Operator competency"),
            "ENV_TEMP" => (input with { TemperatureC = 22 },
                "temperature evidence were within the policy range", "Temperature"),
            "ENV_HUMIDITY" => (input with { HumidityPct = 45 },
                "humidity evidence were within the policy range", "Humidity"),
            "POWER_INTERRUPTION" => (input with { PowerInterruption = false },
                "no power interruption were recorded", "Power"),
            _ => null,  // MULTI_CONTEXT / PROVENANCE_INCOMPLETE / anything else: no obvious single change
        };
        if (plan is null) return null;

        try
        {
            var (cfStatus, cfFindings) = engine.EvaluateInitial(plan.Value.Mutated, at);
            if (cfStatus == s.FinalStatus) return null;            // the change was not decisive

            var remaining = cfFindings
                .Where(f => f.Severity > ReliabilityStatus.Trust && f.RuleId != "ALL_CHECKS_PASS")
                .Select(f => DomainOf(f.RuleId).Label)
                .Distinct()
                .ToList();
            var cfName = cfStatus.ToString().ToUpperInvariant();
            // Sentence flow: the concern phrase reads mid-sentence, so keep it lower-case.
            string Lower(string label) =>
                char.ToLowerInvariant(label[0]) + label[1..];
            string statement;
            if (remaining.Count == 0)
            {
                statement = $"If {plan.Value.Phrase}, no concerns would remain under the same rules — the disposition would be {cfName}.";
            }
            else
            {
                var labels = remaining.Count == 1
                    ? $"{Lower(remaining[0])} concern"
                    : $"{string.Join(", ", remaining.Take(remaining.Count - 1).Select(Lower))} and {Lower(remaining[^1])} concerns";
                statement = $"If {plan.Value.Phrase}, the remaining {labels} would result in {cfName}.";
            }

            return new CounterfactualComparison(
                Label: "Deterministic decision comparison",
                Method: "Rule-based counterfactual",
                ChangedEvidence: plan.Value.Changed,
                Change: $"{plan.Value.Changed} evidence treated as current under the same policy windows.",
                CurrentDisposition: s.FinalStatus.ToString().ToUpperInvariant(),
                CounterfactualDisposition: cfName,
                Statement: statement,
                BasisNote: "Derived by re-running the same deterministic rules with this single evidence change, at the recorded decision time. A rule-based comparison, not a prediction — no probability is attached, and nothing clinical is claimed.");
        }
        catch
        {
            return null;
        }
    }

    // ── Integrity timeline (spec section 13) ─────────────────────────────────────

    /// <summary>
    /// Compact decision-evolution view. Entries come from the STORED record ("recorded"), from
    /// policy boundaries computed off recorded timestamps ("derived"), or from the demonstration
    /// decision sequence that WAS recorded through the real pipeline ("demo-history"). No
    /// historical events are faked: when no sequence exists, the timeline says it is a
    /// decision-time view of a single evaluation.
    /// </summary>
    private static IntegrityTimeline BuildTimeline(IntegrityDecisionSnapshot s)
    {
        var entries = new List<IntegrityTimelineEntry>();
        var history = s.History;
        var isSequence = history is { Count: >= 2 };
        var rules = new HashSet<string>(s.RuleIds ?? []);

        entries.Add(new IntegrityTimelineEntry(
            s.Input.TimestampUtc, "event", "Point-of-care event captured",
            $"{s.Input.Result} ({(string.IsNullOrWhiteSpace(s.Input.TestType) ? "POC test" : s.Input.TestType)})",
            Basis: "recorded"));

        if (rules.Contains("CAL_NEAR_DUE") || rules.Contains("CAL_EXPIRED"))
        {
            var t = s.Input.CalibrationDueUtc.AddDays(-7);
            if (t < s.DecidedAtUtc)
                entries.Add(new IntegrityTimelineEntry(
                    t, "evidence", "Calibration entered its review window",
                    "Policy boundary: 7 days before the calibration due date. From this point the evidence classifies as AGING under the demonstration policy (as evaluated at the recorded decision).",
                    EvidenceState: States.Aging, Basis: "derived"));
        }
        if (rules.Contains("CAL_EXPIRED") && s.Input.CalibrationDueUtc < s.DecidedAtUtc)
            entries.Add(new IntegrityTimelineEntry(
                s.Input.CalibrationDueUtc, "evidence", "Calibration validity boundary passed",
                "Past the configured validity boundary the evidence classifies as EXPIRED (as evaluated at the recorded decision).",
                EvidenceState: States.Expired, Basis: "derived"));

        if (rules.Contains("REAGENT_NEAR_EXPIRY") || rules.Contains("REAGENT_EXPIRED"))
        {
            var t = s.Input.ReagentExpiryUtc.AddDays(-14);
            if (t < s.DecidedAtUtc)
                entries.Add(new IntegrityTimelineEntry(
                    t, "evidence", "Reagent entered its near-expiry window",
                    "Policy boundary: 14 days before the reagent expiry date. From this point the evidence classifies as AGING under the demonstration policy (as evaluated at the recorded decision).",
                    EvidenceState: States.Aging, Basis: "derived"));
        }
        if (rules.Contains("REAGENT_EXPIRED") && s.Input.ReagentExpiryUtc < s.DecidedAtUtc)
            entries.Add(new IntegrityTimelineEntry(
                s.Input.ReagentExpiryUtc, "evidence", "Reagent validity boundary passed",
                "Past the configured validity boundary the evidence classifies as EXPIRED (as evaluated at the recorded decision).",
                EvidenceState: States.Expired, Basis: "derived"));

        if (history is { Count: >= 2 })
        {
            IntegrityHistoryPoint? prev = null;
            foreach (var h in history.OrderBy(h => h.DecidedAtUtc).ThenBy(h => h.AssessmentId))
            {
                var disp = h.FinalStatus.ToString().ToUpperInvariant();
                entries.Add(new IntegrityTimelineEntry(
                    h.DecidedAtUtc, "decision", $"Disposition {disp} recorded",
                    FirstDriverSentence(h.Reasons) ?? "Recorded by the assessment pipeline.",
                    Disposition: disp, Basis: "demo-history"));
                if (prev is not null && prev.FinalStatus != h.FinalStatus)
                {
                    entries.Add(new IntegrityTimelineEntry(
                        h.DecidedAtUtc, "transition", "Disposition changed",
                        NewlyAppeared(prev, h),
                        Disposition: disp,
                        Transition: $"{prev.FinalStatus.ToString().ToUpperInvariant()} → {disp}",
                        Basis: "derived"));
                }
                prev = h;
            }
        }
        else
        {
            var disp = s.FinalStatus.ToString().ToUpperInvariant();
            entries.Add(new IntegrityTimelineEntry(
                s.DecidedAtUtc, "decision", $"Disposition {disp} recorded",
                FirstDriverSentence(s.Reasons) ?? "Recorded by the assessment pipeline.",
                Disposition: disp, Basis: "recorded"));
        }

        var ordered = entries
            .OrderBy(e => e.TimeUtc)
            .ThenBy(e => e.Kind switch { "event" => 0, "evidence" => 1, "decision" => 2, _ => 3 })
            .ToList();

        return isSequence
            ? new IntegrityTimeline(
                "Demonstration decision history",
                "A synthetic sequence recorded by the demonstration facility through the REAL assessment pipeline. Timestamps are part of the deterministic demonstration dataset (fixed offsets from the moment the demonstration was loaded) — this is labelled demonstration history, not claimed production history.",
                ordered)
            : new IntegrityTimeline(
                "Decision-time integrity view",
                "This prototype records a single evaluation per event. Entries come from the stored assessment; evidence boundaries are derived from the recorded policy windows as they stood at the recorded decision.",
                ordered);
    }

    private static string? FirstDriverSentence(IReadOnlyList<string>? reasons)
    {
        foreach (var raw in reasons ?? [])
        {
            if (string.IsNullOrWhiteSpace(raw)) continue;
            if (raw.StartsWith("AI ", StringComparison.Ordinal)) continue;
            var text = StripRulePrefix(raw);
            if (text.Length > 0) return text;
        }
        return null;
    }

    /// <summary>What changed between two sequence decisions: the sentences of rules that appear
    /// in the later decision but not the earlier one — deterministic, from stored data.</summary>
    private static string NewlyAppeared(IntegrityHistoryPoint prev, IntegrityHistoryPoint next)
    {
        var oldRules = new HashSet<string>(prev.RuleIds ?? []);
        var fresh = (next.RuleIds ?? [])
            .Where(r => !oldRules.Contains(r))
            .Take(2)
            .ToList();
        if (fresh.Count == 0) return "The evidence state changed between the two recorded decisions.";
        var byId = new Dictionary<string, string>();
        foreach (var raw in next.Reasons ?? [])
        {
            if (raw.StartsWith('['))
            {
                var close = raw.IndexOf(']');
                if (close > 1) byId[raw[1..close]] = StripRulePrefix(raw);
            }
        }
        var parts = fresh.Select(r => byId.TryGetValue(r, out var sentence) ? sentence : r.Replace('_', ' ').ToLowerInvariant());
        return $"New finding: {string.Join(" ", parts)}";
    }

    /// <summary>
    /// Public, reusable description of what changed between two recorded sequence decisions
    /// ("TRUST → REVIEW": the newly appeared stored finding). Used by the dashboard's
    /// demonstration sequence (spec section 30) so the "why did it change" copy is ALWAYS derived
    /// from stored data — the same derivation the integrity timeline uses, never re-written.
    /// </summary>
    public static string DescribeTransition(IntegrityHistoryPoint previous, IntegrityHistoryPoint next) =>
        NewlyAppeared(previous, next);
}
