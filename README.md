# Relay

Send files and text between nearby devices with no internet, no account and no cloud. Phone to phone, or phone to any laptop browser.

Relay is an Android app. The phone runs a small encrypted server on your local network for as long as the Receive screen is open; the other device talks to it directly.

**[Download the latest APK](https://github.com/muhammadahmad545-code/relay/releases/latest)**

## What it does

- **Phone to phone.** One phone shows a QR code, the other scans it and sends files of any type and size, or the text on its clipboard.
- **Phone to laptop, with nothing installed on the laptop.** Type the phone's address into any browser. The page shows a code; scan it with the phone and the browser is linked. Drag files in to send them to the phone, or download what the phone shares.
- **Works without a router.** Turn on the phone's hotspot and connect the other device to it. Mobile data is never used.
- **Resumes after drops.** Files move in 512 KB chunks. If the connection breaks, the sender asks the receiver where it got to and continues from there.
- **Encrypted end to end.** Every file, file name and text is encrypted with AES-256-GCM using a one-time key that exists only for the session.
- **Updates itself.** The app checks this repository's releases, downloads the new APK, verifies its SHA-256 and hands it to the Android installer.
- **Transfer history** stored on the phone only. Received files land in `Downloads/Relay`.

## How the security works

| Step | What happens |
|---|---|
| Session key | Opening Receive generates a random 256-bit key. It is kept in memory and discarded when the screen closes. |
| Phone to phone | The key travels inside the QR code, so it is never sent over the network. |
| Laptop browser | The browser creates a P-256 key pair and shows the public key as a QR code. The phone scans it, performs ECDH and leaves the session key wrapped for that browser, for one pickup only. Someone listening on the network sees only public values. |
| Every message | `nonce (12 bytes) ‖ ciphertext ‖ tag (16 bytes)`, with the purpose of the message (for example `chunk:<transfer>:<index>`) bound in as associated data, so a captured chunk cannot be replayed into another position or transfer. |
| Requests | Each request carries a token derived from the key by SHA-256, compared in constant time. |
| Scanned codes | The app only accepts pairing codes that point at private network addresses, so a malicious QR code cannot make it send files to the internet. |

**Limits, stated plainly.** Relay protects against anyone passively listening on the network. The browser page itself is served over plain HTTP, because browsers do not trust certificates for local addresses; an attacker who can actively tamper with traffic on your Wi-Fi could alter that page. Phone-to-phone transfers do not have this weakness, because no code is downloaded. Use the browser client on networks you trust.

Browsers disable their built-in cryptography on plain-HTTP pages, so the browser client bundles audited pure-JavaScript implementations ([noble](https://paulmillr.com/noble/)).

## How it is built

```
src/app/                     Screens (Expo Router): home, receive, send, history, settings
src/lib/                     Pairing-code parsing, transfer store, SQLite history
modules/relay-transfer/
  android/                   Kotlin: HTTP server, AES-GCM, ECDH linking, phone-to-phone client
  web/                       Browser client (TypeScript), bundled into one HTML file inside the APK
plugins/                     Config plugin that wires release signing into the Gradle build
```

- **React Native 0.88 + Expo SDK 58** (New Architecture), TypeScript, Expo Router.
- **Custom native module in Kotlin** using the Expo Modules API. File data never crosses the JavaScript bridge: the server decrypts chunks and writes them to disk natively, then moves the finished file into the public Downloads folder through MediaStore, which needs no storage permission.
- **[Basalt Core](https://github.com/muhammadahmad545-code/basalt-core)** provides the theme, UI kit, settings store and self-updater shared by all Basalt apps.
- **Tests** cover the wire protocol end to end against a reference server built on Node's OpenSSL bindings: interoperability of the bundled cryptography, multi-chunk transfers, resume after a dropped connection, cancellation, browser linking, and rejection of a browser that tries to collect someone else's key.

## Permissions

| Permission | Why |
|---|---|
| Camera | Scanning pairing codes. Nothing is recorded. |
| Network | The local transfer itself, and the update check against GitHub. |
| Install packages | Handing a downloaded update to the Android installer. |

No storage, contacts, location or microphone access. No analytics.

## Development

```bash
npm install
npm test
npm run typecheck
npm run prebuild
npx expo run:android
```

`node --import tsx modules/relay-transfer/web/dev.mts` serves the browser client against the reference server, so the laptop side can be worked on without a phone.

Pushing a tag `vX.Y.Z` that matches `package.json` builds a signed APK in GitHub Actions and publishes it as a release.

## License

MIT
