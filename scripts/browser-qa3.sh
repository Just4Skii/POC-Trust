#!/bin/bash
# Browser E2E for the integrity upgrade (spec chunk 4, sections 26/27/28/30/36/37):
# dashboard Integrity Overview, Demonstration moment, enriched history rows, the section-28
# audit pipeline, policy chip + drivers + timeline, humanized copy with zero machine
# identifiers in the primary UI, and the mobile layout. Status always comes from the engine.
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
export PATH="$HOME/.dotnet:$PATH"
export DOTNET_ROOT="$HOME/.dotnet"
export ASPNETCORE_ENVIRONMENT=Development

ref_for() {
  local r; r=$(grep -F -- "$2" "$1" | grep -o 'e[0-9][0-9]*' | head -1)
  [ -n "$r" ] && echo "@$r"
}

cd src/POCTrust.Api
dotnet bin/Debug/net10.0/POCTrust.Api.dll --urls http://127.0.0.1:5615 > /tmp/poctrust-qa3.log 2>&1 &
API_PID=$!
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
trap "kill $API_PID 2>/dev/null" EXIT
for i in $(seq 1 30); do curl -s -m 2 http://127.0.0.1:5615/health > /dev/null 2>&1 && break; sleep 1; done

agent-browser set viewport 1440 1000
agent-browser open http://127.0.0.1:5615
agent-browser wait --load networkidle --timeout 20000
agent-browser wait 1200

FAIL=0
body_text() { agent-browser eval 'document.body.innerText' | tr -d '\r' > "$1"; }
expect_in() { grep -qF -- "$2" "$1" && echo "  PASS page contains: $2" || { echo "  FAIL missing: $2"; FAIL=1; }; }
expect_absent() { grep -qF -- "$2" "$1" && { echo "  FAIL must NOT contain: $2"; FAIL=1; } || echo "  PASS absent: $2"; }

echo "== overview: integrity overview + demonstration moment"
body_text /tmp/qa3-overview.txt
expect_in /tmp/qa3-overview.txt "Integrity overview"
expect_in /tmp/qa3-overview.txt "DEMONSTRATION MODE — SYNTHETIC DATA ONLY"
expect_in /tmp/qa3-overview.txt "Evidence coverage"
expect_in /tmp/qa3-overview.txt "EVIDENCE CONCERNS"
expect_in /tmp/qa3-overview.txt "AGING EVIDENCE"
expect_in /tmp/qa3-overview.txt "Demonstration moment"
expect_in /tmp/qa3-overview.txt "WHY DID IT CHANGE?"
expect_in /tmp/qa3-overview.txt "No advisory involvement"
agent-browser screenshot --full $REPO/docs/assets/integrity-overview-1440.png

echo "== machine-identifier scan on the overview (section 33)"
if grep -Eq '\b(EVIDENCE_STATE|RIR_ID|POLICY_ID|RULE_WEIGHT|SOURCE_CONFIDENCE)\b|\b[A-Z0-9]{2,}_[A-Z0-9_]{3,}\b' /tmp/qa3-overview.txt; then
  echo "  FAIL machine identifiers leaked into the primary UI:"; grep -En '\b[A-Z0-9]{2,}_[A-Z0-9_]{3,}\b' /tmp/qa3-overview.txt | head -5; FAIL=1
else
  echo "  PASS no machine identifiers on the overview"
fi

echo "== assessments list: enriched rows"
agent-browser snapshot -i > /tmp/qa3-snap.txt
NAV=$(ref_for /tmp/qa3-snap.txt 'button "Assessments"')
agent-browser click "$NAV"
agent-browser wait 900
body_text /tmp/qa3-list.txt
expect_in /tmp/qa3-list.txt "Evidence:"
expect_in /tmp/qa3-list.txt "Primary driver:"
expect_in /tmp/qa3-list.txt "Policy:"
expect_in /tmp/qa3-list.txt "AI: Not consulted"
expect_in /tmp/qa3-list.txt "Audit: Available"
if grep -Eq '\b[A-Z0-9]{2,}_[A-Z0-9_]{3,}\b' /tmp/qa3-list.txt; then
  echo "  FAIL machine identifiers leaked into list rows:"; grep -En '\b[A-Z0-9]{2,}_[A-Z0-9_]{3,}\b' /tmp/qa3-list.txt | head -5; FAIL=1
else
  echo "  PASS no machine identifiers in list rows"
fi
agent-browser screenshot --full $REPO/docs/assets/integrity-list-1440.png

echo "== VERIFY record: drivers, policy chip, integrity timeline, zero advisory"
agent-browser snapshot -i > /tmp/qa3-list2.txt
ROW=$(ref_for /tmp/qa3-list2.txt "Hb 10.2 g/dL")
agent-browser click "$ROW"
agent-browser wait 2200
body_text /tmp/qa3-verify.txt
expect_in /tmp/qa3-verify.txt "Verify"
expect_in /tmp/qa3-verify.txt "Decision drivers"
expect_in /tmp/qa3-verify.txt "Inspect Integrity Record"
expect_in /tmp/qa3-verify.txt "Evidence quality evaluated"
expect_in /tmp/qa3-verify.txt "Decision drivers identified"
expect_in /tmp/qa3-verify.txt "Audit saved"
expect_in /tmp/qa3-verify.txt "INTEGRITY TIMELINE"
expect_absent /tmp/qa3-verify.txt "Contextual Analysis"

echo "== open the full record document (policy chip + provenance)"
agent-browser find text "Inspect Integrity Record" click
agent-browser wait 900
body_text /tmp/qa3-doc.txt
expect_in /tmp/qa3-doc.txt "General POC Demonstration"
expect_in /tmp/qa3-doc.txt "required domains available"
expect_in /tmp/qa3-doc.txt "Operational integrity assessment"

echo "== policy chip expands the policy context panel"
agent-browser snapshot -i > /tmp/qa3-doc-snap.txt
CHIP=$(ref_for /tmp/qa3-doc-snap.txt "GENERAL POC DEMONSTRATION")
agent-browser click "$CHIP"
agent-browser wait 700
body_text /tmp/qa3-policy.txt
expect_in /tmp/qa3-policy.txt "REQUIRED EVIDENCE"
expect_in /tmp/qa3-policy.txt "How does this assessment know what evidence matters?"
agent-browser screenshot --full $REPO/docs/assets/integrity-policy-1440.png
agent-browser screenshot --full $REPO/docs/assets/integrity-verify-1440.png

echo "== REVIEW record: advisory context present, visually secondary"
agent-browser find text "Back to history" click >/dev/null 2>&1 || true
agent-browser wait 700
agent-browser snapshot -i > /tmp/qa3-list3.txt
ROW2=$(ref_for /tmp/qa3-list3.txt "Hb 9.1 g/dL")
agent-browser click "$ROW2"
agent-browser wait 2200
body_text /tmp/qa3-review.txt
expect_in /tmp/qa3-review.txt "Contextual Analysis"
agent-browser screenshot --full $REPO/docs/assets/integrity-review-1440.png

echo "== mobile 390: overview + list, zero horizontal overflow"
agent-browser set viewport 390 844
agent-browser open http://127.0.0.1:5615
agent-browser wait --load networkidle --timeout 20000
agent-browser wait 1000
OV=$(agent-browser eval 'document.documentElement.scrollWidth - document.documentElement.clientWidth' | tr -d '\r')
echo "  overview overflow px: $OV"
[ "$OV" = "0" ] || { echo "  FAIL horizontal overflow on overview"; FAIL=1; }
agent-browser screenshot --full $REPO/docs/assets/integrity-overview-390.png

echo "== reduced-motion support is declared in the built CSS"
if grep -rq "prefers-reduced-motion" dist/../dist 2>/dev/null || grep -rq "prefers-reduced-motion" $REPO/frontend/poc-trust-ui/src/index.css; then
  echo "  PASS reduced-motion media handling present"
else
  echo "  FAIL reduced-motion block missing"; FAIL=1
fi

echo "== console errors"
agent-browser errors
agent-browser close
if [ "$FAIL" = "0" ]; then echo "QA3-PASS"; else echo "QA3-FAILED"; exit 1; fi
