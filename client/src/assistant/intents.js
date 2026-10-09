// Executes an intent frame from the language model (see server/src/assistant/understand.js).
// Every action runs locally through the same functions the keyboard and offline brain use.
import { setPaused, setSeed, reseed, setBoost, getState, toMic, audioOff, startCapture, recording, cancelCapture, snapshot, openFilePicker, num, pick } from '../engine/engine.js';
import { addTimer, cancelTimers, timerStatus } from './timers.js';
import { cycleVoice, setRate, getVoicePrefs, ttsCancel } from './speech.js';
import { evalArith, convert, normalize, helpText } from './brain.js';
import { store } from '../lib/store.js';
import { messageFlow, openApp, parsePhone } from './device.js';

const ask = (q) => ({ followUp: q });
const say = (reply, extra) => ({ reply, ...extra });

function timeIn(zone, place) {
  try {
    const t = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: zone });
    const day = new Date().toLocaleDateString([], { weekday: 'long', timeZone: zone });
    const today = new Date().toLocaleDateString([], { weekday: 'long' });
    return "It's " + t + ' in ' + (place || zone.split('/').pop().replace(/_/g, ' ')) + (day !== today ? ', on ' + day : '') + '.';
  } catch {
    return "I couldn't work out the time zone for " + (place || 'that place') + '.';
  }
}

/**
 * @returns {{reply?: string|null, followUp?: string, after?: Function, delegate?: true, task?: Function}}
 *   reply: speak this. followUp: ask this and keep the intent pending. delegate: hand to the chat model.
 */
export function runIntent(frame, ctx = {}) {
  const s = frame.slots || {};
  const mem = store.get().memory;
  switch (frame.intent) {
    case 'pause': return say(setPaused(true));
    case 'play': return say(setPaused(false));
    case 'reseed': return say(reseed());
    case 'set_seed': return s.seed !== null && s.seed >= 0 && s.seed <= 4294967295 ? say(setSeed(s.seed)) : ask('Which seed number?');
    case 'screenshot': snapshot(); return say('Saving a still frame.');
    case 'record': return say(startCapture());
    case 'stop_recording':
      if (!recording()) return say('Nothing is recording.');
      cancelCapture('recording cancelled'); return say('Recording cancelled.');
    case 'boost_up': return say(setBoost(getState().boost * 1.35));
    case 'boost_down': return say(setBoost(getState().boost * 0.74));
    case 'boost_reset': return say(setBoost(1));
    case 'set_boost': return s.level !== null ? say(setBoost(s.level)) : ask('How intense, from calm to wild?');
    case 'mic_on': toMic(); return say('Listening to your microphone. Your voice drives the rings.');
    case 'audio_off': audioOff(); return say('Audio off. The synthetic beat is driving the rings.');
    case 'open_file': return say(openFilePicker());
    case 'timer_set':
      if (!s.seconds || s.seconds <= 0) return ask(frame.follow_up || 'For how long?');
      return say(addTimer(s.seconds, s.label || '', 'for'));
    case 'timer_cancel': return say(cancelTimers());
    case 'timer_status': return say(timerStatus());
    case 'set_name': {
      if (!s.text) return ask("What's your name?");
      const name = s.text.replace(/\b[a-z]/g, (c) => c.toUpperCase()).slice(0, 40);
      ctx.setMemory?.({ name });
      return say('Nice to meet you, ' + name + '.');
    }
    case 'remember':
      if (!s.text) return ask('What should I remember?');
      ctx.setMemory?.({ facts: [...mem.facts, s.text].slice(-30) });
      return say(pick("Got it. I'll remember that.", "Noted. I won't forget."));
    case 'recall':
      if (!mem.facts.length && !mem.name) return say('Nothing yet. Tell me something to remember.');
      return say((mem.name ? 'Your name is ' + mem.name + '. ' : '') + (mem.facts.length ? 'You told me: ' + mem.facts.slice(-5).join('; ') + '.' : ''));
    case 'forget': ctx.setMemory?.(null); ctx.resetConversation?.(); return say('Done. My memory is empty.');
    case 'save_composition': ctx.saveComposition?.(s.text || ''); return say(pick('Saved.', 'Saved to your compositions.') + ' Press question mark to see them.');
    case 'show_saved': ctx.openHelp?.(); return say('Here are your saved compositions.');
    case 'voice_change': return say(cycleVoice());
    case 'voice_faster': return say(setRate(getVoicePrefs().rate + 0.1));
    case 'voice_slower': return say(setRate(getVoicePrefs().rate - 0.1));
    case 'voice_normal': return say(setRate(1));
    case 'barge_on': ctx.setBargeIn?.(true); return say('Sure. Talk over me any time, or just say stop.');
    case 'barge_off': ctx.setBargeIn?.(false); return say("Okay. I won't listen while I'm talking.");
    case 'time': return say("It's " + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.');
    case 'date': {
      const off = s.day_offset || 0, d = new Date(); d.setDate(d.getDate() + off);
      const lead = off === 1 ? 'Tomorrow is ' : off === -1 ? 'Yesterday was ' : off === 0 ? 'Today is ' : 'That is ';
      return say(lead + d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) + '.');
    }
    case 'time_in_place': return s.timezone ? say(timeIn(s.timezone, s.place)) : ask('Which city?');
    case 'calculate': {
      if (!s.expression) return ask('What should I calculate?');
      try {
        const v = evalArith(s.expression);
        return say(isFinite(v) ? num(v) + '.' : "That one doesn't have an answer.");
      } catch { return { delegate: true }; } // not plain arithmetic after all: let the chat model answer
    }
    case 'convert': {
      if (s.value === null || !s.from_unit || !s.to_unit) return ask(frame.follow_up || 'Convert what, to what?');
      const out = convert(normalize(`${s.value} ${s.from_unit} to ${s.to_unit}`));
      return out ? say(out) : { delegate: true }; // units the local table doesn't know: let the chat model answer
    }
    case 'coin': return say(Math.random() < 0.5 ? 'Heads.' : 'Tails.');
    case 'dice': {
      const n = Math.min(10, Math.max(1, s.count || 1)), sides = Math.min(1000, Math.max(2, s.sides || 6));
      const rolls = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * sides));
      const sum = rolls.reduce((a, b) => a + b, 0);
      return say(n > 1 ? 'You rolled ' + rolls.join(', ') + '. Total ' + sum + '.' : 'You rolled ' + (/^(8|11|18)$/.test(String(sum)) ? 'an ' : 'a ') + sum + '.');
    }
    case 'random_number': {
      let lo = s.min ?? 1, hi = s.max ?? 100; if (lo > hi) [lo, hi] = [hi, lo];
      return say(String(lo + Math.floor(Math.random() * (hi - lo + 1))) + '.');
    }
    case 'send_message': {
      const phone = s.recipient ? parsePhone(s.recipient) : null;
      const to = phone ? null : (s.recipient || '').replace(/^my\s+/i, '') || null;
      return { task: () => messageFlow({ to, phone, text: s.text || '' }) };
    }
    case 'open_app': return s.app ? { task: () => openApp(s.app) } : ask('Which app?');
    case 'repeat': return say(ctx.lastReply || "I haven't said anything yet.");
    case 'stop_talking': ttsCancel(); return say(null);
    case 'help': return say(helpText(store.get().claude));
    case 'goodbye': return say('Looping. Press V when you want me back.', { after: () => { if (ctx.assistantOn) ctx.toggleAssistant?.(); } });
    case 'unclear': return say(pick("Sorry, I didn't catch that.", 'Sorry, could you say that again?'));
    case 'question':
    case 'chat':
    default:
      return { delegate: true };
  }
}
