// Phone-assistant actions on this computer: open apps and send WhatsApp messages, fully offline.
// Parsing runs in the browser. The Express server (same Mac only) opens the app and presses send.
// The flow is Siri's: ask for whatever is missing, read the message back, send on "yes".
import { api } from '../lib/api.js';
import { store } from '../lib/store.js';
import { isNative, Device } from '../native/native.js';

const WA = "what'?s ?app";
const VIA = `(?:on|via|through|using|in|with|over)\\s+${WA}`;
const NOUN = `(?:${WA}\\s+)?(?:message|msg|text|note|${WA})`;
const SAYING = "(?:\\s*(?:,|:|-)\\s*|\\s+)(?:saying|that says|which says|and say|and tell (?:him|her|them)|telling (?:him|her|them)|that)\\s+|\\s*[:,]\\s*";

const cap = (s) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
const tidy = (s) => (s || '').trim().replace(/^["'“‘]+|["'”’]+$/g, '').replace(/\s+/g, ' ').trim();

/* ----- phone numbers, typed or spoken ("plus nine one double nine eight ...") ----- */
const DIGIT = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
export function parsePhone(raw) {
  let s = ' ' + String(raw || '').toLowerCase().replace(/[^a-z0-9+ ]/g, ' ') + ' ';
  s = s.replace(/\bplus\b/g, '+');
  for (const [w, d] of Object.entries(DIGIT)) s = s.replace(new RegExp('\\b' + w + '\\b', 'g'), d);
  s = s.replace(/\b(double|triple)\s+(\d)/g, (m, k, d) => d.repeat(k === 'double' ? 2 : 3));
  if (/[a-z]{3,}/.test(s.replace(/\b(my|the|number|is|its|it's|call|phone)\b/g, ''))) return null; // words left: not a number
  const plus = /^\s*\+/.test(s), digits = s.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? (plus ? '+' : '') + digits : null;
}

/* ----- "send a whatsapp to mom saying I'm on my way" -> { to, phone, text } ----- */
function recipient(to) {
  const t = tidy(to).replace(/^(?:to\s+)?(?:my\s+)?/i, '').replace(/[.?!]+$/, '');
  const phone = parsePhone(t);
  return phone ? { to: null, phone } : { to: t || null, phone: null };
}
export function parseMessage(raw) {
  let s = tidy(raw).replace(/[.?!]+$/, '');
  s = s.replace(/^(?:hey |ok |okay )?(?:eve[, ]+)?/i, '')
    .replace(/^(?:please\s+|can you\s+|could you\s+|would you\s+|i want to\s+|i need to\s+)+/i, '');
  let via = false;
  s = s.replace(new RegExp(`^(?:(?:go to|open|launch)\\s+${WA}\\s+(?:and\\s+)?|${VIA}[, ]+)`, 'i'), () => { via = true; return ''; });
  s = s.replace(/^please\s+/i, '');
  const end = `(?:\\s+${VIA})?`;
  const tail = `(?:(?:${SAYING})(.+))?$`;
  const pats = [
    // send a (whatsapp) message (to mom) (on whatsapp) (saying hi)
    [new RegExp(`^(?:send|write|drop|compose)\\s+(?:a\\s+|an\\s+|the\\s+)?(?:new\\s+)?${NOUN}${end}(?:\\s+to\\s+(.+?))?${end}${tail}`, 'i'), 1, 2],
    // send mom a (whatsapp) message saying hi
    [new RegExp(`^(?:send|write|drop)\\s+(.+?)\\s+(?:a\\s+|an\\s+)?${NOUN}${end}${tail}`, 'i'), 1, 2],
    // message / text / whatsapp mom (saying hi)
    [new RegExp(`^(?:message|text|${WA}|ping)\\s+(.+?)${end}${tail}`, 'i'), 1, 2],
  ];
  for (const [re, ti, xi] of pats) {
    const m = s.match(re);
    if (!m) continue;
    const r = recipient(m[ti] || '');
    if (r.to && /^(me|myself|a|an|the)$/i.test(r.to)) return null;
    const text = tidy((m[xi] || '').replace(new RegExp(`\\s+${VIA}$`, 'i'), ''));
    return { ...r, text: text ? text[0].toUpperCase() + text.slice(1) : '' };
  }
  // tell mom on whatsapp (that) I'm late
  const m = s.match(new RegExp(`^tell\\s+(.+?)\\s+${VIA}\\s+(?:that\\s+)?(.+)$`, 'i'))
    || (via && s.match(/^tell\s+(?!me\b)(\S+(?:\s\S+)?)\s+(?:that\s+)?(.+)$/i));
  if (m) { const text = tidy(m[2]); return { ...recipient(m[1]), text: text[0].toUpperCase() + text.slice(1) }; }
  // just "open whatsapp and send a message" or "whatsapp" alone is handled as opening the app
  return null;
}

/* ----- "save mom's number as +91 98765 43210" ----- */
export function parseSaveContact(raw) {
  const s = tidy(raw).replace(/[.?!]+$/, '');
  const m = s.match(/^(?:please\s+)?(?:save|add|store|remember)\s+(?:the\s+)?(?:(?:phone|mobile|whatsapp)\s+)?(?:number|contact)\s+(.+?)\s+(?:as|for)\s+(?:my\s+)?(.+)$/i);
  if (m && parsePhone(m[1])) return { name: cap(m[2]), phone: parsePhone(m[1]) };
  const n = s.match(/^(?:please\s+)?(?:(?:save|add|store|remember)\s+(?:that\s+)?)?(?:my\s+)?(.+?)(?:'s|’s|s)?\s+(?:(?:phone|mobile|whatsapp|contact)\s+)?number\s+(?:is|as|=)\s+(.+)$/i);
  if (n && parsePhone(n[2])) return { name: cap(n[1].replace(/^my\s+/i, '')), phone: parsePhone(n[2]) };
  return null;
}

/* ----- "open whatsapp" ----- */
export function parseOpenApp(raw) {
  const m = tidy(raw).replace(/[.?!]+$/, '').match(/^(?:please\s+|can you\s+|could you\s+)*(?:open|launch)\s+(?:up\s+)?(?:the\s+|my\s+)?(.+?)(?:\s+app(?:lication)?)?(?:\s+for me)?(?:\s+please)?$/i);
  if (!m) return null;
  const app = m[1].trim();
  if (/\b(file|song|track|music|audio|saved|compositions?|favorites|help|menu)\b/i.test(app)) return null;
  return /^what'?s ?app$/i.test(app) ? 'WhatsApp' : app;
}

/* ----- "turn on auto send": the one setting that lets Eve tap send by itself ----- */
export const isAutoSendRequest = (raw) => /\b(?:turn on|enable|set up|allow|switch on)\s+(?:the\s+)?(?:auto(?:matic)?[ -]?send(?:ing)?|whats ?app auto[ -]?send)\b/i.test(raw);
export async function enableAutoSend() {
  if (!isNative) return { r: 'On a Mac, allow your terminal app in System Settings, Privacy and Security, Accessibility. Then I can press send for you.' };
  await Device.openAutoSendSettings().catch(() => {});
  return { r: 'Opening Accessibility settings. Tap Eve auto-send and turn it on. It only taps send right after you say yes to a message.' };
}

/* ----- contacts: Eve's own list first, then the Mac's Contacts app ----- */
function savedContact(name) {
  const q = name.toLowerCase();
  const list = store.get().memory.contacts || [];
  return list.find((c) => c.name.toLowerCase() === q) || list.find((c) => c.name.toLowerCase().includes(q)) || null;
}
async function findContact(name) {
  const own = savedContact(name);
  if (own) return own;
  try {
    return isNative ? await Device.findContact({ name }) : await api('/device/contact', { method: 'POST', body: { name } });
  } catch { return null; }
}
export function saveContact(ctx, name, phone) {
  const list = (store.get().memory.contacts || []).filter((c) => c.name.toLowerCase() !== name.toLowerCase());
  ctx.setMemory?.({ contacts: [...list, { name, phone }].slice(-100) });
}

/* ----- the conversation ----- */
const who = (m) => (m.to ? cap(m.to) : spell(m.phone));
const spell = (p) => (p || '').replace(/\d/g, (d) => d + ' ').trim();
const question = (r, msg) => ({ r, pending: { intent: 'whatsapp', question: r, msg } });

// Works out what is still missing and asks for it; with everything known, reads the message back.
export async function messageFlow(m) {
  if (!m.to && !m.phone) return question('Who should I send it to?', { ...m, step: 'to' });
  if (!m.phone) {
    let c = await findContact(m.to);
    // "message mom I'm running late" with no "saying": the name is the first word or two
    if (!c && !m.text) {
      const w = m.to.split(/\s+/);
      for (let n = Math.min(2, w.length - 1); n >= 1 && !c; n--) {
        c = await findContact(w.slice(0, n).join(' '));
        if (c) m = { ...m, text: tidy(w.slice(n).join(' ')).replace(/^(?:saying|that)\s+/i, '') };
      }
    }
    if (!c) return question(`I don't have a number for ${cap(m.to)}. What's their WhatsApp number, with the country code?`, { ...m, step: 'phone' });
    m = { ...m, to: c.name, phone: c.phone };
  }
  if (!m.text) return question(`What should I say to ${who(m)}?`, { ...m, step: 'text' });
  if (m.text) m.text = m.text[0].toUpperCase() + m.text.slice(1);
  return question(`Your message to ${who(m)} says: ${m.text}. Send it?`, { ...m, step: 'confirm' });
}

const YES = /^(?:yes|yeah|yep|yup|sure|ok|okay|send|send it|do it|go ahead|go for it|confirm|correct|right|please do|yes please|sounds good|absolutely)\b/i;
const NO = /^(?:no|nope|nah|cancel|stop|dont|don't|do not|never ?mind|forget it|don't send|abort)\b/i;

// The answer to a follow-up question. Returns a task, or null if the answer is about something else.
export function resolveMessage(msg, raw, ctx) {
  const said = tidy(raw).replace(/[.?!]+$/, '');
  switch (msg.step) {
    case 'to': {
      if (NO.test(said)) return { r: "Okay, I won't send anything." };
      const r = recipient(said.replace(/^(?:send it to|to|it's for|for)\s+/i, ''));
      return { task: () => messageFlow({ ...msg, ...r }) };
    }
    case 'phone': {
      if (NO.test(said)) return { r: "Okay, I won't send it." };
      const phone = parsePhone(said);
      if (!phone) return question("Sorry, I didn't get a number. Say it with the country code, like plus nine one, then the number.", msg);
      const name = cap(msg.to);
      saveContact(ctx, name, phone);
      return { task: () => messageFlow({ ...msg, to: name, phone }) };
    }
    case 'text': {
      if (NO.test(said) && said.split(/\s+/).length <= 2) return { r: "Okay, I won't send it." };
      const text = tidy(raw).replace(/^(?:say|tell (?:him|her|them)|that)\s+/i, '');
      return { task: () => messageFlow({ ...msg, text }) };
    }
    case 'confirm': {
      const change = said.match(/^(?:(?:no|actually|wait)[, ]+)?(?:change (?:it|that) to|make it|say|instead say|actually say|tell (?:him|her|them))\s+(.+?)(?:\s+instead)?$/i);
      if (change) return { task: () => messageFlow({ ...msg, text: tidy(change[1]) }) };
      if (YES.test(said)) return { task: () => send(msg) };
      if (NO.test(said)) return { r: "Okay, I won't send it." };
      return null;
    }
  }
  return null;
}

const ACCESSIBILITY = isNative
  ? ' To let me tap send for you, say turn on auto send.'
  : ' To let me press send for you, allow your terminal app in System Settings, Privacy and Security, Accessibility.';
// no server or not this Mac: open the chat in the browser with the message typed in
function openInBrowser(m) {
  const url = 'https://wa.me/' + m.phone.replace(/\D/g, '') + '?text=' + encodeURIComponent(m.text);
  window.open(url, '_blank', 'noopener');
}
export async function send(m) {
  try {
    const body = { phone: m.phone, text: m.text };
    const { status, autoSend } = isNative ? await Device.sendWhatsApp(body) : await api('/device/whatsapp', { method: 'POST', body });
    if (status === 'sent') return { r: `Sent to ${who(m)}.` };
    if (isNative && autoSend) return { r: `I couldn't find WhatsApp's send button, so your message to ${who(m)} is waiting there. Tap send.` };
    return { r: `Your message to ${who(m)} is ready in WhatsApp. ${isNative ? 'Tap send' : 'Press return to send it'}.` + ACCESSIBILITY };
  } catch (e) {
    if (isNative) return { r: e.kind === 'missing' ? "WhatsApp isn't installed on this phone. Install it from the Play Store and ask me again." : "I couldn't open WhatsApp." };
    if (e.kind === 'missing') { openInBrowser(m); return { r: "WhatsApp isn't installed on this Mac, so I opened WhatsApp Web with your message. Press send there. Install WhatsApp from the App Store and I can send for you." }; }
    openInBrowser(m);
    return { r: `I opened WhatsApp with your message to ${who(m)}. Press send.` };
  }
}

export async function openApp(app) {
  try {
    const out = isNative ? await Device.openApp({ name: app }) : await api('/device/open', { method: 'POST', body: { app } });
    return { r: 'Opening ' + out.app + '.' };
  } catch (e) {
    if (e.kind === 'missing') return { r: `I couldn't find an app called ${app} on this ${isNative ? 'phone' : 'Mac'}.` };
    if (isNative) return { r: "I couldn't open it." };
    if (/^whatsapp$/i.test(app)) { window.open('https://web.whatsapp.com/', '_blank', 'noopener'); return { r: 'Opening WhatsApp Web.' }; }
    return { r: e.kind === 'remote' ? 'I can only open apps on the computer running Eve.' : "I can't open apps right now. Is the Eve server running on this Mac?" };
  }
}
