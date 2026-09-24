# Changelog

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
