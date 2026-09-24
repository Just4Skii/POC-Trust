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
import { evidenceItems, qualityFor } from "../src/lib/evidence.ts";
import {
  EVIDENCE_STATES,
  coverageGlyph,
  evidenceSources,
  isEvidenceQualityState,
  parseRir,
  qualityConcerns,
  stateTone,
  stateWord,
} from "../src/lib/rir.ts";
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

// ── Result Integrity Record (RIR) ──────────────────────────────────────────────────────────
check("rir: qualityFor mirrors the backend rule-first derivation", () => {
  const input = {
    deviceId: "DEV-02", qcPassed: true, operatorId: "OP-12", operatorCompetent: false,
    reagentLot: "LOT-44", provenance: "site-B/DEV-02/OP-12",
  };
  const rules = ["CAL_NEAR_DUE", "REAGENT_NEAR_EXPIRY", "OPERATOR_NOT_COMPETENT", "POWER_INTERRUPTION", "MULTI_CONTEXT"];
  assert.equal(qualityFor("cal", input, rules), "aging");
  assert.equal(qualityFor("reagent", input, rules), "aging");
  assert.equal(qualityFor("op", input, rules), "expired");
  assert.equal(qualityFor("env", input, rules), "valid");
  assert.equal(qualityFor("qc", input, rules), "valid");

  const missing = { deviceId: "DEV-04", qcPassed: true, operatorId: "", reagentLot: "", provenance: "" };
  const missingRules = ["PROVENANCE_INCOMPLETE"];
  assert.equal(qualityFor("op", missing, missingRules), "missing");
  assert.equal(qualityFor("reagent", missing, missingRules), "missing");
  assert.equal(qualityFor("prov", missing, missingRules), "missing");

  const failed = { deviceId: "DEV-03", qcPassed: false, operatorId: "OP-3", reagentLot: "LOT-91", provenance: "s/D/OP" };
  const failedRules = ["QC_FAILED", "CAL_EXPIRED", "REAGENT_EXPIRED", "ENV_TEMP", "ENV_HUMIDITY"];
  assert.equal(qualityFor("qc", failed, failedRules), "failed");
  assert.equal(qualityFor("cal", failed, failedRules), "expired");
  assert.equal(qualityFor("reagent", failed, failedRules), "expired");
  assert.equal(qualityFor("env", failed, failedRules), "failed");
});

check("rir: state vocabulary is the eight-value taxonomy with tones for every state", () => {
  assert.deepEqual(
    [...EVIDENCE_STATES].sort(),
    ["aging", "conflicting", "expired", "failed", "missing", "stale", "unverified-source", "valid"],
  );
  for (const s of EVIDENCE_STATES) {
    const tone = stateTone(s);
    assert.ok(tone.chip.length > 0 && tone.dot.length > 0, `tone for ${s}`);
    assert.ok(isEvidenceQualityState(s));
  }
  assert.equal(isEvidenceQualityState("PASS"), false); // legacy binary state must not reappear
  assert.equal(isEvidenceQualityState(undefined), false);
});

check("rir: parseRir is defensive — garbage never reaches the document view", () => {
  assert.equal(parseRir(null), null);
  assert.equal(parseRir("nope"), null);
  assert.equal(parseRir({}), null);
  const record = parseRir({
    assessmentId: "a", disposition: "Review",
    evidenceQuality: { coverage: { items: [{ domain: "cal", state: "AGING" }] } },
    domains: [{ domain: "cal", state: 42, note: null }],
    decisionDrivers: ["ok", 5, null, ""],
  });
  assert.ok(record);
  assert.equal(record.domains[0].state, "missing"); // unknown state falls back safely
  assert.equal(record.evidenceQuality.coverage.items[0].state, "missing");
  assert.deepEqual(record.decisionDrivers, ["ok"]);
});

check("rir: coverage glyph distinguishes available evidence from absent evidence", () => {
  assert.equal(coverageGlyph({ domain: "qc", label: "QC", available: true, state: "failed" }), "✓");
  assert.equal(coverageGlyph({ domain: "env", label: "Env", available: false, state: "missing" }), "?");
});

check("rir: sources list derives only from available evidence", () => {
  const record = parseRir({
    assessmentId: "a", disposition: "Trust",
    domains: [
      { domain: "device", available: true, source: "Event record" },
      { domain: "qc", available: true, source: "Device quality-control record" },
      { domain: "maintenance", available: false, source: "Not captured in this prototype" },
    ],
  });
  assert.deepEqual(evidenceSources(record), ["Event record", "Device quality-control record"]);
});

// ── Integrity upgrade (spec chunk 3): causality, conflicts, timeline, policy ───────────────
check("rir: causality, conflicts and timeline parse defensively from the endpoint payload", () => {
  // Missing sections fall back safely (older cached payloads, pending states).
  const minimal = parseRir({ assessmentId: "a", disposition: "Review" });
  assert.ok(minimal);
  assert.equal(minimal.causality, null);
  assert.deepEqual(minimal.conflicts, []);
  assert.equal(minimal.timeline, null);
  assert.deepEqual(minimal.policy.contextualDomains, []);

  const full = parseRir({
    assessmentId: "a", disposition: "Verify",
    domains: [
      { domain: "cal", state: "expired", verification: "Boundary evaluated…", relatedRuleIds: ["CAL_EXPIRED"], sourceIdentifier: null },
    ],
    conflicts: [{
      sourceA: "Device quality-control record", sourceAState: "VALID",
      sourceB: "Site environment snapshot", sourceBState: "FAILED",
      conflict: "QC passed while environment out of range.", whyItMatters: "Context matters.", relatedRuleIds: "ENV_TEMP",
    }],
    causality: {
      verified: true,
      derivationNote: "ok",
      primaryDrivers: [{ ruleId: "CAL_EXPIRED", statement: "Calibration overdue.", domain: "calibration", domainLabel: "Calibration", evidenceState: "expired", role: "primary" }],
      secondaryConsiderations: [{ ruleId: "OPERATOR_NOT_COMPETENT", statement: "Operator competency lapsed.", domain: "operator", domainLabel: "Operator competency", evidenceState: "expired", role: "secondary" }],
      contextualNotes: [{ ruleId: "", statement: "Environment evidence is valid.", domain: "environment", domainLabel: "Environment", evidenceState: "valid", role: "informational" }],
      counterfactual: {
        label: "Deterministic decision comparison", method: "Rule-based counterfactual",
        changedEvidence: "Calibration", change: "treated as current",
        currentDisposition: "VERIFY", counterfactualDisposition: "REVIEW",
        statement: "If calibration evidence were current…", basisNote: "…no probability…",
      },
    },
    timeline: {
      label: "Demonstration decision history", note: "synthetic",
      entries: [
        { timeUtc: "2026-09-01T09:42:00Z", kind: "decision", title: "Disposition TRUST recorded", detail: "All deterministic checks passed.", basis: "demo-history" },
        { timeUtc: "2026-09-01T14:03:00Z", kind: "transition", title: "Disposition changed", detail: "New finding: …", transition: "TRUST → REVIEW", basis: "derived" },
      ],
    },
    policy: { id: "rural-phc-demo", contextualDomains: ["environment", "power", "connectivity"], selectionNote: "rural site marker" },
  });
  assert.ok(full.causality && full.causality.verified);
  assert.equal(full.causality.primaryDrivers[0].evidenceState, "expired");
  assert.equal(full.causality.counterfactual.method, "Rule-based counterfactual");
  assert.equal(full.conflicts[0].sourceBState, "FAILED");
  assert.equal(full.timeline.label, "Demonstration decision history");
  assert.equal(full.timeline.entries[1].transition, "TRUST → REVIEW");
  assert.deepEqual(full.policy.contextualDomains, ["environment", "power", "connectivity"]);
  // Garbage inside the new sections must not throw and must fall back per-field.
  const garbage = parseRir({
    assessmentId: "a", disposition: "Trust",
    causality: { primaryDrivers: "nope", counterfactual: 42, verified: "yes" },
    conflicts: "nope", timeline: 7,
  });
  assert.ok(garbage);
  assert.deepEqual(garbage.causality.primaryDrivers, []);
  assert.equal(garbage.causality.counterfactual, null);
  assert.deepEqual(garbage.conflicts, []);
  assert.equal(garbage.timeline, null);
});

check("rir: quality concerns summary counts only concerning domain states", () => {
  const record = parseRir({
    assessmentId: "a", disposition: "Review",
    domains: [
      { domain: "cal", state: "aging" },
      { domain: "op", state: "expired" },
      { domain: "env", state: "valid" },
      { domain: "qc", state: "valid" },
      { domain: "prov", state: "unverified-source" },
    ],
  });
  const concerns = qualityConcerns(record);
  assert.equal(concerns.count, 3);
  assert.equal(concerns.breakdown, "1 aging · 1 expired · 1 unverified source");
  // Valid records read clean.
  const clean = parseRir({ assessmentId: "b", disposition: "Trust", domains: [{ domain: "qc", state: "valid" }] });
  assert.deepEqual(qualityConcerns(clean), { count: 0, breakdown: "" });
  // Signal-map node words use the same vocabulary as the record.
  assert.equal(stateWord("expired"), "EXPIRED");
  assert.equal(stateWord("unverified-source"), "UNVERIFIED SOURCE");
});

check("rir: policy chip data carries required + contextual evidence and selection note", () => {
  const record = parseRir({
    assessmentId: "a", disposition: "Trust",
    policy: {
      id: "rural-phc-demo", name: "Rural PHC POC Test", version: "demo-v1", kind: "demonstration",
      requiredDomains: ["device", "quality-control", "calibration", "operator", "reagent", "provenance"],
      contextualDomains: ["environment", "power", "connectivity"],
      selectionNote: "Selected because the event's recorded provenance identifies a rural PHC site.",
    },
  });
  assert.equal(record.policy.id, "rural-phc-demo");
  assert.equal(record.policy.requiredDomains.length, 6);
  assert.ok(record.policy.contextualDomains.includes("environment"));
  assert.match(record.policy.selectionNote, /rural PHC site/);
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

