import { describe, it, expect, vi } from 'vitest';
import { engineMock } from './engine.mock.js';

vi.mock('../src/engine/engine.js', () => engineMock);
const { speechText, splitSentences, voiceScore, voiceLabel } = await import('../src/assistant/speech.js');
const { isEcho, isStop, isTalkingOver } = await import('../src/assistant/bargein.js');

describe('speechText: says text the way a person would', () => {
  it.each([
    ['Boost is 1.35.', 'Boost is 1.35.'],
    ['It is **25 km** (about 15.5 mi) — e.g. a long run & a nap!!', 'It is 25 kilometers, about 15.5 miles, for example a long run and a nap!'],
    ['Seed 0x2a set.', 'Seed zero x 2 a set.'],
    ['Set it to 20°C vs. 68°F.', 'Set it to 20 degrees Celsius versus 68 degrees Fahrenheit.'],
    ['1. First item\n2. Second 🎉', 'First item Second'],
    ['3 x 4 is 12.', '3 times 4 is 12.'],
  ])('%j', (input, out) => expect(speechText(input)).toBe(out));
});

describe('splitSentences', () => {
  it('never splits decimals or common abbreviations', () => {
    expect(splitSentences('Boost is 1.35. Dr. Smith arrived at 3.30 today! Really? Yes.'))
      .toEqual(['Boost is 1.35.', 'Dr. Smith arrived at 3.30 today!', 'Really?', 'Yes.']);
  });
});

describe('voice ranking', () => {
  const v = (name, lang = 'en-US', localService = true) => ({ name, lang, localService });
  it('prefers natural voices and rejects novelty or non-English ones', () => {
    const ranked = [v('Albert'), v('Microsoft Zira - English (United States)'), v('Google US English', 'en-US', false),
      v('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false), v('Ava (Premium)'), v('Google Deutsch', 'de-DE', false)]
      .map((x) => [voiceScore(x), x]).filter(([s]) => s >= 0).sort((a, b) => b[0] - a[0]).map(([, x]) => voiceLabel(x));
    expect(ranked.slice(0, 3)).toEqual(['Aria', 'Ava', 'US English']);
    expect(ranked).not.toContain('Deutsch');
    expect(ranked).not.toContain('Albert'); // novelty voices are excluded, not just ranked low
  });
});

describe('barge-in', () => {
  const spoken = 'The capital of France is Paris. It sits on the Seine.';
  it('ignores Eve hearing itself', () => {
    expect(isEcho('the capital of France is Paris', spoken)).toBe(true);
    expect(isEcho('it sits on the sane', spoken)).toBe(true);
  });
  it('notices someone talking over it', () => {
    expect(isTalkingOver('actually what about Germany', spoken)).toBe(true);
    expect(isTalkingOver('um', spoken)).toBe(false);
  });
  it('recognizes stop words', () => {
    for (const s of ['stop', 'wait a second', 'hey eve, stop', 'never mind', 'okay eve be quiet']) expect(isStop(s)).toBe(true);
    expect(isStop('stopwatch please')).toBe(false);
    expect(isStop('what is a stop sign')).toBe(false);
  });
});
