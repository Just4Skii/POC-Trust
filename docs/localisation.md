# Localised Clinical Interaction Layer

**Status: post-stabilisation presentation layer.** This feature changes how explanations are
*presented*; it never changes what is *decided*.

## The one-line rule

> The decision is language-neutral. Only the explanation around it is localised.

`disposition = REVIEW` is `REVIEW` in English, isiZulu, isiXhosa and Afrikaans. The
machine-readable record, the deterministic reliability engine, the TRUST/REVIEW/VERIFY
semantics, the AI safety boundaries and the API contracts are untouched by localisation.
Language changes only how reasons, instructions and context are presented to the operator.

## Scope — what is and is not translated

| Localised (operator-facing presentation) | Canonical / language-neutral (data) |
| --- | --- |
| Reason sentences ("Calibration has expired.") | Persisted values, enums, rule IDs, audit event types |
| Next-action instructions | API field names and payloads |
| Evidence labels, evidence-state descriptions | The canonical status codes as data (TRUST/REVIEW/VERIFY) |
| Status descriptions (not the code) | Assessment/audit identifiers |
| Navigation labels, buttons, empty-state text | Log and technical-detail content |
| Offline/sync explanations, onboarding guidance | The English source strings on decision screens |

**Status display pattern (spec section 2):** decision screens always show the canonical code
*and* the localised label together — `REVIEW · <localised label>` — plus a **Show in English**
toggle so the canonical wording is one click away without changing the operator's stored
preference.

## Architecture — static, reviewed message catalogs

Runtime machine translation of safety-critical text is **forbidden**. Catalogs are
pre-authored, keyed by stable message keys, shipped with the app (offline-capable), and
versioned.

**Library choice: react-i18next + i18next.** Justification: the smallest mainstream React
option with built-in per-locale lazy bundles, `Intl.PluralRules`-based plurals (ICU-equivalent)
and interpolation; FormatJS ships a heavier ICU parser and Lingui couples rendering to a
compile step. Bundle impact: ~128 kB gzip total app bundle including the library; each
non-English catalog is a separate ~2.5 kB gzip lazy chunk, loaded only when selected.

Key layout (`frontend/poc-trust-ui/src/i18n/`):

```
catalogs/en-ZA.json   source of truth (bundled eagerly — it is the mandatory fallback)
catalogs/zu-ZA.json   lazy chunk
catalogs/xh-ZA.json   lazy chunk
catalogs/af-ZA.json   lazy chunk
meta/<locale>.json    per-key review metadata (status, source, reviewer, reviewed_at, source_hash)
index.ts              runtime init, lazy loading, <html lang> sync, device preference
strings.ts            localised accessors with family-unit fallback (extends lib/labels.ts)
support.ts            support-state derivation from real metadata (never hard-coded)
```

### Key taxonomy — the whole explanation chain

Every driver of a decision gets a consistent key family, so the reason, the evidence card,
the next action and the audit label always tell the same story in the same language:

```
driver.<rule>.title / .explanation / .action      e.g. driver.cal_expired.title
evidence.<item>.label / .last_verified            e.g. evidence.reagent.label
evidence.state.<state>.label / .meaning           e.g. evidence.state.aging.meaning
decision.<state>.label / .description / .strip / .next_action / .can_rely
audit.stage.<event>                               e.g. audit.stage.disposition_recorded
ui.*                                              navigation, selector, preview labels, hero buttons
```

Rules enforced by `scripts/check-i18n.mjs` (wired into `npm run check:i18n` and
`check:contract`):

- one rule ID maps to a FIXED key family; every rule ID the engine emits must have its full
  family defined in English (completeness check against the engine rule vocabulary);
- dates, times and counts are DATA — interpolated via i18next at render time, never baked
  into translated strings;
- **family-unit fallback**: a driver is shown in a locale only when its whole family resolves
  there (`src/i18n/strings.ts`); otherwise the family falls back to English AS A UNIT, so the
  operator never sees a half-translated explanation chain;
- missing or empty strings always fall back to English — never a raw key, never an empty
  string, never unreviewed machine output standing in for canonical wording;
- every catalog value in every locale passes the same machine-text detector the copy guard
  uses (scanned as rendered text, interpolation placeholders excluded).

## Translation tooling — machine translation is a drafting aid

Machine output was used (and is used at development time only) to produce FIRST DRAFTS for
isiZulu and isiXhosa, stored with `status: "draft"`, `source: "machine_draft"`. Machine output
is never promoted to "reviewed" automatically; no translation API is called at runtime for any
safety-critical text; no API keys exist in the frontend or repository. Quality of
medical/technical terminology for isiZulu and isiXhosa is treated with extra scepticism for
exactly this reason. Where no accepted equivalent exists, the glossary keeps the English term
— a mistranslated safety instruction is worse than an English technical term.

Provider language coverage must always be verified against the provider's official
documentation on the day it is used; no provider's coverage is hard-coded as fact anywhere in
this repository.

## Review workflow and translation status

Every catalog entry carries metadata in `src/i18n/meta/<locale>.json`:

```json
{ "status": "draft | in_review | reviewed",
  "source": "human | machine_draft | machine_edited",
  "reviewer": "<name/role when reviewed>",
  "reviewed_at": "<date when reviewed>",
  "source_hash": "<sha256 of the English source string>" }
```

If the English source text changes, `npm run i18n:sync` recomputes `source_hash`; any
translation whose hash no longer matches reverts to `draft` automatically — a translation can
never silently drift from its source. `--check` mode fails CI on drift.

**Review standard:** safety-critical strings must be reviewed by appropriately qualified
native speakers, ideally with health-sector/diagnostic terminology experience, before being
marked `reviewed`.

**Release gate:** a locale is presented as *supported* only when ALL its safety-critical
strings are `reviewed`; until then the UI derives its state from the real metadata and labels
it `Preview — draft`. The language menu, the Settings language card and the decision-screen
preview label all read this state — nothing is hard-coded.

## Terminology glossary (review FIRST, before sentences)

Machine drafts below — pending native-speaker clinical-linguistic review; reviewers may keep
the English term where no accepted equivalent exists.

| English | Afrikaans (draft) | isiZulu (draft) | isiXhosa (draft) |
| --- | --- | --- | --- |
| repeat test | herhaal die toets | phinda uhlolo | phinda uvavanyo |
| trained operator | opgeleide operateur | i-operateri eqeqeshiwe | i-operateri eqeqelisiweyo |
| quality control | gehaltebeheer | ukulawula ikhwalithi | ulawulo lwekhwalithi |
| calibration | kalibrasie | i-calibration | i-calibration |
| expired | verstryk | kuphelelwe yisikhathi | kuphelelwe lixesha |
| invalid | ongeldig | akulungile | akulunganga |
| reagent | reagens | i-reagent | i-reagent |
| result cannot be relied upon | die uitslag kan nie betrou word nie | isiphumo asinakwazi ukwethenjwa | isiphumo alinakwazi ukwethenjwa |
| confirmatory testing | bevestigende toetsing | uhlolo lwokuqinisekisa | uvavanyo lokuqinisekisa |
| verification required | verifiëring vereis | kudingeka ukuqinisekiswa | kufuneka ukuqinisekiswa |
| review recommended | hersiening aanbeveel | kunconywa ukubuyekezwa | kucebiswa ukubuyekezwa |
| device | toestel | idivayisi | isixhobo |
| operator | operateur | i-operateri | i-operateri |
| audit trail | ouditspoor | umkhondo wokurekhoda | umkhondo wokubhaliweyo |
| synchronisation / offline | sinchronisering / aflyn | ukuvumelanisa / ngaphandle koxhumano | ukvumelanisa / ngaphandle koqhagamshelwano |

## Claims policy

Never claim, until reviewed translations genuinely exist for the claimed scope:

- "POC Trust supports South Africa's three major languages"
- "clinically validated translations"
- "fully localised" / "fully translated"

Permitted, as applicable:

- "Localisation architecture in place; language preview available."
- "Draft translations — pending clinical linguistic review."
- "English, isiZulu, isiXhosa and Afrikaans supported for the reviewed instruction set" —
  only once true, and stating the scope.

Wherever draft translations are displayed, the preview label is visible:
**LANGUAGE PREVIEW — DRAFT TRANSLATIONS · Not yet reviewed by clinical linguists.**

## Language selector and preference

- ONE compact control (`Language: English ▾`): sidebar footer on desktop, duplicated in
  Settings; deliberately NOT in the header (which already carries the demonstration
  indicator, palette hint, help, online status and last-sync time). On narrow screens it
  lives in Settings. Entries render language names in their own language with their support
  state from real catalog metadata. A native `<select>` keeps it keyboard- and
  screen-reader-accessible.
- Preference is a device/browser setting (`poctrust.language` in local storage) — the
  prototype has no authentication, so nothing implies a verified operator identity. Default:
  browser language when it matches a supported locale, else English; always overridable.
- Switching is instant — no page reload, no form-state loss; `<html lang>` follows the active
  locale so screen readers and hyphenation behave correctly.

## Languages

Initial set: `en-ZA` (canonical source), `zu-ZA`, `xh-ZA`, `af-ZA`, using BCP 47 codes. The
registry (`src/i18n/locales.ts`) is the only place a further official language (e.g. Sesotho,
Sepedi, Setswana, Xitsonga) is added: one catalog, one meta file, one entry.

Rationale for the initial set: these are among the most widely spoken home languages in South
Africa per **Statistics South Africa, Census 2022** — consult the primary release at
<https://census.statssa.gov.za/> (Census 2022 products, "Main place of residence and language"
tables) rather than relying on repeated figures.

## Deliberate boundaries (this increment)

- The audit trail records decision data language-neutrally. Recording WHICH language and
  catalog version was displayed for an assessment requires a small, additive backend change
  (optional `uiLocale`/`catalogVersion` fields — no decision-logic change, no contract
  break) and remains **deferred pending explicit approval** (spec section 12).
- Sub-lines of the audit pipeline embed persisted record statements (language-neutral data)
  and stay canonical; the stage labels themselves are localised.
- Contextual Analysis content stays English in every locale (section 9, default policy):
  the panel's framing is localised and, in non-English locales, the panel states that the
  advisory text is currently available in English. The AI prose carries `lang="en"`.
  On-demand machine translation of advisory text (the optional later phase) was not built.
- Dates/times render via Intl with the active locale and a **verified** en-ZA fallback:
  a formatter is trusted only when the runtime resolves it to the same language (some
  runtimes lack zu/xh ICU data — verified, never assumed). Timezone stays
  Africa/Johannesburg. Recorded clinical values are never re-formatted.
- Catalogs, review metadata and the language selector's support states ship with the app
  and are warmed right after first paint, so switching language works without a network;
  a failed catalog load is never cached and simply refuses the switch (English fallback
  stays authoritative). Full runtime-translation independence is gate-enforced.
- Remaining furniture (some settings/operational page copy, the header sync chip) keeps
  its existing English copy until the next preview-set expansion; the mechanism above
  extends to it without redesign.

Verification evidence and the acceptance-criteria mapping for this feature live in
[`localisation-report.md`](localisation-report.md).
