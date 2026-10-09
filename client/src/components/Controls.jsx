import { useEffect, useState } from 'react';
import { store, useStore } from '../lib/store.js';
import { useTick } from '../lib/useTick.js';
import { getState } from '../engine/engine.js';

const GROUPS = [
  [['v', 'talk', 'V'], ['t', 'type', 'T']],
  [['m', 'microphone', 'M'], ['f', 'audio file', 'F'], [' ', 'live audio', 'space']],
  [['l', 'pause', 'L'], ['r', 'new seed', 'R'], ['p', 'save still', 'P'], ['g', 'record 5s', 'G']],
  [['?', 'help', '?']],
];

// Bottom right: a collapsible, grouped controls menu (always visible on touch, on pointer movement with a mouse).
export default function Controls({ act }) {
  useTick(150);
  const open = useStore((s) => s.menuOpen);
  const assistantOn = useStore((s) => s.assistantOn);
  const [show, setShow] = useState(false);
  const e = getState();

  useEffect(() => {
    let t = 0;
    const move = (ev) => {
      if (ev.pointerType !== 'mouse') return;
      setShow(true);
      clearTimeout(t);
      t = setTimeout(() => setShow(false), 2500);
    };
    window.addEventListener('pointermove', move);
    return () => { window.removeEventListener('pointermove', move); clearTimeout(t); };
  }, []);

  const pressed = { v: assistantOn, m: e.source === 'mic', ' ': e.source !== 'synth' };
  const label = { l: e.paused ? 'play' : 'pause', g: e.recording ? 'recording…' : 'record 5s' };
  return (
    <>
      <div id="bar" role="toolbar" aria-label="Controls" className={open ? 'open' : ''}>
        {GROUPS.map((g, i) => (
          <div className="grp" key={i}>
            {g.map(([k, text, key]) => (
              <button key={k} className="btn" aria-pressed={k in pressed ? String(pressed[k]) : undefined}
                onClick={() => act(k)}>
                {label[k] || text}<kbd>{key}</kbd>
              </button>
            ))}
          </div>
        ))}
      </div>
      <button id="menu" className={'btn' + (show ? ' show' : '')} aria-expanded={open} aria-controls="bar"
        onClick={() => store.set({ menuOpen: !open })}>controls</button>
    </>
  );
}
