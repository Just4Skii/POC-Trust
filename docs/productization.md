# Productization Notes, FINAL DEMO

This document records what the productization pass added to the validated prototype, the
invariants it deliberately preserves, and the honest boundaries that remain. Nothing here
changes the reliability semantics: the deterministic engine, the VERIFY-lock invariant
(`EnforceFinalStatus(Verify, _) == Verify` for any AI input) and the advisory-only AI boundary
are exactly as validated in the evidence pack.

## 1. One-command appliance

`docker compose up --build` produces a single container: the ASP.NET Core API serves the built
React UI from `wwwroot` on port 8080. The SPA fallback keeps the API's JSON 404 contract, an
unknown `/api/*` route returns `404 {"error":"Unknown API endpoint."}`, never HTML. `GET /health`
backs the compose healthcheck. SQLite lives on the `poctrust-data` volume, so demonstration data
survives restarts.

The appliance defaults to `ASPNETCORE_ENVIRONMENT=Development` on purpose: the demo lifecycle
endpoints (`/api/demo/*`) and the synthetic-data banner are environment-guarded, and a
demonstration appliance wants them visible. Hardening path: set `Production` (demo lifecycle
controls disappear via 404, seeding defaults off) and `Auth__Mode=apikey`.

Non-Docker paths: `./run.sh` (dev: API 5183 + Vite 5173), `./run.sh --single` (build UI once,
serve everything from 5183), `make test` / `make ui-test` / `make compose-up`.

## 2. Idempotent offline sync

Gap closed from the limitations list: "no server-side idempotency key, a replayed sync can
create a duplicate assessment."

- `POST /api/assessments/evaluate` accepts an optional `Idempotency-Key` (≤128 chars).
- First submission stores a `SyncReceipt` (key → assessment id → exact response JSON).
- A retry with the same key returns the STORED response bytes plus `Idempotent-Replay: true`;
  no engine call, no second assessment, no second audit row.
- Concurrent same-key submissions are race-safe: the primary-key conflict falls back to the
  winner's stored response.
- The UI's pending queue already assigns a stable `_queueId`; it is now also sent as the
  idempotency key on both the first offline attempt and every queued retry, so a submission
  that timed out after reaching the server cannot be double-counted.
- Keys are optional: programmatic clients without the header behave exactly as before.

Replay honesty: the stored response is the ORIGINAL response the first submission produced,
including the AI advisory summary that decision actually received. Nothing is re-fabricated.

## 3. Tamper-evident audit sealing

Gap closed: "no cryptographic audit sealing."

- Every audit row written by `EfAuditStore` carries `PrevHash` and `Hash`; `Hash` is SHA-256 over
  the row's full content (id, assessment id, evidence JSON, statuses, AI flag/summary, action,
  timestamp in ms) plus the previous row's hash. Genesis rows chain from the literal `GENESIS`.
- Chain order is the product's canonical audit order: `TimestampUtc`, then `Id` (the same
  deterministic tie-break used by every read path).
- `GET /api/audit/verify` recomputes the chain and reports `{valid, sealedEntries,
  legacyUnsealedEntries, totalEntries, brokenAt}`, the first broken entry is identified.
- Rows written before sealing existed are an unsealed legacy prefix: reported, never a failure.
- SQLite cannot ORDER BY DateTimeOffset server-side, so the chain head is found in memory,
  consistent with the repo-wide convention (a scale item, not a correctness item).
- Boundary stated in the response itself: sealing proves the sealed trail has not been altered;
  it does not attest that the underlying event occurred. Single-writer SQLite serialises writes;
  a same-instant race could split the head (detected as broken, i.e. it errs towards flagging).

## 4. Transport protections

- **Rate limiting**: per-IP fixed window, default 100 requests / 10 s, over every endpoint.
  429 answers use the same safe envelope: `{"error":"Too many requests. Please retry shortly."}`.
  Configured via `RateLimit:PermitsPerWindow` / `RateLimit:WindowSeconds`. In-memory per
  instance, single-container scale, honestly documented.
- **API-key stub** (`Auth:Mode=apikey`, `Auth:ApiKey`): mutating `/api` requests require
  `X-Api-Key`; reads and `/health` stay open. Comparison is constant-time over SHA-256 digests
  (no timing or length leakage). Rejection is a safe 401 envelope. This is appliance
  protection, NOT authentication: the product continues to state that operator identifiers are
  recorded as claimed.

## 5. Operational visibility

- `GET /health` → `{"status":"healthy"}` (compose healthcheck).
- `GET /api/system/status` → environment, database reachability, AI provider state
  (`configured` boolean, model, endpoint HOST only, never the key or full URL path), audit
  sealing algorithm, demo auto-seed flag, rate-limit window, auth mode. "Real AI required" for
  a live demo becomes checkable in one request before judges arrive.

## 6. Startup demonstration seeding

`Demo:AutoSeed` (env `Demo__AutoSeed`, on in Development and the appliance, off otherwise):
- only when the assessment store is EMPTY;
- through the real orchestrator (engine-computed statuses, seeded advisory via the offline-safe
  stub, no external AI calls needed to load a demonstration);
- idempotent on the persisted demo markers; a second run is a no-op;
- failure-tolerant: a failed demonstration load logs a warning and never blocks startup;
- every record is synthetic and clearly labelled by the existing UI banner.

## 7. Presentation restyle

Self-hosted variable fonts (Sora display, Inter body, JetBrains Mono) bundled at build time,
the demo remains fully offline-safe. Display typography applied to every heading via the token
layer; refined radii/shadows/page wash; sidebar field with a faint teal crown glow; brand mark
gradient; primary CTA treatment; quiet scrollbars and selection colour. All status colours,
motion tokens, reduced-motion behaviour and interaction patterns are preserved, and the
copy-guard + contract checks still pass.

## 8. Remaining honest limitations

1. SQLite remains single-writer local storage; no LIS/NHLS integration.
2. The offline queue is still transport metadata, no local decision engine, connectivity is
   not a reliability rule.
3. No full authN/Z (roles, per-user identity); the API-key gate is transport-level only.
4. Rate limiting is per-instance (a multi-replica deployment needs a shared limiter).
5. The audit chain anchors in-process (no external timestamping / notary).
6. No HTTP integration-test suite in CI; API covered by unit + live acceptance checks.
7. No clinical validation, regulatory approval or real patient outcomes are claimed anywhere.
