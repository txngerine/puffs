// Barge-in helpers. While Eve talks, the microphone can hear Eve itself through the speakers.
// A transcript is treated as echo when most of its words are words Eve just said.

const words = (s) => (s.toLowerCase().match(/[a-z0-9']+/g) || []).map((w) => w.replace(/'/g, ''));

export function isEcho(heard, spoken) {
  const h = words(heard);
  if (!h.length) return true;
  const said = new Set(words(spoken));
  if (!said.size) return false;
  const overlap = h.filter((w) => said.has(w)).length / h.length;
  return overlap >= 0.6;
}

// short commands that should cut Eve off immediately
const STOP = /^(?:(?:hey |ok |okay )?eve[, ]+)?(stop|wait|hold on|hang on|quiet|shush|hush|enough|never ?mind|cancel|be quiet|stop talking|shut up)\b/;
export const isStop = (heard) => STOP.test(heard.trim().toLowerCase());

// enough non-echo speech to be someone talking over Eve, not noise
export const isTalkingOver = (heard, spoken) => words(heard).length >= 3 && !isEcho(heard, spoken);
