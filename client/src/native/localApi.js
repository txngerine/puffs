// The phone app has no server: memory, voice settings and saved compositions live in the app's storage,
// behind the same routes and shapes as the Express API (server/src/routes/data.js).
import { lsGet, lsSet } from '../lib/storage.js';

const KEY = { memory: 'puffs.local.memory', settings: 'puffs.local.settings', saved: 'puffs.local.compositions' };
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const fail = (status, error, kind) => Object.assign(new Error(error), { status, kind });
const emptyMemory = () => ({ name: '', facts: [], contacts: [] });

function putMemory(body = {}) {
  const m = { ...emptyMemory(), ...lsGet(KEY.memory, {}) };
  if (body.name !== undefined) m.name = str(body.name, 40);
  if (Array.isArray(body.facts)) m.facts = body.facts.map((f) => str(f, 200)).filter(Boolean).slice(-30);
  if (Array.isArray(body.contacts)) {
    m.contacts = body.contacts
      .map((c) => ({ name: str(c?.name, 60), phone: str(c?.phone, 20).replace(/[^\d+]/g, '') }))
      .filter((c) => c.name && /^\+?\d{7,15}$/.test(c.phone)).slice(-100);
  }
  lsSet(KEY.memory, m);
  return m;
}

export async function localApi(path, { method = 'GET', body } = {}) {
  if (path === '/memory') {
    if (method === 'GET') return { ...emptyMemory(), ...lsGet(KEY.memory, {}) };
    if (method === 'PUT') return putMemory(body);
    if (method === 'DELETE') { lsSet(KEY.memory, null); return emptyMemory(); }
  }
  if (path === '/settings') {
    const s = { voice: '', rate: 1, ...lsGet(KEY.settings, {}) };
    if (method === 'GET') return s;
    if (method === 'PUT') {
      if (body?.voice !== undefined) s.voice = str(body.voice, 200);
      if (typeof body?.rate === 'number' && isFinite(body.rate)) s.rate = Math.max(0.8, Math.min(1.35, body.rate));
      lsSet(KEY.settings, s);
      return s;
    }
  }
  if (path === '/compositions') {
    const list = lsGet(KEY.saved, []);
    if (method === 'GET') return list;
    if (method === 'POST') {
      const seed = body?.seed;
      if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw fail(400, 'seed must be a 32-bit unsigned integer');
      const c = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), seed, name: str(body?.name, 60), createdAt: new Date().toISOString() };
      lsSet(KEY.saved, [c, ...list].slice(0, 200));
      return c;
    }
  }
  const del = path.match(/^\/compositions\/([\w-]+)$/);
  if (del && method === 'DELETE') { lsSet(KEY.saved, lsGet(KEY.saved, []).filter((c) => c.id !== del[1])); return null; }
  // Claude and the Mac's device routes don't exist on the phone
  throw fail(503, 'not available in the app', 'off');
}
