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
  // Spec chunk 3 (sections 10–21): decision drivers are qualitative — primary / secondary /
  // informational. Invented numeric contribution percentages and fake cryptographic provenance
  // are forbidden in presentation code.
  [/contribut\w*\s+\d+(\.\d+)?\s*%/i, "invented numeric contribution percentage"],
  [/\b\d+(\.\d+)?%\s+(?:of\s+)?(?:the\s+)?decision\b/i, "invented decision-share percentage"],
  [/\b[0-9a-f]{64}\b/i, "hash-like fake provenance identifier"],
  // Spec chunk 4 (section 33 — humanization): zero raw machine text in the primary UI.
  [/\bEVIDENCE_STATE\b/, "raw machine identifier EVIDENCE_STATE (use humanized evidence-state copy)"],
  [/\bRIR_ID\b/, "raw machine identifier RIR_ID (the UI says Record ID)"],
  [/\bPOLICY_ID\b/, "raw machine identifier POLICY_ID (the UI says Policy)"],
  [/\bRULE_WEIGHT\b/, "raw machine identifier RULE_WEIGHT (weights do not exist)"],
  [/\bSOURCE_CONFIDENCE\b/, "raw machine identifier SOURCE_CONFIDENCE (no such measure exists)"],
  // Spec chunk 4 (section 34 — clinical honesty): claims that require validation this
  // prototype does not have must never appear.
  [/\bclinically safe\b/i, "forbidden claim: clinically safe"],
  [/\bdiagnostically correct\b/i, "forbidden claim: diagnostically correct"],
  [/\bclinical risk score\b/i, "forbidden claim: clinical risk score"],
  [/\bpatient safety prediction\b/i, "forbidden claim: patient safety prediction"],
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

// ── 5b. Localisation spec — claims policy, required pattern, sections 9–11 ────
console.log("Localisation claims & pattern:");
const BANNED_CLAIMS = [
  [/\bfully\s+localised\b/i, "forbidden claim: fully localised"],
  [/\bclinically\s+validated\s+translations?\b/i, "forbidden claim: clinically validated translations"],
  [/supports?\s+south\s+africa'?s\s+three\s+major\s+languages/i, "forbidden claim: three major languages"],
  [/\bfully\s+translated\b/i, "forbidden claim: fully translated"],
];
const localisationFiles = [
  join(root, "src", "components", "LanguagePicker.tsx"),
  join(root, "src", "pages", "Meta.tsx"),
  join(root, "src", "i18n", "strings.ts"),
  join(root, "src", "components", "ContextualAnalysis.tsx"),
];
for (const file of localisationFiles) {
  const src = readFileSync(file, "utf8");
  for (const [pattern, why] of BANNED_CLAIMS) {
    if (pattern.test(src)) {
      failures++;
      console.error(`  FAIL ${file.replace(root, "").slice(1)} — ${why}`);
    }
  }
}
const pickerGuardSrc = readFileSync(join(root, "src", "components", "LanguagePicker.tsx"), "utf8");
check("language menu entries render in their own language", ["isiZulu", "isiXhosa", "Afrikaans"].every((n) => pickerGuardSrc.includes(n)) || pickerGuardSrc.includes("SUPPORTED_LOCALES"));
check("language support state comes from real catalog metadata", pickerGuardSrc.includes("useLocaleSupport"));
check("selector stays out of the header (sidebar/settings only)", !readFileSync(join(root, "src", "App.tsx"), "utf8").split("<header")[1]?.includes("LanguagePicker"));

// Spec chunks 4–6 (sections 9–11): the advisory panel is English-content with localised
// framing; VERIFY has none of it in any language; no runtime machine translation.
const caGuardSrc = readFileSync(join(root, "src", "components", "ContextualAnalysis.tsx"), "utf8");
check("contextual analysis content stays English (localised framing only)", caGuardSrc.includes('lang="en"') && caGuardSrc.includes("ui.ai.english_only"));
check("VERIFY shows no Contextual Analysis in any language", /=== "Verify"\s*\)\s*return null/.test(caGuardSrc));
check("no machine translation of safety-critical text at runtime", !/\btranslat\w*\s*\(\s*ai\.summary|machineTranslate|autoTranslate/i.test(caGuardSrc));

// ── 6. Required wording (spec chunk 3) — the honesty labels must exist ──────
console.log("Required wording (integrity upgrade):");
const integrityRecordSrc = readFileSync(join(root, "src", "components", "IntegrityRecord.tsx"), "utf8");
const instrumentSrc = readFileSync(join(root, "src", "components", "Instrument.tsx"), "utf8");
const evidenceLibSrc = readFileSync(join(root, "src", "lib", "evidence.ts"), "utf8");
check("counterfactual carries the label 'Deterministic decision comparison'", integrityRecordSrc.includes("Deterministic decision comparison"));
check("counterfactual carries the method 'Rule-based counterfactual'", integrityRecordSrc.includes("Rule-based counterfactual"));
check("conflict panel states the application detected an evidence inconsistency", /detected evidence inconsistency/.test(integrityRecordSrc));
check("monitor marks contributing rows (↳ contributor)", instrumentSrc.includes("↳ contributor"));
check("monitor marks contextual rows (↳ contextual)", instrumentSrc.includes("↳ contextual"));
check("evidence provenance preserves 'as claimed' identity wording", /as claimed/.test(evidenceLibSrc));
check("summary card inspects the full record (progressive disclosure)", integrityRecordSrc.includes("Inspect Integrity Record"));

// ── 7. Required wording (spec chunk 4) — dashboard, rows, audit pipeline, demo moment ──
console.log("Required wording (integrity upgrade, chunk 4):");
const overviewSrc = readFileSync(join(root, "src", "pages", "Overview.tsx"), "utf8");
const listsSrc = readFileSync(join(root, "src", "pages", "Lists.tsx"), "utf8");
const auditTimelineSrc = readFileSync(join(root, "src", "components", "AuditTimeline.tsx"), "utf8");
check("integrity overview card labels the demonstration environment", overviewSrc.includes("Demonstration mode — synthetic data only"));
check("integrity overview carries the four section-26 metrics", ["Evidence coverage", "Evidence concerns", "Conflicts", "Aging evidence"].every((t) => overviewSrc.includes(t)));
check("demonstration moment shows the progression and the why panel", overviewSrc.includes("Demonstration moment") && overviewSrc.includes("Why did it change?"));
check("history rows expose evidence coverage, primary driver and policy", ["Evidence:", "Primary driver:", "Policy:", "Audit: Available", "AI: Not consulted"].every((t) => listsSrc.includes(t)));
// Stage labels moved to the audit.<event>.* catalog family (localisation spec section 4);
// the wording is still enforced — at the catalog source of truth, plus key usage in code.
const enCatalogGuard = JSON.parse(readFileSync(join(root, "src", "i18n", "catalogs", "en-ZA.json"), "utf8"));
check("audit lifecycle follows the section-28 pipeline stages", ["Evidence received", "Evidence quality evaluated", "Rules evaluated", "Decision drivers identified", "Disposition recorded", "Audit saved"].every((label) => Object.values(enCatalogGuard).includes(label)));
check("audit lifecycle resolves stage labels through the catalog", ["audit.stage.evidence_received", "audit.stage.quality_evaluated", "audit.stage.rules_evaluated", "audit.stage.drivers_identified", "audit.stage.disposition_recorded", "audit.stage.audit_saved"].every((key) => auditTimelineSrc.includes(key)));

console.log("");
if (failures > 0) {
  console.error(`COPY GUARD FAILED: ${failures} machine-text leak(s) found.`);
  process.exit(1);
}
console.log("COPY GUARD PASSED — no machine text in human-facing copy.");

