// Tiny external store shared by the engine, the assistant and React (useSyncExternalStore).
import { useSyncExternalStore } from 'react';

const state = {
  seed: 0,
  toast: null,          // { id, text, until }
  talk: { rows: [], visible: false },
  aState: '',           // listening | thinking | speaking | typing | ''
  assistantOn: false,
  wake: false,          // wake word on: Eve waits for "hey Eve"
  asleep: false,        // waiting for the wake word right now
  typing: false,
  typingPrefill: '',
  helpOpen: false,
  menuOpen: false,
  server: 'unknown',    // ok | offline | unknown
  memory: { name: '', facts: [], contacts: [] },
  saved: [],            // saved compositions
};
let snapshot = { ...state };
const listeners = new Set();

export const store = {
  get: () => snapshot,
  set(patch) {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((l) => l());
  },
  subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
};

export function useStore(selector) {
  return useSyncExternalStore(store.subscribe, () => selector(snapshot));
}

let toastSeq = 0;
export function toast(text, ms) {
  store.set({ toast: { id: ++toastSeq, text, until: performance.now() + (ms || 3200) } });
}

// Imperative hooks the UI registers (e.g. the hidden file input lives in React).
export const ui = {
  pickFile: () => {},
};
