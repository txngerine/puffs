const PATTERNS = {
  en: /^(?:what|why|who|whom|whose|when|where|which|how|is|are|was|were|can|could|does|do|did|will|would|should)\b|\b(?:tell me about|explain|define|describe|meaning of|capital of)\b/i,
  ml: /(?:എന്ത്|എന്താണ്|എന്തുകൊണ്ട്|ആര്|ആരാണ്|എവിടെ|എപ്പോൾ|എങ്ങനെ|എത്ര|ഏത്)/u,
  hi: /(?:क्या|क्यों|कौन|कहाँ|कब|कैसे|कितना|कितनी|कितने|कौन-सा|क्या है)/u,
  es: /^(?:qué|por qué|quién|cuándo|dónde|cuál|cómo|es|son|puede)\b|\b(?:explícame|explique|háblame de)\b/i,
  fr: /^(?:quoi|pourquoi|qui|quand|où|quel|quelle|comment|est-ce que)\b|\b(?:explique|décris|parle-moi de)\b/i,
  de: /^(?:was|warum|wer|wann|wo|welche?r?|wie|ist|sind|kann)\b|\b(?:erklär|beschreib|erzähl mir von)\b/i,
  ja: /(?:何|なぜ|誰|どこ|いつ|どう|どれ|ですか|ますか)/u,
};

export function isQuestion(text, locale = 'en-US') {
  const value = String(text || '').trim();
  if (!value) return false;
  if (/[?？]\s*$/.test(value)) return true;
  const language = String(locale).toLowerCase().split('-')[0];
  return (PATTERNS[language] || PATTERNS.en).test(value);
}
