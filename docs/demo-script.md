# POC Trust, 2–3 Minute Demo Script

An honest walkthrough for evaluators. Every step uses the real running product with the
curated synthetic demonstration data, nothing is mocked in the frontend.

## Before you start

```bash
./run.sh            # or: docker compose up --build
```

Open http://localhost:8080 (compose) or the printed single-origin URL. On a fresh database
in the development environment the Overview auto-loads the ten curated demonstration scenarios;
otherwise press **Load demonstration data** (Overview or Settings).

## The walkthrough

| # | Action | What to say |
|---|--------|-------------|
| 1 | Land on **Overview** | "POC Trust answers one question: *can this diagnostic result be relied on?* The three reliability states are Trust, evidence passed configured checks; Review, additional review recommended; Verify, verification required before reliance. Counts come straight from the database." |
| 2 | Open a **Trust** assessment (via a recent row) | "Evidence, quality control, calibration, operator competency, reagent, environment, provenance, was recorded with the result. Deterministic rules decided: all configured checks passed. The action states the result may enter clinical workflow review. Notice the wording: we never claim the result is *clinically correct*, only that the evidence is sound." |
| 3 | Open the **Review** scenario (Demonstration Scenarios card) | "Multiple contextual signals require attention, calibration due soon, reagent nearing expiry, operator competency. Ranked reasons appear first. Below them, Contextual Analysis adds a plain-language note, **advisory only**. It never changes the decision; Review remains the authoritative state." |
| 4 | Run the **Verify** card | "This is the most important screen. Quality control failed and calibration expired, a hard stop. There is **no** Contextual Analysis here at all. The system blocks reliance instead of explaining away a failure." |
| 5 | Scroll to **Audit Trail** on the same page | "Every step is append-only and traceable: evidence recorded, checks evaluated, decision recorded, advisory consulted only where it actually fired. The trail is sealed with a SHA-256 hash chain, tampering is detectable." |
| 6 | Back to Overview → **Synchronization scenario** card | "Offline affects synchronization only in this prototype, it does not change reliability. The record itself was still decided by the same deterministic evidence rules." |

## Likely questions (one-line answers)

- **"Does the AI decide?"**, No. The deterministic engine decides; Contextual Analysis explains review cases only.
- **"What if the AI disagrees with a failure?"**, VERIFY remains VERIFY. The advisory layer cannot downgrade any decision.
- **"Is this real patient data?"**, No. Every record is synthetic, demo-marked, and removable via reset.
- **"Is this clinically validated / deployed?"**, No. It is a prototype with a stated boundary in Settings.

## One-command notes

- **Load / reset** demonstration data from Overview or Settings; both are idempotent and
  demo-marked, so reset never touches assessments you created yourself.
- Scenario cards each run a **real** evaluation through the backend pipeline, repeated clicks
  create additional clearly-marked demonstration records, and every count on screen derives
  from the actual persisted data.
