namespace POCTrust.Core.Integrity;

/// <summary>
/// Compact aggregates over a projected <see cref="ResultIntegrityRecord"/> — the single source of
/// truth for "what counts as an evidence concern" so the dashboard, the list rows and the tests
/// all agree (spec section 26: metrics are calculated from actual records, never fabricated).
///
/// A domain is a CONCERN when its classified quality state is one of the concerning states, or
/// when required evidence was missing entirely. Missing non-required evidence (e.g. maintenance,
/// which this prototype does not capture) is NOT a concern — it does not reduce coverage either.
/// </summary>
public static class IntegrityMetrics
{
    /// <summary>Domain states that count as a quality concern (mirrors the UI's CONCERN_STATES).</summary>
    public static readonly string[] ConcernStates =
        [
            ResultIntegrityProjector.States.Aging,
            ResultIntegrityProjector.States.Stale,
            ResultIntegrityProjector.States.Expired,
            ResultIntegrityProjector.States.Failed,
            ResultIntegrityProjector.States.Conflicting,
            ResultIntegrityProjector.States.UnverifiedSource,
        ];

    /// <summary>Number of concerning domain rows in one record.</summary>
    public static int ConcernCount(ResultIntegrityRecord record) =>
        record.Domains.Count(d =>
            ConcernStates.Contains(d.State)
            || (d.RequiredByPolicy && d.State == ResultIntegrityProjector.States.Missing));

    /// <summary>True when the record carries at least one evidence concern.</summary>
    public static bool HasConcerns(ResultIntegrityRecord record) => ConcernCount(record) > 0;

    /// <summary>Fraction of the selected policy's required evidence that was available (0..1).</summary>
    public static double CoverageRatio(ResultIntegrityRecord record) =>
        record.EvidenceQuality.Coverage.RequiredTotal == 0
            ? 0
            : (double)record.EvidenceQuality.Coverage.RequiredAvailable / record.EvidenceQuality.Coverage.RequiredTotal;
}
