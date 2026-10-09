import { useEffect, useRef } from 'react';
import { store, useStore, toast } from '../lib/store.js';
import { setSeed, hex } from '../engine/engine.js';
import { saveComposition, deleteComposition } from '../assistant/assistant.js';

export default function HelpPanel() {
  const open = useStore((s) => s.helpOpen);
  const seed = useStore((s) => s.seed);
  const claude = useStore((s) => s.claude);
  const locked = useStore((s) => s.locked);
  const server = useStore((s) => s.server);
  const saved = useStore((s) => s.saved);
  const close = useRef(null);
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
        <div className="head"><h2 id="helpT">PUFFS</h2><button ref={close} className="btn" onClick={hide}>close<kbd>esc</kbd></button></div>
        <p>A realtime spectrogram that loops every five seconds, with a voice assistant built in.</p>
        <h3>Keys</h3>
        <dl>
          <dt><kbd>V</kbd></dt><dd>talk to puffs, hands-free</dd>
          <dt><kbd>T</kbd></dt><dd>type to puffs instead</dd>
          <dt><kbd>esc</kbd></dt><dd>interrupt / close (or just talk over Puffs, or say “stop”)</dd>
          <dt><kbd>M</kbd> <kbd>F</kbd></dt><dd>microphone / audio file (or drop one anywhere)</dd>
          <dt><kbd>space</kbd></dt><dd>live audio on or off</dd>
          <dt><kbd>L</kbd> <kbd>R</kbd></dt><dd>pause / new seed</dd>
          <dt><kbd>P</kbd> <kbd>G</kbd></dt><dd>save a still / record the 5 s loop as video</dd>
        </dl>
        <h3>Try saying</h3>
        <p><q>send a WhatsApp to mom saying I'm on my way</q> · <q>open WhatsApp</q> · <q>save mom's number as +91 98765 43210</q> · <q>set a timer for 5 minutes for pasta</q> · <q>15 percent of 80</q> · <q>10 km to miles</q> · <q>make it louder</q> · <q>save this composition</q> · <q>record</q> · <q>remember that I like jazz</q> · <q>help</q></p>
        <h3>Claude</h3>
        <p>{server === 'offline'
          ? 'The server is offline, so the assistant is using its offline brain.'
          : claude ? 'Connected through the server. Ask any way you like: Claude Haiku works out what you mean and the command runs here; real questions go to Claude Opus.'
            + (locked ? ' This server is password protected: press T and type /unlock followed by the password.' : '')
            : 'Not configured. Add ANTHROPIC_API_KEY to server/.env and restart the server; the key never reaches the browser.'}</p>
        <h3>This composition</h3>
        <div className="row">
          <span>seed <code>0x{hex(seed)}</code></span>
          <button className="btn" onClick={() => saveComposition('')}>save</button>
          <button className="btn" onClick={copy}>copy link</button>
        </div>
        <h3>Saved compositions</h3>
        {saved.length === 0
          ? <p>{server === 'offline' ? 'Unavailable while the server is offline.' : 'None yet. Say “save this composition” or press save.'}</p>
          : <ul className="saved">
            {saved.map((c) => (
              <li key={c.id}>
                <button className="btn" onClick={() => { setSeed(c.seed); hide(); }}>
                  {c.name || '0x' + hex(c.seed)}<kbd>{new Date(c.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</kbd>
                </button>
                <button className="btn del" aria-label={'delete ' + (c.name || hex(c.seed))} onClick={() => deleteComposition(c.id)}>×</button>
              </li>
            ))}
          </ul>}
      </div>
    </div>
  );
}
