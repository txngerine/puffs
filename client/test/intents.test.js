import { describe, it, expect, vi, beforeEach } from 'vitest';
import { engineMock, state } from './engine.mock.js';

vi.mock('../src/engine/engine.js', () => engineMock);
const { runIntent } = await import('../src/assistant/intents.js');
const { resolvePending, brain } = await import('../src/assistant/brain.js');
const { cancelTimers, getTimers } = await import('../src/assistant/timers.js');
const { store } = await import('../src/lib/store.js');

const SLOTS = ['seconds', 'label', 'seed', 'level', 'text', 'expression', 'timezone', 'place', 'value', 'from_unit', 'to_unit', 'min', 'max', 'count', 'sides', 'day_offset', 'recipient', 'app'];
const frame = (intent, slots = {}, follow_up = null) => ({ intent, follow_up, slots: { ...Object.fromEntries(SLOTS.map((k) => [k, null])), ...slots } });

beforeEach(() => { cancelTimers(); Object.assign(state, { boost: 1, paused: false }); store.set({ memory: { name: '', facts: [] }, claude: true }); });

describe('runIntent: commands from any phrasing run locally', () => {
  it('turns "chill it out" (boost_down) into a calmer visual', () => {
    expect(runIntent(frame('boost_down')).reply).toBe('Boost is 0.74.');
  });
  it('calculates tips and percentages from an arithmetic expression', () => {
    expect(runIntent(frame('calculate', { expression: '45*0.2' })).reply).toBe('9.');
    expect(runIntent(frame('calculate', { expression: 'sqrt(2)' })).delegate).toBe(true); // not plain arithmetic
  });
  it('converts units through the local table, and delegates unknown units', () => {
    expect(runIntent(frame('convert', { value: 5, from_unit: 'kg', to_unit: 'pounds' })).reply).toBe('5 kg is 11.02 pounds.');
    expect(runIntent(frame('convert', { value: 3, from_unit: 'furlongs', to_unit: 'parsecs' })).delegate).toBe(true);
  });
  it('tells the time in another city', () => {
    const r = runIntent(frame('time_in_place', { timezone: 'Asia/Tokyo', place: 'Tokyo' })).reply;
    expect(r).toMatch(/^It's .+ in Tokyo/);
    expect(runIntent(frame('time_in_place', { timezone: 'Not/AZone', place: 'Atlantis' })).reply).toMatch(/couldn't work out/);
  });
  it('sets timers and asks Siri-style when the duration is missing', () => {
    expect(runIntent(frame('timer_set', { seconds: 600, label: 'oven' })).reply).toMatch(/10 minutes for oven/);
    expect(getTimers()).toHaveLength(1);
    expect(runIntent(frame('timer_set', {}, 'How long should it run?')).followUp).toBe('How long should it run?');
  });
  it('remembers through the assistant context', () => {
    const ctx = { setMemory: vi.fn() };
    runIntent(frame('set_name', { text: 'robin' }), ctx);
    expect(ctx.setMemory).toHaveBeenCalledWith({ name: 'Robin' });
  });
  it('hands questions and small talk to the chat model', () => {
    expect(runIntent(frame('question')).delegate).toBe(true);
    expect(runIntent(frame('chat')).delegate).toBe(true);
  });
  it('rejects out-of-range seeds', () => {
    expect(runIntent(frame('set_seed', { seed: -5 })).followUp).toBeDefined();
  });
});

describe('follow-up questions work offline too', () => {
  it('"set a timer" asks for the duration and keeps the label', () => {
    const r = brain('set a timer for pasta');
    expect(r.r).toBe('Sure. For how long?');
    expect(r.pending).toMatchObject({ intent: 'timer_set', label: 'pasta' });
    expect(resolvePending(r.pending, 'five minutes')).toEqual({ r: 'Okay, 5 minutes for pasta. Starting now.' });
  });
  it('treats a bare number as minutes', () => {
    expect(resolvePending({ intent: 'timer_set', label: '' }, '10')).toEqual({ r: 'Okay, 10 minutes. Starting now.' });
  });
  it('leaves anything else to the language model', () => {
    expect(resolvePending({ intent: 'timer_set', label: '' }, 'make it the usual')).toBeNull();
  });
});
