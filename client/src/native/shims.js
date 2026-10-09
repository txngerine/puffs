// Android's WebView has no Web Speech API. In the app, these stand-ins give the rest of Puffs the same
// SpeechRecognition and speechSynthesis interfaces, backed by Android's own recognizer and voice.
// Imported first in main.jsx, before anything reads those globals.
import { isNative, Speech, Tts } from './native.js';

const later = (f) => setTimeout(f, 0); // web speech events never fire synchronously

/* ----- speech recognition ----- */
let seq = 0, active = null;
class NativeRecognition {
  constructor() {
    this.lang = navigator.language || 'en-US';
    this.interimResults = false;
    this.continuous = false;
    this.maxAlternatives = 1;
    this.processLocally = true;
    this._id = 0;
  }
  start() {
    if (this._id) throw new Error('already started');
    const id = (this._id = ++seq);
    active = this;
    Speech.start({ id, lang: this.lang, interim: this.interimResults }).catch((e) => {
      if (this._id !== id) return;
      this._id = 0;
      later(() => { this.onerror?.({ error: e.code === 'not-allowed' ? 'not-allowed' : 'audio-capture' }); this.onend?.(); });
    });
  }
  stop() { if (this._id) Speech.stop(); }
  abort() {
    if (!this._id) return;
    this._id = 0;
    Speech.abort();
    later(() => { this.onerror?.({ error: 'aborted' }); this.onend?.(); });
  }
  // the app always prefers the on-device recognizer; nothing to download from here
  static async available() { return (await Speech.available()).onDevice ? 'available' : 'unavailable'; }
  static async install() { return false; }
}
const mine = (d) => active && active._id && active._id === d.id ? active : null;

/* ----- speech synthesis ----- */
class Utterance {
  constructor(text) { Object.assign(this, { text, rate: 1, pitch: 1, voice: null, lang: '' }); }
}
let voices = [], n = 0;
const live = new Map(), voiceListeners = new Set();
const synth = {
  speaking: false, paused: false, pending: false,
  getVoices: () => voices,
  speak(u) {
    const id = 'u' + ++n;
    live.set(id, u);
    Tts.speak({ id, text: u.text, rate: u.rate, pitch: u.pitch, voice: u.voice?.name || '', lang: u.lang || '' })
      .catch(() => { live.delete(id); later(() => u.onerror?.({ error: 'synthesis-failed' })); });
  },
  cancel() { live.clear(); Tts.stop(); },
  pause() {}, resume() {},
  addEventListener(type, f) { if (type === 'voiceschanged') voiceListeners.add(f); },
  removeEventListener(type, f) { voiceListeners.delete(f); },
};

if (isNative) {
  window.SpeechRecognition = NativeRecognition;
  window.webkitSpeechRecognition = NativeRecognition;
  Speech.addListener('result', (d) => {
    const r = mine(d);
    if (!r) return;
    const result = Object.assign([{ transcript: d.text, confidence: 1 }], { isFinal: !!d.final });
    r.onresult?.({ resultIndex: 0, results: [result] });
  });
  Speech.addListener('error', (d) => mine(d)?.onerror?.({ error: d.error }));
  Speech.addListener('end', (d) => { const r = mine(d); if (r) { r._id = 0; r.onend?.(); } });

  globalThis.speechSynthesis = synth;
  globalThis.SpeechSynthesisUtterance = Utterance;
  Tts.addListener('start', (d) => live.get(d.id)?.onstart?.());
  Tts.addListener('boundary', (d) => live.get(d.id)?.onboundary?.());
  Tts.addListener('done', (d) => { const u = live.get(d.id); live.delete(d.id); u?.onend?.(); });
  Tts.addListener('error', (d) => { const u = live.get(d.id); live.delete(d.id); u?.onerror?.({ error: 'synthesis-failed' }); });
  // the engine lists its voices a few seconds after it starts
  const loadVoices = (tries) => Tts.getVoices().then(({ voices: list }) => {
    if (!list.length && tries > 0) { setTimeout(() => loadVoices(tries - 1), 2000); return; }
    voices = list.map((v) => ({ name: v.name, lang: v.lang, localService: v.local, voiceURI: v.name, default: false, quality: v.quality }));
    voiceListeners.forEach((f) => f());
  }).catch(() => {});
  loadVoices(5);
}
