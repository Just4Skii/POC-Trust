# POC Trust — Point-of-Care Diagnostic Integrity Layer

A deterministic integrity decision — **TRUST / REVIEW / VERIFY** — between every point-of-care
result and the clinical workflow, with evidence, reasons, an operational action and an
append-only, tamper-evident audit trail for every decision.

The core safety property is unchanged: **VERIFY can never be downgraded** — not by AI, not by
configuration. AI (when present) is advisory explanation only; deterministic rules are
authoritative.

---

## One-command run (demonstration appliance)

```bash
cp .env.example .env        # optional: add AI key, auth mode, port
docker compose up --build
# → http://localhost:8080  (UI + API + seeded demonstration data from one origin)
```

What the appliance gives you on first start:

- the UI served **by the API itself** (single origin, single port, no CORS in play);
- **auto-seeded** curated demonstration set (10 synthetic scenarios: 4 TRUST · 4 REVIEW ·
  2 VERIFY, one created offline) — only when the database is empty, only through the real
  assessment pipeline, always clearly labelled in the UI;
- a `/health` endpoint with a compose healthcheck;
- audit records sealed into a SHA-256 hash chain (`GET /api/audit/verify`).

Without Docker:

```bash
./run.sh              # dev: API :5183 + Vite :5173
./run.sh --single     # packaged: build UI once, API serves UI+API on :5183
```

## Configuration (env / appsettings / user-secrets)

| Setting | Env var (compose → .env) | Default | Purpose |
|---|---|---|---|
| AI key (server-side only) | `AI_API_KEY` → `AI__ApiKey` | empty | Empty ⇒ honest stub advisory; deterministic result never depends on it |
| AI endpoint / model | `AI_ENDPOINT` / `AI_MODEL` | Gemini OpenAI-compatible / `gemini-2.0-flash` | Any OpenAI-compatible chat-completions endpoint |
| Auth stub | `AUTH_MODE` / `AUTH_API_KEY` | `none` | `apikey` ⇒ POST/PUT/PATCH/DELETE require `X-Api-Key`; reads stay open |
| Auto-seed | `DEMO_AUTOSEED` → `Demo__AutoSeed` | false (true in Development + appliance) | First-run demonstration load into an EMPTY store only |
| Rate limit | `RATE_LIMIT_PERMITS` / `RATE_LIMIT_WINDOW` | 100 / 10 s | Per-IP fixed window; 429 uses the safe error envelope |
| Port | `POC_TRUST_PORT` | 8080 | Appliance port mapping |

AI keys never reach the client: environment, user-secrets or `.env` on the server only. The
Settings page refuses key entry by design.

## Productized hardening (this release)

1. **Idempotent offline sync** — `POST /api/assessments/evaluate` accepts an optional
   `Idempotency-Key` header. The UI's pending queue uses its stable `_queueId` as the key, so a
   retried sync replays the ORIGINAL decision (header `Idempotent-Replay: true`) instead of
   creating a duplicate assessment. Closes the known "no server-side idempotency" gap.
2. **Tamper-evident audit sealing** — every audit row is hashed (SHA-256) over its full content
   plus the previous row's hash; `GET /api/audit/verify` recomputes the chain and identifies the
   first broken entry. Rows written before sealing are reported as an unsealed legacy prefix.
   Sealing proves the trail has not been altered; it does not attest that the underlying event
   occurred (honest boundary).
3. **Rate limiting** — per-IP fixed window over all endpoints, configurable, 429 answered with
   the same safe error envelope as every other rejection.
4. **Optional API-key gate** — a transport-level auth STUB for protected deployments
   (`Auth:Mode=apikey`), constant-time comparison, safe 401 envelope. Not an identity system:
   operator identifiers remain recorded-as-claimed.
5. **Health + operational status** — `GET /health` (compose healthcheck) and
   `GET /api/system/status` (AI provider state without any secret material, database, rate
   limit, audit sealing, environment).
6. **Single-container packaging** — multi-stage Docker build; the API serves the built UI when
   present in `wwwroot` (SPA fallback keeps the JSON 404 contract for unknown /api routes).
7. **Startup demonstration seeding** — optional, idempotent, empty-store-only, real-pipeline,
   logged; a failed demonstration load never blocks startup.
8. **Presentation-grade restyle** — self-hosted variable fonts (Sora display + Inter body +
   JetBrains Mono, bundled at build time so the demo stays offline-safe), refined tokens,
   sidebar/brand/CTA upgrades; all status colours and interactions preserved.

## Verification record

| Gate | Result |
|---|---|
| `dotnet build` | 0 warnings, 0 errors |
| `dotnet test` | **117 / 117 passed** (58 core + 21 hardening + 11 demo invariants + 13 integrity-record tests + 14 decision-causality tests) |
| `npm run build` | OK (fonts bundled offline) |
| `npm run lint` (oxlint) | 0 warnings, 0 errors |
| `npm run check:contract` | **23 / 23 passed** + copy guard clean (incl. counterfactual labels, conflict wording, provenance "as claimed", percentage/hash bans) |
| Live smoke: auto-seed, `/health`, `/api/system/status`, `/api/audit/verify`, idempotent replay, tamper detection, rate limit burst, decision-history timeline | all verified |

## Architecture

```
Diagnostic Event → Evidence → ReliabilityEngine → Initial status
  → NeedsAi? → IAIProvider (advisory) → EnforceFinalStatus (VERIFY-locked)
  → Action → SQLite (Assessments + sealed append-only Audit) → API response
                                              ↘ GET /assessments/{id}/integrity-record
                                                ResultIntegrityProjector (derived, rule-first)
                                                → Result Integrity Record (rir-v1)
```

### Result Integrity Record

Each persisted assessment projects a portable, auditable, evidence-linked **Result Integrity
Record**: the evidence the engine had, its classified quality under the selected demonstration
policy (`valid / aging / missing / stale / expired / failed / conflicting / unverified-source`),
**why the disposition occurred** (primary / secondary / informational decision drivers derived
from the engine's recorded findings, with a single labelled rule-based counterfactual where the
dependency is derivable), detected **evidence conflicts** (inconsistencies between two recorded
sources — never clinical truth claims), an **integrity timeline** (recorded, derived and
demonstration-history entries, honestly labelled), and the action that follows. The record is
**derived, never stored twice** — a pure function of the stored assessment and its sealed audit
entries, with every evidence state traced to the rule IDs the deterministic engine recorded.
Two synthetic demonstration policies ("Rural PHC POC Test", "General POC Demonstration") state
what evidence matters; the deterministic rules alone map evidence to the disposition. It is an
operational integrity assessment under a configured demonstration policy, not a measure of
clinical validity. The UI discloses it progressively on the assessment page: a compact RESULT
INTEGRITY summary card with a policy chip, then decision drivers and conflicts, then the full
record document behind "Inspect Integrity Record", with one-click export of the exact
canonical JSON. A seeded three-step demonstration decision history (TRUST → REVIEW → VERIFY,
recorded through the real pipeline) shows decision evolution, explicitly labelled.

- Backend: ASP.NET Core (.NET 10), EF Core/SQLite, `AssessmentOrchestrator` pipeline.
- AI: `OpenAiCompatibleProvider`, `StubAiProvider` fallback — the deterministic result never
  depends on the AI call (12 s timeout, fragment rejection, status claims ignored).
- Frontend: React 19 + Vite, locked navy/teal system, relative `/api` calls (Vite dev proxy → :5183).
- Solution layout: `src/POCTrust.{Core,Infrastructure,Api}`, `tests/POCTrust.Tests`,
  `frontend/poc-trust-ui`.

API: `POST /api/assessments/evaluate` (optional `Idempotency-Key`), `GET /api/assessments/demo/{trust,review,verify,missing,offline}`,
`GET /api/assessments`, `GET /api/assessments/{id}`, `GET /api/dashboard/summary`,
`GET /api/devices`, `GET /api/operators`, `GET /api/quality-controls`,
`GET /api/assessments/audit`, `GET /api/audit/{assessmentId}`, `GET /api/audit/verify`,
`GET /api/demo/{status,seed,reset}` (Development-guarded), `GET /api/system/status`, `GET /health`.

Error contract: rejected requests return `400 {"error":"<message>","fields":[...]}` (or 401/429
from the guards) with no internal detail. An unknown `{kind}` on the demo route and a missing or
blank `result` are client errors (400).

## Competition demo (synthetic data only)

A 2–3 minute walkthrough lives in [`docs/demo-script.md`](docs/demo-script.md); captured
screenshots (desktop + mobile) live in [`docs/assets/`](docs/assets/).

1. Open Overview — demonstration data is already loaded; the header shows the compact
   **Demo · synthetic data only** pill, and the hero reads Evidence → Decision → Explanation →
   Action → Audit
2. Run the **Demonstration Scenarios** cards (Trust / Review / Verify / Missing / Offline) —
   each card runs a real evaluation through the backend pipeline and opens the resulting record
3. Or click a reliability tile to filter the Assessments list to that state
4. Trust → calm confirmation; Review → ranked reasons, advisory Contextual Analysis; Verify →
   hard stop with **no** advisory section anywhere
5. Open Audit Trail → trace evidence → rules → decision → action; every entry is sealed into a
   SHA-256 hash chain (verify with `GET /api/audit/verify`)
6. Demonstration lifecycle (load / reset) lives in Settings with a scoped confirmation — reset
   removes only demo-marked records

Simulated: external AI content via stub when no key is set; the offline queue remains a
localStorage prototype (transport metadata, not a reliability rule; connectivity is NOT a
reliability input). FUTURE: real LIS/NHLS integration, full authN/Z, key rotation, regulatory
validation.

No clinical validation, regulatory approval, hospital deployment, live NHLS integration,
real patient outcomes, or medical certification is claimed.

## AI key (backend only, never commit)

```bash
dotnet user-secrets --project src/POCTrust.Api set "AI:ApiKey" "<key>"
# Gemini's OpenAI-compatible endpoint (the key alone is not enough):
dotnet user-secrets --project src/POCTrust.Api set "AI:Endpoint" "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
dotnet user-secrets --project src/POCTrust.Api set "AI:Model" "gemini-2.0-flash"
```

With no usable provider the deterministic result is still returned and Contextual Analysis
simply stays hidden. See `docs/productization.md` for the full hardening notes and honest
limitations, and `docs/evidence-pack.md` for the competition evidence record.
