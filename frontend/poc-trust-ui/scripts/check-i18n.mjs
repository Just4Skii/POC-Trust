#!/usr/bin/env node
/**
 * i18n completeness check (spec section 4).
 *
 * Enforces, for the LOCALISATION layer:
 *  1. EN SOURCE COMPLETENESS — every rule ID in the engine's vocabulary carries its FULL key
 *     family (driver.<rule>.title/.explanation/.action) in en-ZA; likewise evidence states,
 *     evidence items, decision families, audit stage labels and the ui.* keys.
 *  2. KEY PARITY — every locale catalog has exactly the en-ZA key set, so a driver family is
 *     either fully present or falls back to English AS A UNIT (runtime gate in
 *     src/i18n/strings.ts; parity here makes the gate provable).
 *  3. HUMAN-TEXT SAFETY — every value in every catalog passes the same machine-text detector
 *     the copy guard uses; a translation can never leak UPPER_SNAKE tokens, raw JSON or GUIDs.
 *  4. CLAIMS POLICY (spec section 7) — forbidden overclaims never appear in catalogs or UI.
 *  5. REQUIRED WORDING — the honesty labels and decision-screen pattern keys exist.
 *
 * Run: node scripts/check-i18n.mjs   (wired into `npm run check:i18n` and `check:contract`)
 * Meta/source-hash drift is checked separately by `i18n-meta.mjs --check`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EVIDENCE_STATE_COPY, KNOWN_RULE_IDS, findMachineText,
} from "../src/lib/labels.ts";
import en from "../src/i18n/catalogs/en-ZA.json" with { type: "json" };

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;

function check(name, ok, detail = "") {
  if (ok) console.log(`  PASS ${name}`);
  else { failures++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const contentKeys = Object.keys(en).filter((k) => k !== "version");
const LOCALES = ["en-ZA", "zu-ZA", "xh-ZA", "af-ZA"];
const readCatalog = (l) => JSON.parse(readFileSync(join(root, "src", "i18n", "catalogs", `${l}.json`), "utf8"));

// ── 1. English source completeness ───────────────────────────────────────────
console.log("English source completeness:");
const fam = (base, variants) => variants.every((v) => typeof en[`${base}.${v}`] === "string" && en[`${base}.${v}`].length > 0);
for (const id of KNOWN_RULE_IDS) {
  check(`driver family ${id}`, fam(`driver.${id.toLowerCase()}`, ["title", "explanation", "action"]));
}
for (const state of Object.keys(EVIDENCE_STATE_COPY)) {
  check(`evidence state family ${state}`, fam(`evidence.state.${state}`, ["label", "meaning"]));
}
for (const status of ["trust", "review", "verify"]) {
  check(`decision family ${status}`, fam(`decision.${status}`, ["label", "description", "strip", "next_action", "can_rely"]));
}
const EVIDENCE_ITEMS = ["device", "qc", "cal", "op", "reagent", "env", "prov", "conn"];
// The item list must match the rows the evidence lib actually renders:
const evidenceLibSrc = readFileSync(join(root, "src", "lib", "evidence.ts"), "utf8");
for (const item of EVIDENCE_ITEMS) {
  check(`evidence item label ${item}`, typeof en[`evidence.${item}.label`] === "string" && new RegExp(`key: "${item}"`).test(evidenceLibSrc));
}
const AUDIT_STAGES = ["evidence_received", "quality_evaluated", "rules_evaluated", "drivers_identified", "disposition_recorded", "advisory_consulted", "advisory_not_consulted", "audit_saved"];
for (const stage of AUDIT_STAGES) {
  check(`audit stage label ${stage}`, typeof en[`audit.stage.${stage}`] === "string" && en[`audit.stage.${stage}`].length > 0);
}
const UI_KEYS = [
  "ui.app.tagline",
  ...["overview", "new", "assessments", "audit", "devices", "operators", "qc", "settings"].map((n) => `ui.nav.${n}`),
  "ui.language.label", "ui.language.selector_aria", "ui.language.show_english", "ui.language.show_native",
  "ui.language.supported_note", "ui.support.preview", "ui.support.reviewed", "ui.support.reviewed_count",
  "ui.preview.banner", "ui.preview.note", "ui.catalog.version",
  "ui.hero.next_action", "ui.hero.do_not_rely", "ui.hero.result", "ui.hero.initial_assessment",
  "ui.action.review_evidence", "ui.action.check_device", "ui.action.repeat_test", "ui.action.back_to_history",
  "ui.driver.suggested_action", "ui.common.not_recorded",
];
const missingUi = UI_KEYS.filter((k) => typeof en[k] !== "string" || en[k].length === 0);
check("ui.* key set present in en-ZA", missingUi.length === 0, `missing: ${missingUi.join(", ")}`);

// ── 2. Key parity across locales (drives family-unit fallback) ───────────────
console.log("Locale key parity:");
for (const locale of LOCALES.slice(1)) {
  const cat = readCatalog(locale);
  const missing = contentKeys.filter((k) => typeof cat[k] !== "string" || cat[k].length === 0);
  const extra = Object.keys(cat).filter((k) => k !== "version" && !contentKeys.includes(k));
  check(`${locale} has the full en-ZA key set (family-unit rule)`, missing.length === 0 && extra.length === 0,
    `${missing.length} missing, ${extra.length} unexpected`);
}

// ── 3. Machine-text safety over every catalog value ──────────────────────────
console.log("Catalog human-text safety:");
for (const locale of LOCALES) {
  const cat = readCatalog(locale);
  const leaks = [];
  for (const [key, value] of Object.entries(cat)) {
    if (key === "version" || typeof value !== "string") continue;
    // Scan the RENDERED text: {{placeholder}} slots are the sanctioned interpolation
    // mechanism (values are interpolated as DATA at render time), not JSON leakage.
    const rendered = value.replace(/\{\{[^}]+\}\}/g, "DATA");
    const found = findMachineText(rendered);
    if (found.length > 0) leaks.push(`${key}: ${found.join(", ")}`);
  }
  check(`${locale} values are human-safe`, leaks.length === 0, leaks.slice(0, 3).join(" | "));
}

// ── 4. Claims policy (spec section 7) — no overclaims anywhere ───────────────
console.log("Claims policy:");
const FORBIDDEN_CLAIMS = [
  [/\bfully\s+localised\b/i, "claim: fully localised"],
  [/\bclinically\s+validated\s+translations?\b/i, "claim: clinically validated translations"],
  [/supports?\s+south\s+africa'?s\s+three\s+major\s+languages/i, "claim: three major languages"],
  [/\bfully\s+translated\b/i, "claim: fully translated"],
];
const catalogSrc = LOCALES.map((l) => readCatalog(l));
const uiSrcFiles = [
  join(root, "src", "components", "LanguagePicker.tsx"),
  join(root, "src", "pages", "Meta.tsx"),
  join(root, "src", "pages", "Assessment.tsx"),
  join(root, "src", "i18n", "strings.ts"),
];
let claimHits = [];
for (const cat of catalogSrc) {
  for (const value of Object.values(cat)) {
    for (const [pattern, why] of FORBIDDEN_CLAIMS) {
      if (pattern.test(String(value))) claimHits.push(`catalog: ${why}`);
    }
  }
}
for (const file of uiSrcFiles) {
  const src = readFileSync(file, "utf8");
  for (const [pattern, why] of FORBIDDEN_CLAIMS) {
    if (pattern.test(src)) claimHits.push(`${file.split(/[\\/]/).pop()}: ${why}`);
  }
}
check("no forbidden localisation claims", claimHits.length === 0, claimHits.slice(0, 3).join(" | "));

// ── 5. Required wording — the decision-screen pattern must be reachable ──────
console.log("Required wording (localisation):");
const assessmentSrc = readFileSync(join(root, "src", "pages", "Assessment.tsx"), "utf8");
check("canonical status code stays visible beside the localised label", assessmentSrc.includes("finalName.toUpperCase()"));
check("decision screen offers 'Show in English'", assessmentSrc.includes("ui.language.show_english"));
check("decision screen shows the draft-preview label", assessmentSrc.includes("ui.preview.banner"));
const pickerSrc = readFileSync(join(root, "src", "components", "LanguagePicker.tsx"), "utf8");
check("language picker derives support state from real metadata", pickerSrc.includes("useLocaleSupport"));
const stringsSrc = readFileSync(join(root, "src", "i18n", "strings.ts"), "utf8");
check("driver families resolve as a unit (English fallback)", stringsSrc.includes("familyLng"));
check("dates are interpolated as data, never baked into strings", en["evidence.cal.last_verified"] === "Due {{date}}");

console.log("");
if (failures > 0) {
  console.error(`I18N CHECK FAILED: ${failures} issue(s) found.`);
  process.exit(1);
}
console.log("I18N CHECK PASSED — catalogs complete, human-safe and honestly labelled.");
