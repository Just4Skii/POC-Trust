# Changelog

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
