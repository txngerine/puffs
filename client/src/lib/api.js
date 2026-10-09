// REST client for the Express API. Every request carries an anonymous device id.
import { lsGet, lsSet } from './storage.js';
import { isNative } from '../native/native.js';
import { localApi } from '../native/localApi.js';

function deviceId() {
  let id = lsGet('eve.device', '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) {
    id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
    lsSet('eve.device', id);
  }
  return id;
}
const DEVICE = deviceId();
const headers = (extra) => ({ 'x-eve-device': DEVICE, ...extra });
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

