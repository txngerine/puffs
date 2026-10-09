import { Fragment, useEffect, useRef, useState } from 'react';
import { store, useStore, toast } from '../lib/store.js';
import { setSeed, hex } from '../engine/engine.js';
import { saveComposition, deleteComposition, getRecognitionLang, setRecognitionLang, forgetMemory } from '../assistant/assistant.js';
import { getRankedVoices, voiceLabel, getVoicePrefs, setVoiceByName, setRate } from '../assistant/speech.js';

export default function HelpPanel() {
  const open = useStore((s) => s.helpOpen);
  const seed = useStore((s) => s.seed);
  const server = useStore((s) => s.server);
  const saved = useStore((s) => s.saved);
  const memory = useStore((s) => s.memory);
  const close = useRef(null);
  const prefs = getVoicePrefs();
  const [rate, setRateValue] = useState(prefs.rate);
  const [deleteId, setDeleteId] = useState(null);
  const [forgetArmed, setForgetArmed] = useState(false);
  const voiceChoices = getRankedVoices().slice(0, 12);
  useEffect(() => { if (open) close.current?.focus(); }, [open]);
  const hide = () => store.set({ helpOpen: false });

  const copy = () => {
    const done = () => toast('link copied — it opens this exact composition');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(location.href).then(done, () => toast('copy failed — use the address bar'));
    else toast('copy failed — use the address bar');
  };

  return (
    <div id="help" role="dialog" aria-modal="true" aria-labelledby="helpT" className={open ? 'open' : ''}
      onClick={(e) => { if (e.target === e.currentTarget) hide(); }}>
      <div className="card">
        <div className="head"><h2 id="helpT">EVE</h2><button ref={close} className="btn" onClick={hide}>close<kbd>esc</kbd></button></div>
        <p>A realtime spectrogram that loops every five seconds, with a voice assistant built in.</p>
        <h3>Keys</h3>
        <dl>
          <dt><kbd>V</kbd></dt><dd>talk to eve, hands-free</dd>
          <dt><kbd>T</kbd></dt><dd>type to eve instead</dd>
          <dt><kbd>W</kbd></dt><dd>wake word on/off: eve waits for “hey eve”, like Siri</dd>
          <dt><kbd>esc</kbd></dt><dd>interrupt / close (or just talk over Eve, or say “stop”)</dd>
          <dt><kbd>M</kbd> <kbd>F</kbd></dt><dd>microphone / audio file (or drop one anywhere)</dd>
          <dt><kbd>space</kbd></dt><dd>live audio on or off</dd>
          <dt><kbd>L</kbd> <kbd>R</kbd></dt><dd>pause / new seed</dd>
          <dt><kbd>P</kbd> <kbd>G</kbd></dt><dd>save a still / record the 5 s loop as video</dd>
        </dl>
        <h3>Try saying</h3>
        <p><q>send a WhatsApp to mom saying I'm on my way</q> · <q>open WhatsApp</q> · <q>save mom's number as +91 98765 43210</q> · <q>set a timer for 5 minutes for pasta</q> · <q>actually, make it 10 minutes</q> · <q>15 percent of 80</q> · <q>10 km to miles</q> · <q>make it louder</q> · <q>search for the latest aurora forecast</q> · <q>save this composition</q> · <q>record</q> · <q>remember that I like jazz</q> · <q>turn on wake word</q> · <q>help</q></p>
        <h3>Voice setup</h3>
        <div className="voicePrefs">
          <label>Spoken voice
            <select value={prefs.name || ''} onChange={(e) => { setVoiceByName(e.target.value); toast(e.target.value ? 'voice changed' : 'automatic voice enabled'); }}>
              <option value="">Automatic</option>
              {voiceChoices.map((v) => <option key={v.name} value={v.name}>{voiceLabel(v)} · {v.lang}</option>)}
            </select>
          </label>
          <label>Speech language
            <select value={getRecognitionLang()} onChange={(e) => { setRecognitionLang(e.target.value); toast('speech language changed'); }}>
              {[...new Set([navigator.language || 'en-US', 'en-US', 'en-GB', 'ml-IN', 'hi-IN', 'es-ES', 'fr-FR', 'de-DE', 'ja-JP'])].map((lang) => <option key={lang} value={lang}>{lang === 'ml-IN' ? 'മലയാളം (ml-IN)' : lang}</option>)}
            </select>
          </label>
          <label>Speaking speed <span>{Number(rate).toFixed(2)}×</span>
            <input type="range" min="0.8" max="1.35" step="0.05" value={rate}
              onChange={(e) => setRateValue(Number(e.target.value))}
              onPointerUp={() => setRate(rate)} onKeyUp={() => setRate(rate)} onBlur={() => setRate(rate)} />
          </label>
        </div>
        <h3>This composition</h3>
        <div className="row">
          <span>seed <code>0x{hex(seed)}</code></span>
          <button className="btn" onClick={() => saveComposition('')}>save</button>
          <button className="btn" onClick={copy}>copy link</button>
        </div>
        <h3>What Eve remembers</h3>
        {!memory.name && !memory.facts.length && !memory.contacts.length
          ? <p>Eve has no saved personal details.</p>
          : <>
            <dl className="memoryList">
              {memory.name && <><dt>Name</dt><dd>{memory.name}</dd></>}
              {memory.facts.map((fact, i) => <Fragment key={'fact' + i}><dt>Note</dt><dd>{fact}</dd></Fragment>)}
              {memory.contacts.map((contact, i) => <Fragment key={'contact' + i}><dt>Contact</dt><dd>{contact.name} · {contact.phone}</dd></Fragment>)}
            </dl>
            {forgetArmed
              ? <div className="row"><span>Clear all saved personal details?</span><button className="btn" onClick={() => { forgetMemory(); setForgetArmed(false); }}>clear memory</button><button className="btn" onClick={() => setForgetArmed(false)}>cancel</button></div>
              : <button className="btn" onClick={() => setForgetArmed(true)}>forget everything</button>}
          </>}
        <h3>Saved compositions</h3>
        {saved.length === 0
          ? <p>{server === 'offline' ? 'Unavailable while the server is offline.' : 'None yet. Say “save this composition” or press save.'}</p>
          : <ul className="saved">
            {saved.map((c) => (
              <li key={c.id}>
                <button className="btn" onClick={() => { setSeed(c.seed); hide(); }}>
                  {c.name || '0x' + hex(c.seed)}<kbd>{new Date(c.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</kbd>
                </button>
                {deleteId === c.id
                  ? <><button className="btn del" onClick={() => { deleteComposition(c.id); setDeleteId(null); }}>confirm</button><button className="btn del" onClick={() => setDeleteId(null)}>cancel</button></>
                  : <button className="btn del" aria-label={'delete ' + (c.name || hex(c.seed))} onClick={() => setDeleteId(c.id)}>×</button>}
              </li>
            ))}
          </ul>}
      </div>
    </div>
  );
}
