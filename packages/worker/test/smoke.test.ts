import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// Phase A smoke test, exists to prove the Miniflare harness boots end-to-end
// against the worker entrypoint. Coverage (auth, ratelimit, ws, etc.) lands
// in Phase B; if THIS test breaks, the test infra itself is wrong, not the
// route.
describe('worker smoke', () => {
  it('GET /me without an Authorization header returns 401', async () => {
    const response = await SELF.fetch('https://example.com/me');
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe('unauthorized');
  });

  it('GET /me with an obviously invalid bearer token still returns 401', async () => {
    const response = await SELF.fetch('https://example.com/me', {
      headers: { Authorization: 'Bearer notavalidtoken' },
    });
    expect(response.status).toBe(401);
  });
});
