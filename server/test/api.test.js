import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { Composition, Usage, MAX_COMPOSITIONS } from '../src/models/index.js';
import { sanitizeFrame, INTENTS } from '../src/assistant/understand.js';

let mongo;
const base = { production: false, port: 0, trustProxy: 0, accessPassword: '', deviceDailyTokens: 1000, globalDailyTokens: 100000, chatPerMinute: 50 };
const appWith = (over = {}) => createApp({ ...base, ...over }, { serveClient: false });
const DEV = 'test-device-0001';
const as = (req) => req.set('x-puffs-device', DEV);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri('puffs-test'));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  delete process.env.ANTHROPIC_API_KEY;
});

describe('health and identity', () => {
  it('reports status without a device id', async () => {
    const r = await request(appWith()).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, claude: false, locked: false });
  });
  it('rejects data routes without a valid device id', async () => {
    expect((await request(appWith()).get('/api/memory')).status).toBe(400);
    expect((await request(appWith()).get('/api/memory').set('x-puffs-device', 'bad id!')).status).toBe(400);
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
    const other = await request(app).get('/api/memory').set('x-puffs-device', 'other-device-01');
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
  it('requires the access password for Claude routes when set', async () => {
    const app = appWith({ accessPassword: 'correct horse' });
    expect((await as(request(app).post('/api/assistant/unlock'))).status).toBe(401);
    expect((await as(request(app).post('/api/assistant/unlock')).set('x-puffs-access', 'wrong')).status).toBe(401);
    expect((await as(request(app).post('/api/assistant/unlock')).set('x-puffs-access', 'correct horse')).status).toBe(204);
    expect((await as(request(app).post('/api/assistant/chat')).send({ message: 'hi' })).status).toBe(401);
    expect((await request(app).get('/api/health')).body.locked).toBe(true);
  });
  it('returns 503 when Claude is not configured', async () => {
    const r = await as(request(appWith()).post('/api/assistant/chat')).send({ message: 'hi' });
    expect(r.status).toBe(503);
  });
  it('stops spending once the daily device budget is used', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-never-called';
    await Usage.create({ key: DEV, day: new Date().toISOString().slice(0, 10), tokens: 1000 });
    const r = await as(request(appWith()).post('/api/assistant/chat')).send({ message: 'hi' });
    expect(r.status).toBe(429);
    expect(r.body.kind).toBe('budget');
  });
  it('rate-limits chat per device', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-never-called';
    const app = appWith({ chatPerMinute: 2, deviceDailyTokens: 1000 });
    await Usage.create({ key: DEV, day: new Date().toISOString().slice(0, 10), tokens: 5000 }); // budget answers before Anthropic is called
    const kinds = [];
    for (let i = 0; i < 3; i++) kinds.push((await as(request(app).post('/api/assistant/chat')).send({ message: 'hi' })).body.kind);
    expect(kinds).toEqual(['budget', 'budget', 'rate']); // the third request never reaches the budget check
  });
  it('validates chat input', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-never-called';
    expect((await as(request(appWith()).post('/api/assistant/chat')).send({ message: '' })).status).toBe(400);
  });
});

describe('understanding (small model)', () => {
  it('is unavailable without an Anthropic key', async () => {
    expect((await as(request(appWith()).post('/api/assistant/understand')).send({ text: 'chill it out' })).status).toBe(503);
    expect((await request(appWith()).get('/api/health')).body.understand).toBeNull();
  });
  it('validates input, honours the password and the budget', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-never-called';
    expect((await as(request(appWith()).post('/api/assistant/understand')).send({ text: '' })).status).toBe(400);
    expect((await as(request(appWith({ accessPassword: 'correct horse' })).post('/api/assistant/understand')).send({ text: 'hi' })).status).toBe(401);
    await Usage.create({ key: DEV, day: new Date().toISOString().slice(0, 10), tokens: 5000 });
    const r = await as(request(appWith()).post('/api/assistant/understand')).send({ text: 'chill it out' });
    expect(r.status).toBe(429);
    expect(r.body.kind).toBe('budget');
    expect((await request(appWith()).get('/api/health')).body.understand).toBe('claude-haiku-5-5');
  });
  it('sanitizes frames before the browser acts on them', () => {
    expect(sanitizeFrame({ intent: 'rm -rf', slots: {} })).toBeNull();
    expect(sanitizeFrame(null)).toBeNull();
    const f = sanitizeFrame({ intent: 'timer_set', slots: { seconds: 300, label: '  pasta ', seed: 'x', count: 2.7 }, follow_up: '' });
    expect(f.intent).toBe('timer_set');
    expect(f.slots).toMatchObject({ seconds: 300, label: 'pasta', seed: null, count: 3, timezone: null });
    expect(f.follow_up).toBeNull();
    expect(INTENTS).toContain('question');
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
