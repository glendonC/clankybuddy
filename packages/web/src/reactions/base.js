// Default per-mood-state speech pools. Used as the lowest-priority fallback
// in pools.js when no character override exists. Migrated from mood.js's
// original SPEECH dict during the W3a refactor.

export const BASE = {
  ECSTATIC: ['<3', 'best day ever', 'i love you', '🌟', 'you complete me'],
  HAPPY:    ['hehe', 'thanks!', ':)', 'nice', 'gentle hands'],
  CONTENT:  ['...', 'hello', 'hmm', 'standing by', 'awaiting input'],
  WORRIED:  ['uh', 'careful', 'pls dont', 'plz', '?'],
  HURT:     ['ow!', 'hey!', 'stop', 'cmon man', 'that hurt'],
  BROKEN:   ['error 500', 'help', 'i.. just wanted to help', '💀', 'mercy'],
};
