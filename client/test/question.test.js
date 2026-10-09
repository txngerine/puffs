import { describe, expect, it } from 'vitest';
import { isQuestion } from '../src/assistant/question.js';

describe('language-aware question detection', () => {
  it.each([
    ['What is photosynthesis?', 'en-US'],
    ['explain photosynthesis', 'en-US'],
    ['¿Cómo funciona la fotosíntesis?', 'es-ES'],
    ['Explique la photosynthèse', 'fr-FR'],
    ['Was ist Photosynthese?', 'de-DE'],
    ['ഫോട്ടോസിന്തസിസ് എന്താണ്', 'ml-IN'],
    ['प्रकाश संश्लेषण क्या है', 'hi-IN'],
    ['光合成とは何ですか', 'ja-JP'],
  ])('recognizes %s (%s)', (text, lang) => expect(isQuestion(text, lang)).toBe(true));

  it('does not route an ordinary unsupported statement as a question', () => {
    expect(isQuestion('play my saved composition', 'en-US')).toBe(false);
    expect(isQuestion('', 'ml-IN')).toBe(false);
  });
});
