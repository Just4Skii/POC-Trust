# POC Trust — Point-of-Care Diagnostic Integrity Layer (Prototype)

IMPLEMENTED: deterministic TRUST/REVIEW/VERIFY engine, assessment orchestrator,
pluggable AI (stub + OpenAI-compatible), EF Core SQLite audit, REST API with demos,
React dashboard/form/audit UI, 15 xUnit tests, synthetic demo cases.

SIMULATED: external AI via stub when no key is set; offline sync is prototype metadata only.
FUTURE: real LIS integration, auth, cryptographic audit sealing, regulatory validation.

No clinical validation, regulatory approval, hospital deployment, live NHLS integration,
real patient outcomes, or medical certification is claimed.

## Run
```
dotnet run --project src/POCTrust.Api        # http://localhost:5183
cd frontend/poc-trust-ui; npm install; npm run dev
dotnet test POCTrust.slnx
```
API: `POST /api/assessments/evaluate`, `GET /api/assessments/demo/{trust,review,verify,missing,offline}`, `GET /api/assessments/audit`

## AI key (backend only, never commit)
```
dotnet user-secrets --project src/POCTrust.Api set "AI:ApiKey" "<key>"
```
