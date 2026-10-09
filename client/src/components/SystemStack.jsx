import { useStore } from '../lib/store.js';
import { useTick } from '../lib/useTick.js';
import { getState, LOOP } from '../engine/engine.js';

// Top right: recording progress and toasts.
export default function SystemStack() {
  const { perf: now } = useTick(100);
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
      {toastState !== 'gone' && <div key={toast.id} className={'pill' + (toastState === 'out' ? ' out' : '')}>{toast.text}</div>}
    </div>
  );
}
