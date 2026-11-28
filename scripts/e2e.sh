# Relay end-to-end: open Receive, check the server, read the QR code like another device would,
# upload a file and text through the real encrypted protocol, check they arrived intact, then
# share text into Relay from another app. Sourced by smoke.sh (helpers come from there).

tap_text "Receive"; sleep 6
expect ":8765" 30 "receive session starts and shows the address"
shot e2e-receive

adb forward tcp:18765 tcp:8765 >/dev/null
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18765/)
[ "$code" = 200 ] && pass "phone serves the laptop page" || fail "phone serves the laptop page (HTTP $code)"
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18765/api/hello)
[ "$code" = 401 ] && pass "API refuses requests without the key" || fail "API refuses requests without the key (HTTP $code)"

# Show the code full screen and read it from a screenshot.
tap_text "Pairing QR code. Tap to show it full screen."; sleep 3
adb exec-out screencap -p > "$OUT/e2e-qr.png"
URL=$(python3 e2e/read_qr.py "$OUT/e2e-qr.png" | tail -1)
adb shell input tap 50 50; sleep 2
case "$URL" in
  http://*:8765/#k=*) pass "QR code holds the pairing link" ;;
  *) fail "QR code holds the pairing link (read '$URL')" ;;
esac

head -c 1572864 /dev/urandom > /tmp/e2e-transfer.bin
if npx tsx e2e/client.ts "$URL" 18765 /tmp/e2e-transfer.bin; then pass "encrypted upload and text from a laptop client"; else fail "encrypted upload and text from a laptop client"; fi
sleep 4
expect "hello from the laptop" 8 "received text appears on the phone"
expect "e2e-transfer.bin" 8 "received file appears on the phone"
shot e2e-received
remote=$(adb shell "ls -l /sdcard/Download/Relay/ 2>/dev/null | grep e2e-transfer.bin" | awk '{print $5}')
[ "$remote" = 1572864 ] && pass "file saved to Downloads/Relay with the right size" || fail "file saved to Downloads/Relay with the right size (got '$remote')"
adb pull /sdcard/Download/Relay/e2e-transfer.bin /tmp/e2e-back.bin >/dev/null 2>&1
cmp -s /tmp/e2e-transfer.bin /tmp/e2e-back.bin && pass "file arrived byte-for-byte intact" || fail "file arrived byte-for-byte intact"

adb shell input keyevent KEYCODE_BACK; sleep 3
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:18765/api/hello)
[ "$code" != 401 ] && pass "server stops when leaving Receive" || fail "server stops when leaving Receive (still answering)"

# Share text into Relay from another app.
adb shell "am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT 'shared from another app' dev.basalt.relay"
sleep 6
expect "shared from another app" 15 "text shared from another app opens in Send"
shot e2e-share
adb shell input keyevent KEYCODE_BACK; sleep 2

# Launcher shortcuts (long-press the icon): Receive and Send.
adb shell dumpsys shortcut > "$OUT/shortcuts.txt" 2>/dev/null
grep -A40 "Package: dev.basalt.relay" "$OUT/shortcuts.txt" | grep -q "id=receive" && pass "launcher shortcuts installed" || fail "launcher shortcuts installed"

# Quick Settings tile opens Receive.
TILE=dev.basalt.relay/expo.modules.relaytransfer.ReceiveTileService
adb shell cmd statusbar add-tile $TILE >/dev/null 2>&1
adb shell cmd statusbar click-tile $TILE >/dev/null 2>&1
sleep 6
expect ":8765" 20 "Quick Settings tile opens Receive and starts a session"
shot e2e-tile
adb shell cmd statusbar collapse >/dev/null 2>&1
adb shell input keyevent KEYCODE_BACK; sleep 3

# Received files can be deleted from History.
tap_text "History"; sleep 4
tap_text "More for e2e-transfer.bin" || fail "file actions button visible on a received file"
sleep 2
shot e2e-file-actions
# Android dialogs show their buttons in capitals.
tap_text "DELETE FILE" || tap_text "Delete file"; sleep 2
shot e2e-delete-confirm
tap_text "DELETE" || tap_text "Delete"; sleep 3
expect "file deleted" 10 "deleting a received file updates its history row"
left=$(adb shell "ls /sdcard/Download/Relay/ 2>/dev/null | grep -c e2e-transfer.bin" | tr -d '\r')
[ "$left" = 0 ] && pass "received file removed from Downloads/Relay" || fail "received file removed from Downloads/Relay (still there)"

# Privacy settings.
tap_text "Settings"; sleep 4
expect "App lock" 10 "app lock setting is available"
expect "Quick Settings tile" 10 "quick access help is shown"
shot e2e-settings

# Appearance: change accent, font, background, depth and navigation; the screen previews the draft,
# Apply uses it everywhere, and it is still there after the app restarts.
# Swatches and font rows are found by their accessibility label (content-desc), not their text.
desc_y() { dump; python3 - "$1" <<'PY'
import re, sys
xml = open('/tmp/ui.xml', encoding='utf-8', errors='ignore').read()
for m in re.finditer(r'<node [^>]*>', xml):
    n = m.group(0)
    if f'content-desc="{sys.argv[1]}"' in n:
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        x1, y1, x2, y2 = map(int, b.groups())
        print((x1 + x2) // 2, (y1 + y2) // 2, 'selected' if ('selected="true"' in n or 'checked="true"' in n) else 'no')
        break
PY
}
# Scroll until the labelled control sits in the upper two thirds of the screen, then tap it.
tap_desc() {
  for i in $(seq 1 12); do
    read -r x y _ <<<"$(desc_y "$1")"
    if [ -n "$y" ] && [ "$y" -gt 80 ] && [ "$y" -lt 420 ]; then adb shell input tap $x $y; echo "tapped '$1'"; sleep 1; return 0; fi
    if [ -n "$y" ] && [ "$y" -le 80 ]; then adb shell input swipe 160 250 160 450 300; else adb shell input swipe 160 450 160 250 300; fi
    sleep 1
  done
  echo "could not reach '$1'"; return 1
}
is_selected_desc() {
  for i in $(seq 1 12); do
    read -r x y state <<<"$(desc_y "$1")"
    if [ -n "$y" ]; then [ "$state" = selected ]; return; fi
    adb shell input swipe 160 450 160 250 300; sleep 1
  done
  return 1
}
adb shell am force-stop $PKG; sleep 1
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null; sleep 6
tap_text "Settings"; sleep 3
tap_desc "Appearance" || { scroll_to "Appearance" >/dev/null; tap_text "Appearance"; }
sleep 3
expect "your way" 15 "Appearance screen opens with a live preview"
shot e2e-appearance-default
tap_desc "Teal accent"
tap_desc "Manrope font"
tap_desc "Warm background"
tap_desc "Glass"
tap_desc "Floating"
shot e2e-appearance-draft
expect "Apply" 5 "changes wait for Apply"
tap_text "Apply"; sleep 2
expect_not "Discard" 2 "Apply saves the draft"
adb shell input keyevent KEYCODE_BACK; sleep 2
shot e2e-appearance-applied
adb shell am force-stop $PKG; sleep 1
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null; sleep 6
tap_text "Settings"; sleep 3
tap_desc "Appearance" || { scroll_to "Appearance" >/dev/null; tap_text "Appearance"; }
sleep 3
scroll_top
if is_selected_desc "Teal accent"; then pass "accent choice survives a restart"; else fail "accent choice survives a restart"; fi
if is_selected_desc "Manrope font"; then pass "font choice survives a restart"; else fail "font choice survives a restart"; fi
if is_selected_desc "Floating"; then pass "navigation choice survives a restart"; else fail "navigation choice survives a restart"; fi
# Dark mode with the same choices, for the screenshots.
scroll_top
tap_desc "Dark"; tap_text "Apply"; sleep 2
scroll_top; shot e2e-appearance-dark
tap_desc "Reset to default"; tap_text "Apply"; sleep 2
scroll_top
if is_selected_desc "Relay accent"; then pass "Reset to default returns to the app colour"; else fail "Reset to default returns to the app colour"; fi
adb shell input keyevent KEYCODE_BACK; sleep 1
