# Prototype Notes — VALIDATED

- `dotnet build` — pass (0 warnings; NU1903 cleared by pinning Microsoft.OpenApi 2.7.5);
  `dotnet test` — 51/51 pass; `npm run build` — pass; `npm run lint` — 0 warnings/0 errors;
  `npm run check:contract` — 11/11 pass.
- Live API: trust→TRUST/no-AI; review→REVIEW/AI-advisory; verify→VERIFY/no-AI, downgrade-proof;
  missing→REVIEW; offline→local ID retained, connectivity is not a reliability input.
- New: `GET /api/dashboard/summary`, `/api/assessments`, `/api/assessments/{id}`,
  `/api/devices`, `/api/operators`, `/api/quality-controls` — all from real SQLite rows.
- UI: collapsible sidebar, decision-first result screen, evidence progressive disclosure,
  teal Contextual Analysis only when consulted, audit timeline, offline queue in localStorage,
  demo banner. No Vite branding remains.
- Offline = `connectivity: offline` + `localEventId` retained + `syncTimestamp` null until sync.
  No production sync engine (documented limitation), and no connectivity reliability rule exists —
  the UI states this so "offline" is not read as a reliability verdict.

## Independent QA pass (defects found, fixed, regression-tested)

| Defect | Before | After |
| --- | --- | --- |
| Invalid evidence (`result` blank/whitespace) | HTTP 500 + stack trace with absolute source paths | HTTP 400 `{"error":"Result is required."}` |
| Malformed JSON | 400 with binder/parser internals ("The context field is required.") | 400 `{"error":"Request body is not valid JSON for the assessment contract."}` |
| Unknown demo scenario (`demo/bogus`) | HTTP 200, silently evaluated VERIFY and persisted | HTTP 400, nothing persisted |
| Persisted evidence keys | PascalCase, UI reads camelCase → wrong evidence on reopen | canonical camelCase + case-insensitive reads for legacy rows |
| Historical AI metadata | UI invented `confidence 0.7` / `model "recorded"` | shows only what was persisted |
| Duplicate submissions | demo buttons stayed clickable mid-submission | disabled + in-flight latch |
| Queue sync | index-based write-back could drop an entry queued mid-sync | identity-based removal; concurrent entries preserved |
| Audit ordering | timestamp-only ordering (variable fractional precision) | stable `ThenBy(Id)` tie-break |

