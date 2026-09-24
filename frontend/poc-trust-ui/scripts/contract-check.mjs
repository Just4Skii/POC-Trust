/**
 * Frontend contract checks — no browser or test framework required.
 *
 *   npm run check:contract
 *
 * Imports the pure UI logic modules (src/lib/*.ts) via Node's built-in TypeScript type-stripping.
 * These lock the behaviour of the defects fixed in the QA pass: queue lost-update, fabricated AI
 * metadata, PascalCase/camelCase evidence mismatch, offline evidence state.
 */
import assert from "node:assert/strict";
import { completeSync, enqueueEvent, readQueue, QUEUE_KEY } from "../src/lib/queue.ts";
import { normaliseEvidenceInput, toDecision } from "../src/lib/history.ts";
import { evidenceItems } from "../src/lib/evidence.ts";
import { evidenceSignals, markerPct, bandLeftPct, bandRightPct } from "../src/lib/signals.ts";
import { seededSamples, tracePathD, hashSeed } from "../src/lib/telemetry.ts";
import { EVAL_STEPS, stepDomainStates } from "../src/lib/pipeline.ts";

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

/** Minimal localStorage stand-in. */
function fakeStorage(seed) {
  const map = new Map(seed ? [[QUEUE_KEY, seed]] : []);
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, v),
    raw: () => map.get(QUEUE_KEY) ?? null,
  };
}

check("queue: sync does not discard an entry queued while syncing", () => {
  const storage = fakeStorage();
  enqueueEvent(storage, { result: "one" });
  enqueueEvent(storage, { result: "two" });
  enqueueEvent(storage, { result: "three" });

  const snapshot = readQueue(storage);
  assert.equal(snapshot.length, 3);

  // Sync accepts the first two, then a new submission lands mid-sync.
  enqueueEvent(storage, { result: "concurrent" });
  const remaining = completeSync(storage, [snapshot[0]._queueId, snapshot[1]._queueId]);

  assert.deepEqual(remaining.map((r) => r.result), ["three", "concurrent"]);
  assert.deepEqual(readQueue(storage).map((r) => r.result), ["three", "concurrent"]);
});

check("queue: partial failure keeps undelivered entries in order", () => {
  const storage = fakeStorage();
  ["a", "b", "c"].forEach((r) => enqueueEvent(storage, { result: r }));

  const snapshot = readQueue(storage);
  const remaining = completeSync(storage, [snapshot[0]._queueId]); // sync stopped after the first

  assert.deepEqual(remaining.map((r) => r.result), ["b", "c"]);
});

check("queue: legacy entries get a stable identity and survive reload", () => {
  const storage = fakeStorage(JSON.stringify([{ result: "legacy", _queuedAt: "2026-01-01T00:00:00.000Z" }]));
  const first = readQueue(storage);
  const second = readQueue(storage); // simulated reload
  assert.equal(first.length, 1);
  assert.ok(first[0]._queueId);
  assert.equal(first[0]._queueId, second[0]._queueId, "identity must be stable across reads");
  assert.deepEqual(completeSync(storage, [first[0]._queueId]), []);
});

check("queue: corrupt storage degrades to an empty queue", () => {
  const storage = fakeStorage("not json");
  assert.deepEqual(readQueue(storage), []);
  assert.equal(storage.raw(), "[]");
});

check("history: stored summary never fabricates confidence or model", () => {
  const decision = toDecision(
    {
      id: "11111111-1111-1111-1111-111111111111",
      initialStatus: 1,
      finalStatus: 1,
      action: "Hold for review.",
      aiSummary: "Stored advisory summary from the original assessment.",
      aiConsulted: true,
      decidedAtUtc: "2026-01-01T00:00:00+00:00",
    },
    ["OPERATOR_NOT_COMPETENT"],
    ["OPERATOR_NOT_COMPETENT"],
  );

  assert.equal(decision.aiAssessment.summary, "Stored advisory summary from the original assessment.");
  assert.equal("confidence" in decision.aiAssessment, false);
  assert.equal(decision.aiAssessment.confidence, undefined);
  assert.equal(decision.aiAssessment.model, undefined);
  assert.equal(decision.aiAssessment.recommendedAction, undefined);
  assert.deepEqual(decision.ruleIds, ["OPERATOR_NOT_COMPETENT"]);
});

check("history: no AI summary means no contextual-analysis block", () => {
  const decision = toDecision(
    { id: "x", initialStatus: 0, finalStatus: 0, action: "ok", aiSummary: null, aiConsulted: false },
    [],
    [],
  );
  assert.equal(decision.aiAssessment, null);
});

check("history: malformed stored reasons cannot throw", () => {
  const decision = toDecision(
    { id: "x", initialStatus: 0, finalStatus: 0, action: "ok", aiSummary: null, aiConsulted: false },
    "not-an-array",
    { unexpected: true },
  );
  assert.deepEqual(decision.reasons, []);
  assert.deepEqual(decision.ruleIds, []);
});

check("history: PascalCase record renders identical evidence to camelCase record", () => {
  const pascal = {
    Result: "Hb 9.1 g/dL",
    TestType: "Hb",
    DeviceId: "DEV-02",
    QcPassed: true,
    CalibrationDueUtc: "2026-10-04T00:00:00+00:00",
    OperatorId: "OP-12",
    OperatorCompetent: false,
    ReagentLot: "LOT-44",
    ReagentExpiryUtc: "2026-10-10T00:00:00+00:00",
    TemperatureC: 24,
    HumidityPct: 55,
    PowerInterruption: true,
    Provenance: "site-B/DEV-02/OP-12",
    Connectivity: "online",
    TimestampUtc: "2026-01-01T00:00:00+00:00",
  };
  const camel = Object.fromEntries(Object.entries(pascal).map(([k, v]) => [k[0].toLowerCase() + k.slice(1), v]));

  const fromLegacy = normaliseEvidenceInput(pascal);
  const fromCanonical = normaliseEvidenceInput(camel);
  assert.deepEqual(fromLegacy, fromCanonical);

  // The defect: undefined operatorCompetent read as "not competent" and dates rendered as "—".
  assert.equal(fromLegacy.operatorCompetent, false);
  assert.equal(fromLegacy.calibrationDueUtc, "2026-10-04T00:00:00+00:00");
  assert.equal(fromLegacy.temperatureC, 24);

  const byKey = Object.fromEntries(
    evidenceItems(fromLegacy, ["OPERATOR_NOT_COMPETENT", "POWER_INTERRUPTION"]).map((i) => [i.key, i]),
  );
  assert.equal(byKey.op.value, "OP-12 · competency not current");
  assert.ok(byKey.cal.value.startsWith("Due "), `calibration date renders, got: ${byKey.cal.value}`);
  assert.equal(byKey.env.value, "24°C · 55%");
});

check("evidence: offline is shown as a warning, not as reassurance or failure", () => {
  const base = { deviceId: "DEV-OFF-1", qcPassed: true, operatorCompetent: true, connectivity: "offline" };
  const offline = Object.fromEntries(evidenceItems(base, ["ALL_CHECKS_PASS"]).map((i) => [i.key, i]));
  assert.equal(offline.conn.state, "warn");
  assert.match(offline.conn.detail, /synchronisation metadata/);
  assert.match(offline.conn.detail, /no connectivity rule/);

  const online = Object.fromEntries(
    evidenceItems({ ...base, connectivity: "online" }, ["ALL_CHECKS_PASS"]).map((i) => [i.key, i]),
  );
  assert.equal(online.conn.state, "ok");
});

check("evidence: states come from engine rule IDs, not from guesswork", () => {
  const items = Object.fromEntries(
    evidenceItems(
      { deviceId: "DEV-03", qcPassed: false, operatorCompetent: true, calibrationDueUtc: "2026-01-01T00:00:00+00:00" },
      ["QC_FAILED", "CAL_EXPIRED", "REAGENT_EXPIRED"],
    ).map((i) => [i.key, i]),
  );
  assert.equal(items.qc.state, "fail");
  assert.equal(items.cal.state, "fail");
  assert.equal(items.reagent.state, "fail");
  assert.equal(items.qc.rule, "QC_FAILED → VERIFY");
});

check("evidence: provenance wording does not claim verified identity", () => {
  const items = Object.fromEntries(
    evidenceItems({ operatorId: "OP-07", provenance: "site-A/DEV-01/OP-07" }, []).map((i) => [i.key, i]),
  );
  assert.match(items.prov.detail, /as claimed/);
  assert.match(items.op.detail, /identity not authenticated/);
});

// ── Precision-instrument presentation layer ────────────────────────────────────────────────
check("signals: marker position comes from the real value against engine ranges", () => {
  const [temp, hum] = evidenceSignals(
    { temperatureC: 31.5, humidityPct: 53, calibrationDueUtc: "2026-10-04T00:00:00+00:00", timestampUtc: "2026-09-01T00:00:00+00:00" },
    ["ENV_TEMP"],
  );
  assert.equal(temp.state, "warn");
  assert.equal(temp.valueText, "31.5 °C");
  // 31.5 °C sits above the 15–30 band on a 10–40 rail → past the band's right edge.
  // bandRightPct is a CSS right-inset, so the band's right edge is at 100 − bandRightPct.
  assert.ok(markerPct(temp.rail) > 100 - bandRightPct(temp.rail), "marker must fall outside the acceptable band");
  assert.equal(hum.state, "ok");
  assert.ok(
    markerPct(hum.rail) >= bandLeftPct(hum.rail) && markerPct(hum.rail) <= 100 - bandRightPct(hum.rail),
    "a healthy value must sit inside the acceptable band",
  );
});

check("signals: calibration rail uses the engine's 7-day threshold and never invents a value", () => {
  const calibration = (inputs, rules) => evidenceSignals(inputs, rules)[2];
  const dueSoon = calibration(
    { calibrationDueUtc: "2026-09-05T00:00:00+00:00", timestampUtc: "2026-09-01T00:00:00+00:00" },
    ["CAL_NEAR_DUE"],
  );
  assert.equal(dueSoon.key, "cal");
  assert.equal(dueSoon.state, "warn");
  assert.match(dueSoon.valueText, /Due in 4 d/);
  const expired = calibration(
    { calibrationDueUtc: "2026-08-20T00:00:00+00:00", timestampUtc: "2026-09-01T00:00:00+00:00" },
    ["CAL_EXPIRED"],
  );
  assert.equal(expired.state, "fail");
  assert.match(expired.valueText, /Overdue/);
  const missing = calibration({}, []);
  assert.equal(missing.rail, undefined, "a missing value must not get an invented marker position");
  assert.equal(missing.valueText, "Not recorded");
});

check("telemetry: seeded traces are deterministic per record and never NaN", () => {
  const a = seededSamples("demo-assess-001:temp", 26, 0.5, 0.16);
  const b = seededSamples("demo-assess-001:temp", 26, 0.5, 0.16);
  assert.deepEqual(a, b, "same seed must produce the identical trace");
  assert.notDeepEqual(a, seededSamples("demo-assess-002:temp", 26, 0.5, 0.16));
  assert.ok(a.every((v) => Number.isFinite(v)));
  const d = tracePathD(a, 128, 26, 4);
  assert.match(d, /^M/);
  assert.ok(!/NaN/.test(d));
  assert.notEqual(hashSeed("x"), hashSeed("y"));
});

check("pipeline: rail outcomes mirror the real evidence — never all-green for a bad result", () => {
  const qcFail = stepDomainStates({ deviceId: "D1", qcPassed: false, operatorId: "OP-1", operatorCompetent: true, provenance: "s/D/OP" }, ["QC_FAILED"]);
  assert.equal(qcFail.quality, "fail");
  assert.equal(qcFail.collect, "ok");

  const envConcern = stepDomainStates({ deviceId: "D1", qcPassed: true, operatorId: "OP-1", operatorCompetent: true, temperatureC: 31.5, humidityPct: 50, provenance: "s/D/OP" }, ["ENV_TEMP"]);
  assert.equal(envConcern.environment, "warn");
  assert.equal(envConcern.quality, "ok");

  const provenanceGap = stepDomainStates({ deviceId: "D1", qcPassed: true, operatorId: "", temperatureC: 22, humidityPct: 45, provenance: "" }, ["PROVENANCE_INCOMPLETE"]);
  assert.equal(provenanceGap.operator, "warn");

  const clean = stepDomainStates({ deviceId: "D1", qcPassed: true, operatorId: "OP-1", operatorCompetent: true, provenance: "s/D/OP", temperatureC: 22, humidityPct: 45 }, ["ALL_CHECKS_PASS"]);
  for (const step of EVAL_STEPS) {
    assert.equal(clean[step.key], "ok", `clean record: ${step.key} must read ok`);
  }
});

let failed = 0;
for (const [name, run] of checks) {
  try {
    run();
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`\n${checks.length - failed}/${checks.length} frontend contract checks passed.`);
if (failed > 0) process.exit(1);

