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
expect "hello from the laptop" 15 "received text appears on the phone"
expect "e2e-transfer.bin" 10 "received file appears on the phone"
shot e2e-received
remote=$(adb shell "ls -l /sdcard/Download/Relay/ 2>/dev/null | grep e2e-transfer.bin" | awk '{print $5}')
[ "$remote" = 1572864 ] && pass "file saved to Downloads/Relay with the right size" || fail "file saved to Downloads/Relay with the right size (got '$remote')"
adb pull /sdcard/Download/Relay/e2e-transfer.bin /tmp/e2e-back.bin >/dev/null 2>&1
cmp -s /tmp/e2e-transfer.bin /tmp/e2e-back.bin && pass "file arrived byte-for-byte intact" || fail "file arrived byte-for-byte intact"

adb shell input keyevent KEYCODE_BACK; sleep 3
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:18765/api/hello)
[ "$code" != 401 ] && pass "server stops when leaving Receive" || fail "server stops when leaving Receive (still answering)"

# Share text into Relay from another app.
adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "shared from another app" dev.basalt.relay >/dev/null
sleep 6
expect "shared from another app" 15 "text shared from another app opens in Send"
shot e2e-share
adb shell input keyevent KEYCODE_BACK; sleep 2
