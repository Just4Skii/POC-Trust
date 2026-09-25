# Reliability Policy, IMPLEMENTED

Severity VERIFY > REVIEW > TRUST.
- QC_FAILED → VERIFY; CAL_EXPIRED → VERIFY; REAGENT_EXPIRED → VERIFY
- OPERATOR_NOT_COMPETENT → REVIEW; ENV_TEMP/HUMIDITY → REVIEW; POWER_INTERRUPTION → REVIEW
- PROVENANCE_INCOMPLETE → REVIEW; MULTI_CONTEXT → REVIEW
Hard invariant (tested): `EnforceFinalStatus(VERIFY, any AI) == VERIFY`.
Actions: TRUST → routine workflow; REVIEW → hold for review; VERIFY → do not rely, verify/repeat.

Boundaries (regression-tested): temperature 15 and 30 inclusive pass, 14.999 and 30.001 fail;
humidity 10 and 85 inclusive pass, 9.9 and 85.1 fail; expiry comparisons are strict, so
"calibration due exactly now" is REVIEW (CAL_NEAR_DUE) and one second overdue is VERIFY (CAL_EXPIRED).

NOT A RULE (explicit prototype boundary): `connectivity` (online/offline) and `localEventId` are
synchronisation metadata only. Offline never raises or lowers the status, and the UI labels it as
metadata so it cannot be mistaken for a reliability verdict. Connectivity is not scored, not
weighted, and not sent to the AI as a reliability claim.
