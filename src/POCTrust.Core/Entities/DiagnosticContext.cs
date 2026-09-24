namespace POCTrust.Core.Entities;

public sealed record DiagnosticContext(
    string Result,
    string DeviceId,
    bool QcPassed,
    DateTimeOffset CalibrationDueUtc,
    string OperatorId,
    bool OperatorCompetent,
    string ReagentLot,
    DateTimeOffset ReagentExpiryUtc,
    double TemperatureC,
    DateTimeOffset TimestampUtc,
    string Provenance,
    string TestType = "Hb",
    double HumidityPct = 45,
    bool PowerInterruption = false,
    string Connectivity = "online",
    string LocalEventId = "",
    string? QualitativeResult = null,
    /// <summary>
    /// Optional demonstration marker (e.g. "demo-assess-003"). Set only by the demo seeding
    /// facility so synthetic records can be identified and reset safely. The reliability engine
    /// never reads it; it is persisted inside the evidence JSON for provenance/reset only.
    /// </summary>
    string? DemoKey = null
)
{
    public DiagnosticEvent ToEvent(DateTimeOffset nowUtc) => new(
        Guid.NewGuid(),
        TestType,
        Result,
        QualitativeResult,
        TimestampUtc,
        new DeviceState(DeviceId, "Generic", "POC-1", QcPassed, TimestampUtc, CalibrationDueUtc, true, false),
        new OperatorInfo(OperatorId, OperatorCompetent, OperatorCompetent ? nowUtc.AddMonths(6) : nowUtc.AddDays(-1), [TestType]),
        new ReagentInfo(ReagentLot, ReagentExpiryUtc, true, true),
        new EnvironmentInfo(TemperatureC, HumidityPct, PowerInterruption, TimestampUtc),
        Provenance,
        Connectivity,
        string.IsNullOrWhiteSpace(LocalEventId) ? $"local-{TimestampUtc:yyyyMMddHHmmss}" : LocalEventId,
        Connectivity == "offline" ? null : nowUtc
    );
}
