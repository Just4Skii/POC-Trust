# AI Design — IMPLEMENTED (advisory only)

IMPLEMENTED: invocation policy (TRUST no AI; hard VERIFY no AI; multi-concern REVIEW → AI),
response validation, timeout/malformed fallback to deterministic result, `AI:ApiKey` via user-secrets/env only.
AI NEVER diagnoses, never overrides VERIFY, never outputs authoritative status (ignored if present).
SIMULATED: stub provider. FUTURE: additional vendors via `IAIProvider`.
