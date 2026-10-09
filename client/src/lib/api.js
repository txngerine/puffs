// REST + server-sent-events client for the Express API. Every request carries an anonymous device id.
import { lsGet, lsSet } from './storage.js';
import { isNative } from '../native/native.js';
import { localApi } from '../native/localApi.js';

function deviceId() {
  let id = lsGet('puffs.device', '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) {
    id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
    lsSet('puffs.device', id);
  }
  return id;
}
const DEVICE = deviceId();
const headers = (extra) => {
  const h = { 'x-puffs-device': DEVICE, ...extra };
  const access = lsGet('puffs.access', '');
  if (access) h['x-puffs-access'] = access;
  return h;
};
async function failure(res) {
  const body = await res.json().catch(() => ({}));
  const err = new Error(body.error || 'HTTP ' + res.status);
  err.status = res.status;
  err.kind = body.kind;
  return err;
}

export async function api(path, { method = 'GET', body, signal, headers: extraHeaders = {} } = {}) {
  if (isNative) return localApi(path, { method, body }); // the Android app keeps everything on the phone
  const res = await fetch('/api' + path, {
    method,
    signal,
    headers: headers({ ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await failure(res);
  return res.status === 204 ? null : res.json();
}

// POST that answers with text/event-stream; calls onEvent(name, data) per event.
export async function stream(path, body, { signal, onEvent }) {
  if (isNative) throw Object.assign(new Error('not available in the app'), { status: 503, kind: 'off' });
  const res = await fetch('/api' + path, {
    method: 'POST',
    signal,
    headers: headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw await failure(res);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, i); buf = buf.slice(i + 2);
      let event = 'message', data = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      let parsed = {};
      try { parsed = data ? JSON.parse(data) : {}; } catch { /* ignore malformed event */ }
      onEvent(event, parsed);
    }
  }
}
