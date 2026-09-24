#!/usr/bin/env node
/**
 * i18n meta generator — maintains src/i18n/meta/<locale>.json from the en-ZA source catalog.
 *
 * Every catalog entry carries review metadata (spec section 6):
 *   key, locale, status (draft|in_review|reviewed), source (human|machine_draft|machine_edited),
 *   reviewer, reviewed_at, source_hash (SHA-256 of the ENGLISH source string).
 *
 * If the English source text changes, translations of that key revert to draft/needs-re-review
 * automatically via source_hash mismatch — a translation can never silently drift from its
 * source. Hand-set "reviewed" statuses on non-English locales are PRESERVED while their
 * source_hash still matches the current English text.
 *
 * Modes:
 *   node scripts/i18n-meta.mjs          → update meta files in place (add missing, fix hashes)
 *   node scripts/i18n-meta.mjs --check  → verify only; exit 1 on drift (used by check:i18n)
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import en from "../src/i18n/catalogs/en-ZA.json" with { type: "json" };

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const metaDir = join(root, "src", "i18n", "meta");
const LOCALES = ["en-ZA", "zu-ZA", "xh-ZA", "af-ZA"];
const check = process.argv.includes("--check");

const sha = (text) => createHash("sha256").update(text).digest("hex");

// Keys that carry review metadata (everything except the catalog version marker).
const contentKeys = Object.keys(en).filter((k) => k !== "version");
const enHashes = Object.fromEntries(contentKeys.map((k) => [k, sha(en[k])]));

let drift = 0;

for (const locale of LOCALES) {
  const file = join(metaDir, `${locale}.json`);
  let existing = {};
  try { existing = JSON.parse(readFileSync(file, "utf8")); } catch { /* first run */ }

  const isSource = locale === "en-ZA";
  const next = {};

  for (const key of contentKeys) {
    const prev = existing[key];
    const hash = enHashes[key];
    if (isSource) {
      next[key] = {
        status: "reviewed",
        source: "human",
        reviewer: prev?.reviewer ?? "POC Trust prototype team (source of truth)",
        reviewed_at: prev?.reviewed_at ?? "2026-09-25",
        source_hash: hash,
      };
      continue;
    }
    // Non-source locale: keep human review state while the English source is unchanged.
    const sourceUnchanged = prev?.source_hash === hash;
    const keptReview =
      sourceUnchanged && (prev?.status === "reviewed" || prev?.status === "in_review")
        ? {
            status: prev.status,
            source: prev.source === "human" ? "machine_edited" : prev.source,
            reviewer: prev.reviewer,
            reviewed_at: prev.reviewed_at,
          }
        : { status: "draft", source: "machine_draft" };
    next[key] = { ...keptReview, source_hash: hash };
    if (!sourceUnchanged && prev) drift++;
  }

  // Version marker rides along so the UI can show a knowable catalog version.
  next.version = existing.version ?? 1;

  const ordered = Object.fromEntries(contentKeys.map((k) => [k, next[k]]).concat([["version", next.version]]));
  const sorted = Object.keys(ordered).sort().reduce((acc, k) => { acc[k] = ordered[k]; return acc; }, {});

  if (check) {
    const same = JSON.stringify(sorted) === JSON.stringify(existing);
    console.log(`  ${same ? "PASS" : "FAIL"} meta/${locale}.json ${same ? "in sync" : "out of date — run: npm run i18n:sync"}`);
    if (!same) drift++;
  } else {
    writeFileSync(file, JSON.stringify(sorted, null, 2) + "\n");
    const reviewed = Object.values(sorted).filter((e) => e?.status === "reviewed").length;
    console.log(`  meta/${locale}.json — ${contentKeys.length} keys, ${reviewed} reviewed`);
  }
}

if (check && drift > 0) {
  console.error(`I18N META DRIFT: ${drift} issue(s). Run: npm run i18n:sync`);
  process.exit(1);
}
if (!check) console.log("Meta files updated.");
