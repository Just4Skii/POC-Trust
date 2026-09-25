#!/bin/bash
# Browser E2E for the Localised Clinical Interaction Layer (spec chunks 4–6, sections 9/10/11/14/15):
# the decision is language-neutral (canonical code + identical API payloads in every language),
# only the explanation around it is localised. Covers: zu/xh/af decision screens, the
# Contextual-Analysis English-note policy, VERIFY without advisory content in every language,
# the "Show in English" round trip (hero + reason chain), announcement live region,
# offline-cached catalog switching (no re-fetch on repeat switches), and 390px layout
# with isiZulu strings.
#
# NOTE on date parts: the QA runtime (headless Chromium) carries NO ICU data for zu/xh, so
# dates correctly fall back to en-ZA formatting (spec section 11: verify, never assume).
# Positive matches are case-insensitive because CSS text-transform feeds innerText.
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
export PATH="$HOME/.dotnet:$PATH"
export DOTNET_ROOT="$HOME/.dotnet"
export ASPNETCORE_ENVIRONMENT=Development

cd src/POCTrust.Api
dotnet bin/Debug/net10.0/POCTrust.Api.dll --urls http://127.0.0.1:5616 > /tmp/poctrust-qa4.log 2>&1 &
API_PID=$!
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
trap "kill $API_PID 2>/dev/null" EXIT
for i in $(seq 1 30); do curl -s -m 2 http://127.0.0.1:5616/health > /dev/null 2>&1 && break; sleep 1; done

# One TRUST record via the real demonstration pipeline (review/verify records are seeded).
curl -s http://127.0.0.1:5616/api/assessments/demo/trust > /dev/null

FAIL=0
body_text() { agent-browser eval 'document.body.innerText' | tr -d '\r' > "$1"; }
expect_in() { grep -qiF -- "$2" "$1" && echo "  PASS page contains: $2" || { echo "  FAIL missing: $2"; FAIL=1; }; }
expect_absent() { grep -qF -- "$2" "$1" && { echo "  FAIL must NOT contain: $2"; FAIL=1; } || echo "  PASS absent: $2"; }

html_lang() {
  local L
  for i in 1 2 3; do
    L=$(agent-browser eval 'document.documentElement.lang' | tr -d '\r"')
    [ -n "$L" ] && { echo "$L"; return; }
    sleep 1
  done
  echo "$L"
}

# Language-agnostic navigation: the sidebar is hidden on narrow screens, so fall back to
# the mobile header nav. "Assessments" is the third entry in both (NAV order is stable).
nav_assessments() {
  agent-browser eval "(function(){var aside=document.querySelector('aside nav');var btns=(aside?aside:document.querySelector('header nav')).querySelectorAll('button');if(btns.length<3)return 'NO_NAV';btns[2].click();return 'NAV';})()" > /dev/null
  sleep 1
}
# Open a record row by its result substring (row text is DATA — language-independent).
open_row() {
  agent-browser eval "(function(){var row=[].slice.call(document.querySelectorAll('li button')).find(function(b){return b.innerText.indexOf('$1')>-1});if(!row)return 'NO_ROW';row.click();return 'ROW';})()" > /dev/null
  sleep 2
}

switch_locale() {
  agent-browser eval "(function(){var sel=[].slice.call(document.querySelectorAll('select')).find(function(s){return [].slice.call(s.options).some(function(o){return o.value==='$1'})});if(!sel)return 'NO_SELECT';var set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(sel,'$1');sel.dispatchEvent(new Event('change',{bubbles:true}));return 'SWITCHED:$1';})()"
  sleep 1
}

agent-browser set viewport 1440 1000
agent-browser open http://127.0.0.1:5616
agent-browser wait --load networkidle --timeout 20000
agent-browser wait 1500

echo "== English baseline: open the seeded REVIEW record"
nav_assessments
open_row "Hb 9.1"
body_text /tmp/qa4-en-review.txt
expect_in /tmp/qa4-en-review.txt "REVIEW"
expect_in /tmp/qa4-en-review.txt "Contextual Analysis"

echo "== payload stashed in English (spec 14: language switch must not change data)"
agent-browser eval "(function(){var x=new XMLHttpRequest();x.open('GET','/api/assessments?take=100',false);x.send(null);var list=JSON.parse(x.responseText);list=(Array.isArray(list)?list:(list.items||[]));var rec=list.filter(function(a){return a.result==='Hb 9.1 g/dL'})[0];if(!rec)return 'NO_RECORD';window.__rid=rec.id;var y=new XMLHttpRequest();y.open('GET','/api/assessments/'+rec.id,false);y.send(null);window.__payloadEn=y.responseText;return 'stored';})()" > /tmp/qa4-store.txt
grep -q "stored" /tmp/qa4-store.txt && echo "  PASS record payload stashed" || { echo "  FAIL could not stash payload"; FAIL=1; }

echo "== isiZulu: decision screen pattern (canonical code + localised label + preview label)"
switch_locale "zu-ZA"
L=$(html_lang); [ "$L" = "zu-ZA" ] && echo "  PASS html lang=$L" || { echo "  FAIL html lang=$L"; FAIL=1; }
body_text /tmp/qa4-zu-review.txt
expect_in /tmp/qa4-zu-review.txt "REVIEW"
expect_in /tmp/qa4-zu-review.txt "Ukubuyekezwa"
expect_in /tmp/qa4-zu-review.txt "Bonisa ngesiNgisi"
expect_in /tmp/qa4-zu-review.txt "Isiboniso kolimi"
agent-browser screenshot --full $REPO/docs/assets/i18n-review-zu-1440.png

echo "== section 9: Contextual Analysis stays English, framed in isiZulu"
expect_in /tmp/qa4-zu-review.txt "Ukuhlaziywa komongo atholakala ngesiNgisi okwamanje."
expect_in /tmp/qa4-zu-review.txt "Incazelo esizwa i-AI"
LANGNODE=$(agent-browser eval 'document.querySelector("[lang=en]") ? "lang-marked" : "no-lang"' | tr -d '\r')
echo "$LANGNODE" | grep -q "lang-marked" && echo "  PASS advisory prose carries lang=en" || { echo "  FAIL advisory prose missing lang=en"; FAIL=1; }

echo "== spec 14: the API payload is byte-identical in isiZulu"
agent-browser eval "(function(){var y=new XMLHttpRequest();y.open('GET','/api/assessments/'+window.__rid,false);y.send(null);return y.responseText===window.__payloadEn?'IDENTICAL':'DIFFERENT';})()" | tr -d '\r' > /tmp/qa4-payload.txt
grep -q "IDENTICAL" /tmp/qa4-payload.txt && echo "  PASS payload identical across languages" || { echo "  FAIL payload changed: $(cat /tmp/qa4-payload.txt)"; FAIL=1; }

echo "== Show in English round trip (hero AND reason chain, spec section 8)"
agent-browser eval "(function(){var b=[].slice.call(document.querySelectorAll('button')).find(function(x){return x.innerText.trim()==='Bonisa ngesiNgisi'});if(!b)return 'NO_BTN';b.click();return 'OVERRIDE-ON';})()" > /dev/null
sleep 1
body_text /tmp/qa4-zu-english.txt
expect_in /tmp/qa4-zu-english.txt "Concerns need review"
expect_in /tmp/qa4-zu-english.txt "Calibration due soon"
agent-browser eval "(function(){var b=[].slice.call(document.querySelectorAll('button')).find(function(x){return x.innerText.trim()==='Bonisa nge-isiZulu'});if(!b)return 'NO_BTN';b.click();return 'OVERRIDE-OFF';})()" > /dev/null
sleep 1
body_text /tmp/qa4-zu-back.txt
expect_in /tmp/qa4-zu-back.txt "Ukubuyekezwa"

echo "== announcement live region exists (section 11)"
agent-browser eval 'document.querySelector("[data-testid=locale-announcer]") && document.querySelector("[data-testid=locale-announcer]").getAttribute("aria-live")' | tr -d '\r' > /tmp/qa4-ann.txt
grep -q "polite" /tmp/qa4-ann.txt && echo "  PASS polite live region present" || { echo "  FAIL live region missing"; FAIL=1; }

echo "== VERIFY in isiZulu: canonical code + localised label + ZERO advisory content"
nav_assessments
open_row "Hb 10.2"
body_text /tmp/qa4-zu-verify.txt
expect_in /tmp/qa4-zu-verify.txt "VERIFY"
expect_in /tmp/qa4-zu-verify.txt "Ukuqinisekisa"
expect_absent /tmp/qa4-zu-verify.txt "Contextual Analysis"
expect_absent /tmp/qa4-zu-verify.txt "Ukuhlaziywa komongo atholakala"
agent-browser screenshot --full $REPO/docs/assets/i18n-verify-zu-1440.png

echo "== TRUST in isiZulu (record created through the real pipeline)"
nav_assessments
agent-browser eval "document.querySelector('li button').click()" > /dev/null
sleep 2
body_text /tmp/qa4-zu-trust.txt
expect_in /tmp/qa4-zu-trust.txt "TRUST"
expect_in /tmp/qa4-zu-trust.txt "Ukuthembeka"
expect_absent /tmp/qa4-zu-trust.txt "Contextual Analysis"

echo "== Afrikaans + isiXhosa render from the same catalogs"
switch_locale "af-ZA"
L=$(html_lang); [ "$L" = "af-ZA" ] && echo "  PASS html lang=$L" || { echo "  FAIL html lang=$L"; FAIL=1; }
body_text /tmp/qa4-af-trust.txt
expect_in /tmp/qa4-af-trust.txt "TRUST"
expect_in /tmp/qa4-af-trust.txt "Vertroue"
expect_in /tmp/qa4-af-trust.txt "Taalvoorskou"
switch_locale "xh-ZA"
L=$(html_lang); [ "$L" = "xh-ZA" ] && echo "  PASS html lang=$L" || { echo "  FAIL html lang=$L"; FAIL=1; }
body_text /tmp/qa4-xh-trust.txt
expect_in /tmp/qa4-xh-trust.txt "Ukuthembeka"
expect_in /tmp/qa4-xh-trust.txt "Imboniso yolwimi"
agent-browser screenshot --full $REPO/docs/assets/i18n-trust-xh-1440.png

echo "== offline-style switching: repeat switches fetch NO new catalog chunks (section 10)"
agent-browser eval 'window.__zuN = performance.getEntriesByType("resource").filter(function(r){return r.name.indexOf("zu-ZA")>-1}).length; window.__afN = performance.getEntriesByType("resource").filter(function(r){return r.name.indexOf("af-ZA")>-1}).length; "counted"' > /dev/null
switch_locale "zu-ZA"
switch_locale "af-ZA"
agent-browser eval '(function(){var z=performance.getEntriesByType("resource").filter(function(r){return r.name.indexOf("zu-ZA")>-1}).length; var a=performance.getEntriesByType("resource").filter(function(r){return r.name.indexOf("af-ZA")>-1}).length; return (z===window.__zuN && a===window.__afN) ? "NO-NEW-FETCHES" : ("NEW-FETCHES z:"+z+" a:"+a);})()' | tr -d '\r' > /tmp/qa4-offline.txt
grep -q "NO-NEW-FETCHES" /tmp/qa4-offline.txt && echo "  PASS switches served from warmed cache (no network)" || { echo "  FAIL $(cat /tmp/qa4-offline.txt)"; FAIL=1; }

echo "== back to English: the canonical experience is unchanged"
switch_locale "en-ZA"
L=$(html_lang); [ "$L" = "en-ZA" ] && echo "  PASS html lang=$L" || { echo "  FAIL html lang=$L"; FAIL=1; }

echo "== mobile 390 in isiZulu: zero horizontal overflow, no clipped strings"
switch_locale "zu-ZA"
agent-browser set viewport 390 844
agent-browser open http://127.0.0.1:5616
agent-browser wait --load networkidle --timeout 20000
agent-browser wait 1200
OV=$(agent-browser eval 'document.documentElement.scrollWidth - document.documentElement.clientWidth' | tr -d '\r')
echo "  overview overflow px: $OV"
[ "$OV" = "0" ] || { echo "  FAIL horizontal overflow (overview, isiZulu)"; FAIL=1; }
agent-browser eval "(function(){var nav=document.querySelector('header nav');var btns=nav?nav.querySelectorAll('button'):[];if(btns.length<3)return 'NO_NAV';btns[2].click();return 'NAV';})()" > /dev/null
sleep 1
open_row "Hb"
OV2=$(agent-browser eval 'document.documentElement.scrollWidth - document.documentElement.clientWidth' | tr -d '\r')
echo "  record overflow px: $OV2"
[ "$OV2" = "0" ] || { echo "  FAIL horizontal overflow (record, isiZulu)"; FAIL=1; }
agent-browser screenshot --full $REPO/docs/assets/i18n-record-zu-390.png

echo "== console errors"
agent-browser errors
agent-browser close
if [ "$FAIL" = "0" ]; then echo "QA4-PASS"; else echo "QA4-FAILED"; exit 1; fi
