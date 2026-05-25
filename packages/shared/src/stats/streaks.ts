// Streak math · current and longest run of consecutive days with any
// activity. Both surfaces need the same numbers (the TUI Overview stat
// tiles and the web's daily-streaks panel were independently shipping
// near-identical implementations).

const DAY_MS = 86_400_000;

export type StreakSummary = {
  current_streak: number;
  longest_streak: number;
};

// Walk backward from today (UTC) counting consecutive days that appear
// in `activeDates`; sweep the sorted list once to find the longest run.
// Days where fires+hits=0 are not "active" · pass only rows that
// represent activity.
export function computeStreaks(
  daily: ReadonlyArray<{ date: string; fires?: number; hits?: number }>,
): StreakSummary {
  const activeDates = new Set<string>();
  for (const d of daily) {
    if ((d.fires ?? 0) > 0 || (d.hits ?? 0) > 0) {
      activeDates.add(d.date);
    }
  }
  if (activeDates.size === 0) return { current_streak: 0, longest_streak: 0 };

  // Current streak · walk back from today UTC. Cap at ~5y so a corrupt
  // dataset can't infinite-loop the modal.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  let current = 0;
  for (let i = 0; i < 365 * 5; i++) {
    const d = new Date(today.getTime() - i * DAY_MS);
    const iso = d.toISOString().slice(0, 10);
    if (activeDates.has(iso)) current++;
    else break;
  }

  // Longest streak · sweep the sorted active-date list.
  const sortedIso = [...activeDates].sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sortedIso.length; i++) {
    const prev = new Date(`${sortedIso[i - 1]!}T00:00:00Z`).getTime();
    const cur = new Date(`${sortedIso[i]!}T00:00:00Z`).getTime();
    if (cur - prev === DAY_MS) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }
  return { current_streak: current, longest_streak: longest };
}

// Count of distinct days with any activity. Cheap derived metric used in
// "active days: N / 7" copy.
export function activeDaysCount(
  daily: ReadonlyArray<{ date: string; fires?: number; hits?: number }>,
): number {
  let n = 0;
  for (const d of daily) {
    if ((d.fires ?? 0) > 0 || (d.hits ?? 0) > 0) n++;
  }
  return n;
}
