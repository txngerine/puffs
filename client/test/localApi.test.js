import { describe, it, expect, beforeEach } from 'vitest';

// the Android app's stand-in for the server's data routes, on top of localStorage
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { localApi } = await import('../src/native/localApi.js');

beforeEach(() => mem.clear());

describe('on-phone storage (Android app)', () => {
  it('stores memory and contacts like the server does', async () => {
    expect(await localApi('/memory')).toEqual({ name: '', facts: [], contacts: [] });
    const m = await localApi('/memory', { method: 'PUT', body: { name: 'Asha', contacts: [{ name: 'Mom', phone: '+91 98765-43210' }, { name: 'Bad', phone: 'x' }] } });
    expect(m).toEqual({ name: 'Asha', facts: [], contacts: [{ name: 'Mom', phone: '+919876543210' }] });
    expect((await localApi('/memory', { method: 'PUT', body: { facts: ['likes tea'] } })).contacts).toHaveLength(1);
    expect(await localApi('/memory', { method: 'DELETE' })).toEqual({ name: '', facts: [], contacts: [] });
  });
  it('keeps voice settings within range', async () => {
    expect(await localApi('/settings', { method: 'PUT', body: { rate: 5, voice: 'en-us-x-iog-local' } })).toEqual({ voice: 'en-us-x-iog-local', rate: 1.35 });
  });
  it('saves and deletes compositions', async () => {
    const c = await localApi('/compositions', { method: 'POST', body: { seed: 1337, name: 'dawn' } });
    expect(await localApi('/compositions')).toEqual([c]);
    await expect(localApi('/compositions', { method: 'POST', body: { seed: -1 } })).rejects.toMatchObject({ status: 400 });
    await localApi('/compositions/' + c.id, { method: 'DELETE' });
    expect(await localApi('/compositions')).toEqual([]);
  });
  it('has no Claude or Mac routes', async () => {
    await expect(localApi('/assistant/understand', { method: 'POST' })).rejects.toMatchObject({ status: 503, kind: 'off' });
  });
});
