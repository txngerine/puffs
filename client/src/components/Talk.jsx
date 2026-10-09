import { useEffect, useRef } from 'react';
import { useStore } from '../lib/store.js';
import { ask, escapeAsk } from '../assistant/assistant.js';

const LABELS = { listening: 'listening', thinking: 'thinking', speaking: 'speaking' };

// Bottom left: assistant state, the latest exchange, and the text box — one flow, so nothing overlaps.
export default function Talk() {
  const talk = useStore((s) => s.talk);
  const search = useStore((s) => s.search);
  const aState = useStore((s) => s.aState);
  const assistantOn = useStore((s) => s.assistantOn);
  const typing = useStore((s) => s.typing);
  const prefill = useStore((s) => s.typingPrefill);
  const asleep = useStore((s) => s.asleep);
  const input = useRef(null);

  useEffect(() => {
    if (typing && input.current) { input.current.value = prefill; input.current.focus(); }
  }, [typing, prefill]);

  // while typing the text box itself is the indicator
  const stateOn = aState !== 'typing' && (assistantOn || !!aState);
  const on = typing || stateOn || talk.visible;
  return (
    <div id="talk" className={on ? 'on' : ''}>
      <div id="state" data-s={aState} className={stateOn ? 'on' : ''}>
        <span className="dot" />
        <span className="lbl">{LABELS[aState] || (assistantOn ? (asleep ? 'say “hey eve”' : 'ready') : '')}</span>
      </div>
      <div id="say" className={talk.visible ? 'on' : ''} aria-live="polite">
        {talk.rows.map(([who, text], i) => (
          <div key={i} className={'line ' + ({ you: 'u', eve: 'a' }[who] || 'n')}>
            <span className="who">{who === 'note' ? '' : who}</span>
            <span>{text}</span>
          </div>
        ))}
        {search.results.length > 0 && (
          <ol className="searchResults" aria-label={'Top search results for ' + search.query}>
            {search.results.slice(0, 5).map((result, i) => (
              <li key={result.url}>
                <a href={result.url} target="_blank" rel="noopener noreferrer">
                  <span className="resultTitle">{i + 1}. {result.title}</span>
                  {result.snippet && <span className="resultSnippet">{result.snippet}</span>}
                  <span className="resultUrl">{new URL(result.url).hostname}</span>
                </a>
              </li>
            ))}
          </ol>
        )}
      </div>
      <input
        id="ask" ref={input} type="text" autoComplete="off" autoCapitalize="off" spellCheck={false}
        style={{ display: typing ? 'block' : 'none' }}
        placeholder="ask eve…"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { const v = e.currentTarget.value; e.currentTarget.value = ''; ask(v); }
          else if (e.key === 'Escape') escapeAsk();
        }}
      />
    </div>
  );
}
