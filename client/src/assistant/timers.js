// Countdown timers. Ticked by setInterval (not rAF) so they still fire in a background tab.
import { ensureCtx, chime, pick } from '../engine/engine.js';
import { toast } from '../lib/store.js';

const timers = []; let timerSeq = 0;
let onDone = () => {};
export const setTimerHandler = (fn) => { onDone = fn; };
export const getTimers = () => timers;

export function fmtDur(s) {
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60, p = [];
  if (h) p.push(h + (h === 1 ? ' hour' : ' hours'));
  if (m) p.push(m + (m === 1 ? ' minute' : ' minutes'));
  if (x || !p.length) p.push(x + (x === 1 ? ' second' : ' seconds'));
  return p.join(' and ');
}
export function addTimer(sec, label, prep) {
  if (!(sec > 0) || sec > 86400) return 'Timers can run from one second up to a day.';
  ensureCtx();
  label = (label || '').trim().slice(0, 40); prep = prep === 'to' ? 'to' : 'for';
  timers.push({ id: ++timerSeq, end: Date.now() + sec * 1000, label, prep });
  timers.sort((a, b) => a.end - b.end);
  return pick('Okay', 'Sure', 'Got it') + ', ' + fmtDur(sec) + (label ? ' ' + prep + ' ' + label : '') + '. ' + pick('Starting now.', "I'll let you know.", 'The clock is running.');
}
export function cancelTimer(id) {
  const i = timers.findIndex((t) => t.id === id);
  if (i >= 0) timers.splice(i, 1);
}
export function cancelTimers() {
  const n = timers.length; timers.length = 0;
  return n ? (n === 1 ? 'Timer cancelled.' : 'All ' + n + ' timers cancelled.') : 'There are no timers running.';
}
export function timerStatus() {
  if (!timers.length) return 'No timers running.';
  const now = Date.now();
  return timers.map((t) => (t.label ? t.label + ': ' : '') + fmtDur(Math.max(0, (t.end - now) / 1000)) + ' left').join('. ') + '.';
}
function tickTimers() {
  const now = Date.now();
  while (timers.length && timers[0].end <= now) {
    const t = timers.shift();
    const msg = !t.label ? 'Time is up.' : t.prep === 'to' ? 'Time to ' + t.label + '.' : 'Time is up for ' + t.label + '.';
    chime(); toast('timer done' + (t.label ? ' — ' + t.label : ''), 8000);
    onDone(msg);
  }
}
setInterval(tickTimers, 250);
