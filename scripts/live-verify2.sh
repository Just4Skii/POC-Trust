#!/bin/bash
# Integrity upgrade E2E (spec chunk 4, sections 26–36): dashboard integrity overview,
# enriched history rows, the demonstration sequence, per-scenario RIRs, historical
# reopen consistency and humanized row fields — all against the REAL API + engine.
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO/src/POCTrust.Api"
export PATH="$HOME/.dotnet:$PATH"
export DOTNET_ROOT="$HOME/.dotnet"
export ASPNETCORE_ENVIRONMENT=Development

dotnet bin/Debug/net10.0/POCTrust.Api.dll --urls http://127.0.0.1:5614 > /tmp/poctrust-e2e.log 2>&1 &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null" EXIT

for i in $(seq 1 30); do
  curl -s -m 2 http://127.0.0.1:5614/health > /dev/null 2>&1 && break
  sleep 1
done
echo "== health: $(curl -s http://127.0.0.1:5614/health)"

echo "== reset + seed:"
curl -s -X POST http://127.0.0.1:5614/api/demo/reset > /dev/null
curl -s -X POST http://127.0.0.1:5614/api/demo/seed | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('loaded:', d['loaded'], '| mismatches:', d['distributionMismatches'])
"

python3 - <<'PYEOF'
import json, re, urllib.request

BASE = "http://127.0.0.1:5614"
def get(path):
    with urllib.request.urlopen(BASE + path, timeout=30) as r:
        return json.load(r)

failures = []
def check(name, ok, detail=""):
    print(("  PASS " if ok else "  FAIL ") + name + (f" — {detail}" if detail and not ok else ""))
    if not ok: failures.append(name)

# ── S26: dashboard integrity overview ────────────────────────────────────────
summary = get("/api/dashboard/summary")
integ = summary["integrity"]
rows = get("/api/assessments?take=500")
records = {a["id"]: get(f"/api/assessments/{a['id']}/integrity-record") for a in rows}

# Independently recompute the aggregates from the per-record RIRs.
CONCERN = {"aging", "stale", "expired", "failed", "conflicting", "unverified-source"}
def concerns(rec):
    return sum(1 for d in rec["domains"]
               if d["state"] in CONCERN or (d["requiredByPolicy"] and d["state"] == "missing"))
ratios = [r["evidenceQuality"]["coverage"]["requiredAvailable"] / r["evidenceQuality"]["coverage"]["requiredTotal"]
          for r in records.values() if r["evidenceQuality"]["coverage"]["requiredTotal"] > 0]
expected_pct = round(sum(ratios) / len(ratios) * 100 + 1e-9)
expected_conflicts = sum(r["evidenceQuality"]["conflictCount"] for r in records.values())
expected_concern_records = sum(1 for r in records.values() if concerns(r) > 0)
expected_aging_records = sum(1 for r in records.values() if r["evidenceQuality"]["agingCount"] > 0)

print(f"== integrity overview: {integ['coverageStatement']}, concerns={integ['assessmentsWithConcerns']}, conflicts={integ['conflicts']}, aging={integ['assessmentsWithAging']}")
check("S26 overview assessments count matches the store", integ["assessments"] == len(records))
check("S26 coverage percent is derived from real records", integ["coveragePercent"] == expected_pct, f"got {integ['coveragePercent']} expected {expected_pct}")
check("S26 conflicts equal the per-record conflict sum", integ["conflicts"] == expected_conflicts)
check("S26 concern count equals per-record concern tally", integ["assessmentsWithConcerns"] == expected_concern_records)
check("S26 aging count equals per-record aging tally", integ["assessmentsWithAging"] == expected_aging_records)
check("S26 note discloses the calculation basis", "never preset" in integ["note"])

# ── S27: every history row carries compact integrity consistent with its full record ──
bad_rows = []
for a in rows:
    ri = a.get("integrity")
    rec = records[a["id"]]
    if not ri:
        bad_rows.append((a["id"], "missing integrity")); continue
    cov = rec["evidenceQuality"]["coverage"]
    if (ri["coverageAvailable"], ri["coverageRequired"]) != (cov["requiredAvailable"], cov["requiredTotal"]):
        bad_rows.append((a["id"], "coverage mismatch"))
    if ri["conflictCount"] != rec["evidenceQuality"]["conflictCount"]:
        bad_rows.append((a["id"], "conflict mismatch"))
    if ri["concerns"] != concerns(rec):
        bad_rows.append((a["id"], "concern mismatch"))
    if ri["policy"] != rec["policy"]["name"]:
        bad_rows.append((a["id"], "policy mismatch"))
    if not ri["policy"] or ri["coverageRequired"] == 0:
        bad_rows.append((a["id"], "empty policy/coverage"))
print(f"== rows: {len(rows)} rows checked")
check("S27 row integrity agrees with the full record for every row", not bad_rows, str(bad_rows[:4]))
check("S27 rows exist", len(rows) >= 13, f"{len(rows)}")

# Primary-driver fields never leak machine vocabulary.
leak = re.compile(r"\b[A-Z0-9]{2,}_[A-Z0-9_]+\b")
driver_leaks = [a["id"] for a in rows if a.get("integrity") and (
    leak.search(a["integrity"].get("primaryDriverLabel") or "")
    or leak.search(a["integrity"].get("policy") or ""))]
check("S27/S33 primary driver + policy fields are humanized", not driver_leaks, str(driver_leaks[:4]))

# The VERIFY seeded record (demo-assess-008) must name a primary driver.
v8 = next((a for a in rows if (a.get("integrity") or {}).get("primaryDriverLabel")
           and a["finalStatus"] == 2), None)
check("S27 a VERIFY row names its primary driver", v8 is not None)

# ── S30: demonstration sequence ──────────────────────────────────────────────
demo = get("/api/dashboard/demonstration")
steps = demo["steps"]
print("== demonstration: " + " → ".join(s["disposition"] for s in steps))
check("S30 sequence available", demo["available"] is True and len(steps) == 3)
check("S30 dispositions are TRUST → REVIEW → VERIFY",
      [s["disposition"] for s in steps] == ["TRUST", "REVIEW", "VERIFY"])
check("S30 first step has no change line", steps[0]["change"] is None)
check("S30 change lines are derived from recorded findings",
      all((s["change"] or "").startswith("New finding:") for s in steps[1:]))
check("S30 deterministic — no advisory involvement", demo["aiInvolved"] is False)
check("S30 every step discloses its policy", all(s["policy"] for s in steps))
check("S30 note labels the data as demonstration-only", "demonstration" in demo["note"].lower())

# ── S29/S35: per-scenario RIR checks through the real pipeline ──────────────
def demo_kind(kind):
    return get(f"/api/assessments/demo/{kind}")["id"]

kinds = {}
for kind in ["trust", "review", "verify", "missing", "offline"]:
    kinds[kind] = demo_kind(kind)
# These records were created AFTER the initial snapshot — fetch them fresh.
krecords = {kind: get(f"/api/assessments/{aid}/integrity-record") for kind, aid in kinds.items()}

t_rec = krecords["trust"]
check("trust scenario: complete coverage, no conflicts", 
      t_rec["evidenceQuality"]["coverage"]["requiredAvailable"] == t_rec["evidenceQuality"]["coverage"]["requiredTotal"]
      and t_rec["evidenceQuality"]["conflictCount"] == 0 and t_rec["disposition"] == "Trust")
v_rec = krecords["verify"]
check("verify scenario: hard failure, primary driver identified, no advisory",
      v_rec["disposition"] == "Verify" and v_rec["aiContext"]["consulted"] is False
      and any(d["state"] == "failed" for d in v_rec["domains"])
      and v_rec["causality"]["primaryDrivers"])
m_rec = krecords["missing"]
check("missing scenario: coverage incomplete, engine-derived disposition",
      m_rec["evidenceQuality"]["coverage"]["requiredAvailable"] < m_rec["evidenceQuality"]["coverage"]["requiredTotal"]
      and m_rec["disposition"] in ("Trust", "Review", "Verify"))
o_rec = krecords["offline"]
conn = next(d for d in o_rec["domains"] if d["domain"] == "connectivity")
check("offline scenario: connectivity stays synchronisation metadata",
      "synchronisation metadata" in conn["note"].lower() and o_rec["disposition"] == "Trust")

# ── S35: historical reopen consistency ──────────────────────────────────────
first = get(f"/api/assessments/{kinds['trust']}/integrity-record")
second = get(f"/api/assessments/{kinds['trust']}/integrity-record")
check("S35 reopening reproduces the identical record", json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True))

print()
if failures:
    print(f"E2E FAILED: {len(failures)} check(s): {failures}")
    raise SystemExit(1)
print("ALL INTEGRITY E2E CHECKS PASSED")
PYEOF
echo DONE
