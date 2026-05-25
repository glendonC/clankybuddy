// Character-grid padding helpers · TUI-local (Ink draws on a fixed
// terminal cell grid, not pixels). NOT to be confused with the
// format helpers in @clankybuddy/shared/stats which produce values;
// these produce spacing AROUND values for column alignment.

export function padEnd(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}

export function padStart(s: string, w: number): string {
  return s.length >= w ? s : ' '.repeat(w - s.length) + s;
}

export function padCenter(s: string, w: number): string {
  if (s.length >= w) return s.slice(0, w);
  const pad = w - s.length;
  const left = Math.floor(pad / 2);
  return ' '.repeat(left) + s + ' '.repeat(pad - left);
}
