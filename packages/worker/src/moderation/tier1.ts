// Lifted verbatim from chinmeister/packages/worker/src/moderation.ts:18-55.
// Tuning of this list (additions / removals) is a separate concern, touch the
// roster, not the compilation.
const BLOCKED_PATTERNS: readonly string[] = [
  'nigger',
  'nigga',
  'niggers',
  'niggas',
  'chink',
  'chinks',
  'wetback',
  'spic',
  'spics',
  'kike',
  'kikes',
  'gook',
  'gooks',
  'coon',
  'coons',
  'darkie',
  'darkies',
  'beaner',
  'beaners',
  'zipperhead',
  'faggot',
  'faggots',
  'fag',
  'fags',
  'dyke',
  'dykes',
  'tranny',
  'trannies',
  'retard',
  'retards',
  'retarded',
  'kill yourself',
  'kys',
  'buy followers',
  'free crypto',
  'dm me for',
];

interface CompiledPattern {
  source: string;
  regex: RegExp;
}

// Case-insensitive flag is redundant for normalized input but kept as defense in
// depth in case a caller passes a raw string.
const COMPILED: readonly CompiledPattern[] = BLOCKED_PATTERNS.map((p) => ({
  source: p,
  regex: new RegExp('\\b' + p.replace(/\s+/g, '\\s+') + '\\b', 'i'),
}));

export interface Tier1Result {
  hit: boolean;
  pattern?: string;
}

export function tier1Check(canonical: string): Tier1Result {
  for (const { source, regex } of COMPILED) {
    if (regex.test(canonical)) {
      return { hit: true, pattern: source };
    }
  }
  return { hit: false };
}
