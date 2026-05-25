import { SELF, env as rawEnv } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/types.js';

const env = rawEnv as unknown as Env;

// Plan B 2026-05-15, /admin/stats route. Auth model mirrors /admin/preserve:
// fail-closed 503 if env.ADMIN_TOKEN is unset, 401 for missing/wrong bearer,
// constant-time compare on the token.

const TOKEN = 'test-admin-token-do-not-use-in-prod';

// vitest-pool-workers / Miniflare snapshots env at test-isolate boot. Mutating
// `env.ADMIN_TOKEN` directly only flips it for the in-process caller; the
// underlying SELF.fetch runs against the same env so the cast-mutation works
// for the assertion windows below.
function setAdminToken(value: string | undefined): void {
  (env as unknown as { ADMIN_TOKEN: string | undefined }).ADMIN_TOKEN = value;
}

async function clearKv(): Promise<void> {
  // Best-effort: clear keys this test touches between runs to avoid bleed.
  await env.AUTH_KV.delete('cfg:moderation_mode');
  const day = new Date().toISOString().slice(0, 10);
  await env.AUTH_KV.delete(`mcount:${day}`);
}

describe('/admin/stats route', () => {
  beforeEach(async () => {
    setAdminToken(TOKEN);
    await clearKv();
  });
  afterEach(() => {
    setAdminToken(undefined);
  });

  it('503 when ADMIN_TOKEN is not configured', async () => {
    setAdminToken(undefined);
    const res = await SELF.fetch('https://example.com/admin/stats');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('admin_disabled');
  });

  it('401 when Authorization header is missing', async () => {
    const res = await SELF.fetch('https://example.com/admin/stats');
    expect(res.status).toBe(401);
  });

  it('401 when bearer token does not match', async () => {
    const res = await SELF.fetch('https://example.com/admin/stats', {
      headers: { Authorization: 'Bearer wrong-token-' + 'x'.repeat(30) },
    });
    expect(res.status).toBe(401);
  });

  it('200 with expected shape when authenticated', async () => {
    const res = await SELF.fetch('https://example.com/admin/stats', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('day');
    expect(body).toHaveProperty('mode');
    expect(body).toHaveProperty('mode_source');
    expect(body).toHaveProperty('cost');
    expect(body).toHaveProperty('top_users');
    expect(body).toHaveProperty('kill_switch');

    const cost = body.cost as Record<string, unknown>;
    expect(cost).toHaveProperty('calls_today');
    expect(cost).toHaveProperty('pending_delta');
    expect(cost).toHaveProperty('cost_usd');
    expect(cost).toHaveProperty('budget_usd');
    expect(cost).toHaveProperty('threshold_usd');
    expect(cost).toHaveProperty('headroom_pct');

    const ks = body.kill_switch as Record<string, unknown>;
    expect(ks).toHaveProperty('flipped');
    expect(ks).toHaveProperty('flipped_at');
    expect(ks).toHaveProperty('expires_at');
  });

  it('mode_source = "env_floor" by default (no KV override set)', async () => {
    const res = await SELF.fetch('https://example.com/admin/stats', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const body = (await res.json()) as { mode: string; mode_source: string };
    // wrangler.test.toml sets MODERATION_MODE = "regex_only"
    expect(body.mode).toBe('regex_only');
    expect(body.mode_source).toBe('env_floor');
  });

  it('KV override surfaces as mode_source = "kv_override" and flips kill_switch.flipped', async () => {
    await env.AUTH_KV.put('cfg:moderation_mode', 'regex_only');
    const res = await SELF.fetch('https://example.com/admin/stats', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const body = (await res.json()) as {
      mode: string;
      mode_source: string;
      kill_switch: { flipped: boolean; expires_at: number | null };
    };
    expect(body.mode).toBe('regex_only');
    expect(body.mode_source).toBe('kv_override');
    expect(body.kill_switch.flipped).toBe(true);
    expect(body.kill_switch.expires_at).not.toBeNull();
  });

  it('no-budget-set (MODERATION_DAILY_BUDGET_USD = 0) yields budget_usd = 0 and headroom 0', async () => {
    // wrangler.test.toml has MODERATION_DAILY_BUDGET_USD = "0"
    const res = await SELF.fetch('https://example.com/admin/stats', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const body = (await res.json()) as {
      cost: { budget_usd: number; threshold_usd: number; headroom_pct: number };
    };
    expect(body.cost.budget_usd).toBe(0);
    expect(body.cost.threshold_usd).toBe(0);
    expect(body.cost.headroom_pct).toBe(0);
  });

  it('top_users is sorted descending by calls (from DO snapshot)', async () => {
    // Drive a few moderation increments through the DO so getTopSpenders
    // returns a non-trivial snapshot.
    const id = env.DATABASE.idFromName('singleton');
    const stub = env.DATABASE.get(id);
    await stub.incrementModerationCounters(0, { 'u_alpha': 3 });
    await stub.incrementModerationCounters(0, { 'u_beta': 7 });
    await stub.incrementModerationCounters(0, { 'u_gamma': 1 });
    await stub.incrementModerationCounters(0, { 'u_beta': 2 });

    const res = await SELF.fetch('https://example.com/admin/stats', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const body = (await res.json()) as {
      top_users: { user_id: string; calls: number }[];
    };
    expect(body.top_users.length).toBeGreaterThanOrEqual(3);
    // Descending order on `calls`.
    for (let i = 1; i < body.top_users.length; i++) {
      expect(body.top_users[i - 1]!.calls).toBeGreaterThanOrEqual(
        body.top_users[i]!.calls,
      );
    }
    // u_beta should be #1 with 9 calls.
    expect(body.top_users[0]!.user_id).toBe('u_beta');
    expect(body.top_users[0]!.calls).toBe(9);
  });
});
