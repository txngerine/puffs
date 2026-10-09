import './native/shims.js'; // first: the Android app's speech stand-ins must exist before anything reads them
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import * as engine from './engine/engine.js';
import * as brain from './assistant/brain.js';
import * as assistant from './assistant/assistant.js';
import * as speech from './assistant/speech.js';
import * as timers from './assistant/timers.js';
import * as store from './lib/store.js';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// ?debug=1 exposes internals for manual testing in the console
if (new URLSearchParams(location.search).has('debug')) window.__eve = { engine, brain, assistant, speech, timers, store };
