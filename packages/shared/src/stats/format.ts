// Stats-rendering format helpers. Pure, side-effect-free. Both surfaces
// (TUI Ink and web canvas/DOM) format the same numbers; one source of
// truth here prevents "+1.2K" rendering as "1,200" elsewhere.

// Round to integer + locale-format with thousands separators. NaN / non-
// finite values render as "0" so chart axes don't blow up on empty data.
export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Math.round(n).toLocaleString();
}

// Signed integer with explicit `+` for positives. Useful for mood deltas
// and gain/loss columns where the sign carries the meaning.
export function fmtSigned(n: number): string {
  const rounded = Math.round(n);
  if (rounded > 0) return `+${rounded.toLocaleString()}`;
  return rounded.toLocaleString();
}

// Human duration. ms → "1h 23m" / "12m" / "45s" / "0m". Two-pane choice:
// hours+minutes for ≥1h, minutes for <1h ≥1m, seconds for <1m.
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

// Short date · "Mar 15" UTC. Used by chart axis labels where space is
// tight and the year is implied by the surrounding window. UTC keeps
// timeseries-bucket labels stable across timezones (the buckets are
// computed UTC server-side).
export function fmtShortDate(epoch: number): string {
  const d = new Date(epoch);
  const month = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ][d.getUTCMonth()]!;
  return `${month} ${d.getUTCDate()}`;
}

// Same as fmtShortDate but takes a YYYY-MM-DD date string instead of an
// epoch. Used for daily_calendar entries which carry dates not epochs.
export function fmtShortDateIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const month = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ][d.getUTCMonth()]!;
  return `${month} ${d.getUTCDate()}`;
}
