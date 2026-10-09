// Assistant orchestration: listening, turn-taking, the local brain, and memory sync with the Express API.
import { ensureCtx, toMic, releaseMic, getState, hex } from '../engine/engine.js';
import { brain, resolvePending } from './brain.js';
import { setTimerHandler } from './timers.js';
import { ttsSay, ttsCancel, ttsIdle, isSpeaking, cycleVoice, setVoiceByName, getRankedVoices, voiceLabel, applySettings, speechEvents, recentSpeech } from './speech.js';
import { isEcho, isStop, isTalkingOver } from './bargein.js';
import { parseWake } from './wake.js';
import { store, toast } from '../lib/store.js';
import { api } from '../lib/api.js';
import { lsGet, lsSet } from '../lib/storage.js';
import { isNative } from '../native/native.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let sr = null, listening = false, srErrs = 0, assistantMic = false;
let turnId = 0, turnBusy = false, lastReply = '', listenTimer = 0, talkTimer = 0;

const st = () => store.get();
const setAState = (s) => store.set({ aState: s || '' });
const FALLBACK = "Sorry, I can't help with that yet. Say help to hear what I can do.";

/* ----- conversation caption ----- */
function renderTalk(rows, hold) {
  store.set({ talk: { rows: rows.filter((r) => r[1]), visible: true } });
  clearTimeout(talkTimer);
  talkTimer = setTimeout(() => store.set({ talk: { ...st().talk, visible: false } }), hold || 14000);
}
const showExchange = (u, r) => renderTalk([['you', u], ['eve', r]]);
function respond(q, text) { lastReply = text; showExchange(q, text); ttsSay(text); }
function notify(msg) {
  // spoken announcement outside a conversation turn (timers)
  stopListen();
  renderTalk([['eve', msg]]);
  ttsSay(msg);
  ttsIdle().then(() => listenAfterTurn());
}
setTimerHandler(notify);

/* ----- server data: memory, settings, compositions ----- */
export async function loadServerState() {
  try {
    const [health, memory, settings, saved] = await Promise.all([
      isNative ? { device: true } : fetch('/api/health').then((r) => r.json()),
      api('/memory'), api('/settings'), api('/compositions'),
    ]);
    applySettings(settings);
    store.set({ server: 'ok', device: !!health.device, memory, saved });
  } catch {
    store.set({ server: 'offline' });
    toast('server offline — assistant runs offline only', 5000);
  }
}
async function setMemory(patch) {
  const prev = st().memory;
  const next = patch === null ? { name: '', facts: [], contacts: [] } : { ...prev, ...patch };
  store.set({ memory: next });
  try {
    store.set({ memory: patch === null ? await api('/memory', { method: 'DELETE' }) : await api('/memory', { method: 'PUT', body: patch }) });
  } catch { toast("couldn't save to the server — remembered for this session only", 4500); }
}
export async function saveComposition(name) {
  const seed = getState().seed;
  try {
    const c = await api('/compositions', { method: 'POST', body: { seed, name: name || '' } });
    store.set({ saved: [c, ...st().saved] });
    toast('saved 0x' + hex(seed));
  } catch { toast("couldn't save — is the server running?", 4500); }
}
export async function deleteComposition(id) {
  store.set({ saved: st().saved.filter((c) => c.id !== id) });
  await api('/compositions/' + id, { method: 'DELETE' }).catch(() => toast("couldn't delete on the server"));
}

/* ----- text box ----- */
export function openAsk(prefill) {
  stopListen();
  store.set({ typing: true, typingPrefill: prefill || '', menuOpen: false });
  setAState('typing');
  if (!prefill) renderTalk([['note', 'enter to send · esc to close']], 6000);
}
export function closeAsk() {
  store.set({ typing: false });
  setAState('');
  listenAfterTurn();
}
// esc inside the box: first interrupts an answer, then closes
export function escapeAsk() {
  if (isSpeaking() || turnBusy) { interrupt(); setAState('typing'); }
  else closeAsk();
}

/* ----- on-device speech recognition: no audio leaves the computer and no internet is needed -----
   Chrome downloads a language pack once; until then recognition uses Chrome's network service. */
let localLang = null, localTried = false;
async function prepareLocalSpeech() {
  if (localTried || !SR?.available) return;
  localTried = true;
  const opts = (lang) => ({ langs: [lang], processLocally: true });
  try {
    for (const lang of [...new Set([navigator.language || 'en-US', 'en-US'])]) {
      let a = await SR.available(opts(lang));
      if (a === 'downloadable' || a === 'downloading') {
        toast('downloading offline speech recognition…', 5000);
        if (await SR.install(opts(lang))) a = 'available';
      }
      if (a === 'available') { localLang = lang; toast('speech recognition runs offline', 3000); return; }
    }
  } catch { /* not supported: network recognition */ }
}
function recognizeLocally(rec) {
  if (localLang && 'processLocally' in rec) { rec.processLocally = true; rec.lang = localLang; }
}

/* ----- barge-in: keep listening while Eve talks, so you can interrupt by voice ----- */
let bargeSr = null, barging = false, bargeTimer = 0, bargeCut = false;
// Android's recognizer can't listen while the phone speaks, so the app takes turns instead
let bargeOn = !isNative && lsGet('eve.barge', true);
export function setBargeIn(on) { bargeOn = on && !isNative; lsSet('eve.barge', on); if (!on) stopBarge(); }
export const bargeInEnabled = () => bargeOn;

speechEvents.onStart = () => {
  if (!bargeOn || !SR || !st().assistantOn || st().typing) return;
  clearTimeout(bargeTimer);
  bargeTimer = setTimeout(startBarge, 300); // let the normal recognizer release the mic first
};
speechEvents.onIdle = () => { if (!bargeCut) stopBarge(); };

function startBarge() {
  if (barging || !isSpeaking() || listening) return;
  if (!bargeSr) {
    bargeSr = new SR();
    bargeSr.lang = navigator.language || 'en-US';
    bargeSr.interimResults = true;
    bargeSr.continuous = true;
    recognizeLocally(bargeSr);
    bargeSr.onresult = (e) => {
      let heard = '', final = false;
      for (let i = e.resultIndex; i < e.results.length; i++) { heard += e.results[i][0].transcript; final = final || e.results[i].isFinal; }
      const spoken = recentSpeech();
      if (!heard.trim() || isEcho(heard, spoken)) return;
      if (isStop(heard)) {
        stopBarge(); interrupt(); setAState(''); toast('stopped'); scheduleListen(400);
        return;
      }
      if (isTalkingOver(heard, spoken) && !bargeCut) {
        bargeCut = true; // stop talking as soon as someone talks over Eve, then wait for the full sentence
        ttsCancel();
        renderTalk([['you', heard]]);
      }
      if (final && bargeCut) { stopBarge(); ask(heard); }
    };
    bargeSr.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setBargeIn(false);
    };
    bargeSr.onend = () => {
      barging = false;
      if (bargeCut) { bargeCut = false; scheduleListen(); return; } // talked over but nothing final came
      if (isSpeaking() && bargeOn && st().assistantOn) startBarge();  // continuous mode can still stop on silence
    };
  }
  try { bargeSr.start(); barging = true; } catch { /* already running */ }
}
function stopBarge() {
  clearTimeout(bargeTimer);
  bargeCut = false;
  if (bargeSr && barging) { try { bargeSr.abort(); } catch { /* ignore */ } }
  barging = false;
}

/* ----- wake word: with it on, Eve dozes until it hears "hey Eve", like Siri or Alexa -----
   While dozing, recognition still runs but every transcript is dropped unless it starts with the wake
   word; nothing is shown, answered or sent to the server. After each answer Eve stays awake for a few
   seconds so follow-ups don't need the wake word. Android's recognizer beeps on every restart, so the
   app keeps tap-to-talk. */
const FOLLOW_MS = 8000;
let wakeOn = !isNative && !!SR && lsGet('eve.wake', false), awakeUntil = 0, dozeTimer = 0;
store.set({ wake: wakeOn });
const dozing = () => wakeOn && Date.now() >= awakeUntil;
const setAsleep = (v) => { if (st().asleep !== v) store.set({ asleep: v }); };
export const wakeEnabled = () => wakeOn;
function watchDoze() {
  clearTimeout(dozeTimer);
  const left = awakeUntil - Date.now();
  if (wakeOn && left > 0) { setAsleep(false); dozeTimer = setTimeout(watchDoze, left + 50); return; }
  setAsleep(wakeOn);
  if (wakeOn && st().aState === 'listening') setAState('');
}
function stayAwake(ms = FOLLOW_MS) { awakeUntil = Date.now() + ms; watchDoze(); }
export function doze() { awakeUntil = 0; watchDoze(); scheduleListen(); }
export function setWake(on) {
  wakeOn = !!on && !isNative && !!SR;
  lsSet('eve.wake', wakeOn);
  store.set({ wake: wakeOn });
  watchDoze();
  if (wakeOn && !st().assistantOn) toggleAssistant({ asleep: true });
  return wakeOn;
}
// a short rising blip: Eve heard its name and is listening
let chimeCtx = null;
function chime() {
  try {
    chimeCtx = chimeCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (chimeCtx.state === 'suspended') chimeCtx.resume();
    const t = chimeCtx.currentTime, o = chimeCtx.createOscillator(), g = chimeCtx.createGain();
    o.frequency.setValueAtTime(660, t); o.frequency.exponentialRampToValueAtTime(990, t + 0.12);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(chimeCtx.destination); o.start(t); o.stop(t + 0.25);
  } catch { /* no Web Audio: the caption still shows */ }
}
// a final transcript from the listener: dozing, only the wake word counts
function heard(txt) {
  const w = parseWake(txt);
  if (dozing() && !w) return false;
  stopListen();
  if (w && !w.rest) {
    chime(); stayAwake();
    renderTalk([['note', 'listening…']], 4000);
    scheduleListen(150);
  } else ask(w ? w.rest : txt);
  return true;
}
// after a turn: keep listening, awake for a follow-up
function listenAfterTurn(delay) {
  if (wakeOn) stayAwake();
  scheduleListen(delay);
}

/* ----- listening ----- */
function scheduleListen(delay) {
  clearTimeout(listenTimer);
  listenTimer = setTimeout(startListen, delay == null ? 350 : delay);
}
function startListen() {
  if (st().typing || !st().assistantOn || listening || barging || isSpeaking() || turnBusy) return;
  if (!SR) { openAsk(); return; }
  if (!sr) {
    sr = new SR();
    sr.lang = navigator.language || 'en-US';
    sr.interimResults = true;
    sr.continuous = false;
    sr.maxAlternatives = 1;
    recognizeLocally(sr);
    sr.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) { srErrs = 0; if (heard(r[0].transcript)) return; continue; }
        interim += r[0].transcript;
      }
      if (!interim || dozing()) return; // dozing: nothing is shown
      if (wakeOn) stayAwake(); // still talking: don't doze off mid-sentence
      renderTalk([['you', interim]]);
    };
    sr.onerror = (e) => {
      const err = e.error || 'error';
      listening = false;
      if (err === 'aborted' || err === 'no-speech') return; // onend restarts
      if (err === 'not-allowed' || err === 'service-not-allowed') { toast('speech recognition blocked — typing instead', 4000); openAsk(); return; }
      if (err === 'network') { toast(SR.available ? 'offline speech pack not ready — typing instead' : 'this browser needs internet for speech — typing instead', 5000); openAsk(); return; }
      srErrs++;
      toast('speech (' + err + ')', 3500);
      if (srErrs >= 3) openAsk();
    };
    sr.onend = () => {
      listening = false;
      if (st().aState === 'listening') setAState('');
      if (st().assistantOn && !st().typing && !isSpeaking() && !turnBusy) scheduleListen(dozing() ? 100 : 500); // a gap could miss the wake word
    };
  }
  try { sr.start(); listening = true; if (!dozing()) setAState('listening'); } catch { /* already running */ }
  watchDoze();
}
function stopListen() {
  clearTimeout(listenTimer);
  if (sr && listening) { try { sr.abort(); } catch { /* ignore */ } }
  listening = false;
}
export function interrupt() {
  turnId++; turnBusy = false;
  ttsCancel();
}
export function escapeTalk() {
  if (isSpeaking() || turnBusy) { interrupt(); setAState(''); toast('interrupted'); scheduleListen(); }
}

export function toggleAssistant({ asleep = false } = {}) {
  if (st().assistantOn) {
    store.set({ assistantOn: false, typing: false, asleep: false, talk: { ...st().talk, visible: false } });
    clearTimeout(dozeTimer);
    interrupt(); stopListen(); stopBarge();
    setAState('');
    toast('assistant off');
    if (assistantMic) { assistantMic = false; releaseMic(); }
    return;
  }
  store.set({ assistantOn: true });
  ensureCtx();
  // pressing V means "listen now"; starting on page load means "wait for hey Eve"
  if (wakeOn) { awakeUntil = asleep ? 0 : Date.now() + FOLLOW_MS; watchDoze(); }
  toast(isNative ? 'assistant on — tap talk to stop'
    : wakeOn ? 'listening for “hey eve” — V to stop, W for always listening' : 'assistant on — V to stop, esc to interrupt');
  setAState('');
  const wasMic = getState().source === 'mic';
  (async () => {
    // in the app the recognizer needs the microphone to itself; the rings follow Eve's voice instead
    if (!wasMic && !isNative) assistantMic = await toMic();
    await prepareLocalSpeech();
    if (localLang && sr) recognizeLocally(sr);
    if (!lsGet('eve.greeted', false) && !asleep) { lsSet('eve.greeted', true); ask('hello'); }
    else startListen();
  })();
}

/* ----- a turn ----- */
const brainCtx = () => ({
  lastReply, assistantOn: st().assistantOn, toggleAssistant, setMemory, saveComposition, setBargeIn,
  wake: wakeOn, setWake, doze,
  openHelp: () => store.set({ helpOpen: true, menuOpen: false }),
});

/* ----- an open follow-up question, like "For how long?" ----- */
let pending = null;   // { intent, question, label, prep, at }
const PENDING_MS = 60_000;

/* A turn, Siri-style:
   1. an open follow-up ("For how long?") is answered with what was already asked
   2. otherwise the local rules handle the request; anything they don't cover gets a polite fallback */
export async function ask(raw) {
  const q = (raw || '').trim();
  if (!q) return;
  interrupt();
  stopListen();
  if (wakeOn) stayAwake(); // listenAfterTurn extends this once the answer is spoken
  const id = turnId;
  if (q[0] === '/') { slash(q); return; }
  turnBusy = true; setAState('thinking');
  showExchange(q, '');
  const ctx = brainCtx();
  const pend = pending && Date.now() - pending.at < PENDING_MS ? pending : null;
  pending = null;

  let local = (pend && resolvePending(pend, q, ctx)) || brain(q, ctx);
  if (local?.task) {
    // device actions and lookups: a contact search or opening an app takes a moment
    local = await local.task();
    if (id !== turnId) return;
  }
  if (local && local.r === null) { turnBusy = false; setAState(''); listenAfterTurn(); return; }
  respond(q, local ? local.r : FALLBACK);
  if (local?.pending) pending = { ...local.pending, at: Date.now() };
  await ttsIdle();
  if (id !== turnId) return;
  turnBusy = false; setAState('');
  if (local?.after) local.after();
  else listenAfterTurn();
}

function slash(q) {
  const [cmd, ...rest] = q.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim();
  let msg;
  if (cmd === 'voice') {
    if (arg === 'list') msg = 'Voices: ' + getRankedVoices().slice(0, 8).map(voiceLabel).join(', ') + '.';
    else if (arg) { const v = setVoiceByName(arg); msg = v ? "Hi, I'm " + voiceLabel(v) + '.' : "I couldn't find a voice called " + arg + '. Try slash voice list.'; }
    else msg = cycleVoice();
  } else if (cmd === 'save') {
    saveComposition(arg); msg = 'Saved.';
  } else {
    msg = 'Commands: slash voice, slash voice list, slash save.';
  }
  showExchange(q, msg);
  setAState('');
  lastReply = msg; ttsSay(msg);
  ttsIdle().then(() => listenAfterTurn());
}
