# Eve

Eve is a voice assistant, like Siri, with a realtime audio-reactive spectrogram that loops every 5.000 s as its face.
It understands you with its own rules in the browser: no AI service, no API key. MERN stack:
**MongoDB** stores the assistant's memory, voice settings and saved compositions.
**Express** serves the API. **React** renders the interface. **Node** runs it all.

## Run it

```bash
npm install
npm run dev          # API on :5050 + Vite on http://localhost:5173
```

No MongoDB install is needed for development. If `MONGODB_URI` isn't set, the server starts an embedded
MongoDB whose data persists in `server/.data/`. The first start downloads its binary (about 77 MB).

Production (one process, one port):

```bash
npm run build        # builds client/dist
NODE_ENV=production MONGODB_URI=... npm start    # app + API on http://localhost:5050
```

Or with Docker (app + MongoDB): `docker compose up --build`.

## Android app

Eve also runs as an Android app (Capacitor), fully offline: no server, no internet, no API key.

```bash
npm run android            # builds client/android/app/build/outputs/apk/debug/app-debug.apk
npm run android -- --run   # also installs it on the connected phone or running emulator and opens it
```

Needs the Android SDK (Android Studio) and JDK 21. Newer JDKs are too new for Android's Gradle plugin; the script finds
an installed JDK 21 on macOS, or uses `JAVA_HOME`. To install the APK on a phone, turn on USB debugging and plug it in,
or copy the APK over and open it.

What's different in the app:
- **Tap talk** (bottom left) instead of pressing V. Tap again while Eve speaks to stop it.
- **Listening** uses Android's on-device speech recognizer. If the phone lacks the language pack, Android offers to
  download it once (about 60 MB); until then Eve uses Google's online recognizer, or the text box when offline.
  Eve takes turns: it doesn't listen while it talks.
- **Speaking** uses the phone's text-to-speech voices; offline it picks one installed on the phone.
- **Memory, voice settings and saved compositions** stay on the phone.
- **Opening apps**: "open WhatsApp", "open settings", any app on the home screen.
- **WhatsApp**: "send a WhatsApp to mom saying I'm on my way". Contacts come from the phone's address book
  (Android asks once). Eve reads the message back and sends it when you say yes.
  To let Eve tap Send by itself, say **"turn on auto send"** and switch on *Eve auto-send* in Accessibility
  settings. It acts only inside WhatsApp, and only for a few seconds after you confirm a message. Without it,
  Eve opens the chat with the message typed in and you tap Send.

Native code is in `client/android/app/src/main/java/com/codecarrots/eve/`: `SpeechPlugin` (speech recognition),
`TtsPlugin` (voice), `DevicePlugin` (apps, contacts, WhatsApp), `SendService` (auto-send). In JavaScript,
`client/src/native/` adds the browser speech APIs on top of them (`shims.js`) and replaces the server's data routes
(`localApi.js`).

## Checks

```bash
npm run lint         # ESLint (React hooks rules included)
npm test             # Vitest: API tests against an in-memory MongoDB + assistant/speech unit tests
npm run e2e          # Playwright against the built app (uses your installed Chrome; PW_CHANNEL=chromium for Playwright's)
```

CI (`.github/workflows/ci.yml`) runs all three on every push.

### Configuration: `server/.env` (copy from `server/.env.example`)

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection string. Required in production; optional in development. |
| `PORT` | API/app port (default 5050). |
| `LOCAL_ACTIONS` | Lets Eve open apps and send WhatsApp messages on the Mac running the server, for requests from that Mac only. Default on in development, off in production. |
| `TRUST_PROXY` | Number of proxies in front of the app, so rate limits see real client IPs. |

The server refuses to start in production without `MONGODB_URI`, or with an invalid setting.

### Protection

The API has rate limits per IP and per device, and caps on stored data: 30 facts and 200 saved compositions per device.
Every response also carries a strict Content-Security-Policy and security headers (helmet), and logs are
structured JSON in production.

## Layout

```
client/                 React + Vite
  src/engine/engine.js  WebGL field + GPU particles (vertex shader), Canvas 2D overlay/HUD, audio analysis, capture
  src/assistant/        brain.js (offline intents) · speech.js (text-to-speech) · bargein.js · timers.js · assistant.js (turns, listening, API)
  test/                 Vitest unit tests
  src/components/       Stage · SystemStack · Talk · Controls · HelpPanel
  src/lib/              store (shared state for React + engine) · api (REST) · storage
server/                 Express + Mongoose
  src/models/           Memory · Settings · Composition
  src/routes/           data.js (memory, settings, compositions) · device.js (apps and WhatsApp on this Mac)
  src/app.js · config.js · logger.js · middleware/limits.js
  test/                 API tests (supertest + in-memory MongoDB)
e2e/                    Playwright tests
legacy/index.html       the original single-file version, kept for reference
scripts/dev.mjs         runs both dev servers
scripts/android.mjs     builds (and with --run installs) the Android app
client/android/         Android project (Capacitor) with Eve's native plugins
client/src/native/      the app's speech stand-ins and on-phone storage
```

## API

All `/api` routes except `/api/health` need an `x-eve-device` header. The browser creates an anonymous id
and stores it in localStorage. There are no accounts, and every document is scoped to that id.

| Method | Route | |
|---|---|---|
| GET | `/api/health` | `{ ok, db, device }` |
| GET · PUT · DELETE | `/api/memory` | `{ name, facts[], contacts[] }` the assistant remembers |
| GET · PUT | `/api/settings` | `{ voice, rate }` |
| GET · POST | `/api/compositions` | saved seeds `{ id, seed, name, createdAt }` |
| DELETE | `/api/compositions/:id` | |
| GET | `/api/device` | `{ ok, whatsapp }` (installed?). Device routes answer only requests from this Mac |
| POST | `/api/device/open` | `{ app }` opens an app |
| POST | `/api/device/contact` | `{ name }` → `{ name, phone }` from macOS Contacts |
| POST | `/api/device/whatsapp` | `{ phone, text }` → `{ status: 'sent' \| 'drafted' }` |

## Using it

Press **?** in the app for every control.

| Key | |
|---|---|
| V | talk to Eve, hands-free |
| T | type to Eve instead |
| W | wake word on or off: Eve waits for "hey Eve", like Siri |
| Esc | interrupt / close |
| M / F | microphone / audio file (or drop one anywhere) |
| Space | live audio on or off |
| L / R | pause / new seed |
| P / G | save a still / record the seamless 5 s loop as WebM |

The offline brain handles these directly:
- the visual: pause, play, record, screenshot, new seed, louder or quieter, microphone
- saving compositions: "save this composition as dawn"
- timers
- maths and unit conversions
- time and date
- coin flips and dice
- memory: "my name is…", "remember that…"
- voice: "change your voice", "speak slower"
- apps and WhatsApp: "open WhatsApp", "send a WhatsApp to mom saying I'm on my way", "message dad I'm running late",
  "save mom's number as +91 98765 43210"

**Fully offline.** None of the above needs internet or an API key. Speech recognition runs on-device in Chrome
(it downloads a language pack the first time you press V), and replies use a voice installed on the computer.

**WhatsApp and apps (macOS).** Like Siri, Eve asks for anything missing ("Who should I send it to?", "What should
it say?"), reads the message back, and sends it when you say "yes". Say "change it to …" or "no" instead.
- Recipients: numbers you saved with Eve first, then the Mac's Contacts app (macOS asks for permission once).
  Unknown names: Eve asks for the number, with the country code, and remembers it.
- Sending uses the **WhatsApp desktop app** (Mac App Store). The server opens the chat with your message and presses
  Return. That needs one permission: System Settings → Privacy & Security → **Accessibility** → turn on the app that
  runs `npm run dev` (Terminal, iTerm, VS Code…). Without it, Eve types the message and you press Return.
- Without the desktop app or the server, Eve opens the chat in WhatsApp Web with the message filled in.
- These actions only answer requests from the Mac the server runs on. They're on in development and off in
  production unless `LOCAL_ACTIONS=1`.

**How Eve understands you (Siri-style).** Everything runs in the browser, in milliseconds, with no AI service:
1. **Follow-ups.** If Eve just asked something ("For how long?"), your answer completes that request.
2. **Local rules.** Commands and questions it knows ("pause", "15% of 80", "set a timer for 5 minutes", "what time is it",
   "good morning") are matched by Eve's own rules. Greetings follow the time of day.
3. **Anything else** gets a polite "Sorry, I can't help with that yet", and "help" lists what Eve can do.

**Wake word ("hey Eve").** Press W or say "turn on the wake word". Eve then waits quietly and ignores
everything until it hears "hey Eve" or "ok Eve". Say the request in the same breath ("hey Eve, set a timer for
10 minutes"), or say just "hey Eve", wait for the chime, then ask. After each answer Eve stays awake for 8 seconds,
so follow-ups don't need the wake word. "Goodbye" or "go to sleep" sends it back to waiting. The setting is remembered,
so Eve starts waiting as soon as the page opens. While waiting, nothing it hears is shown, answered or sent to the
server, but Chrome's recognizer still processes the audio (see Privacy below). Not available in the Android app.

**Talking over Eve.** While Eve speaks, it keeps listening. Start talking and it stops to hear you;
"stop" or "wait" cuts it off. It ignores its own voice coming back through the speakers by comparing what it
hears with what it just said. Headphones still work best. Say "turn off interruptions" to disable this.

**Rendering.** The ~9,200 particles are positioned in a WebGL vertex shader, so each frame the CPU only updates
36 ring parameters. `?particles=cpu` forces the Canvas 2D path, which is also the fallback without WebGL.

URL parameters: `?seed=1337` / `?seed=random`, `?motion=0|1`, `?capture=1` (records on load), `?debug=1` (exposes `window.__eve`), `?particles=cpu`.

Privacy: browser speech recognition is not offline. Chrome and Edge send microphone audio to their own
cloud speech services while listening. If recognition is unavailable, a text box opens instead.
