import { describe, it, expect, vi, beforeEach } from 'vitest';
import { engineMock } from './engine.mock.js';

vi.mock('../src/engine/engine.js', () => engineMock);
const api = vi.fn();
vi.mock('../src/lib/api.js', () => ({ api: (...a) => api(...a) }));
globalThis.window = { open: vi.fn() };

const { parseMessage, parsePhone, parseSaveContact, parseOpenApp, messageFlow, resolveMessage } = await import('../src/assistant/device.js');
const { brain, resolvePending } = await import('../src/assistant/brain.js');
const { store } = await import('../src/lib/store.js');

const MOM = { name: 'Mom', phone: '+919876543210' };
const ctx = { setMemory: vi.fn((p) => store.set({ memory: { ...store.get().memory, ...p } })) };
beforeEach(() => {
  api.mockReset(); window.open.mockReset(); ctx.setMemory.mockClear();
  store.set({ claude: false, memory: { name: '', facts: [], contacts: [MOM] } });
});

describe('understanding message requests', () => {
  it.each([
    ['send a message to mom saying I am on my way', { to: 'mom', text: 'I am on my way' }],
    ['Send a WhatsApp message to Mom: dinner at 8', { to: 'Mom', text: 'Dinner at 8' }],
    ['open WhatsApp and send a message to mom saying hi', { to: 'mom', text: 'Hi' }],
    ['send mom a whatsapp saying running late', { to: 'mom', text: 'Running late' }],
    ['whatsapp my brother that the match starts at 7', { to: 'brother', text: 'The match starts at 7' }],
    ['text john saying call me', { to: 'john', text: 'Call me' }],
    ['message mom on whatsapp saying good night', { to: 'mom', text: 'Good night' }],
    ["tell dad on whatsapp that I'll be home soon", { to: 'dad', text: "I'll be home soon" }],
    ['send a message to mom saying see you on whatsapp', { to: 'mom', text: 'See you' }],
    ['can you open whatsapp and send a message', { to: null, text: '' }],
    ['send a whatsapp to +91 98765 43210 saying hello', { phone: '+919876543210', text: 'Hello' }],
  ])('%s', (q, want) => expect(parseMessage(q)).toMatchObject(want));
  it.each(['tell me a joke', 'what is the capital of France', 'open whatsapp', 'send me a message'])('ignores %s', (q) => expect(parseMessage(q)).toBeNull());
});

describe('phone numbers and contacts', () => {
  it.each([
    ['+91 98765 43210', '+919876543210'],
    ['plus nine one nine eight seven six five four three two one zero', '+919876543210'],
    ['double nine eight seven six five four three two one', '9987654321'],
    ['hello there', null], ['12', null],
  ])('%s', (q, p) => expect(parsePhone(q)).toBe(p));
  it('saves contacts said in different ways', () => {
    expect(parseSaveContact("save mom's number as +91 98765 43210")).toEqual(MOM);
    expect(parseSaveContact('save the number 9876543210 as my sister')).toEqual({ name: 'Sister', phone: '9876543210' });
    expect(parseSaveContact("John's number is +1 415 555 0100")).toEqual({ name: 'John', phone: '+14155550100' });
    expect(parseSaveContact('remember I like tea')).toBeNull();
  });
  it('remembers contacts from the brain', () => {
    expect(brain("save dad's number as +44 7700 900123", ctx).r).toBe('Saved. I can message Dad on WhatsApp now.');
    expect(store.get().memory.contacts).toContainEqual({ name: 'Dad', phone: '+447700900123' });
  });
});

describe('opening apps', () => {
  it.each([['open whatsapp', 'WhatsApp'], ['launch spotify', 'spotify'], ['please open the Notes app', 'Notes']])('%s', (q, a) => expect(parseOpenApp(q)).toBe(a));
  it.each(['open a file', 'open my saved compositions'])('leaves %s to the visual commands', (q) => expect(parseOpenApp(q)).toBeNull());
  it('opens through the server', async () => {
    api.mockResolvedValueOnce({ app: 'WhatsApp' });
    expect(await brain('open whatsapp').task()).toEqual({ r: 'Opening WhatsApp.' });
    expect(api).toHaveBeenCalledWith('/device/open', { method: 'POST', body: { app: 'WhatsApp' } });
  });
});

describe('the conversation, Siri-style', () => {
  it('reads the message back and sends on yes', async () => {
    const out = await brain('send a whatsapp to mom saying I am on my way', ctx).task();
    expect(out.r).toBe('Your message to Mom says: I am on my way. Send it?');
    api.mockResolvedValueOnce({ status: 'sent' });
    const sent = await resolvePending(out.pending, 'yes', ctx).task();
    expect(sent.r).toBe('Sent to Mom.');
    expect(api).toHaveBeenCalledWith('/device/whatsapp', { method: 'POST', body: { phone: '+919876543210', text: 'I am on my way' } });
  });
  it('asks for whoever and whatever is missing', async () => {
    let out = await messageFlow({ to: null, phone: null, text: '' });
    expect(out.r).toBe('Who should I send it to?');
    out = await resolveMessage(out.pending.msg, 'my mom', ctx).task();
    expect(out.r).toBe('What should I say to Mom?');
    out = await resolveMessage(out.pending.msg, "I'll call you tonight", ctx).task();
    expect(out.r).toBe("Your message to Mom says: I'll call you tonight. Send it?");
  });
  it('asks for an unknown number, saves it, and continues', async () => {
    api.mockRejectedValueOnce(Object.assign(new Error('x'), { kind: 'missing' })); // not in the Mac's Contacts either
    let out = await messageFlow({ to: 'priya', phone: null, text: 'Hi' });
    expect(out.r).toMatch(/don't have a number for Priya/);
    out = await resolveMessage(out.pending.msg, 'plus nine one nine nine eight eight seven seven six six five five', ctx).task();
    expect(out.r).toBe('Your message to Priya says: Hi. Send it?');
    expect(store.get().memory.contacts).toContainEqual({ name: 'Priya', phone: '+919988776655' });
  });
  it('finds the name when there is no "saying"', async () => {
    const out = await brain("message mom I'm running late", ctx).task();
    expect(out.r).toBe("Your message to Mom says: I'm running late. Send it?");
  });
  it('lets you change the message or cancel', async () => {
    const { pending } = await messageFlow({ to: 'mom', phone: null, text: 'Hi' });
    expect((await resolveMessage(pending.msg, 'change it to hello mom', ctx).task()).r).toBe('Your message to Mom says: Hello mom. Send it?');
    expect(resolveMessage(pending.msg, 'no', ctx).r).toBe("Okay, I won't send it.");
    expect(resolveMessage(pending.msg, 'what time is it', ctx)).toBeNull(); // something else: handled normally
    expect(api).not.toHaveBeenCalledWith('/device/whatsapp', expect.anything());
  });
  it('explains when it can only type the message', async () => {
    api.mockResolvedValueOnce({ status: 'drafted' });
    const { pending } = await messageFlow({ to: 'mom', phone: null, text: 'Hi' });
    expect((await resolveMessage(pending.msg, 'send it', ctx).task()).r).toMatch(/ready in WhatsApp.*Accessibility/);
  });
  it('falls back to WhatsApp in the browser without the server', async () => {
    api.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 502 }));
    const { pending } = await messageFlow({ to: 'mom', phone: null, text: 'Hi there' });
    expect((await resolveMessage(pending.msg, 'yes', ctx).task()).r).toMatch(/opened WhatsApp/);
    expect(window.open).toHaveBeenCalledWith('https://wa.me/919876543210?text=Hi%20there', '_blank', 'noopener');
  });
});
