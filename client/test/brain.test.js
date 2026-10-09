import { describe, it, expect, vi, beforeEach } from 'vitest';
import { engineMock, state } from './engine.mock.js';

vi.mock('../src/engine/engine.js', () => engineMock);
const { brain, evalArith } = await import('../src/assistant/brain.js');
const { cancelTimers } = await import('../src/assistant/timers.js');
const { store } = await import('../src/lib/store.js');

const reply = (q, ctx) => brain(q, ctx)?.r;
beforeEach(() => { cancelTimers(); store.set({ claude: false, memory: { name: '', facts: [] } }); Object.assign(state, { paused: false, boost: 1, recording: false }); });

describe('maths and conversions', () => {
  it.each([
    ['what is 12 × 7', '84.'],
    ['what is twelve times seven', '84.'],
    ['15 percent of 80', '12.'],
    ['whats 2 to the power of 10', '1024.'],
    ['square root of 144', '12.'],
    ['10 km to miles', '10 km is 6.21 miles.'],
    ['how many feet in 3 meters', '3 meters is 9.84 feet.'],
    ['100 degrees fahrenheit in celsius', '100 degrees Fahrenheit is 37.78 degrees Celsius.'],
  ])('%s', (q, a) => expect(reply(q)).toBe(a));
  it('refuses division by zero politely', () => expect(reply('what is 5 divided by 0')).toMatch(/doesn't have an answer/));
});

describe('evalArith (no eval: the CSP forbids it)', () => {
  it.each([['1+2*3', 7], ['(1+2)*3', 9], ['2**3**2', 512], ['-3+5', 2], ['10/4', 2.5], ['(15/100*80)', 12], ['2*-3', -6]])(
    '%s = %s', (e, v) => expect(evalArith(e)).toBe(v));
  it.each(['1+', '(2', '2)', 'alert(1)', '1;2'])('rejects %s', (e) => expect(() => evalArith(e)).toThrow());
});

describe('timers', () => {
  it('parses durations and labels', () => {
    expect(reply('set a timer for 5 minutes for pasta')).toBe('Okay, 5 minutes for pasta. Starting now.');
    expect(reply('remind me in 10 minutes to check the oven')).toBe('Okay, 10 minutes to check the oven. Starting now.');
    expect(reply('timer for half an hour')).toBe('Okay, 30 minutes. Starting now.');
    expect(reply('how long is left')).toMatch(/^pasta: 5 minutes left\. check the oven: 10 minutes left\. 30 minutes left\.$/);
    expect(reply('cancel the timer')).toBe('All 3 timers cancelled.');
  });
  it('asks for a duration when missing', () => expect(reply('set a timer')).toMatch(/how long/i));
});

describe('routing: local commands vs Claude', () => {
  it.each(['what is the world record for the mile', 'help me write a poem', 'can you play a game', 'what is the capital of France'])(
    '%s goes to Claude', (q) => expect(brain(q)).toBeNull());
  it('handles visual commands locally', () => {
    expect(brain('pause').kind).toBe('cmd');
    expect(state.paused).toBe(true);
    expect(brain('play').kind).toBe('cmd');
    expect(reply('louder')).toBe('Boost is 1.35.');
    expect(reply('more')).toBe('Boost is 1.82.');
    expect(engineMock.setSeed).not.toHaveBeenCalledWith(Number.NaN);
    reply('set seed to 42');
    expect(engineMock.setSeed).toHaveBeenCalledWith(42);
  });
  it('marks small talk as chat so Claude can take it when available', () => {
    expect(brain('hello').kind).toBe('chat');
    expect(brain('tell me a joke').kind).toBe('chat');
  });
  it('explains where Claude is configured', () => expect(reply('connect claude')).toMatch(/ANTHROPIC_API_KEY/));
});

describe('memory and compositions go through the assistant context', () => {
  it('passes name, facts and saves to ctx', () => {
    const ctx = { setMemory: vi.fn(), saveComposition: vi.fn(), resetConversation: vi.fn(), setBargeIn: vi.fn() };
    expect(reply('my name is robin', ctx)).toBe('Nice to meet you, Robin.');
    expect(ctx.setMemory).toHaveBeenCalledWith({ name: 'Robin' });
    reply('remember that I like jazz', ctx);
    expect(ctx.setMemory).toHaveBeenLastCalledWith({ facts: ['i like jazz'] });
    reply('save this composition as dawn', ctx);
    expect(ctx.saveComposition).toHaveBeenCalledWith('dawn');
    reply('forget everything', ctx);
    expect(ctx.setMemory).toHaveBeenLastCalledWith(null);
    expect(ctx.resetConversation).toHaveBeenCalled();
    reply('turn off interruptions', ctx);
    expect(ctx.setBargeIn).toHaveBeenCalledWith(false);
  });
  it('reads memory from the store', () => {
    store.set({ memory: { name: 'Sam', facts: [] } });
    expect(reply("what's my name")).toBe('You are Sam.');
  });
});
