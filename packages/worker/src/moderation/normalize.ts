// Residual bypasses NOT handled here (by design, addressed by Tier 2 / reputation / appeals):
// emoji-spelling (regional indicators), homophones, multi-message slur splits,
// novel slang / dogwhistles, foreign-language slurs.

// Lowercased after homoglyph fold runs post-toLowerCase, so uppercase Cyrillic /
// Greek confusables are listed too, toLowerCase on Cyrillic 'А' yields 'а', but
// some confusables (e.g. Greek capital tau 'Τ') don't lowercase to a Latin shape.
const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic confusables (the high-FP Latin lookalikes)
  'а': 'a', 'в': 'b', 'е': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o',
  'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j',
  'ѕ': 's', 'ԝ': 'w',
  // Greek confusables (Latin-shaped lowercase)
  'α': 'a', 'β': 'b', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o',
  'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x',
  // Mathematical alphanumerics that NFKC misses (bold italic, script, fraktur,
  // double-struck, etc., sample of the high-frequency abuse forms).
  '𝐚': 'a', '𝐛': 'b', '𝐜': 'c', '𝐝': 'd', '𝐞': 'e', '𝐟': 'f', '𝐠': 'g',
  '𝐡': 'h', '𝐢': 'i', '𝐤': 'k', '𝐥': 'l', '𝐧': 'n', '𝐨': 'o', '𝐩': 'p',
  '𝐬': 's', '𝐭': 't',
  '𝒂': 'a', '𝒆': 'e', '𝒊': 'i', '𝒐': 'o',
  '𝓪': 'a', '𝓮': 'e', '𝓲': 'i', '𝓸': 'o',
  '𝔞': 'a', '𝔢': 'e', '𝔦': 'i', '𝔬': 'o',
  '𝕒': 'a', '𝕖': 'e', '𝕚': 'i', '𝕠': 'o',
  '𝖆': 'a', '𝖊': 'e', '𝖎': 'i', '𝖔': 'o',
  // IPA / Latin-extended visual subs that survive NFKC and lowercase.
  'ɑ': 'a', 'ɡ': 'g', 'ɪ': 'i', 'ʀ': 'r', 'ʏ': 'y', 'ɩ': 'i', 'ʟ': 'l',
  // Roman numerals (NFKC handles uppercase but not all lowercase forms).
  'ⅰ': 'i', 'ⅽ': 'c', 'ⅾ': 'd', 'ⅼ': 'l', 'ⅿ': 'm', 'ⅹ': 'x',
};

const LEET: Record<string, string> = {
  '@': 'a', '4': 'a', '8': 'b', '(': 'c', '3': 'e', '6': 'g', '1': 'i',
  '!': 'i', '|': 'i', '0': 'o', '5': 's', '$': 's', '7': 't', '+': 't',
  '2': 'z',
};

const INVISIBLES = /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿]/g;
const COMBINING = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;

export interface Normalized {
  original: string;
  canonical: string;
  display: string;
  flags: {
    hadInvisibles: boolean;
    hadHomoglyph: boolean;
    hadCombining: boolean;
    hadLeet: boolean;
    repetitionRatio: number;
  };
}

export function normalize(input: string): Normalized {
  const original = input;
  let s = input.normalize('NFKC');

  const hadInvisibles = INVISIBLES.test(s);
  s = s.replace(INVISIBLES, '');

  const hadCombining = COMBINING.test(s);
  s = s.replace(COMBINING, '');

  const display = s.slice(0, 280);

  s = s.toLowerCase();

  let hadHomoglyph = false;
  s = [...s].map((ch) => {
    const sub = HOMOGLYPHS[ch];
    if (sub !== undefined) {
      hadHomoglyph = true;
      return sub;
    }
    return ch;
  }).join('');

  let hadLeet = false;
  // Leading [a-z] requirement so a leading "@" in a mention is not munged.
  s = s.replace(/[a-z][@4831065$!|+27(]+[a-z]?/g, (m) => {
    let out = '';
    for (const ch of m) {
      const sub = LEET[ch];
      if (sub !== undefined) {
        hadLeet = true;
        out += sub;
      } else {
        out += ch;
      }
    }
    return out;
  });

  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/(?:\b[a-z]\s){2,11}[a-z]\b/g, (m) => m.replace(/\s/g, ''));

  const before = s.length;
  s = s.replace(/(.)\1{2,}/g, '$1$1');
  const repetitionRatio = before === 0 ? 0 : (before - s.length) / before;

  return {
    original,
    canonical: s,
    display,
    flags: { hadInvisibles, hadHomoglyph, hadCombining, hadLeet, repetitionRatio },
  };
}
