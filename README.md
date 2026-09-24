# POC Trust — Point-of-Care Diagnostic Integrity Layer (Prototype)

IMPLEMENTED: deterministic TRUST/REVIEW/VERIFY engine with VERIFY-lock; assessment orchestrator
(validate → rules → conditional AI → enforce → action → persist → audit); pluggable AI
(stub + OpenAI-compatible, advisory only); EF Core SQLite assessments + append-only audit;
REST API (evaluate, demos, history, detail, dashboard, devices, operators, QC, audit) with a safe
error contract; platform UI (Overview, New Assessment, Assessments, Audit Trail, Devices, Operators,
Quality Controls, Settings) with locked navy/teal visual system; 51 xUnit tests + 11 frontend
contract checks; synthetic demos.

IMPLEMENTED (QA pass): invalid evidence returns `400 {"error":"..."}` (never a stack trace or file
path); unknown demo scenarios return 400 instead of silently evaluating VERIFY; persisted evidence is
canonical camelCase and historical records are read case-insensitively; the UI never invents an AI
confidence or model name for stored assessments; the pending queue removes only synchronised entries.

SIMULATED: external AI content via stub when no key is set; offline queue is localStorage
prototype metadata (no production sync engine, and connectivity is NOT a reliability rule).
FUTURE: real LIS/NHLS integration, authN/Z, cryptographic audit sealing, regulatory validation.

No clinical validation, regulatory approval, hospital deployment, live NHLS integration,
real patient outcomes, or medical certification is claimed.

## Run
```
dotnet run --project src/POCTrust.Api        # http://localhost:5183
cd frontend/poc-trust-ui; npm install; npm run dev   # http://localhost:5173
dotnet test POCTrust.slnx
npm --prefix frontend/poc-trust-ui run build
npm --prefix frontend/poc-trust-ui run lint
npm --prefix frontend/poc-trust-ui run check:contract
```
API: `POST /api/assessments/evaluate`, `GET /api/assessments/demo/{trust,review,verify,missing,offline}`,
`GET /api/assessments`, `GET /api/assessments/{id}`, `GET /api/dashboard/summary`,
`GET /api/devices`, `GET /api/operators`, `GET /api/quality-controls`,
`GET /api/assessments/audit`, `GET /api/audit/{assessmentId}`

Error contract: rejected requests return `400 {"error":"<message>","fields":[...]}` with no internal
detail. An unknown `{kind}` on the demo route and a missing/blank `result` are client errors (400).

Operator identifiers are recorded as claimed — there is no authentication in this prototype.

## Competition demo (synthetic data only)
1. Open Overview 2. Demonstration Mode on 3. Run TRUST → decision → evidence
4. Run REVIEW → Contextual Analysis 5. Run VERIFY → safety interruption
6. Open Audit Trail → trace evidence → rules → decision → action 7. Run OFFLINE scenario

## AI key (backend only, never commit)
```
dotnet user-secrets --project src/POCTrust.Api set "AI:ApiKey" "<key>"
# Gemini's OpenAI-compatible endpoint (the key alone is not enough):
dotnet user-secrets --project src/POCTrust.Api set "AI:Endpoint" "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
dotnet user-secrets --project src/POCTrust.Api set "AI:Model" "gemini-2.0-flash"
```
With no usable provider the deterministic result is still returned and Contextual Analysis simply
stays hidden.

