// Wake word: "hey Eve, …". Speech recognizers spell the name several ways, so a greeting is required
// in front of it ("hey", "hi", "ok"), which keeps phrases like "Christmas Eve" from waking Eve.
const WAKE = /\b(?:hey|hi|hay|ok|okay|o\.k\.)[\s,]+(?:eve|eves|eva|evie|eave)\b[\s,.!?]*/i;

// The words after the wake word ('' when there are none), or null when the wake word wasn't said.
export function parseWake(heard) {
  const m = WAKE.exec(heard || '');
  if (!m) return null;
  return { rest: heard.slice(m.index + m[0].length).trim() };
}
