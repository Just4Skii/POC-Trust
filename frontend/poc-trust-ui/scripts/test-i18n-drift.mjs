#!/usr/bin/env node
/**
 * Source-hash drift test (localisation spec section 14).
 *
 * Proves, END TO END against a sandbox copy of the real catalogs + meta:
 *   1. editing an English source string marks its translations as needing re-review
 *      (status reverts to "draft"/"machine_draft", source_hash becomes the new hash);
 *   2. translations whose English source did NOT change keep their human review state;
 *   3. the en-ZA source meta itself stays "reviewed" throughout.
 *
 * Run: node scripts/test-i18n-drift.mjs   (wired into `npm run check:i18n`)
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  PASS ${name}`);
  else { failed++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};
const sha = (t) => createHash("sha256").update(t).digest("hex");

// 1. Sandbox copy of catalogs + meta.
const sandbox = mkdtempSync(join(tmpdir(), "poctrust-i18n-"));
cpSync(join(root, "src", "i18n"), join(sandbox, "src", "i18n"), { recursive: true });

const DRIFT_KEY = "driver.cal_expired.explanation";
const KEEP_KEY = "driver.qc_failed.title";
const mutated = "MUTATED — the calibration validity boundary has moved for this test run.";
const zuMetaPath = join(sandbox, "src", "i18n", "meta", "zu-ZA.json");
const enMetaPath = join(sandbox, "src", "i18n", "meta", "en-ZA.json");

try {
  // 2. Simulate a human-reviewed translation for two keys (one will drift, one will not).
  const zuMeta = JSON.parse(readFileSync(zuMetaPath, "utf8"));
  const enCatalog = JSON.parse(readFileSync(join(sandbox, "src", "i18n", "catalogs", "en-ZA.json"), "utf8"));
  for (const key of [DRIFT_KEY, KEEP_KEY]) {
    zuMeta[key] = { status: "reviewed", source: "human", reviewer: "Test reviewer", reviewed_at: "2026-09-25", source_hash: sha(enCatalog[key]) };
  }
  writeFileSync(zuMetaPath, JSON.stringify(zuMeta, null, 2) + "\n");

  // 3. Mutate ONE English source string in the sandbox.
  enCatalog[DRIFT_KEY] = mutated;
  writeFileSync(join(sandbox, "src", "i18n", "catalogs", "en-ZA.json"), JSON.stringify(enCatalog, null, 2) + "\n");

  // 4. Run the real sync over the sandbox.
  const run = spawnSync(process.execPath, [join(root, "scripts", "i18n-meta.mjs"), "--root", sandbox], { encoding: "utf8" });
  check("i18n-meta sync runs over the sandbox", run.status === 0, run.stderr?.slice(0, 200));

  // 5. Assert the drift reversion + preservation.
  const after = JSON.parse(readFileSync(zuMetaPath, "utf8"));
  check("mutated English reverts the translation to draft", after[DRIFT_KEY].status === "draft" && after[DRIFT_KEY].source === "machine_draft",
    JSON.stringify(after[DRIFT_KEY]));
  check("reverted translation records the NEW source hash", after[DRIFT_KEY].source_hash === sha(mutated));
  check("unmutated translation KEEPS its human review", after[KEEP_KEY].status === "reviewed" && after[KEEP_KEY].reviewer === "Test reviewer",
    JSON.stringify(after[KEEP_KEY]));
  check("kept translation keeps the OLD source hash", after[KEEP_KEY].source_hash === sha(enCatalog[KEEP_KEY] === mutated ? "" : readOld(enCatalog, KEEP_KEY)));
  const enMeta = JSON.parse(readFileSync(enMetaPath, "utf8"));
  check("en-ZA source meta stays reviewed", enMeta[DRIFT_KEY].status === "reviewed" && enMeta[DRIFT_KEY].source_hash === sha(mutated));
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

function readOld(catalog, key) {
  // The unmutated English text for KEEP_KEY (the catalog currently holds only the mutation).
  const original = JSON.parse(readFileSync(join(root, "src", "i18n", "catalogs", "en-ZA.json"), "utf8"));
  return original[key];
}

console.log("");
if (failed > 0) {
  console.error(`I18N DRIFT TEST FAILED: ${failed} issue(s).`);
  process.exit(1);
}
console.log("I18N DRIFT TEST PASSED — source-hash re-review reversion behaves correctly.");
