import { useEffect, useRef, useState } from 'react';
import Stage from './components/Stage.jsx';
import SystemStack from './components/SystemStack.jsx';
import Talk from './components/Talk.jsx';
import Controls from './components/Controls.jsx';
import HelpPanel from './components/HelpPanel.jsx';
import { store, ui, useStore } from './lib/store.js';
import { toMic, loadFile, toggleAudio, reseed, startCapture, snapshot, setPaused, getState } from './engine/engine.js';
import { toggleAssistant, openAsk, escapeTalk, loadServerState } from './assistant/assistant.js';

export default function App() {
  const fileInput = useRef(null);
  const [fresh, setFresh] = useState(true);
  const [dragging, setDragging] = useState(false);
  const assistantOn = useStore((s) => s.assistantOn);
  const aState = useStore((s) => s.aState);
  const busy = assistantOn && (aState === 'speaking' || aState === 'thinking');

  // one action map for keys and menu buttons
  const act = (k, e) => {
    const s = store.get();
    if (k === 'escape') {
      if (s.helpOpen) store.set({ helpOpen: false });
      else if (s.menuOpen) store.set({ menuOpen: false });
      else escapeTalk();
      return;
    }
    if (k === '?' || k === '/') { e?.preventDefault(); store.set({ helpOpen: !s.helpOpen, menuOpen: false }); return; }
    if (s.helpOpen) return;
    const handlers = {
      m: () => toMic(), f: () => fileInput.current?.click(), r: reseed, g: startCapture, p: snapshot,
      l: () => setPaused(!getState().paused), v: toggleAssistant, t: () => openAsk(), ' ': toggleAudio,
    };
    if (!handlers[k]) return;
    if ('mfvt '.includes(k)) e?.preventDefault();
    handlers[k]();
    setFresh(false);
  };

  useEffect(() => {
    ui.pickFile = () => fileInput.current?.click();
    loadServerState();
    const t = setTimeout(() => setFresh(false), 9000);

    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement) return;
      if (e.target.closest?.('button') && (e.key === ' ' || e.key === 'Enter')) return; // let focused buttons click
      act(e.key.toLowerCase(), e);
    };
    let depth = 0;
    const enter = (e) => { e.preventDefault(); depth++; setDragging(true); };
    const over = (e) => e.preventDefault();
    const leave = () => { if (--depth <= 0) { depth = 0; setDragging(false); } };
    const drop = (e) => {
      e.preventDefault(); depth = 0; setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) loadFile(f);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
    // act reads live state from the store, so the listener never goes stale
  }, []);

  return (
    <div id="stage" onPointerDown={(e) => { if (e.target.tagName === 'CANVAS') store.set({ menuOpen: false }); }}>
      <Stage />
      <div id="drop" style={{ display: dragging ? 'grid' : 'none' }}>DROP AUDIO FILE</div>
      <SystemStack />
      <Talk />
      <div id="hint" className={fresh ? 'fresh' : ''}><span><kbd>V</kbd>talk</span><span><kbd>?</kbd>controls</span></div>
      <Controls act={act} />
      {/* touch screens have no V key: one big button talks, interrupts, and stops */}
      <button id="talkbtn" className="btn" aria-pressed={assistantOn} onClick={() => (busy ? escapeTalk() : act('v'))}>
        {!assistantOn ? 'talk' : busy ? 'tap to stop' : aState === 'listening' ? 'listening…' : 'tap to end'}
      </button>
      <HelpPanel />
      <input id="file" ref={fileInput} type="file" accept="audio/*"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} />
    </div>
  );
}
