import Anthropic from '@anthropic-ai/sdk';
import { Conversation, Memory, Composition, Usage, MAX_FACTS, MAX_COMPOSITIONS } from '../models/index.js';

export const MODEL = 'claude-opus-5-5';
const MAX_HISTORY = 60; // messages per conversation before starting a fresh one (history is never trimmed in place)

export const claudeEnabled = () =>
  process.env.CLAUDE !== 'off' &&
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);

let client = null;
export const getClient = () => (client ||= new Anthropic({ maxRetries: 1 }));

const SYSTEM = `You are Puffs, the voice assistant living inside a realtime audio-reactive spectrogram artwork in the user's web browser. The artwork is about nine thousand monochrome particles on 36 rings around a black void, driven by 64 frequency bands from 20 Hz to 16 kHz, and it loops seamlessly every five seconds.

Everything you write is read aloud by text-to-speech and shown as a caption, so write the way a warm, articulate person actually talks: contractions, natural rhythm, a mix of short and longer sentences, and the answer first. Usually one to three sentences. Don't restate the question, don't open with filler like "Great question", and don't sign off with offers of more help. No markdown, lists, emoji, code, URLs or parenthetical asides unless the user asks; when several items matter, weave them into a sentence. Write numbers, units and symbols the way you'd say them ("about twenty kilometers", "seventy percent"). If the user wants detail, give it, still in speakable paragraphs.

Use the tools when the user wants to change the visual, set or cancel timers, save the current composition, or have you remember something. After a tool runs, confirm briefly in your own words. A file can only be opened by the user pressing F or dropping one on the page.

Each user message starts with a bracketed context line (local time, visual state, timers, what the user asked you to remember). Use it when relevant and don't read it back. You have no internet access, so for live information like weather, news or prices, say you can't check it.`;

const strictObj = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const TOOLS = [
  { name: 'control_visual', strict: true,
    description: 'Pause or play the animation, pick a new random seed (a new composition), save a PNG still, or record the five second loop as a WebM video.',
    input_schema: strictObj({ action: { type: 'string', enum: ['pause', 'play', 'reseed', 'screenshot', 'record'] } }, ['action']) },
  { name: 'set_seed', strict: true, description: 'Set the composition seed to a specific integer between 0 and 4294967295.',
    input_schema: strictObj({ seed: { type: 'integer' } }, ['seed']) },
  { name: 'set_boost', strict: true, description: 'Set how strongly audio drives the visual. 1 is normal, 0.35 is the calmest, 2.4 the most intense.',
    input_schema: strictObj({ level: { type: 'number' } }, ['level']) },
  { name: 'set_audio_source', strict: true, description: "Choose what drives the visual: the user's microphone, or off (built-in synthetic beat).",
    input_schema: strictObj({ source: { type: 'string', enum: ['mic', 'off'] } }, ['source']) },
  { name: 'set_timer', strict: true, description: 'Start a countdown timer that chimes and is announced aloud when it ends. Label may be an empty string.',
    input_schema: strictObj({ seconds: { type: 'number' }, label: { type: 'string' } }, ['seconds', 'label']) },
  { name: 'cancel_timers', strict: true, description: 'Cancel every running timer.', input_schema: strictObj({}, []) },
  { name: 'save_composition', strict: true, description: 'Save the current seed to the user\'s saved compositions. Name may be an empty string.',
    input_schema: strictObj({ name: { type: 'string' } }, ['name']) },
  { name: 'remember', strict: true, description: 'Store a short fact about the user that persists across visits.',
    input_schema: strictObj({ fact: { type: 'string' } }, ['fact']) },
  { name: 'forget_everything', strict: true, description: 'Erase everything remembered about the user.', input_schema: strictObj({}, []) },
];

/* Tools run in two places. Memory and saved compositions live in MongoDB, so they run here.
   Everything that changes the screen is validated here and sent to the browser as an `action` event. */
async function runTool(name, input, { deviceId, context, emit }) {
  const i = input && typeof input === 'object' ? input : {};
  const client = (result) => { emit('action', { name, input: i }); return result; };
  switch (name) {
    case 'control_visual': {
      const done = { pause: 'Paused on screen.', play: 'Playing on screen.', reseed: 'A new random seed is showing.',
        screenshot: 'A PNG still is downloading.', record: 'Recording the five second loop; it downloads in about ten seconds.' }[i.action];
      if (done) return client(done);
      break;
    }
    case 'set_seed':
      if (Number.isInteger(i.seed) && i.seed >= 0 && i.seed <= 4294967295) return client('Seed set to ' + i.seed + '.');
      break;
    case 'set_boost':
      if (typeof i.level === 'number' && isFinite(i.level)) {
        i.level = Math.max(0.35, Math.min(2.4, i.level));
        return client('Boost set to ' + i.level + '.');
      }
      break;
    case 'set_audio_source':
      if (i.source === 'mic') return client('Requested the microphone; the browser may ask the user for permission.');
      if (i.source === 'off') return client('Audio off; the synthetic beat drives the visual.');
      break;
    case 'set_timer':
      if (typeof i.seconds === 'number' && i.seconds >= 1 && i.seconds <= 86400) {
        i.label = typeof i.label === 'string' ? i.label.slice(0, 40) : '';
        return client('Timer started.');
      }
      return { error: 'Timers can run from 1 second to 24 hours.' };
    case 'cancel_timers':
      return client('All timers cancelled.');
    case 'save_composition': {
      const seed = context.seed;
      if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) return { error: 'The current seed is unknown.' };
      if (await Composition.countDocuments({ deviceId }) >= MAX_COMPOSITIONS) return { error: 'The saved compositions list is full.' };
      const c = await Composition.create({ deviceId, seed, name: typeof i.name === 'string' ? i.name.trim().slice(0, 60) : '' });
      emit('saved', { id: String(c._id), seed: c.seed, name: c.name, createdAt: c.createdAt });
      return 'Saved.';
    }
    case 'remember':
      if (typeof i.fact === 'string' && i.fact.trim()) {
        const m = await Memory.findOneAndUpdate(
          { deviceId },
          { $push: { facts: { $each: [i.fact.trim().slice(0, 200)], $slice: -MAX_FACTS } } },
          { upsert: true, returnDocument: 'after' },
        ).lean();
        emit('memory', { name: m.name || '', facts: m.facts || [] });
        return 'Remembered.';
      }
      break;
    case 'forget_everything':
      await Memory.deleteOne({ deviceId });
      emit('memory', { name: '', facts: [] });
      return 'Memory erased.';
  }
  return { error: 'Invalid input for ' + name };
}

const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
function contextLine(ctx, mem) {
  const parts = [
    ctx.time && 'local time ' + clip(ctx.time, 80),
    Number.isInteger(ctx.seed) && 'seed 0x' + ctx.seed.toString(16).padStart(8, '0'),
    ctx.source && 'audio ' + ({ mic: 'microphone', file: 'audio file', synth: 'synthetic beat' }[ctx.source] || 'unknown'),
    ctx.paused ? 'paused' : 'playing',
    typeof ctx.boost === 'number' && 'boost ' + Math.round(ctx.boost * 100) / 100,
    ctx.recording && 'recording',
    ctx.timers && 'timers: ' + clip(ctx.timers, 300),
    mem?.name && "user's name " + mem.name,
    mem?.facts?.length && 'remembered: ' + mem.facts.join('; '),
  ].filter(Boolean);
  return '[' + parts.join(' | ') + ']';
}

// after a mid-output refusal fallback, blocks before the last fallback marker must not be echoed back
function echoable(content) {
  let cut = -1;
  content.forEach((b, i) => { if (b.type === 'fallback') cut = i; });
  if (cut < 0) return content;
  return content.filter((b, i) => i > cut || !/^(thinking|redacted_thinking|tool_use|server_tool_use)$/.test(b.type));
}

async function activeConversation(deviceId) {
  let conv = await Conversation.findOne({ deviceId, active: true });
  if (conv && conv.messages.length > MAX_HISTORY) {
    conv.active = false;
    await conv.save();
    conv = null;
  }
  return conv || Conversation.create({ deviceId, messages: [] });
}

/* ----- spend limits ----- */
const today = () => new Date().toISOString().slice(0, 10);
export const GLOBAL_KEY = '*';
export async function budgetLeft(deviceId, limits) {
  const day = today();
  const [mine, all] = await Promise.all([Usage.findOne({ key: deviceId, day }).lean(), Usage.findOne({ key: GLOBAL_KEY, day }).lean()]);
  if ((all?.tokens || 0) >= limits.globalDailyTokens) return 'global';
  if ((mine?.tokens || 0) >= limits.deviceDailyTokens) return 'device';
  return null;
}
// cache reads are excluded: they cost a tenth of normal input and would make long chats look expensive
const spent = (u) => (u?.input_tokens || 0) + (u?.cache_creation_input_tokens || 0) + (u?.output_tokens || 0);
export async function recordUsage(deviceId, usage, requests) {
  const day = today(), tokens = spent(usage);
  const inc = { $inc: { tokens, requests } };
  await Promise.all([
    Usage.updateOne({ key: deviceId, day }, inc, { upsert: true }),
    Usage.updateOne({ key: GLOBAL_KEY, day }, inc, { upsert: true }),
  ]);
}

// One turn at a time per device, so an interrupted turn finishes its bookkeeping before the next starts.
const locks = new Map();
export function withDeviceLock(deviceId, fn) {
  const prev = locks.get(deviceId) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  locks.set(deviceId, tail);
  tail.then(() => { if (locks.get(deviceId) === tail) locks.delete(deviceId); });
  return run;
}

/**
 * Runs one assistant turn: streams text, executes tools, persists the conversation.
 * emit(event, data) sends server-sent events; signal aborts when the browser disconnects.
 */
export async function chatTurn({ deviceId, message, context, emit, signal }) {
  const conv = await activeConversation(deviceId);
  const mem = await Memory.findOne({ deviceId }).lean();
  const messages = [...conv.messages];
  const mark = messages.length;
  messages.push({ role: 'user', content: contextLine(context, mem) + '\n' + message });
  let shown = '';
  const save = async (msgs) => { conv.messages = msgs; conv.markModified('messages'); await conv.save(); };

  try {
    for (let hop = 0; hop < 6; hop++) {
      const stream = getClient().beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 16000,
          system: SYSTEM,
          tools: TOOLS,
          messages,
          output_config: { effort: 'low' },
          cache_control: { type: 'ephemeral' },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        { signal },
      );
      stream.on('text', (delta) => { shown += delta; emit('text', { t: delta }); });
      const msg = await stream.finalMessage();
      await recordUsage(deviceId, msg.usage, 1).catch(() => {});
      if (msg.stop_reason === 'refusal') {
        emit('refusal', {});
        return; // the declined turn is not kept
      }
      messages.push({ role: 'assistant', content: echoable(msg.content) });
      if (msg.stop_reason !== 'tool_use') break;
      const results = [];
      for (const b of msg.content) {
        if (b.type !== 'tool_use') continue;
        const out = await runTool(b.name, b.input, { deviceId, context, emit });
        results.push(typeof out === 'string'
          ? { type: 'tool_result', tool_use_id: b.id, content: out }
          : { type: 'tool_result', tool_use_id: b.id, content: out.error, is_error: true });
      }
      messages.push({ role: 'user', content: results });
      if (shown && !/\s$/.test(shown)) { shown += ' '; emit('text', { t: ' ' }); }
    }
    await save(messages);
    emit('done', {});
  } catch (e) {
    if (signal.aborted || e instanceof Anthropic.APIUserAbortError) {
      // keep the interrupted exchange (as plain text) so follow-ups still make sense
      await save([...messages.slice(0, mark),
        { role: 'user', content: message },
        { role: 'assistant', content: (shown.trim() || '…') + ' (interrupted)' }]);
      return;
    }
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) emit('error', { kind: 'auth' });
    else if (e instanceof Anthropic.RateLimitError) emit('error', { kind: 'rate' });
    else { console.warn('[claude]', e?.status || '', e?.message || e); emit('error', { kind: 'other' }); }
  }
}

// Commands handled locally in the browser are still added to the conversation, so Claude has the whole picture.
export async function appendExchange(deviceId, user, assistant) {
  const conv = await activeConversation(deviceId);
  await Conversation.updateOne({ _id: conv._id }, { $push: { messages: { $each: [
    { role: 'user', content: clip(user, 2000) }, { role: 'assistant', content: clip(assistant, 4000) || '…' },
  ] } } });
}

export async function resetConversation(deviceId) {
  await Conversation.updateMany({ deviceId, active: true }, { $set: { active: false } });
}
