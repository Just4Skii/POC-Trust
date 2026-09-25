# Localised Clinical Interaction Layer, Final Implementation Report

**Scope delivered:** spec chunks 1–6 of 6 (sections 1–16), implemented in two passes:
sections 1–8 (foundation, decision-screen pattern, language selector) and sections 9–16
(Contextual-Analysis policy, offline operation, UX/formatting constraints, backend-impact
policy, phased delivery, testing, acceptance, this report).

**Spec headline honoured end to end:** *the decision is language-neutral; only the
explanation around it is localised.*

---

## 1. i18n approach and library chosen (and why)

**Library: react-i18next + i18next** (already recorded in `docs/localisation.md`).
Rationale, briefly: the smallest mainstream React option with lazy per-locale bundles,
`Intl.PluralRules`-based plurals (ICU MessageFormat-equivalent for this catalog's needs)
and interpolation; FormatJS ships a heavier ICU parser, Lingui couples to a compile step.
Interpolation is used for all dates/counts, no translated fragment is ever concatenated.

Key architectural properties (all verified by the gates below):

- **English (en-ZA) is the source of truth and the mandatory fallback.** It is bundled
  eagerly; zu/xh/af catalogs lazy-load as ~2.9 kB gzip chunks.
- **Static reviewed catalogs, never runtime machine translation.** No translation-service
  call exists anywhere in the app source; the copy/i18n gates scan for known provider
  endpoints (Google Cloud Translation, Azure Translator, DeepL, LibreTranslate) and fail
  the build if one appears.
- **Family-unit fallback:** a driver/decision/evidence-state key family renders in a
  locale only when *every* member resolves there; otherwise the whole family falls back
  to English as a unit. Tested live against the real i18next instance (check-i18n §7).
- **A missing key can never surface as raw key text or an empty string**, enforced by
  `parseMissingKeyHandler`, `returnNull:false`, `returnEmptyString:false`, the English
  fallback layer, and a live behavioural test.

## 2. Catalog inventory (per locale, split by review state)

| Locale | Keys | Reviewed | In review | Draft (machine-drafted) | Missing |
|--------|------|----------|-----------|--------------------------|---------|
| en-ZA  | 128  | 128      | 0         | 0                        | 0       |
| zu-ZA  | 128  | 0        | 0         | 128                      | 0       |
| xh-ZA  | 128  | 0        | 0         | 128                      | 0       |
| af-ZA  | 128  | 0        | 0         | 128                      | 0       |

Key families: `driver.<rule>.{title,explanation,action}` for all 12 engine rule IDs,
`decision.<state>.{label,description,strip,next_action,can_rely}`,
`evidence.<item>.label`/`.last_verified`, `evidence.state.*.{label,meaning}` (8 states),
`audit.stage.*` (8 pipeline stages), and `ui.*` chrome (including the section-9 advisory
framing `ui.ai.*`, localised time words `ui.time.*`, and the announcement key
`ui.language.changed`). Dates and counts are DATA interpolated at render time, never
baked into translated strings (`evidence.cal.last_verified = "Due {{date}}"` is asserted).

Per-locale status counts are reported on every `check:i18n` run (spec section 14), and
the meta source-hashes are verified against the live English source each run.

## 3. Locales: "preview" vs "supported" (honest claims)

- **en-ZA, supported.** Fully reviewed source of truth.
- **zu-ZA, xh-ZA, af-ZA, preview.** Every string is a machine draft (`machine_draft`),
  awaiting clinical-linguistic review. The UI derives this state from the real review
  metadata: the language menu marks each entry "(Preview, draft)" in the active
  language, the decision screen carries
  **"Language preview, draft translations / Not yet reviewed by clinical linguists"**,
  and Settings shows "Reviewed 128/128" for English versus "Preview, draft 0/128" for
  the others, computed from meta, never hard-coded.
- No "supported" claim is made for any non-English locale anywhere in the product.
- Review workflow ready for Phase 2: a qualified reviewer promotes keys in
  `src/i18n/meta/<locale>.json` (`source: human`, `reviewed_at`); a locale becomes
  "supported" in the UI automatically, and only, when every key is `reviewed`.

## 4. Translation sources used for drafts (none auto-promoted)

zu/xh/af drafts were authored as careful machine-assisted drafts during development
(`source: machine_draft`, `status: draft` in meta), with deliberate English-term
fallbacks where no safe clinical equivalent exists (e.g. "calibration" kept in English
inside isiZulu sentences), following the 15-term glossary in `docs/localisation.md`.
Nothing was auto-promoted: the promotion path requires a human reviewer + date in meta,
and `i18n-meta.mjs` preserves hand-set reviewed states only while the English source is
unchanged. The functional drift test (`scripts/test-i18n-drift.mjs`) proves end-to-end
that editing an English string reverts affected translations to draft.

## 5. Persisted data is language-independent, confirmed

- **Backend: zero changes** in both localisation passes (`git diff` contains no `.cs`
  files; 131/131 backend tests untouched and green). Dispositions, rule IDs, reason
  strings, RIR payloads and audit entries are exactly as before.
- **Browser-verified (spec section 14):** the QA suite fetches a stored assessment's API
  payload in English, switches to isiZulu, re-fetches and asserts the two payloads are
  **byte-identical** (`PASS payload identical across languages`).
- Offline-created assessments continue to enqueue canonical values only; display strings
  depend solely on the active locale at render time.

## 6. VERIFY never shows Contextual Analysis, confirmed

The advisory panel returns null for VERIFY *before any rendering*, so the block (and its
localised framing, including the "available in English" note) is absent, not hidden,
in every language. Browser-verified for isiZulu and isiXhosa views
(`PASS absent: Contextual Analysis`), enforced statically by the copy/i18n gates, and
unchanged from the deterministic-engine guarantee (VERIFY renders no advisory content
in any language).

## 7. Contextual Analysis language policy (section 9, default)

- AI-generated text remains **English in every locale**, it is advisory content, never
  machine-translated at runtime; the English original is the persisted record.
- The framing around it is localised from the catalog (subtitle, authoritative-decision
  line, metadata labels, unavailable note).
- In non-English locales the panel states explicitly:
  **"Contextual Analysis is currently available in English."** (`ui.ai.english_only`,
  rendered in the active language).
- The English AI prose carries `lang="en"` so screen readers switch pronunciation for
  the inline language change (section 11).
- The optional later phase (on-demand machine translation of advisory text, labelled
  "Machine-translated. Not clinically reviewed.") was **not** built.

## 8. Offline behaviour, verified

- All locale catalogs and review metadata ship with the app (static, same-origin,
  hashed assets); after first paint an idle prefetch warms every locale into the module
  cache, so **switching language needs no network**.
- Browser-verified: after the warm-up, repeated switches between locales fetch **zero**
  new catalog chunks (`PASS switches served from warmed cache`).
- A failed catalog load is never cached and never breaks the screen: the switch is
  refused, the current language stays, English fallback remains authoritative, and the
  load retries when connectivity returns. No runtime dependency on any translation
  service exists at all.
- Limitation, honestly stated: a *cold* offline start of the whole app (no cache at all)
  is outside localisation's scope, the app is a network-delivered SPA; the localisation
  layer adds no new cold-start dependency because catalogs are ordinary app assets.

## 9. Formatting, layout and accessibility (section 11)

- **Dates/times** render through `Intl` with the active locale, timezone fixed to
  **Africa/Johannesburg**. Locale support is **verified, not assumed**: a formatter is
  trusted only when the runtime resolves it to the same language, otherwise it falls
  back to en-ZA (relative words "Today/Yesterday" come from the catalog like any copy).
  This was exercised for real: the QA headless browser carries no zu/xh ICU data and
  correctly fell back to en-ZA date parts while labels stayed isiZulu.
- **Numbers:** clinical measurement values are rendered exactly as recorded in every
  language (re-formatting recorded values was deliberately rejected as a safety risk);
  counts/percentages are simple digits identical across these locales.
- **Text expansion:** evidence values, activity text, primary-driver phrases and monitor
  readings were moved from truncation to wrapping (`break-words`); safety text is never
  truncated; list-title ellipsis remains only for navigation rows whose full value is on
  the record. Verified at **390 px in isiZulu: zero horizontal overflow** on overview,
  list and record screens.
- **Accessibility:** the language selector is a labelled native `<select>` (keyboard/SR
  operable); `<html lang>` follows the active locale; inline English content inside
  translated screens (advisory prose, supervisor override) declares `lang="en-ZA"/"en"`;
  language changes are announced through a polite live region in the new language
  (`ui.language.changed`); status remains icon + canonical code + label (never colour or
  language alone); contrast and motion behaviour unchanged.

## 10. Viewports and suites actually exercised

- **1440×1000:** English baseline; isiZulu REVIEW (label, preview banner, advisory note,
  `lang="en"` prose); isiZulu VERIFY (zero advisory content); isiZulu TRUST; Afrikaans
  and isiXhosa decision screens; Show-in-English round trip (hero + reason chain);
  payload-identity check; announcement live region present. Screenshots in
  `docs/assets/i18n-*.png`.
- **390×844 (isiZulu):** overview, list and record, 0 px horizontal overflow.
- Suites: `browser-qa4.sh` (33 checks, localisation) PASS; legacy `browser-qa3.sh`
  (integrity upgrade) PASS; `live-verify2.sh` (API E2E) PASS; `check:contract` chain,
  contract checks, copy guard, meta drift gate, i18n completeness/behaviour checks and
  the functional drift test, all PASS; `dotnet build` 0 warnings, `dotnet test`
  131/131; `npm run build` and `oxlint` 0 warnings/errors.

## 11. Backend / API impact (section 12)

**Preferred path taken: zero backend change.** The optional, additive,
approval-required recording of `uiLocale` and `catalogVersion` in assessment/audit
metadata (so the displayed language becomes traceable, "what instruction did the
operator actually see?") is **specified but NOT implemented**, pending explicit
approval. It remains a small, additive design: two optional fields, no decision-logic
change, no contract break, covered by tests when approved.

## 12. Phase status (section 13)

| Phase | Status |
|-------|--------|
| 0, Foundation (library, keyed catalogs, humanization integration, fallback, `lang` attr, English unchanged) | **Done** |
| 1, Preview set (pilot strings incl. the three demo scenarios, drafts, compact menu + preview label, demo moment) | **Done** |
| 2, Review pipeline (glossary ready, review workflow + promotion, source-hash drift detection) | **Tooling done; human review outstanding** (external native speakers) |
| 3, Operator experience (device preference, Show in English) | **Done** (side-by-side supervisor view: optional, not built) |
| 4, Localised clinical interaction (voice, more languages, local workflow guidance) | **Not attempted**, per spec |

## 13. Limitations and what still requires clinical-linguistic review

1. All zu/xh/af strings are unreviewed machine drafts, terminology (especially
   clinical/safety phrasing) must be reviewed by qualified native speakers before any
   non-preview claim.
2. Where no accepted equivalent exists, drafts keep the English technical term; the
   glossary decision ("English term vs translated term") is a reviewer decision.
3. zu/xh **ICU formatting data is absent in some runtimes** (the QA headless browser,
   for example); the verified en-ZA fallback handles this, but real-device checks with
   full-ICU browsers are advisable before wide preview use.
4. Chrome text beyond the decision screens (sync chip, some settings/operational pages)
   is still English-only, the next preview-set expansion, deliberately deferred to keep
   this pass auditable.
5. Catalog versioning is present (`version` marker + per-key hashes); bumping the
   version per reviewed release is part of the Phase-2 reviewer workflow.
6. No provider language-coverage claims are hard-coded anywhere; coverage must be
   verified against official documentation on the day any MT-assisted drafting is used
   again.

## 14. Acceptance criteria (section 15), mapping

| Criterion | Evidence |
|-----------|----------|
| English experience unchanged after Phase 0 | English bundle render verified byte-stable across passes; legacy suites green |
| Persisted/decision data identical across languages | Payload byte-identity check (QA4); zero backend diff |
| Canonical status code always visible beside localised label | Hero pattern `REVIEW · <localised label>`; asserted in every locale |
| Draft translations visibly labelled | Preview banner + menu suffix + Settings states, all derived from real meta |
| Only "reviewed" strings described as supported | Support state computed from meta; en=128/128, others 0/128 → preview |
| No runtime translation of safety-critical text | No translation API in source (gate-scanned); static catalogs only |
| Works offline | Idle prefetch + no-new-fetch check; refused switch on failed load |
| No API keys exposed | No translation service integration exists at all |
| "Show in English" on decision screens | Hero + reason-chain override, verified both directions |
| Contextual Analysis policy respected in every locale | English-only advisory note; localised framing; VERIFY has none in any locale |
| No layout breakage at 390px with longer strings | isiZulu 390 px suite: 0 px overflow; wrap-not-truncate fixes |
| Claims in UI/docs match review status | Claims-policy bans in copy + i18n gates; this report states drafts only |
| Language control is a single compact menu, not header items | Sidebar footer + Settings duplicate; copy-guard placement check |
| Menu shows real per-language support state | Derived from meta at runtime (never hard-coded) |
| Every engine rule ID has a complete key family in English | check-i18n family coverage for all 12 rules |
| Driver localised as a whole unit or falls back as a unit | family-unit gate + live behavioural tests (missing member → English chain) |
| No provider language-coverage claims hard-coded | Gate scan for provider endpoints/claims; none exist |
