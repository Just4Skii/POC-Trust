using POCTrust.Core.Entities;
using POCTrust.Core.Enums;

namespace POCTrust.Api.Services;

/// <summary>A curated demonstration scenario. Seeding submits the <b>inputs</b> through the real
/// assessment pipeline — the deterministic engine computes status, reasons, action and audit.
/// <see cref="Expected"/> is the seed self-check: after seeding, the engine-computed status is
/// compared against it, and a mismatch means this definition's inputs are wrong (never the engine).</summary>
public sealed record DemoSeed(
    string Key,
    string Title,
    ReliabilityStatus Expected,
    Func<DateTimeOffset, DiagnosticContext> Build,
    /// <summary>Optional fixed decision instant (relative to the seed instant) for the
    /// demonstration decision history — the sequence is recorded through the REAL pipeline at
    /// historical timestamps so the integrity timeline shows genuinely recorded evolution.</summary>
    Func<DateTimeOffset, DateTimeOffset>? DecisionAt = null);

/// <summary>
/// The curated synthetic demonstration dataset. Deterministic and idempotent:
///
/// - stable, human-meaningful demo keys ("demo-assess-001"…) persisted inside the evidence JSON;
/// - no randomness — every input is fixed relative to the moment of seeding;
/// - timestamps are FIXED OFFSETS from the seed/reset instant, so "today" and "yesterday" stay
///   true whenever the demonstration is loaded (offsets deterministic, absolute time anchored);
/// - seeding never happens on ordinary server startup — only via the explicit, guarded endpoint.
///
/// Distribution (engine-confirmed): TRUST 5 · REVIEW 5 · VERIFY 3, one offline-marked record,
/// plus a three-step demonstration decision history (TRUST → REVIEW → VERIFY) recorded through
/// the real pipeline at historical instants as calibration evidence ages.
/// Note: incomplete provenance is a REVIEW-level finding in this engine build (not VERIFY), so
/// scenario 10 is seeded as REVIEW — the engine defines truth and the demo adapts to it.
/// </summary>
public static class DemoSeedData
{
    public static readonly IReadOnlyList<DemoSeed> All =
    [
        // ── Demonstration decision history: one synthetic sequence recorded through the REAL
        // pipeline at three historical instants, so the Integrity Timeline shows genuine decision
        // evolution as calibration evidence ages (current → AGING → EXPIRED). Timestamps are fixed
        // offsets from the seed instant; the UI labels this "Demonstration decision history" —
        // it is never presented as production history. (Listed first so the seeded-keys listing
        // reads chronologically; audit sealing is recording-ordered and unaffected.)
        new DemoSeed("demo-history-1", "Decision history · calibration current", ReliabilityStatus.Trust, now => new DiagnosticContext(
            Result: "Hb 12.8 g/dL", DeviceId: "POC-DXB-02", QcPassed: true,
            CalibrationDueUtc: now.AddDays(-1), OperatorId: "Operator B", OperatorCompetent: true,
            ReagentLot: "LOT-2016", ReagentExpiryUtc: now.AddDays(90),
            TemperatureC: 23.0, TimestampUtc: now.AddDays(-30).AddMinutes(-10), Provenance: "District PHC Node 04 (Synthetic)/POC-DXB-02/Operator B",
            TestType: "Hb", HumidityPct: 45, DemoKey: "demo-history-1", LocalEventId: "local-demo-history-1"),
            now => now.AddDays(-30)),

        new DemoSeed("demo-history-2", "Decision history · calibration aging", ReliabilityStatus.Review, now => new DiagnosticContext(
            Result: "Glucose 6.1 mmol/L", DeviceId: "POC-DXB-02", QcPassed: true,
            CalibrationDueUtc: now.AddDays(-1), OperatorId: "Operator B", OperatorCompetent: true,
            ReagentLot: "LOT-2016", ReagentExpiryUtc: now.AddDays(90),
            TemperatureC: 23.0, TimestampUtc: now.AddDays(-5).AddHours(-1).AddMinutes(-10), Provenance: "District PHC Node 04 (Synthetic)/POC-DXB-02/Operator B",
            TestType: "Glucose", HumidityPct: 48, DemoKey: "demo-history-2", LocalEventId: "local-demo-history-2"),
            now => now.AddDays(-5).AddHours(-1)),

        new DemoSeed("demo-history-3", "Decision history · calibration expired", ReliabilityStatus.Verify, now => new DiagnosticContext(
            Result: "Hb 10.2 g/dL", DeviceId: "POC-DXB-02", QcPassed: true,
            CalibrationDueUtc: now.AddDays(-1), OperatorId: "Operator B", OperatorCompetent: true,
            ReagentLot: "LOT-2016", ReagentExpiryUtc: now.AddDays(90),
            TemperatureC: 23.0, TimestampUtc: now.AddMinutes(-15), Provenance: "District PHC Node 04 (Synthetic)/POC-DXB-02/Operator B",
            TestType: "Hb", HumidityPct: 45, DemoKey: "demo-history-3", LocalEventId: "local-demo-history-3"),
            now => now.AddMinutes(-5)),

        // ── TRUST: clean evidence ───────────────────────────────────────────────
        new DemoSeed("demo-assess-001", "Clean evidence", ReliabilityStatus.Trust, now => new DiagnosticContext(
            Result: "Hb 14.2 g/dL", DeviceId: "POC-DXA-01", QcPassed: true,
            CalibrationDueUtc: now.AddDays(60), OperatorId: "Operator A", OperatorCompetent: true,
            ReagentLot: "LOT-2041", ReagentExpiryUtc: now.AddDays(90),
            TemperatureC: 22.5, TimestampUtc: now.AddMinutes(-18), Provenance: "KwaMoya Community Clinic (Demo)/POC-DXA-01/Operator A",
            TestType: "Hb", HumidityPct: 45, DemoKey: "demo-assess-001")),

        new DemoSeed("demo-assess-002", "Clean evidence", ReliabilityStatus.Trust, now => new DiagnosticContext(
            Result: "Glucose 5.4 mmol/L", DeviceId: "POC-DXA-01", QcPassed: true,
            CalibrationDueUtc: now.AddDays(60), OperatorId: "Operator B", OperatorCompetent: true,
            ReagentLot: "LOT-2055", ReagentExpiryUtc: now.AddDays(75),
            TemperatureC: 23.0, TimestampUtc: now.AddHours(-2).AddMinutes(-10), Provenance: "KwaMoya Community Clinic (Demo)/POC-DXA-01/Operator B",
            TestType: "Glucose", HumidityPct: 50, DemoKey: "demo-assess-002")),

        // ── TRUST created offline: connectivity is synchronisation metadata, not a reliability rule ──
        new DemoSeed("demo-assess-003", "Clean evidence, created offline", ReliabilityStatus.Trust, now => new DiagnosticContext(
            Result: "Malaria RDT negative", DeviceId: "POC-DXM-03", QcPassed: true,
            CalibrationDueUtc: now.AddDays(45), OperatorId: "Operator C", OperatorCompetent: true,
            ReagentLot: "LOT-2077", ReagentExpiryUtc: now.AddDays(60),
            TemperatureC: 25.0, TimestampUtc: now.AddHours(-4).AddMinutes(-25), Provenance: "North Coast PHC (Demo)/POC-DXM-03/Operator C",
            TestType: "Malaria-RDT", HumidityPct: 55, Connectivity: "offline",
            LocalEventId: "local-demo-assess-003", DemoKey: "demo-assess-003")),

        new DemoSeed("demo-assess-004", "Clean evidence", ReliabilityStatus.Trust, now => new DiagnosticContext(
            Result: "Hb 13.1 g/dL", DeviceId: "POC-DXB-02", QcPassed: true,
            CalibrationDueUtc: now.AddDays(40), OperatorId: "Operator A", OperatorCompetent: true,
            ReagentLot: "LOT-2038", ReagentExpiryUtc: now.AddDays(80),
            TemperatureC: 22.0, TimestampUtc: now.AddDays(-1).AddHours(-3), Provenance: "District PHC Node 04 (Synthetic)/POC-DXB-02/Operator A",
            TestType: "Hb", HumidityPct: 40, DemoKey: "demo-assess-004")),

        // ── REVIEW: interacting contextual concerns (AI advisory is consulted for these) ──
        new DemoSeed("demo-assess-005", "Calibration approaching + operator competency", ReliabilityStatus.Review, now => new DiagnosticContext(
            Result: "Hb 9.1 g/dL", DeviceId: "POC-DXB-02", QcPassed: true,
            CalibrationDueUtc: now.AddDays(3), OperatorId: "Operator B", OperatorCompetent: false,
            ReagentLot: "LOT-2071", ReagentExpiryUtc: now.AddDays(45),
            TemperatureC: 24.0, TimestampUtc: now.AddHours(-3).AddMinutes(-5), Provenance: "District PHC Node 04 (Synthetic)/POC-DXB-02/Operator B",
            TestType: "Hb", HumidityPct: 55, DemoKey: "demo-assess-005")),

        new DemoSeed("demo-assess-006", "Power interruption + reagent nearing expiry", ReliabilityStatus.Review, now => new DiagnosticContext(
            Result: "CRP 42 mg/L", DeviceId: "POC-DXA-01", QcPassed: true,
            CalibrationDueUtc: now.AddDays(60), OperatorId: "Operator C", OperatorCompetent: true,
            ReagentLot: "LOT-1990", ReagentExpiryUtc: now.AddDays(10),
            TemperatureC: 24.5, TimestampUtc: now.AddHours(-6).AddMinutes(-40), Provenance: "KwaMoya Community Clinic (Demo)/POC-DXA-01/Operator C",
            TestType: "CRP", HumidityPct: 60, PowerInterruption: true, DemoKey: "demo-assess-006")),

        new DemoSeed("demo-assess-007", "Calibration approaching + operator competency", ReliabilityStatus.Review, now => new DiagnosticContext(
            Result: "Glucose 11.2 mmol/L", DeviceId: "POC-DXB-02", QcPassed: true,
            CalibrationDueUtc: now.AddDays(5), OperatorId: "Operator B", OperatorCompetent: false,
            ReagentLot: "LOT-2079", ReagentExpiryUtc: now.AddDays(60),
            TemperatureC: 23.5, TimestampUtc: now.AddDays(-1).AddHours(-6), Provenance: "District PHC Node 04 (Synthetic)/POC-DXB-02/Operator B",
            TestType: "Glucose", HumidityPct: 48, DemoKey: "demo-assess-007")),

        // ── VERIFY: hard-stop evidence failures — deterministic only, AI is never consulted ──
        new DemoSeed("demo-assess-008", "Quality control failed + calibration expired", ReliabilityStatus.Verify, now => new DiagnosticContext(
            Result: "Hb 8.4 g/dL", DeviceId: "POC-DXB-02", QcPassed: false,
            CalibrationDueUtc: now.AddDays(-9), OperatorId: "Operator B", OperatorCompetent: true,
            ReagentLot: "LOT-2080", ReagentExpiryUtc: now.AddDays(60),
            TemperatureC: 23.0, TimestampUtc: now.AddHours(-1).AddMinutes(-15), Provenance: "District PHC Node 04 (Synthetic)/POC-DXB-02/Operator B",
            TestType: "Hb", HumidityPct: 50, DemoKey: "demo-assess-008")),

        new DemoSeed("demo-assess-009", "Reagent expired", ReliabilityStatus.Verify, now => new DiagnosticContext(
            Result: "CRP 68 mg/L", DeviceId: "POC-DXA-01", QcPassed: true,
            CalibrationDueUtc: now.AddDays(60), OperatorId: "Operator C", OperatorCompetent: true,
            ReagentLot: "LOT-1822", ReagentExpiryUtc: now.AddDays(-1),
            TemperatureC: 23.0, TimestampUtc: now.AddHours(-20), Provenance: "KwaMoya Community Clinic (Demo)/POC-DXA-01/Operator C",
            TestType: "CRP", HumidityPct: 45, DemoKey: "demo-assess-009")),

        // ── Missing evidence: engine returns REVIEW for incomplete provenance in this build ──
        new DemoSeed("demo-assess-010", "Provenance incomplete", ReliabilityStatus.Review, now => new DiagnosticContext(
            Result: "Hb 11.0 g/dL", DeviceId: "POC-DXM-03", QcPassed: true,
            CalibrationDueUtc: now.AddDays(30), OperatorId: "", OperatorCompetent: true,
            ReagentLot: "", ReagentExpiryUtc: now.AddDays(30),
            TemperatureC: 23.0, TimestampUtc: now.AddDays(-2).AddHours(-2), Provenance: "",
            TestType: "Hb", HumidityPct: 45, DemoKey: "demo-assess-010")),

    ];
}
