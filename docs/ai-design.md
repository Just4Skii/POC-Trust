# AI Design — IMPLEMENTED (advisory only)

IMPLEMENTED: invocation policy (TRUST no AI; hard VERIFY no AI; multi-concern REVIEW → AI),
response validation, timeout/malformed fallback to deterministic result, `AI:ApiKey` via user-secrets/env only.
AI NEVER diagnoses, never overrides VERIFY, never outputs authoritative status (ignored if present).
SIMULATED: stub provider. FUTURE: additional vendors via `IAIProvider`.

Provider configuration: `AI:Endpoint` + `AI:Model` + `AI:ApiKey` (server-side only, never in the
frontend bundle). Setting a Gemini key without Gemini's OpenAI-compatible endpoint leaves the default
OpenAI endpoint in place, so calls fail; the failure is caught and the deterministic result is
returned with the reason "AI unavailable (HttpRequestException)". Empty or missing key → `StubAiProvider`
(labelled `stub/offline`), which keeps the demo's Contextual Analysis path exercisable offline.

Advisory metadata: a confidence score and model name are only ever the values the provider returned for
that live decision. They are not persisted with the assessment, and the UI does not reconstruct or
invent them for stored records. Rejected output (for example a fragment under the minimum length) is
dropped and the deterministic result stands; the record then notes that an advisory was requested
(`AiConsulted`) without displaying any advisory content.
