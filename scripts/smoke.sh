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

# Fail the build when the app did not render its first screen.
grep -q "text=\"$EXPECT\"" "$OUT/2-after-intro.xml" && grep -q "text=\"$EXPECT\"" "$OUT/3-relaunch.xml" || { echo "SMOKE TEST FAILED: '$EXPECT' not on screen"; exit 1; }
echo "SMOKE TEST PASSED"
