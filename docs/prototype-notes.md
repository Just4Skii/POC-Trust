# Prototype Notes — VALIDATED 2026-09-24

- `dotnet build POCTrust.slnx` — pass; `dotnet test` — 15/15 pass; `npm run build` — pass.
- Demos: trust→TRUST/no-AI; review→REVIEW/AI; verify→VERIFY/AI-not-consulted; missing→REVIEW/AI; offline→local ID retained, sync null.
- Offline = `connectivity: offline`, `localEventId` retained, `syncTimestamp` null until sync. No production sync engine (documented limitation).
