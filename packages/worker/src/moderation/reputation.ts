export interface RepEntry {
  user_id: string;
  score: number;
  flagged_count: number;
  passed_count: number;
  shadow_until: number | null;
  updated_at: number;
  created_at: number;
}

export type RepBand = 'trusted' | 'default' | 'suspect' | 'gated' | 'shadow' | 'banned';

// Per backend-plan.md §7c. Order of checks matters: shadow_until takes priority
// over the score band so a temporarily-shadowbanned trusted user still gets
// echo-only treatment until the timer elapses.
export function bandOf(score: number, shadow_until: number | null, now: number = Date.now()): RepBand {
  if (shadow_until != null && shadow_until > now) return 'shadow';
  if (score >= 80) return 'trusted';
  if (score >= 50) return 'default';
  if (score >= 25) return 'suspect';
  if (score >= 10) return 'gated';
  if (score >= 1) return 'shadow';
  return 'banned';
}

export const ADJUSTMENTS = {
  cleanBroadcast: 0.1,
  tier1Hit: -10,
  tier2Hit: -25,
  flagOnlyNoHit: -2,
  appealUpheld: 5,
  reportWeighted: -15,
  cleanDecay24h: 2,
} as const;
