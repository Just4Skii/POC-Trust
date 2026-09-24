# Architecture — IMPLEMENTED

```
Diagnostic Event → Evidence → ReliabilityEngine → Initial status
  → NeedsAi? → IAIProvider (advisory) → EnforceFinalStatus (VERIFY-locked)
  → Action → SQLite (Assessments + append-only Audit) → API response
```

IMPLEMENTED: `POCTrust.Core/Reliability/ReliabilityEngine.cs`, `POCTrust.Api/Services/AssessmentOrchestrator.cs`,
`IAIProvider` with `StubAiProvider`/`OpenAiCompatibleProvider`, `PocTrustDbContext`.
SIMULATED: AI content when offline/stub. FUTURE: auth, multi-site sync.

API boundary: invalid evidence and unknown demo scenarios are client errors answered as
`400 {"error":"...","fields":[...]}` (`POCTrust.Api/ApiError.cs` plus the controller checks in
`AssessmentsController`). `ApiError` projects model-binding failures onto the public field contract and
drops binder internals, and `Program.cs` installs an exception handler that returns the same envelope
with no exception text, stack trace or file path. The handler is registered inside the development
exception page so development builds cannot leak either.

Persistence: evidence is serialised once with web defaults (camelCase) in `EfAuditStore`, giving one
canonical stored format. Reads tolerate the PascalCase form written by earlier builds. List ordering
uses a deterministic `ThenBy(Id)` tie-break because timestamps are stored with variable fractional
precision; ordering still happens in memory (a scale item, not a correctness item).
