// Stand-in for the WebGL/Canvas engine so assistant logic can be tested in Node.
import { vi } from 'vitest';

export const state = { seed: 0x539, source: 'synth', paused: false, boost: 1, recording: false, particles: 9216, ringCount: 36 };
export const engineMock = {
  TAU: Math.PI * 2, LOOP: 5, NB: 64,
  voice: { env: 0, speaking: false },
  hex: (n) => n.toString(16).padStart(8, '0'),
  pick: (...a) => a[0],
  num: (v) => String(Math.abs(v) >= 1 ? Math.round(v * 100) / 100 : +v.toPrecision(3)),
  getState: () => state,
  setPaused: vi.fn((p) => { state.paused = p; return p ? 'Paused.' : 'Playing.'; }),
  setSeed: vi.fn((n) => { state.seed = n; return 'Seed set.'; }),
  reseed: vi.fn(() => 'New seed.'),
  setBoost: vi.fn((v) => { state.boost = Math.max(0.35, Math.min(2.4, v)); return 'Boost is ' + engineMock.num(state.boost) + '.'; }),
  toMic: vi.fn(), audioOff: vi.fn(), startCapture: vi.fn(() => 'Recording.'), cancelCapture: vi.fn(),
  recording: () => state.recording, snapshot: vi.fn(), openFilePicker: vi.fn(() => 'Opening the file picker.'),
  ensureCtx: vi.fn(), chime: vi.fn(),
};
