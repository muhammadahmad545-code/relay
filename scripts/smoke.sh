#!/bin/bash
# Smoke test on an emulator: install, launch, skip the introduction, capture what is on screen.
# Usage: smoke.sh <apk> <package> <text that must be on screen after the introduction>
set -u
APK="$1"; PKG="$2"; EXPECT="$3"; OUT=smoke
mkdir -p "$OUT"
adb wait-for-device
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb install -r -g "$APK" || { echo "INSTALL FAILED"; exit 1; }
adb logcat -c

shot() { adb exec-out screencap -p > "$OUT/$1.png"; adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && adb pull /sdcard/ui.xml "$OUT/$1.xml" >/dev/null 2>&1; }

tap_text() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && adb pull /sdcard/ui.xml /tmp/ui.xml >/dev/null 2>&1 || return 1
  local xy
  xy=$(python3 - "$1" <<'PY'
import re, sys
want = sys.argv[1]
xml = open('/tmp/ui.xml', encoding='utf-8', errors='ignore').read()
# The last match wins: the floating tab bar is drawn last, on top of any same-named chip below it.
hit = None
for m in re.finditer(r'<node [^>]*>', xml):
    n = m.group(0)
    t = re.search(r' text="([^"]*)"', n); d = re.search(r' content-desc="([^"]*)"', n)
    if (t and t.group(1) == want) or (d and d.group(1) == want):
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        if b:
            x1, y1, x2, y2 = map(int, b.groups()); hit = ((x1 + x2) // 2, (y1 + y2) // 2)
if hit: print(*hit)
PY
)
  [ -n "$xy" ] && adb shell input tap $xy && echo "tapped '$1' at $xy"
}

# Wait until the app shows something we can read (slow emulators can take a minute).
wait_for() {
  for i in $(seq 1 30); do
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && adb pull /sdcard/ui.xml /tmp/ui.xml >/dev/null 2>&1
    grep -q "text=\"$1\"" /tmp/ui.xml 2>/dev/null && return 0
    sleep 5
  done
  return 1
}

FAILED=0
fail() { echo "E2E FAIL: $*"; FAILED=1; }
pass() { echo "E2E PASS: $*"; }
dump() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && adb pull /sdcard/ui.xml /tmp/ui.xml >/dev/null 2>&1; }
# True when some on-screen text contains the given substring.
has_text() { dump; grep -q "text=\"[^\"]*$1" /tmp/ui.xml 2>/dev/null; }
wait_contains() {
  for i in $(seq 1 ${2:-20}); do has_text "$1" && return 0; sleep 3; done
  return 1
}
# Scroll down until the text is on screen (lists longer than the screen).
scroll_to() {
  for i in $(seq 1 8); do has_text "$1" && return 0; adb shell input swipe 160 520 160 220 300; sleep 1; done
  has_text "$1"
}
# Scroll back to the top of the current screen.
scroll_top() { for i in 1 2 3 4; do adb shell input swipe 160 200 160 600 200; done; sleep 1; }
# Tap the first view whose resource id ends with the given name.
tap_res() {
  dump
  local xy
  xy=$(python3 - "$1" <<'PY'
import re, sys
xml = open('/tmp/ui.xml', encoding='utf-8', errors='ignore').read()
for m in re.finditer(r'<node [^>]*>', xml):
    n = m.group(0)
    r = re.search(r'resource-id="([^"]*)"', n)
    if r and r.group(1).endswith(sys.argv[1]):
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        if b:
            x1, y1, x2, y2 = map(int, b.groups()); print((x1 + x2) // 2, (y1 + y2) // 2); break
PY
)
  [ -n "$xy" ] && adb shell input tap $xy && echo "tapped #$1 at $xy"
}
type_text() { adb shell input text "$(echo "$1" | sed 's/ /%s/g')"; }
expect() { if wait_contains "$1" "${2:-20}" || scroll_to "$1"; then pass "$3"; else fail "$3 (did not see '$1')"; shot "fail-$(echo "$3" | tr -c 'a-zA-Z0-9' '-' | cut -c1-40)"; fi; }
expect_not() { sleep "${2:-3}"; if has_text "$1"; then fail "$3 (still saw '$1')"; else pass "$3"; fi; }

adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
wait_for "Skip" || echo "introduction never appeared"
shot 1-launch
tap_text "Skip" || echo "no Skip found"
wait_for "$EXPECT" || echo "EXPECTED TEXT NOT FOUND AFTER INTRO: $EXPECT"
sleep 5
shot 2-after-intro
# Visit every tab by its label to prove each screen renders.
for label in ${TABS:-}; do
  tap_text "$label" && sleep 8 && shot "tab-$label"
done
# Relaunch from cold to see the second-start path.
adb shell am force-stop "$PKG"; sleep 2
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
wait_for "$EXPECT" || echo "EXPECTED TEXT NOT FOUND AFTER RELAUNCH: $EXPECT"
shot 3-relaunch
adb logcat -d -v time > "$OUT/logcat.txt"
grep -E "ReactNativeJS|AndroidRuntime|FATAL|Error|Exception" "$OUT/logcat.txt" | grep -v "chatty" | tail -200 > "$OUT/errors.txt" || true
echo "---- texts on screen after intro ----"
python3 - "$OUT/2-after-intro.xml" <<'PY' || true
import re, sys
try:
    xml = open(sys.argv[1], encoding='utf-8', errors='ignore').read()
    print([t for t in re.findall(r' text="([^"]+)"', xml)][:60])
except Exception as e:
    print("no dump", e)
PY
echo "---- JS errors ----"
head -80 "$OUT/errors.txt"

# App-specific end-to-end checks.
if [ -f scripts/e2e.sh ]; then
  echo "---- end-to-end ----"
  adb logcat -c
  source scripts/e2e.sh
  adb logcat -d -v time > "$OUT/logcat-e2e.txt"
  grep -E "AndroidRuntime|FATAL" "$OUT/logcat-e2e.txt" | head -40 && grep -q "FATAL EXCEPTION" "$OUT/logcat-e2e.txt" && fail "the app crashed during end-to-end tests"
fi

# Fail the build when the app did not render its first screen.
grep -q "text=\"$EXPECT\"" "$OUT/2-after-intro.xml" && grep -q "text=\"$EXPECT\"" "$OUT/3-relaunch.xml" || { echo "SMOKE TEST FAILED: '$EXPECT' not on screen"; exit 1; }
[ "$FAILED" = 0 ] || { echo "END-TO-END TESTS FAILED"; exit 1; }
echo "SMOKE TEST PASSED"
