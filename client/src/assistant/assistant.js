// Assistant orchestration: listening, turn-taking, local brain vs. Claude (via the Express API), memory sync.
import { ensureCtx, toMic, releaseMic, getState, setPaused, setSeed, reseed, setBoost, snapshot, startCapture, audioOff, recording, hex } from '../engine/engine.js';
import { brain, resolvePending } from './brain.js';
import { runIntent } from './intents.js';
import { addTimer, cancelTimers, timerStatus, setTimerHandler } from './timers.js';
import { ttsSay, ttsCancel, ttsIdle, isSpeaking, cycleVoice, setVoiceByName, getRankedVoices, voiceLabel, applySettings, speechEvents, recentSpeech } from './speech.js';
import { isEcho, isStop, isTalkingOver } from './bargein.js';
import { store, toast } from '../lib/store.js';
import { api, stream } from '../lib/api.js';
import { lsGet, lsSet } from '../lib/storage.js';
import { isNative } from '../native/native.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let sr = null, listening = false, srErrs = 0, assistantMic = false;
let turnId = 0, turnBusy = false, lastReply = '', listenTimer = 0, talkTimer = 0, chatCtrl = null;

const st = () => store.get();
const setAState = (s) => store.set({ aState: s || '' });
const FALLBACK = "I don't know that one yet. Say help to hear what I can do.";

/* ----- conversation caption ----- */
function renderTalk(rows, hold) {
  store.set({ talk: { rows: rows.filter((r) => r[1]), visible: true } });
  clearTimeout(talkTimer);
  talkTimer = setTimeout(() => store.set({ talk: { ...st().talk, visible: false } }), hold || 14000);
}
const showExchange = (u, r) => renderTalk([['you', u], ['puffs', r]]);
function respond(q, text) { lastReply = text; showExchange(q, text); ttsSay(text); }
function notify(msg) {
  // spoken announcement outside a conversation turn (timers)
  stopListen();
  renderTalk([['puffs', msg]]);
  ttsSay(msg);
  ttsIdle().then(() => scheduleListen());
}
setTimerHandler(notify);

/* ----- server data: memory, settings, compositions ----- */
export async function loadServerState() {
  try {
    const [health, memory, settings, saved] = await Promise.all([
      isNative ? { claude: false, locked: false, device: true } : fetch('/api/health').then((r) => r.json()),
      api('/memory'), api('/settings'), api('/compositions'),
    ]);
    applySettings(settings);
    store.set({ server: 'ok', claude: !!health.claude, locked: !!health.locked, device: !!health.device, memory, saved });
  } catch {
    store.set({ server: 'offline', claude: false });
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
async function resetConversation() { await api('/assistant/reset', { method: 'POST' }).catch(() => {}); }

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
  scheduleListen();
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

/* ----- barge-in: keep listening while Puffs talks, so you can interrupt by voice ----- */
let bargeSr = null, barging = false, bargeTimer = 0, bargeCut = false;
// Android's recognizer can't listen while the phone speaks, so the app takes turns instead
let bargeOn = !isNative && lsGet('puffs.barge', true);
export function setBargeIn(on) { bargeOn = on && !isNative; lsSet('puffs.barge', on); if (!on) stopBarge(); }
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
        bargeCut = true; // stop talking as soon as someone talks over Puffs, then wait for the full sentence
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
        if (r.isFinal) { srErrs = 0; const txt = r[0].transcript; stopListen(); ask(txt); return; }
        interim += r[0].transcript;
      }
      if (interim) renderTalk([['you', interim]]);
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
      if (st().assistantOn && !st().typing && !isSpeaking() && !turnBusy) scheduleListen(500);
    };
  }
  try { sr.start(); listening = true; setAState('listening'); } catch { /* already running */ }
}
function stopListen() {
  clearTimeout(listenTimer);
  if (sr && listening) { try { sr.abort(); } catch { /* ignore */ } }
  listening = false;
}
export function interrupt() {
  turnId++; turnBusy = false;
  if (chatCtrl) { chatCtrl.abort(); chatCtrl = null; } // the server keeps the interrupted exchange
  ttsCancel();
}
export function escapeTalk() {
  if (isSpeaking() || turnBusy) { interrupt(); setAState(''); toast('interrupted'); scheduleListen(); }
}

export function toggleAssistant() {
  if (st().assistantOn) {
    store.set({ assistantOn: false, typing: false, talk: { ...st().talk, visible: false } });
    interrupt(); stopListen(); stopBarge();
    setAState('');
    toast('assistant off');
    if (assistantMic) { assistantMic = false; releaseMic(); }
    return;
  }
  store.set({ assistantOn: true });
  ensureCtx();
  toast(isNative ? 'assistant on — tap talk to stop' : 'assistant on — V to stop, esc to interrupt');
  setAState('');
  const wasMic = getState().source === 'mic';
  (async () => {
    // in the app the recognizer needs the microphone to itself; the rings follow Puffs' voice instead
    if (!wasMic && !isNative) assistantMic = await toMic();
    await prepareLocalSpeech();
    if (localLang && sr) recognizeLocally(sr);
    if (!lsGet('puffs.greeted', false)) { lsSet('puffs.greeted', true); ask('hello'); }
    else startListen();
  })();
}

/* ----- a turn ----- */
const brainCtx = () => ({
  lastReply, assistantOn: st().assistantOn, toggleAssistant, setMemory, saveComposition, resetConversation, setBargeIn,
  openHelp: () => store.set({ helpOpen: true, menuOpen: false }),
});

/* ----- conversation state for understanding: recent turns and an open follow-up question ----- */
let recent = [];      // last few { user, assistant } exchanges, so "again" or "cancel that" make sense
let pending = null;   // { intent, question, label, prep, at } after Puffs asked something like "For how long?"
const PENDING_MS = 60_000;
function noteTurn(user, assistant, { toServer = true } = {}) {
  if (!assistant) return;
  recent = [...recent, { user, assistant }].slice(-3);
  if (toServer && st().claude) api('/assistant/append', { method: 'POST', body: { user, assistant } }).catch(() => {});
}

// Small model: utterance -> { intent, slots, follow_up }. Null when unavailable; the chat model is the fallback.
async function understandRemote(id, q, pend) {
  const ctrl = new AbortController(); chatCtrl = ctrl;
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    return await api('/assistant/understand', {
      method: 'POST', signal: ctrl.signal,
      body: {
        text: q, recent,
        pending: pend ? { intent: pend.intent, question: pend.question } : null,
        context: { time: new Date().toLocaleString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      },
    });
  } catch { return null; } finally {
    clearTimeout(timer);
    if (chatCtrl === ctrl) chatCtrl = null;
  }
}

/* A turn, Siri-style:
   1. an open follow-up ("For how long?") is answered offline when possible
   2. instant local rules handle clear commands
   3. the small model works out what any other phrasing means, and the command runs locally
   4. only real questions and conversation go to the chat model */
export async function ask(raw) {
  const q = (raw || '').trim();
  if (!q) return;
  interrupt();
  stopListen();
  const id = turnId;
  if (q[0] === '/') { slash(q); return; }
  turnBusy = true; setAState('thinking');
  showExchange(q, '');
  const ctx = brainCtx();
  const pend = pending && Date.now() - pending.at < PENDING_MS ? pending : null;
  pending = null;
  let after = null;

  const claude = st().claude;
  const offline = pend && resolvePending(pend, q, ctx);
  // with Claude, an unresolved follow-up goes to the language model, which sees the open question
  let local = offline || (pend && claude ? null : brain(q, ctx));
  if (local?.task) {
    // device actions and lookups: a contact search or opening an app takes a moment
    local = { kind: 'cmd', ...(await local.task()) };
    if (id !== turnId) return;
  }
  if (offline) local.kind = 'cmd';
  if (local && local.r === null) {
    turnBusy = false; setAState(''); scheduleListen(); return;
  } else if (local && (local.kind === 'cmd' || !claude)) {
    respond(q, local.r); noteTurn(q, local.r);
    if (local.pending) pending = { ...local.pending, at: Date.now() };
    after = local.after;
  } else if (claude) {
    const frame = await understandRemote(id, q, pend);
    if (id !== turnId) return;
    let handled = false;
    if (frame && frame.intent !== 'question' && frame.intent !== 'chat') {
      // a follow-up answer keeps what was already known (e.g. the timer's label)
      if (pend && frame.intent === pend.intent && !frame.slots.label && pend.label) frame.slots.label = pend.label;
      let out = runIntent(frame, ctx);
      if (out.task) {
        const res = await out.task();
        if (id !== turnId) return;
        out = res.pending ? { followUp: res.r, pendingState: res.pending } : { reply: res.r };
      }
      if (out.pendingState) {
        pending = { ...out.pendingState, at: Date.now() };
        respond(q, out.followUp); noteTurn(q, out.followUp, { toServer: false });
        handled = true;
      } else if (out.followUp) {
        pending = { intent: frame.intent, question: out.followUp, label: frame.slots.label || '', prep: 'for', at: Date.now() };
        respond(q, out.followUp); noteTurn(q, out.followUp, { toServer: false });
        handled = true;
      } else if (!out.delegate) {
        if (out.reply === null) { turnBusy = false; setAState(''); scheduleListen(); return; }
        respond(q, out.reply); noteTurn(q, out.reply);
        after = out.after;
        handled = true;
      }
    }
    if (!handled) {
      const ok = await claudeTurn(id, q);
      if (!ok && id === turnId) respond(q, local ? local.r : FALLBACK);
      if (id === turnId) noteTurn(q, lastReply, { toServer: false }); // the server already stored the chat turn
    }
  } else respond(q, FALLBACK);
  if (id !== turnId) return;
  await ttsIdle();
  if (id !== turnId) return;
  turnBusy = false; setAState('');
  if (after) after();
  else scheduleListen();
}

function slash(q) {
  const [cmd, ...rest] = q.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim();
  let msg;
  if (cmd === 'voice') {
    if (arg === 'list') msg = 'Voices: ' + getRankedVoices().slice(0, 8).map(voiceLabel).join(', ') + '.';
    else if (arg) { const v = setVoiceByName(arg); msg = v ? "Hi, I'm " + voiceLabel(v) + '.' : "I couldn't find a voice called " + arg + '. Try slash voice list.'; }
    else msg = cycleVoice();
  } else if (cmd === 'reset') {
    resetConversation(); msg = 'Fresh conversation.';
  } else if (cmd === 'unlock') {
    unlock(arg); return;
  } else if (cmd === 'save') {
    saveComposition(arg); msg = 'Saved.';
  } else {
    msg = 'Commands: slash voice, slash voice list, slash save, slash reset, slash unlock.';
  }
  showExchange(q, msg);
  setAState('');
  lastReply = msg; ttsSay(msg);
  ttsIdle().then(() => scheduleListen());
}

// checks the server's access password before keeping it (never shown on screen)
async function unlock(pw) {
  const finish = (msg) => { showExchange('/unlock ••••••••', msg); setAState(''); lastReply = msg; ttsSay(msg); ttsIdle().then(() => scheduleListen()); };
  if (!pw) { lsSet('puffs.access', null); return finish('Password cleared.'); }
  try {
    await api('/assistant/unlock', { method: 'POST', headers: { 'x-puffs-access': pw } });
    lsSet('puffs.access', pw);
    finish('Unlocked. Claude is available.');
  } catch (e) {
    finish(e.status === 401 ? "That password didn't work." : "I couldn't reach the server.");
  }
}

/* ----- Claude, streamed from the server ----- */
function context() {
  const s = getState();
  return {
    time: new Date().toLocaleString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    seed: s.seed, source: s.source, paused: s.paused, boost: s.boost, recording: recording(),
    timers: timerStatus() === 'No timers running.' ? '' : timerStatus(),
  };
}
// screen-side effects of Claude's tools; validated on the server first
function runClientTool(name, i) {
  switch (name) {
    case 'control_visual':
      if (i.action === 'pause') setPaused(true);
      else if (i.action === 'play') setPaused(false);
      else if (i.action === 'reseed') reseed();
      else if (i.action === 'screenshot') snapshot();
      else if (i.action === 'record') startCapture();
      break;
    case 'set_seed': setSeed(i.seed); break;
    case 'set_boost': setBoost(i.level); break;
    case 'set_audio_source': if (i.source === 'mic') toMic(); else audioOff(); break;
    case 'set_timer': addTimer(i.seconds, i.label, 'for'); break;
    case 'cancel_timers': cancelTimers(); break;
  }
}
const pickOne = (...a) => a[Math.floor(Math.random() * a.length)];

async function claudeTurn(id, q) {
  const ctrl = new AbortController(); chatCtrl = ctrl;
  let shown = '', pending = '', outcome = 'ok';
  const flush = (all) => {
    const m = all ? pending : (pending.match(/^[\s\S]*[.!?…]["')\]]*(?=\s)/) || [''])[0];
    if (m.trim()) { ttsSay(m); pending = pending.slice(m.length); }
  };
  // people fill a long pause before answering; so does Puffs, once, if the first words are slow
  const hmm = setTimeout(() => { if (id === turnId && !shown && !isSpeaking()) ttsSay(pickOne('Hmm.', 'Let me think.', 'One sec.', 'Let me see.')); }, 1500);
  try {
    await stream('/assistant/chat', { message: q, context: context() }, {
      signal: ctrl.signal,
      onEvent(ev, d) {
        if (id !== turnId) return;
        if (ev === 'text') { shown += d.t; pending += d.t; showExchange(q, shown); flush(false); }
        else if (ev === 'action') runClientTool(d.name, d.input || {});
        else if (ev === 'memory') store.set({ memory: d });
        else if (ev === 'saved') store.set({ saved: [d, ...st().saved] });
        else if (ev === 'refusal') outcome = 'refusal';
        else if (ev === 'error') outcome = d.kind || 'other';
      },
    });
  } catch (e) {
    if (ctrl.signal.aborted || id !== turnId) return true;
    if (e.status === 503) store.set({ claude: false });
    outcome = e.status === 401 ? 'locked' : e.status === 429 ? (e.kind === 'budget' ? 'budget' : 'rate') : 'other';
  } finally {
    clearTimeout(hmm);
    if (chatCtrl === ctrl) chatCtrl = null;
  }
  if (id !== turnId) return true;
  flush(true);
  if (outcome === 'refusal') { respond(q, "I can't help with that one."); return true; }
  if (outcome === 'auth') { store.set({ claude: false }); respond(q, "The server's Anthropic key was rejected, so I'm using my offline brain for now."); return true; }
  if (outcome === 'rate') { respond(q, "You're asking faster than I'm allowed to answer. Give me a few seconds."); return true; }
  if (outcome === 'budget') { respond(q, "I've used up today's Claude allowance, so I'm on my offline brain until tomorrow."); return true; }
  if (outcome === 'locked') { respond(q, 'Claude is password protected on this server. Press T and type slash unlock, then the password.'); return true; }
  if (outcome !== 'ok') { toast('claude unavailable — answered offline', 4000); return false; }
  lastReply = shown.trim();
  if (!lastReply) { lastReply = 'Done.'; respond(q, lastReply); }
  return true;
}
