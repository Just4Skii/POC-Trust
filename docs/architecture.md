# Architecture — IMPLEMENTED

```
Diagnostic Event → Evidence → ReliabilityEngine → Initial status
  → NeedsAi? → IAIProvider (advisory) → EnforceFinalStatus (VERIFY-locked)
  → Action → SQLite (Assessments + append-only Audit) → API response
```

IMPLEMENTED: `POCTrust.Core/Reliability/ReliabilityEngine.cs`, `POCTrust.Api/Services/AssessmentOrchestrator.cs`,
`IAIProvider` with `StubAiProvider`/`OpenAiCompatibleProvider`, `PocTrustDbContext`.
SIMULATED: AI content when offline/stub. FUTURE: auth, multi-site sync.
