import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { Composition, MAX_COMPOSITIONS } from '../src/models/index.js';

let mongo;
const base = { production: false, port: 0, trustProxy: 0 };
const appWith = (over = {}) => createApp({ ...base, ...over }, { serveClient: false });
const DEV = 'test-device-0001';
const as = (req) => req.set('x-eve-device', DEV);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri('eve-test'));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
});

describe('health and identity', () => {
  it('reports status without a device id', async () => {
    const r = await request(appWith()).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true });
  });
  it('rejects data routes without a valid device id', async () => {
    expect((await request(appWith()).get('/api/memory')).status).toBe(400);
    expect((await request(appWith()).get('/api/memory').set('x-eve-device', 'bad id!')).status).toBe(400);
  });
  it('sets security headers', async () => {
    const r = await request(appWith()).get('/api/health');
    expect(r.headers['content-security-policy']).toContain("default-src 'self'");
    expect(r.headers['x-powered-by']).toBeUndefined();
  });
  it('answers malformed JSON with 400', async () => {
    const r = await as(request(appWith()).put('/api/memory')).set('Content-Type', 'application/json').send('{oops');
    expect(r.status).toBe(400);
  });
});

describe('memory and settings', () => {
  it('stores, caps and isolates memory per device', async () => {
    const app = appWith();
    const facts = Array.from({ length: 40 }, (_, i) => 'fact ' + i);
    const put = await as(request(app).put('/api/memory')).send({ name: 'Sam', facts });
    expect(put.body.name).toBe('Sam');
    expect(put.body.facts).toHaveLength(30);
    expect(put.body.facts.at(-1)).toBe('fact 39');
    const other = await request(app).get('/api/memory').set('x-eve-device', 'other-device-01');
    expect(other.body).toEqual({ name: '', facts: [], contacts: [] });
    expect((await as(request(app).delete('/api/memory'))).body).toEqual({ name: '', facts: [], contacts: [] });
  });
  it('validates and clamps settings', async () => {
    const app = appWith();
    expect((await as(request(app).put('/api/settings')).send({ rate: 'fast' })).status).toBe(400);
    const r = await as(request(app).put('/api/settings')).send({ voice: 'Aria', rate: 9 });
    expect(r.body).toEqual({ voice: 'Aria', rate: 1.35 });
  });
});

describe('compositions', () => {
  it('creates, lists and deletes', async () => {
    const app = appWith();
    const c = await as(request(app).post('/api/compositions')).send({ seed: 42, name: 'dawn' });
    expect(c.status).toBe(201);
    expect((await as(request(app).get('/api/compositions'))).body.map((x) => x.name)).toEqual(['dawn']);
    expect((await as(request(app).delete('/api/compositions/' + c.body.id))).status).toBe(204);
    expect((await as(request(app).delete('/api/compositions/' + c.body.id))).status).toBe(404);
    expect((await as(request(app).delete('/api/compositions/not-an-id'))).status).toBe(404);
  });
  it('rejects bad seeds', async () => {
    for (const seed of [-1, 1.5, 2 ** 32, '7']) {
      expect((await as(request(appWith()).post('/api/compositions')).send({ seed })).status).toBe(400);
    }
  });
  it('caps saved compositions per device', async () => {
    await Composition.insertMany(Array.from({ length: MAX_COMPOSITIONS }, (_, i) => ({ deviceId: DEV, seed: i })));
    expect((await as(request(appWith()).post('/api/compositions')).send({ seed: 1 })).status).toBe(409);
  });
});

describe('abuse protection', () => {
  it('rate-limits writes per device', async () => {
    const app = appWith();
    let last;
    for (let i = 0; i < 61; i++) last = await as(request(app).put('/api/settings')).send({ rate: 1 });
    expect(last.status).toBe(429);
    expect(last.headers['retry-after']).toBeDefined();
  });
  it('has no AI assistant routes', async () => {
    expect((await as(request(appWith()).post('/api/assistant/chat')).send({ message: 'hi' })).status).toBe(404);
  });
});

describe('device actions (open apps, WhatsApp) on the Mac running the server', async () => {
  const mac = await import('../src/device/mac.js');
  const calls = [];
  const fakeExec = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'open' && args[0] === '-Ra' && args[1] === 'Nope') return Promise.reject(new Error('not found'));
    if (cmd === 'osascript' && args[1].includes('Contacts')) return Promise.resolve({ stdout: args[2] === 'Mom' ? 'Mom\t+91 98765 43210\n' : '' });
    if (cmd === 'osascript' && args[2]?.includes('blocked')) return Promise.reject(Object.assign(new Error('x'), { stderr: 'System Events got an error: osascript is not allowed assistive access. (-1719)' }));
    return Promise.resolve({ stdout: '' });
  };
  const on = () => appWith({ localActions: true });
  beforeEach(() => { calls.length = 0; mac._setExec(fakeExec); });
  const itMac = process.platform === 'darwin' ? it : it.skip;

  it('is off unless enabled', async () => {
    const r = await as(request(appWith({ localActions: false })).post('/api/device/open')).send({ app: 'WhatsApp' });
    expect(r.status).toBe(503);
    expect(calls).toHaveLength(0);
  });
  itMac('opens apps', async () => {
    const r = await as(request(on()).post('/api/device/open')).send({ app: 'whatsapp' });
    expect(r.body).toEqual({ app: 'WhatsApp' });
    expect(calls).toContainEqual(['open', '-a', 'WhatsApp']);
    expect((await as(request(on()).post('/api/device/open')).send({ app: 'Nope' })).status).toBe(404);
    expect((await as(request(on()).post('/api/device/open')).send({ app: '../../bin/sh; rm' })).status).toBe(400);
  });
  itMac('looks up the Mac\'s contacts', async () => {
    expect((await as(request(on()).post('/api/device/contact')).send({ name: 'Mom' })).body).toEqual({ name: 'Mom', phone: '+91 98765 43210' });
    expect((await as(request(on()).post('/api/device/contact')).send({ name: 'Zed' })).status).toBe(404);
  });
  itMac('sends WhatsApp messages, passing text as data rather than code', async () => {
    const r = await as(request(on()).post('/api/device/whatsapp')).send({ phone: '+91 98765 43210', text: 'On my way "now" & soon' });
    expect(r.body).toEqual({ status: 'sent' });
    const osa = calls.find((c) => c[0] === 'osascript');
    expect(osa[3]).toBe('whatsapp://send?phone=919876543210&text=On%20my%20way%20%22now%22%20%26%20soon');
    expect(osa[2]).not.toContain('On my way');
  });
  itMac('reports a draft when it may not press send', async () => {
    const r = await as(request(on()).post('/api/device/whatsapp')).send({ phone: '919876543210', text: 'blocked' });
    expect(r.body).toEqual({ status: 'drafted' });
  });
  itMac('checks the number and text', async () => {
    expect((await as(request(on()).post('/api/device/whatsapp')).send({ phone: '123', text: 'hi' })).status).toBe(400);
    expect((await as(request(on()).post('/api/device/whatsapp')).send({ phone: '919876543210', text: ' ' })).status).toBe(400);
  });
  it('saves contacts in memory', async () => {
    const r = await as(request(appWith()).put('/api/memory')).send({ contacts: [{ name: 'Mom', phone: '+91 98765-43210' }, { name: 'Bad', phone: 'abc' }] });
    expect(r.body.contacts).toEqual([{ name: 'Mom', phone: '+919876543210' }]);
  });
});
