import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// Stage 2 global-benchmark overlay smoke. The route fans out to every
// LeaderboardDO and pivots their daily rows into a unified time series;
// at this layer we just prove the endpoint is wired, returns the
// envelope shape, and applies the public cache headers /leaderboard
// uses. Empty-data path is the most common case in a fresh test isolate
// (no events ingested → every DO returns []).
describe('GET /leaderboard/series', () => {
  it('returns a 200 with a sorted timeseries envelope and public cache headers', async () => {
    const response = await SELF.fetch('https://example.com/leaderboard/series');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toMatch(/application\/json/);
    expect(response.headers.get('Cache-Control')).toMatch(/public.*max-age=\d+/);
    expect(response.headers.get('CDN-Cache-Control')).toMatch(/max-age=\d+/);

    const body = (await response.json()) as {
      timeseries?: Array<{ date: string; per_model: Record<string, unknown> }>;
    };
    expect(body.timeseries).toBeDefined();
    expect(Array.isArray(body.timeseries)).toBe(true);

    // If any data leaks into the isolate from a prior test, the array
    // must still be ascending by date.
    if (body.timeseries && body.timeseries.length > 1) {
      for (let i = 1; i < body.timeseries.length; i++) {
        const prev = body.timeseries[i - 1]!.date;
        const curr = body.timeseries[i]!.date;
        expect(prev <= curr).toBe(true);
      }
    }
  });

  it('accepts explicit since/until query params (YYYY-MM-DD)', async () => {
    const response = await SELF.fetch(
      'https://example.com/leaderboard/series?since=2026-01-01&until=2026-01-31',
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { timeseries?: unknown };
    expect(body.timeseries).toBeDefined();
  });

  it('falls back to defaults on malformed date params', async () => {
    const response = await SELF.fetch(
      'https://example.com/leaderboard/series?since=garbage&until=2026-13-99',
    );
    // Malformed inputs are silently swapped for defaults (today-30 .. today),
    // so the response is still a 200 with a well-formed envelope.
    expect(response.status).toBe(200);
  });
});
