# POC Trust — Point-of-Care Diagnostic Integrity Layer (Prototype)

IMPLEMENTED: deterministic TRUST/REVIEW/VERIFY engine with VERIFY-lock; assessment orchestrator
(validate → rules → conditional AI → enforce → action → persist → audit); pluggable AI
(stub + OpenAI-compatible, advisory only); EF Core SQLite assessments + append-only audit;
REST API (evaluate, demos, history, detail, dashboard, devices, operators, QC, audit);
platform UI (Overview, New Assessment, Assessments, Audit Trail, Devices, Operators,
Quality Controls, Settings) with locked navy/teal visual system; 15 xUnit tests; synthetic demos.

SIMULATED: external AI content via stub when no key is set; offline queue is localStorage
prototype metadata (no production sync engine).
FUTURE: real LIS/NHLS integration, authN/Z, cryptographic audit sealing, regulatory validation.

No clinical validation, regulatory approval, hospital deployment, live NHLS integration,
real patient outcomes, or medical certification is claimed.

## Run
```
dotnet run --project src/POCTrust.Api        # http://localhost:5183
cd frontend/poc-trust-ui; npm install; npm run dev   # http://localhost:5173
dotnet test POCTrust.slnx
npm --prefix frontend/poc-trust-ui run build
```
API: `POST /api/assessments/evaluate`, `GET /api/assessments/demo/{trust,review,verify,missing,offline}`,
`GET /api/assessments`, `GET /api/assessments/{id}`, `GET /api/dashboard/summary`,
`GET /api/devices`, `GET /api/operators`, `GET /api/quality-controls`,
`GET /api/assessments/audit`, `GET /api/audit/{assessmentId}`

## Competition demo (synthetic data only)
1. Open Overview 2. Demonstration Mode on 3. Run TRUST → decision → evidence
4. Run REVIEW → Contextual Analysis 5. Run VERIFY → safety interruption
6. Open Audit Trail → trace evidence → rules → decision → action 7. Run OFFLINE scenario

## AI key (backend only, never commit)
```
dotnet user-secrets --project src/POCTrust.Api set "AI:ApiKey" "<key>"
```
