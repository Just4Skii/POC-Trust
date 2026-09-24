#!/usr/bin/env node
/**
 * Copy guard — fails the build if machine text can leak into human-facing UI copy.
 *
 * Two lines of defence:
 *  1. UNIT: every public mapping in src/lib/labels.ts (rule vocabulary, humanized reasons,
 *     status copy, timestamps, demo labels) is run through the machine-text detector, using
 *     fixtures that mirror the exact strings the frozen backend persists
 *     ("[RULE_ID] text …", "AI unavailable (HttpRequestException); …").
 *  2. SOURCE SCAN: presentation files (every .tsx under src) may not contain raw rule IDs,
 *     locale-machine timestamps or the raw "AI unavailable" marker.
 *
 * Run: node scripts/copy-guard.mjs   (wired into `npm run check:contract`)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEMO_DEVICE_NAMES,
  EVIDENCE_STATE_COPY,
  KNOWN_RULE_IDS,
  RULE_COPY,
  STATUS_COPY,
  deviceLabel,
  evidenceStateCopy,
  facilityLabel,
  findMachineText,
  formatEventTime,
  humanizeReason,
  humanizeToken,
  isAiUnavailableReason,
  operatorLabel,
} from "../src/lib/labels.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;

function check(name, ok, detail = "") {
  if (ok) console.log(`  PASS ${name}`);
  else { failures++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

function assertHuman(name, text) {
  const findings = findMachineText(String(text));
  check(name, findings.length === 0, `${JSON.stringify(String(text)).slice(0, 90)} → ${findings.join(", ")}`);
}

// ── 1. Rule vocabulary coverage ──────────────────────────────────────────────
console.log("Rule vocabulary:");
const ENGINE_RULES = [
  "QC_FAILED", "CAL_EXPIRED", "CAL_NEAR_DUE", "REAGENT_EXPIRED", "REAGENT_NEAR_EXPIRY",
  "OPERATOR_NOT_COMPETENT", "ENV_TEMP", "ENV_HUMIDITY", "POWER_INTERRUPTION",
  "PROVENANCE_INCOMPLETE", "MULTI_CONTEXT", "ALL_CHECKS_PASS",
];
for (const id of ENGINE_RULES) check(`covers engine rule ${id}`, KNOWN_RULE_IDS.includes(id));
for (const id of KNOWN_RULE_IDS) {
  const c = RULE_COPY[id];
  assertHuman(`label for ${id}`, c.label);
  assertHuman(`sentence for ${id}`, c.sentence);
}

// ── 2. Persisted-reason fixtures (exact formats the frozen backend writes) ───
console.log("Humanized reasons:");
const REASON_FIXTURES = [
  "[QC_FAILED] QC failed — result must not be relied upon without verification.",
  "[CAL_EXPIRED] Calibration overdue since 2026-03-15.",
  "[CAL_NEAR_DUE] Calibration due within 7 days.",
  "[REAGENT_EXPIRED] Reagent lot LOT-2071 expired 2026-03-10.",
  "[REAGENT_NEAR_EXPIRY] Reagent lot LOT-2071 nearing expiry (2026-10-01).",
  "[OPERATOR_NOT_COMPETENT] Operator OP-03 competency expired/unverified.",
  "[ENV_TEMP] Temperature 31.5°C outside 15–30°C range.",
  "[ENV_HUMIDITY] Humidity 92% outside 10–85% range.",
  "[POWER_INTERRUPTION] Power interruption associated with event.",
  "[PROVENANCE_INCOMPLETE] Missing required provenance (who/device/reagent/where).",
  "[MULTI_CONTEXT] Multiple contextual concerns (3) — interaction review warranted.",
  "[ALL_CHECKS_PASS] All deterministic checks passed.",
  "AI unavailable (HttpRequestException); deterministic result retained.",
  "AI unavailable (TimeoutException); deterministic result retained.",
];
for (const raw of REASON_FIXTURES) {
  const h = humanizeReason(raw);
  assertHuman(`label: ${raw.slice(0, 42)}`, h.label);
  assertHuman(`text:  ${raw.slice(0, 42)}`, h.text);
}
check("AI-unavailable reason is classified, not rendered raw", isAiUnavailableReason(REASON_FIXTURES[12]) && humanizeReason(REASON_FIXTURES[12]).aiUnavailable === true);
check("rule id preserved for technical details", humanizeReason(REASON_FIXTURES[0]).ruleId === "QC_FAILED");

// Unknown future rule must humanize, never leak:
const future = humanizeReason("[FUTURE_RULE_XYZ] Something unexpected happened.");
assertHuman("unknown rule label", future.label);
assertHuman("unknown rule text", future.text);
assertHuman("token fallback", humanizeToken("SOME_NEW_TOKEN"));
check("token fallback is sentence-case words", humanizeToken("SOME_NEW_TOKEN") === "Some new token");

// ── 3. Status copy, timestamps, demo labels ──────────────────────────────────
console.log("Status / time / demo labels:");
for (const [s, c] of Object.entries(STATUS_COPY)) {
  assertHuman(`status meaning ${s}`, c.meaning);
  assertHuman(`status strip ${s}`, c.strip);
}
for (const iso of [new Date().toISOString(), new Date(Date.now() - 864e5).toISOString(), new Date(Date.now() - 3 * 864e5).toISOString(), new Date(Date.now() - 40 * 864e5).toISOString(), null, "not-a-date"]) {
  assertHuman(`formatEventTime(${iso ?? "null"})`, formatEventTime(iso));
}
for (const id of Object.keys(DEMO_DEVICE_NAMES)) assertHuman(`device ${id}`, deviceLabel(id));
assertHuman("unknown device passes through", deviceLabel("DEV-99"));
assertHuman("missing operator", operatorLabel(""));
assertHuman("missing facility", facilityLabel(""));

// ── 3b. Evidence-quality taxonomy copy (Result Integrity Record) ─────────────
console.log("Evidence-quality taxonomy:");
for (const [state, c] of Object.entries(EVIDENCE_STATE_COPY)) {
  assertHuman(`state label ${state}`, c.label);
  assertHuman(`state meaning ${state}`, c.meaning);
}
// Every state must humanize with a fallback; unknown states never leak machine text.
assertHuman("unknown state fallback", evidenceStateCopy("SOMETHING_NEW").label);
assertHuman("unverified-source label", evidenceStateCopy("unverified-source").label);
assertHuman("unverified-source meaning", evidenceStateCopy("unverified-source").meaning);

// ── 4. Detector self-test — proves the guard fails on a deliberate leak ──────
console.log("Detector self-test (deliberate leaks must be caught):");
for (const [leak, why] of [
  ["[QC_FAILED] QC failed", "raw rule id"],
  ["AI unavailable (HttpRequestException); deterministic result retained.", "exception name"],
  ["record 3f8a2c1e-9b7d-4e5f-a6c0-1d2e3f4a5b6c created", "raw GUID"],
  ["value is undefined", "uninitialised artefact"],
  ['{"ruleId":"QC_FAILED"}', "raw JSON"],
]) check(`detects ${why}`, findMachineText(leak).length > 0, `not detected in ${leak}`);

// ── 5. Source scan — presentation files must not embed machine vocabulary ────
// (.tsx = what the user reads; .ts logic files such as lib/evidence.ts hold the
//  technical strings that feed the "Technical details" disclosure and are exempt.)
console.log("Source scan (src/**/*.tsx):");
function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const BANNED_TSX = [
  ...KNOWN_RULE_IDS.map((id) => [new RegExp(`\\b${id}\\b`), `raw rule id ${id}`]),
  [/\bAI unavailable\b/, "raw AI-unavailable marker"],
  [/\.toLocaleString\(/, "locale-machine timestamp (use formatEventTime)"],
  // Forbidden framings (spec: the record is an operational integrity assessment — never these):
  [/\bclinical truth\b/i, "forbidden framing: clinical truth"],
  [/\bdiagnostic correctness\b/i, "forbidden framing: diagnostic correctness"],
  [/\bpatient safety probability\b/i, "forbidden framing: patient safety probability"],
  [/\bmedical confidence\b/i, "forbidden framing: medical confidence"],
];
const tsxFiles = walk(join(root, "src")).filter((f) => f.endsWith(".tsx"));
for (const file of tsxFiles) {
  const src = readFileSync(file, "utf8");
  for (const [pattern, why] of BANNED_TSX) {
    if (pattern.test(src)) {
      failures++;
      console.error(`  FAIL ${file.replace(root, "").slice(1)} — ${why}`);
    }
  }
}
console.log(`  scanned ${tsxFiles.length} presentation files`);

console.log("");
if (failures > 0) {
  console.error(`COPY GUARD FAILED: ${failures} machine-text leak(s) found.`);
  process.exit(1);
}
console.log("COPY GUARD PASSED — no machine text in human-facing copy.");

