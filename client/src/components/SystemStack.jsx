import { useStore } from '../lib/store.js';
import { useTick } from '../lib/useTick.js';
import { getState, LOOP } from '../engine/engine.js';
import { getTimers, cancelTimer } from '../assistant/timers.js';
import { toast as showToast } from '../lib/store.js';

function clock(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
}

// Top right: recording progress, timers (click to cancel), toasts.
export default function SystemStack() {
  const { perf: now, wall } = useTick(100);
  const toast = useStore((s) => s.toast);
  const e = getState();
  const toastState = !toast ? 'gone' : now > toast.until + 400 ? 'gone' : now > toast.until ? 'out' : 'in';
  return (
    <div id="sys" aria-live="polite">
      {e.recording && (
        <div className={'pill ' + (e.recState === 'rec' ? 'rec' : 'warm')}>
          {e.recState === 'rec'
            ? 'rec ' + Math.min(LOOP, e.elapsed - e.recStart).toFixed(1) + ' / 5.0 s'
            : 'rec starts in ' + Math.max(0, LOOP - (e.elapsed - e.warmStart)).toFixed(1) + ' s'}
        </div>
      )}
      {getTimers().map((t) => (
        <div key={t.id} className="pill timer" title="click to cancel"
          onClick={() => { cancelTimer(t.id); showToast('timer cancelled'); }}>
          {(t.label || 'timer') + '  ' + clock(Math.max(0, Math.ceil((t.end - wall) / 1000)))}
        </div>
      ))}
      {toastState !== 'gone' && <div key={toast.id} className={'pill' + (toastState === 'out' ? ' out' : '')}>{toast.text}</div>}
    </div>
  );
}
