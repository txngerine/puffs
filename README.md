# Puffs

A realtime, audio-reactive spectrogram that loops every 5.000 s, with a voice assistant built in. MERN stack:
**MongoDB** stores the assistant's memory, conversation history, voice settings and saved compositions.
**Express** serves the API and proxies Claude. **React** renders the interface. **Node** runs it all.

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

Or with Docker (app + MongoDB): `docker compose up --build`. To enable Claude, put
`ANTHROPIC_API_KEY=...` (and ideally `ACCESS_PASSWORD=...`) in a `.env` file next to `docker-compose.yml`.

## Android app

Puffs also runs as an Android app (Capacitor), fully offline: no server, no internet, no API key.

```bash
npm run android            # builds client/android/app/build/outputs/apk/debug/app-debug.apk
npm run android -- --run   # also installs it on the connected phone or running emulator and opens it
```

Needs the Android SDK (Android Studio) and JDK 21. Newer JDKs are too new for Android's Gradle plugin; the script finds
an installed JDK 21 on macOS, or uses `JAVA_HOME`. To install the APK on a phone, turn on USB debugging and plug it in,
or copy the APK over and open it.

What's different in the app:
- **Tap talk** (bottom left) instead of pressing V. Tap again while Puffs speaks to stop it.
- **Listening** uses Android's on-device speech recognizer. If the phone lacks the language pack, Android offers to
  download it once (about 60 MB); until then Puffs uses Google's online recognizer, or the text box when offline.
  Puffs takes turns: it doesn't listen while it talks.
- **Speaking** uses the phone's text-to-speech voices; offline it picks one installed on the phone.
- **Memory, voice settings and saved compositions** stay on the phone. Claude isn't available in the app.
- **Opening apps**: "open WhatsApp", "open settings", any app on the home screen.
- **WhatsApp**: "send a WhatsApp to mom saying I'm on my way". Contacts come from the phone's address book
  (Android asks once). Puffs reads the message back and sends it when you say yes.
  To let Puffs tap Send by itself, say **"turn on auto send"** and switch on *Puffs auto-send* in Accessibility
  settings. It acts only inside WhatsApp, and only for a few seconds after you confirm a message. Without it,
  Puffs opens the chat with the message typed in and you tap Send.

Native code is in `client/android/app/src/main/java/com/codecarrots/puffs/`: `SpeechPlugin` (speech recognition),
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
| `ANTHROPIC_API_KEY` | Enables Claude for open questions. Optional; without it the assistant uses its offline brain. The key stays on the server. |
| `PORT` | API/app port (default 5050). |
| `ACCESS_PASSWORD` | Optional shared password for the Claude routes. Visitors type `/unlock <password>` in the assistant's text box. |
| `DEVICE_DAILY_TOKENS` / `DAILY_TOKEN_BUDGET` | Daily Claude token limits per device and for the whole server (defaults 150k / 2M). |
| `CHAT_PER_MINUTE` | Claude questions per minute, per IP and per device (default 12). |
| `LOCAL_ACTIONS` | Lets Puffs open apps and send WhatsApp messages on the Mac running the server, for requests from that Mac only. Default on in development, off in production. |
| `TRUST_PROXY` | Number of proxies in front of the app, so rate limits see real client IPs. |

The server refuses to start in production without `MONGODB_URI`, or with an invalid setting.

### Protection for your Anthropic key

The Claude routes can spend your credit, so they have four layers of protection:
- rate limits per IP and per device
- daily token budgets, stored in MongoDB so they survive restarts
- an optional access password
- caps on stored data: 30 facts and 200 saved compositions per device

Every response also carries a strict Content-Security-Policy and security headers (helmet), and logs are
structured JSON in production.

## Layout

```
client/                 React + Vite
  src/engine/engine.js  WebGL field + GPU particles (vertex shader), Canvas 2D overlay/HUD, audio analysis, capture
  src/assistant/        brain.js (offline intents) · speech.js (text-to-speech) · bargein.js · timers.js · assistant.js (turns, listening, API)
  test/                 Vitest unit tests
  src/components/       Stage · SystemStack · Talk · Controls · HelpPanel
  src/lib/              store (shared state for React + engine) · api (REST + SSE) · storage
server/                 Express + Mongoose
  src/models/           Memory · Settings · Conversation · Composition
  src/routes/           data.js (memory, settings, compositions) · assistant.js (chat stream, append, reset)
  src/assistant/claude.js  Claude tool loop, conversation persistence, token budgets
  src/app.js · config.js · logger.js · middleware/limits.js
  test/                 API tests (supertest + in-memory MongoDB)
e2e/                    Playwright tests
legacy/index.html       the original single-file version, kept for reference
scripts/dev.mjs         runs both dev servers
scripts/android.mjs     builds (and with --run installs) the Android app
client/android/         Android project (Capacitor) with Puffs' native plugins
client/src/native/      the app's speech stand-ins and on-phone storage
```

## API

All `/api` routes except `/api/health` need an `x-puffs-device` header. The browser creates an anonymous id
and stores it in localStorage. There are no accounts, and every document is scoped to that id.

| Method | Route | |
|---|---|---|
| GET | `/api/health` | `{ ok, db, claude, model }` |
| GET · PUT · DELETE | `/api/memory` | `{ name, facts[], contacts[] }` the assistant remembers |
| GET · PUT | `/api/settings` | `{ voice, rate }` |
| GET · POST | `/api/compositions` | saved seeds `{ id, seed, name, createdAt }` |
| DELETE | `/api/compositions/:id` | |
| POST | `/api/assistant/chat` | `{ message, context }` → server-sent events: `text`, `action`, `memory`, `saved`, `refusal`, `error`, `done` |
| POST | `/api/assistant/understand` | `{ text, recent, pending, context }` → `{ intent, slots, follow_up }` (Claude Haiku 5.5, structured output) |
| POST | `/api/assistant/append` | adds a locally answered exchange to the Claude conversation |
| POST | `/api/assistant/reset` | starts a fresh conversation |
| GET | `/api/device` | `{ ok, whatsapp }` (installed?). Device routes answer only requests from this Mac |
| POST | `/api/device/open` | `{ app }` opens an app |
| POST | `/api/device/contact` | `{ name }` → `{ name, phone }` from macOS Contacts |
| POST | `/api/device/whatsapp` | `{ phone, text }` → `{ status: 'sent' \| 'drafted' }` |

Claude's tools run in two places. Memory and saved compositions are written to MongoDB on the server.
Changes to the screen (pause, seed, boost, timers, audio source) are validated on the server and sent
to the browser as `action` events. Interrupting an answer closes the stream, and the server stores the
partial exchange so follow-up questions still make sense.

## Using it

Press **?** in the app for every control.

| Key | |
|---|---|
| V | talk to Puffs, hands-free |
| T | type to Puffs instead |
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

**WhatsApp and apps (macOS).** Like Siri, Puffs asks for anything missing ("Who should I send it to?", "What should
it say?"), reads the message back, and sends it when you say "yes". Say "change it to …" or "no" instead.
- Recipients: numbers you saved with Puffs first, then the Mac's Contacts app (macOS asks for permission once).
  Unknown names: Puffs asks for the number, with the country code, and remembers it.
- Sending uses the **WhatsApp desktop app** (Mac App Store). The server opens the chat with your message and presses
  Return. That needs one permission: System Settings → Privacy & Security → **Accessibility** → turn on the app that
  runs `npm run dev` (Terminal, iTerm, VS Code…). Without it, Puffs types the message and you press Return.
- Without the desktop app or the server, Puffs opens the chat in WhatsApp Web with the message filled in.
- These actions only answer requests from the Mac the server runs on. They're on in development and off in
  production unless `LOCAL_ACTIONS=1`.

When the server has a key, everything else goes to Claude (`claude-opus-5-5`).

**How Puffs understands you (Siri-style).** Each request goes through up to four steps, cheapest first:
1. **Follow-ups.** If Puffs just asked something ("For how long?"), your answer completes that request, offline when possible.
2. **Instant local rules.** Clear commands ("pause", "15% of 80", "set a timer for 5 minutes") run in the browser in milliseconds.
3. **Understanding with the smallest model.** Anything else goes to `claude-haiku-5-5` at low effort, together with the last
   few exchanges. It returns an intent and its details as structured output, for example `{ intent: "timer_set", seconds: 600,
   label: "oven" }`, and the browser carries it out locally. That's why "could you chill it out a bit", "wake me in ten",
   "what's a 20 percent tip on 45", "what time is it in Tokyo" and "cancel that" all work. When a detail is missing,
   Puffs asks a short follow-up question.
4. **Real questions and conversation** go to the chat model (`claude-opus-5-5`, streamed and spoken as it arrives).

Steps 3 and 4 need `ANTHROPIC_API_KEY` on the server, and both count toward the daily token budgets. Without a key,
steps 1 and 2 still work.

**Talking over Puffs.** While Puffs speaks, it keeps listening. Start talking and it stops to hear you;
"stop" or "wait" cuts it off. It ignores its own voice coming back through the speakers by comparing what it
hears with what it just said. Headphones still work best. Say "turn off interruptions" to disable this.

**Rendering.** The ~9,200 particles are positioned in a WebGL vertex shader, so each frame the CPU only updates
36 ring parameters. `?particles=cpu` forces the Canvas 2D path, which is also the fallback without WebGL.

URL parameters: `?seed=1337` / `?seed=random`, `?motion=0|1`, `?capture=1` (records on load), `?debug=1` (exposes `window.__puffs`), `?particles=cpu`.

Privacy: browser speech recognition is not offline. Chrome and Edge send microphone audio to their own
cloud speech services while listening. If recognition is unavailable, a text box opens instead.
