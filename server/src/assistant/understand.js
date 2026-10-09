// Natural-language understanding with the smallest, fastest Claude model.
// Turns any phrasing ("could you chill it out a bit", "wake me in ten") into an intent frame the
// browser executes locally, Siri-style, so only real questions reach the larger chat model.
import { getClient, recordUsage } from './claude.js';

export const UNDERSTAND_MODEL = 'claude-haiku-5-5';

export const INTENTS = [
  'pause', 'play', 'reseed', 'set_seed', 'screenshot', 'record', 'stop_recording',
  'boost_up', 'boost_down', 'boost_reset', 'set_boost',
  'mic_on', 'audio_off', 'open_file',
  'timer_set', 'timer_cancel', 'timer_status',
  'set_name', 'remember', 'recall', 'forget',
  'save_composition', 'show_saved',
  'voice_change', 'voice_faster', 'voice_slower', 'voice_normal', 'barge_on', 'barge_off',
  'time', 'date', 'time_in_place',
  'calculate', 'convert', 'coin', 'dice', 'random_number',
  'send_message', 'open_app',
  'repeat', 'stop_talking', 'help', 'goodbye',
  'question', 'chat', 'unclear',
];

const SLOTS = {
  seconds: 'number', label: 'string', seed: 'integer', level: 'number', text: 'string',
  expression: 'string', timezone: 'string', place: 'string', value: 'number', from_unit: 'string', to_unit: 'string',
  min: 'integer', max: 'integer', count: 'integer', sides: 'integer', day_offset: 'integer',
  recipient: 'string', app: 'string',
};
const nullable = (type) => ({ anyOf: [{ type }, { type: 'null' }] });
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'slots', 'follow_up'],
  properties: {
    intent: { type: 'string', enum: INTENTS },
    slots: {
      type: 'object', additionalProperties: false, required: Object.keys(SLOTS),
      properties: Object.fromEntries(Object.entries(SLOTS).map(([k, t]) => [k, nullable(t)])),
    },
    follow_up: nullable('string'),
  },
};

const SYSTEM = `You are the language-understanding step of Puffs, a voice assistant built into an audio-reactive artwork in the user's browser. You do not answer the user. You decide what they want and fill in the details, like Siri's intent recognizer. Speech-to-text errors are common, so read through misheard words.

Intents:
- pause, play: freeze or resume the animation. reseed: a new random composition. set_seed: a specific seed (slot seed).
- screenshot: save a still image. record: record the five second loop as video. stop_recording.
- boost_up, boost_down: more or less intense or reactive ("chill it out" is boost_down). boost_reset: back to normal. set_boost: an exact level (slot level, 0.35 to 2.4, 1 is normal).
- mic_on: use the microphone. audio_off: stop the mic or music and use the built-in beat. open_file: play an audio file.
- timer_set: a countdown, alarm or reminder (slot seconds = total duration in seconds, slot label = what it is for, without "for" or "to"). timer_cancel. timer_status: how long is left.
- set_name: the user tells you their name (slot text). remember: a fact to keep (slot text, phrased as the user said it). recall: what do you know about me. forget: erase memory.
- save_composition: keep the current look (slot text = a name if given). show_saved: list saved compositions.
- voice_change: a different voice. voice_faster, voice_slower, voice_normal: speaking speed. barge_on, barge_off: whether the user may talk over Puffs.
- time: the local time. date: the date (slot day_offset: 0 today, 1 tomorrow, -1 yesterday). time_in_place: the time somewhere else (slot timezone = the IANA zone such as Asia/Tokyo, slot place = the place as said).
- calculate: arithmetic (slot expression = digits, decimal points, + - * / ** and parentheses only; turn words, percentages and tips into that form, for example a 20 percent tip on 45 becomes 45*0.2).
- convert: unit conversion (slots value, from_unit, to_unit as plain unit words such as km, miles, kg, pounds, celsius, fahrenheit, liters, cups).
- coin: flip a coin. dice: roll dice (slots count, sides). random_number: between min and max.
- send_message: send a WhatsApp message or text to someone (slot recipient = the person's name as said, or their phone number in digits; slot text = the message itself, exactly as they want it sent, in their words, first person). Do not set follow_up: Puffs asks for anything missing itself.
- open_app: open or launch an app on this computer (slot app = the app name, e.g. WhatsApp, Safari, Spotify).
- repeat: say that again. stop_talking: be quiet or never mind. help: what can you do. goodbye: the user is done.
- question: anything that needs knowledge, explanation, advice, opinion or creativity. chat: greetings and small talk. unclear: noise, fragments, or speech you cannot interpret.

Rules:
- Set every slot you don't use to null.
- If the intent is clear but a required detail is missing (a timer with no duration, a conversion with no value), set follow_up to one short, friendly question that asks for it, the way Siri would ("For how long?"). Otherwise follow_up is null.
- If Puffs just asked a follow-up question, the user's message is probably the answer: combine it with that pending intent.
- Use the recent conversation for references like "again", "that one", "make it longer" or "cancel it".`;

const clean = (v, type) => {
  if (v === null || v === undefined) return null;
  if (type === 'string') return typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null;
  if (typeof v !== 'number' || !isFinite(v)) return null;
  return type === 'integer' ? Math.round(v) : v;
};
// The schema is enforced by the API; this is the defensive check before the browser acts on it.
export function sanitizeFrame(raw) {
  if (!raw || typeof raw !== 'object' || !INTENTS.includes(raw.intent)) return null;
  const slots = {};
  for (const [k, t] of Object.entries(SLOTS)) slots[k] = clean(raw.slots?.[k], t);
  const follow_up = typeof raw.follow_up === 'string' && raw.follow_up.trim() ? raw.follow_up.trim().slice(0, 160) : null;
  return { intent: raw.intent, slots, follow_up };
}

const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
function userContent({ text, recent, pending, context }) {
  const lines = [];
  if (context?.time) lines.push('Local time: ' + clip(context.time, 80) + (context.timezone ? ' (' + clip(context.timezone, 40) + ')' : ''));
  const turns = Array.isArray(recent) ? recent.slice(-3) : [];
  if (turns.length) {
    lines.push('Recent conversation:');
    for (const t of turns) lines.push('User: ' + clip(t?.user, 300), 'Puffs: ' + clip(t?.assistant, 300));
  }
  if (pending?.question) lines.push(`Puffs just asked: "${clip(pending.question, 160)}" while handling the intent ${clip(pending.intent, 40)}.`);
  lines.push('', 'The user said: ' + JSON.stringify(clip(text, 500)));
  return lines.join('\n');
}

export async function understand({ deviceId, text, recent, pending, context, signal }) {
  const msg = await getClient().messages.create(
    {
      model: UNDERSTAND_MODEL,
      max_tokens: 2048, // headroom: adaptive thinking also counts toward this
      system: SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: userContent({ text, recent, pending, context }) }],
    },
    { signal, timeout: 15_000 },
  );
  await recordUsage(deviceId, msg.usage, 1).catch(() => {});
  if (msg.stop_reason === 'refusal') return { intent: 'unclear', slots: {}, follow_up: null };
  const block = msg.content.find((b) => b.type === 'text');
  if (!block) return null;
  try { return sanitizeFrame(JSON.parse(block.text)); } catch { return null; }
}
