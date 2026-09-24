namespace POCTrust.Core.Entities;

public sealed record DeviceState(
    string DeviceId,
    string Manufacturer,
    string Model,
    bool QcPassed,
    DateTimeOffset QcTimestampUtc,
    DateTimeOffset CalibrationDueUtc,
    bool MaintenanceOk,
    bool FaultFlag
);

public sealed record OperatorInfo(
    string OperatorId,
    bool Competent,
    DateTimeOffset CompetencyExpiryUtc,
    IReadOnlyList<string> AuthorizedTestTypes
);

public sealed record ReagentInfo(
    string Lot,
    DateTimeOffset ExpiryUtc,
    bool Valid,
    bool StorageOk
);

public sealed record EnvironmentInfo(
    double TemperatureC,
    double HumidityPct,
    bool PowerInterruption,
    DateTimeOffset TimestampUtc
);

public sealed record DiagnosticEvent(
    Guid EventId,
    string TestType,
    string ResultValue,
    string? QualitativeResult,
    DateTimeOffset TimestampUtc,
    DeviceState Device,
    OperatorInfo Operator,
    ReagentInfo Reagent,
    EnvironmentInfo Environment,
    string Provenance,
    string Connectivity,
    string LocalEventId,
    DateTimeOffset? SyncTimestampUtc
);
