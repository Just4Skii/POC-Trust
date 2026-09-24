# Changelog

## 1.4.0-integrity-overview — Dashboard Integrity Overview, Enriched Rows, Audit Pipeline, Demonstration Moment (25 September 2026)

The third RIR increment (spec sections 26–39): the integrity story now reaches the whole
surface — the dashboard, the history list and the audit trail — and the demonstration gains a
deterministic centrepiece. All metrics are calculated from the stored records at request time;
nothing is preset. Frozen layers untouched (`ReliabilityEngine`, AI abstraction, orchestrator
semantics, audit sealing; 131/131 tests green, 0 warnings).

### Added

- **Integrity overview** (dashboard, section 26): four aggregates over the stored assessments —
  evidence coverage (e.g. "97% complete"), assessments with evidence concerns, detected
  conflicts, assessments with aging evidence — computed by the backend from the SAME projection
  the detail records use, with the environment labelled "Demonstration mode — synthetic data
  only" whenever demonstration records are present. Empty stores render an honest zero state.
- **Enriched history rows** (section 27): every list row now shows the evidence coverage
  ("Evidence: 6/7"), the primary driver ("Primary driver: Calibration expired"), the selected
  policy, an explicit AI indicator ("AI: Contextual Analysis" / "AI: Not consulted") and audit
  availability ("Audit: Available") — each row understandable before opening it. Row fields are
  derived by the same projector as the full record (no parallel derivation) and are optional in
  the payload, so older or unprojectable records simply render a plainer row.
- **Audit pipeline stages** (section 28): the per-assessment audit lifecycle now follows the
  full chain — Evidence received → Evidence quality evaluated → Rules evaluated → Decision
  drivers identified → Disposition recorded → Contextual Analysis consulted (only when it was)
  → Audit saved — each stage bound to the stored audit row and the derived record. The advisory
  stage stays visually secondary; it never reads as if the AI created the decision.
- **Demonstration moment** (section 30): the dashboard now carries the core proof of the
  integrity engine — "Watch one result become trustworthy, then watch its integrity context
  change" — rendering the stored three-step sequence TRUST → REVIEW → VERIFY with a
  "Why did it change?" panel whose lines are derived from the recorded findings (the same
  derivation the integrity timeline uses, via the projector's public `DescribeTransition`).
  Fully deterministic; the payload states `aiInvolved` and the card says "No advisory
  involvement — every change comes from the deterministic rules alone."
- **Scenario cards updated** (section 29): trust / review / verify / missing / offline cards
  now describe what the opened record's Result Integrity Record will show — coverage, concerns,
  conflicts, primary driver, synchronisation-metadata wording for offline — while the record
  itself remains the proof (numbers are never hardcoded into card copy).
- **New endpoint** `GET /api/dashboard/demonstration`: the stored demonstration sequence with
  per-step disposition, policy and derived change line; `available:false` with no invented
  steps when the sequence is not loaded.
- **Tests** (section 35): 14 new regression tests (`IntegrityUpgradeTests`) covering: RIR
  disposition equals the deterministic status for every scenario kind; no fabricated evidence
  (10 canonical domains, null identifiers for unrecorded evidence, coverage arithmetic); the
  eight-state taxonomy incl. the honestly-reserved STALE; causality from real rules with a
  structural no-numeric-driver guarantee and no weight/percent/contribution/confidence keys;
  policy displayed but never softening a hard VERIFY under either policy; byte-identical
  reopen consistency (states + provenance wording); RIR independence from AI (advisory outage),
  REVIEW-only advisory display, VERIFY never consulted, and a rogue advisory unable to move the
  disposition; dashboard aggregates recomputed independently; row/record consistency; and the
  demonstration sequence.

### Changed

- Copy guard (section 33/34): bans the raw machine identifiers `EVIDENCE_STATE`, `RIR_ID`,
  `POLICY_ID`, `RULE_WEIGHT`, `SOURCE_CONFIDENCE` from presentation code, and the unvalidated
  claims "clinically safe", "diagnostically correct", "clinical risk score" and "patient safety
  prediction"; requires the new dashboard/row/pipeline wording.
- Contract checks: 27/27 — the new row-integrity, overview and demonstration parsers are
  exercised defensively (garbage degrades to honest empty states, never crashes).

### Verification record

- `dotnet build` 0 warnings / 0 errors; `dotnet test` **131/131**.
- `npm run build` ok; `npm run lint` 0/0 (36 files); `npm run check:contract` 27/27 + copy guard PASS.
- API E2E (`scripts/live-verify2.sh`): overview aggregates recomputed independently from
  per-record RIRs and matching; all 13 row-integrity blocks agree with their full records;
  demonstration sequence TRUST → REVIEW → VERIFY with derived change lines and no advisory
  involvement; per-scenario RIRs (trust/review/verify/missing/offline) correct; reopening a
  record reproduces a byte-identical RIR.
- Browser E2E (`scripts/browser-qa3.sh`, 30 checks): integrity overview + demonstration moment
  render with the environment label; enriched rows; the section-28 audit pipeline on a record
  page; VERIFY page contains zero "Contextual Analysis" text; policy chip expands the policy
  panel; zero machine identifiers in the primary UI (regex scan of rendered text); zero
  horizontal overflow at 390px; reduced-motion handling present; no console errors. Legacy
  suites (`browser-qa2.sh`, `live-verify.sh`) still pass — seed/reset, audit chain valid,
  historical reopen, Evidence Monitor, Signal Map, Reliability Arc, Command Palette unchanged.
- Frozen layers absent from the diff: `ReliabilityEngine.cs`, `AssessmentOrchestrator.cs`,
  AI providers, `AuditChain.cs`, `EfAuditStore.cs`.

## 1.3.0-decision-causality — Evidence Conflict, Decision Drivers, Integrity Timeline, Policies (25 September 2026)

The second RIR increment (spec sections 10–25): the record now explains **why** the disposition
occurred (decision causality derived from the engine's own findings), detects **evidence
conflicts**, exposes **provenance detail without implying authentication**, shows an
**integrity timeline** including a genuinely recorded demonstration decision history, offers a
single **rule-based counterfactual** where the dependency is derivable, and formalises the
**demonstration policies** that state what evidence matters. Frozen layers untouched
(`ReliabilityEngine`, AI abstraction, orchestrator semantics; 117/117 tests green).

### Added

- **Decision causality** (`DecisionCausality` in the RIR): primary drivers, secondary
  considerations and informational context, classified from the engine's recorded findings.
  The projector re-runs the SAME deterministic rules on the SAME stored input at the SAME
  decision instant as a **gated verification** — the re-run must reproduce the stored decision
  exactly (status AND rule IDs) before any role classification is shown; otherwise the record
  falls back to the plain reason sentences and says so. Roles are qualitative
  (primary / secondary / informational) — no numeric weights exist anywhere.
- **Rule-based counterfactual** (one, guarded): only when there is exactly one primary driver,
  the driver has a well-defined "make current" mutation, no failed hard control is present, and
  the mutation actually changes the outcome. Always labelled "Deterministic decision
  comparison" / "Rule-based counterfactual", with an explicit "not a prediction — no
  probability" basis note. Never an LLM output; never clinical.
- **Evidence conflicts** (`EvidenceConflict`): detected inconsistencies between two recorded
  sources (QC recorded as passed while the environment snapshot is outside the policy's
  supported ranges; the engine's MULTI_CONTEXT interaction marker), each with source A, source
  B, what conflicts, why it matters, and the related rule IDs. The record states that it has
  detected an evidence inconsistency — never that it discovered a clinical truth. The old
  inflated conflict-count estimate was replaced with this honest model.
- **Integrity timeline**: decision-evolution view per record. Entries carry their basis inline
  — `recorded` (from the stored assessment), `derived` (policy boundaries computed from
  recorded timestamps, e.g. "calibration validity boundary passed"), or `demo-history`. When a
  record belongs to the seeded decision sequence, the timeline is explicitly labelled
  **"Demonstration decision history"**; single records are labelled a decision-time view. No
  historical events are faked.
- **Demonstration decision history** (seed data): a three-step sequence recorded through the
  REAL pipeline at historical instants as calibration evidence ages — TRUST → REVIEW → VERIFY —
  with transitions explained from the newly-appeared stored rules. Requires only a narrow,
  additive decision-instant parameter on the orchestrator (ordinary submissions unaffected;
  a decision can never be post-dated).
- **Demonstration policies** (`DemonstrationPolicies`): exactly two synthetic policies —
  "Rural PHC POC Test" (6 required domains; environment/power/connectivity contextual) and
  "General POC Demonstration" (7 required). Selection is deterministic from the recorded
  site marker and disclosed in the record (`selectionNote`). The policy states what evidence
  is expected and sets the coverage denominator; the deterministic rules alone map evidence to
  the disposition — a policy can never override a rule outcome or give the AI authority.
  No policy-authoring platform was built.
- **Provenance detail per evidence domain**: source identifier (device id, operator id, lot —
  never a fabricated handle), verification wording that preserves "Operator ID as claimed" and
  states what the prototype does NOT do (no authentication, no sensor attestation, no lot
  genealogy), record reference, and the related rule IDs. No fake hashes anywhere.
- **UI integration** (progressive disclosure, five-second rule first): the assessment page now
  flows status → can-I-rely → action → **RESULT INTEGRITY summary card** (evidence X/Y,
  quality concerns, consistency conflicts, traceability, disposition + policy chip) →
  **decision drivers** (conflict cards, causal bars, counterfactual) → evidence flow and
  signal map → reasons → evidence cards → Evidence Monitor → advisory Contextual Analysis →
  **Integrity Timeline** → the full record document (behind "Inspect Integrity Record") →
  audit. Evidence cards gained state/source/freshness/contribution with a per-domain details
  disclosure; the monitor tags rows "↳ contributor" / "↳ contextual"; the signal map carries
  the precise quality word per node (evidence → quality state → POC Trust → disposition).
- **Guard extensions**: copy-guard bans invented contribution percentages and hash-like fake
  provenance, requires the counterfactual labels, the inconsistency wording, "as claimed"
  provenance and the inspect toggle; contract-check covers causality/conflict/timeline/policy
  parsing (defensive fallbacks) and the quality-concerns summary (23/23 checks).
- **14 new backend tests** (`IntegrityCausalityTests`): policy selection and policy-driven
  coverage, role classification, counterfactual present/absent guards, conflict detection
  (and consistent-bad-evidence producing none), the decision-history sequence end-to-end
  (including audit-chain validity), provenance wording, related-rule mapping, and seeding the
  back-dated history into a populated store.

### Changed

- **Audit trail commits to recording order** (`EfAuditStore`): audit entries are stamped when
  they are appended, while the assessment row keeps the decision instant. For ordinary
  submissions the two are milliseconds apart; this keeps the SHA-256 chain valid and honest
  when the back-dated demonstration history is recorded (a hash chain over timestamp order
  could never accept an older entry after a newer one). Sealing/verification semantics are
  otherwise unchanged.
- Coverage denominators are policy-driven (6 or 7 depending on the selected demonstration
  policy); environment is contextual under the rural policy but still rule-relevant — the
  engine's environment rules are untouched.
- Demo dataset grows to 13 records (TRUST 5 · REVIEW 5 · VERIFY 3 + the 3-step history
  sequence); lifecycle/invariant tests updated accordingly.

### Honesty notes

- The decision history is labelled demonstration data; nothing presents it as production
  history.
- The counterfactual re-runs the real rules with one evidence change and is always labelled;
  it is a rule-based comparison, not a prediction, and carries no probability.
- Conflict detection is inconsistency detection between recorded sources — nothing more.
- Verification wording claims only what the prototype does: recorded claims, as claimed.

## 1.2.0-integrity-records — Result Integrity Record (25 September 2026)

The product upgrade from "POC Trust gives TRUST / REVIEW / VERIFY" to "POC Trust creates an
evidence-linked **Result Integrity Record** (RIR) that explains the quality of the evidence,
why the disposition occurred, what changed it, and what action follows." Implemented strictly
as the spec directs: the RIR is a **derived projection** over the existing persisted assessment
and its sealed audit entries — no parallel persistence, no duplicate source of truth, and the
deterministic engine, orchestrator and AI abstraction are completely untouched (absent from
the diff; 103/103 tests green).

### Added

- **Evidence-quality taxonomy** (backend `POCTrust.Core/Integrity`): evidence is now classified
  as `valid / aging / missing / stale / expired / failed / conflicting / unverified-source`.
  Classification is **rule-first** — every state derives from the rule IDs the engine actually
  recorded at decision time, so the projection can never quietly re-decide a stored assessment
  (regression-tested). `stale` is defined but reserved: no current engine rule produces it.
- **Evidence domain model**: ten canonical domains (device identity, quality control,
  calibration, operator competency, reagent lot, environment, power, connectivity, provenance,
  maintenance). Each row answers: is evidence available, what state is it in, what is its
  source, when was it recorded, did it contribute to the decision. Maintenance is honestly
  reported as not captured in this prototype and not required by the demonstration policy.
- **Evidence coverage**: "N / 7 required domains available" — the required set is exactly the
  engine's rule families. A failed control still counts as evidence the engine HAD (coverage is
  about existence, not quality). Missing evidence never invents a value; the consequence is
  stated instead.
- **Lightweight policy context**: thresholds are surfaced as the explicit "POC Trust
  demonstration policy demo-v1" (7-day calibration review boundary, 14-day reagent near-expiry
  boundary, 15–30 °C / 10–85 % environment ranges) — mirroring the engine's existing
  configuration, labelled as a prototype policy, never as clinically validated requirements.
- **`GET /api/assessments/{id}/integrity-record`**: narrow additive endpoint returning the
  canonical RIR (`rir-v1`), self-describing JSON with string-valued states for portability.
  Deterministic: the same stored record always projects a byte-identical record, anchored at
  the decision time. 404 with a safe error envelope for unknown ids.
- **RIR document view** (assessment detail): the central artefact rendered from the real
  record — identity (result / test / event), integrity disposition with statement, the
  four-dimension evidence-quality summary, coverage glyphs, all evidence domains with state
  chips and contribution markers, decision drivers (persisted reasons with machine prefixes
  stripped, pipeline notes excluded), recommended action, provenance sources, policy applied,
  advisory contextual note (explicitly advisory), sealed audit reference, and an honest basis
  note ("operational integrity assessment … not a measure of clinical validity").
  Download/Copy record (JSON) makes the portability claim concrete — the exported bytes are
  exactly the displayed record. Designed states for loading / not-yet-synchronised (offline
  pending) / service error — no fabricated records.
- **Evidence rows upgraded** with the taxonomy quality state, mirroring the backend derivation
  (contract-tested so presentation cannot disagree with the decision).
- **Copy-guard extensions**: the evidence-quality vocabulary and its fallbacks are enforced
  human-safe, and the forbidden framings (clinical truth, diagnostic correctness, patient
  safety probability, medical confidence) are banned from all presentation files.
- **13 new backend tests** (`ResultIntegrityRecordTests`): per-scenario coverage and state
  expectations, byte-identical determinism, the never-re-evaluates invariant, vocabulary and
  policy assertions, driver hygiene, audit reference, endpoint 200/404.


## 1.1.0-demo-polish — Final Visual Polish Pass (25 September 2026)

Demonstration-first polish over the productized appliance, per the v2 polish spec. The
deterministic engine, AI safety boundaries, persistence semantics and API contracts are
untouched (engine files absent from the diff; 90/90 tests green, contracts intact).

### Added

- **Demonstration Scenarios section** on Overview: three primary cards (Trust / Review /
  Verify) plus Missing-evidence and Offline secondary cards. Each card runs a REAL backend
  evaluation (`GET /api/assessments/demo/{kind}`) and opens the resulting record — never a
  mocked result. Kind-run records are now demo-marked (`demo-kind-*`) so reset removes them,
  and the endpoint is environment-guarded (Development-only, 403 otherwise).
- **Automated demo-data invariant suite** (`DemoInvariantsTests`, 11 tests): status matches
  the seed declaration, TRUST carries only passing findings, VERIFY has a hard-stop reason and
  never consults AI (decision AND audit), REVIEW never carries a hard-stop, offline labels are
  always backed by offline metadata, reasons are humanized, demo markers persist, audit order
  holds, determinism is exact, and seeds reference only the curated synthetic directory.
- **Designed empty states** (`EmptyState` component) across Overview, Assessments, Audit
  Trail, Devices, Operators and Quality Controls — with "Run demonstration" / "Create
  assessment" actions.
- **Reset confirmation** in Settings with explicit scope ("removes only demo-marked records").
- **Settings taxonomy**: Implemented / Prototype boundary / Future, stated honestly.
- **Presentation assets**: `docs/demo-script.md` (2–3 minute walkthrough + Q&A) and captured
  screenshots in `docs/assets/` (Overview, Trust, Review, Verify at 1440; Overview and Verify
  at 390; Audit Trail).

### Changed

- **Compact environment indicator**: the full-width demonstration banner is replaced by a
  persistent header pill — "Demo · synthetic data only", shortening to "Demo · synthetic"
  at narrow widths, never disappearing.
- **Clickable reliability tiles**: Trust/Review/Verify tiles now filter the Assessments list
  (with per-state counts and visible focus states).
- **Richer assessment rows**: device display names, offline and Contextual Analysis indicators,
  audit availability, and a "View all assessments" link; the hero gains the quiet
  Evidence → Decision → Explanation → Action → Audit story strip.
- **Operational pages rebuilt from persisted records**: Devices (human names, operational
  state derived from QC evidence, latest state, drill-through to filtered assessments),
  Operators (counts, drill-through), Quality Controls (humanized metric labels).
- **Responsive hardening**: grid/flex children may shrink below content and long text
  truncates — zero horizontal overflow measured at 390 / 600 / 768 / 1024 / 1280 / 1440.
- **VERIFY pages**: the audit lifecycle's non-consultation line no longer carries the
  Contextual Analysis product name ("Advisory context not consulted"), keeping the hard-stop
  page free of advisory wording while staying honest.
- **README demo section** rewritten around the scenario cards, demo script and assets.

## 1.0.0-productized — Final Demo Productization (24 September 2026)

Productization release of the competition prototype: one-command appliance, operational
hardening, presentation-grade restyle. The deterministic TRUST/REVIEW/VERIFY engine, the
VERIFY-lock invariant and the advisory-only AI boundary are functionally unchanged.

### Added

- **One-command appliance**: multi-stage `Dockerfile` (Node UI build → .NET publish →
  single runtime serving UI+API from one origin), `docker-compose.yml` with healthcheck and
  persistent SQLite volume, `.env.example`, `run.sh` (dev / single-origin modes), `Makefile`.
- **Idempotent offline sync**: optional `Idempotency-Key` header on evaluate; replay returns
  the original response (`Idempotent-Replay: true`); UI queue identity (`_queueId`) doubles as
  the key; race-safe receipt storage. 5 new tests.
- **Tamper-evident audit sealing**: SHA-256 hash chain over append-only audit rows
  (`PrevHash`/`Hash`), `GET /api/audit/verify` reporting first broken entry; legacy unsealed
  prefix tolerated and reported. 5 new tests.
- **Rate limiting**: per-IP fixed window (`RateLimit:PermitsPerWindow`/`WindowSeconds`),
  429 with the safe error envelope.
- **Optional API-key auth stub** (`Auth:Mode=apikey`): constant-time key comparison over SHA-256
  digests, mutating /api endpoints gated, reads and `/health` open, safe 401 envelope.
  6 new tests.
- **Operability endpoints**: `GET /health`; `GET /api/system/status` (AI provider state without
  secrets, database, rate limit, sealing, environment). 2 new tests.
- **Startup demonstration seeding** (`Demo:AutoSeed`): empty-store-only, real-pipeline,
  idempotent, failure-tolerant, logged.
- **System status endpoint tests**, startup seeding tests.

### Changed

- **Frontend restyle**: self-hosted variable fonts (Sora / Inter / JetBrains Mono — bundled,
  offline-safe), display typography for headings, refined tokens (radii, shadows, page wash),
  sidebar field, brand mark, primary CTA treatment, quiet scrollbars, selection colour.
  Status colours and all interaction patterns preserved.
- **CORS origins configurable** (`Cors:Origins`), expose `Idempotent-Replay` header.
- README restructured around the one-command appliance + hardening record.

### Fixed

- Audit chain-head lookup uses in-memory ordering (SQLite cannot ORDER BY DateTimeOffset —
  consistent with the repo-wide convention).

### Honesty notes (unchanged stance)

- Sealing proves the sealed trail has not been altered; it does not attest that the underlying
  event occurred.
- The API-key gate is transport-level protection for an appliance, not an identity system;
  operator identifiers remain recorded-as-claimed.
- Rate limiting is per-instance in-memory (single-container scale, documented).
- Idempotent replay is scoped to clients that send the header (the product UI always does for
  offline queue entries).
