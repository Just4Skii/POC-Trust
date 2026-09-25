# Data Governance, Prototype

IMPLEMENTED: synthetic data only; no real patient info; SQLite stores input JSON, rule IDs, AI summary, action, timestamps; audit append-only (insert only).
SIMULATED: no cryptographic immutability, no access control. FUTURE: authN/Z, retention, real governance review.

Evidence records: persisted evidence JSON is canonical camelCase; readers also accept the PascalCase
form written by earlier prototype builds, so no historical record is silently misread. Operator
identifiers are recorded **as claimed**, the prototype has no authentication, so no verified human
identity is asserted anywhere in the API, the UI or the audit trail.

Who saw what: the audit row stores the same evidence JSON as the assessment plus the deterministic
decision, the action and whether an AI advisory was consulted. No AI confidence score or model name
is persisted, so none is displayed for historical records (the API returns them only for the live
decision that produced them).
