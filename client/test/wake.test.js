import { describe, it, expect } from 'vitest';
import { parseWake } from '../src/assistant/wake.js';

describe('parseWake: hears "hey Eve" and keeps what follows', () => {
  it.each([
    ['hey eve', ''],
    ['Hey Eve, what time is it?', 'what time is it?'],
    ['ok eva set a timer for 5 minutes', 'set a timer for 5 minutes'],
    ['um hey evie open WhatsApp', 'open WhatsApp'],
    ['Okay, Eve. Pause', 'Pause'],
  ])('%s', (heard, rest) => {
    expect(parseWake(heard)).toEqual({ rest });
  });

  it.each(['christmas eve dinner', 'the eve of the launch', 'hey there', '', 'hey evening'])('ignores %j', (heard) => {
    expect(parseWake(heard)).toBeNull();
  });
});
