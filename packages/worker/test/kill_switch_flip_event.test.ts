import { env as rawEnv } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bumpDailyAndMaybeFlip } from '../src/moderation/kill_switch.js';
import type { Env } from '../src/types.js';

const env = rawEnv as unknown as Env;

// Plan B 2026-05-15, verify the kill_switch_flip event emits the new
// `budget_usd` / `pending_delta` doubles and dual-writes a JSON line to
// console.log (Logpush + wrangler-tail surface).

function setBudget(value: string): void {
  (env as unknown as { MODERATION_DAILY_BUDGET_USD: string }).MODERATION_DAILY_BUDGET_USD =
    value;
}

// Minimal ExecutionContext stand-in: bumpDailyAndMaybeFlip wraps its work in
// ctx.waitUntil. We capture the resulting Promise so the test can await it.
function makeCtx(): { ctx: ExecutionContext; tasks: Promise<unknown>[] } {
  const tasks: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(p: Promise<unknown>): void {
      tasks.push(p);
    },
    passThroughOnException(): void {
      /* no-op */
    },
  } as unknown as ExecutionContext;
  return { ctx, tasks };
}

async function clearFlipState(): Promise<void> {
  await env.AUTH_KV.delete('cfg:moderation_mode');
  const day = new Date().toISOString().slice(0, 10);
  await env.AUTH_KV.delete(`mcount:${day}`);
}

describe('kill_switch_flip event', () => {
  const originalBudget = (env as unknown as { MODERATION_DAILY_BUDGET_USD: string })
    .MODERATION_DAILY_BUDGET_USD;

  beforeEach(async () => {
    await clearFlipState();
    // Use a tiny budget so the 0.7 threshold (= 0.7 * 0.01 = 0.007 USD) is
    // crossed by ~71 tier-2 calls (each ESTIMATED_COST_PER_CALL_USD = 0.0001).
    // We seed `mcount:<day>` directly so the flip trips on a single call.
    setBudget('0.01');
  });

  afterEach(async () => {
    setBudget(originalBudget ?? '0');
    await clearFlipState();
    vi.restoreAllMocks();
  });

  it('flip emits console.log with kill_switch_flip + new doubles, then is idempotent', async () => {
    const day = new Date().toISOString().slice(0, 10);
    // Seed past-threshold count: 80 calls * 0.0001 = 0.008 USD, > 0.7 * 0.01.
    await env.AUTH_KV.put(`mcount:${day}`, '80');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const first = makeCtx();
    await bumpDailyAndMaybeFlip(env, first.ctx, 0.0001);
    await Promise.all(first.tasks);

    // Find the kill_switch_flip line.
    const flipLines = logSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.includes('kill_switch_flip'));
    expect(flipLines.length).toBe(1);
    const payload = JSON.parse(flipLines[0]!) as Record<string, unknown>;
    expect(payload.evt).toBe('kill_switch_flip');
    expect(payload.new_mode).toBe('regex_only');
    expect(payload.prior_mode).toBe('unset');
    expect(typeof payload.cost_now_usd).toBe('number');
    expect(typeof payload.budget_usd).toBe('number');
    expect(payload.budget_usd).toBe(0.01);
    expect(typeof payload.pending_delta).toBe('number');
    expect(typeof payload.count).toBe('number');

    // KV override now set.
    const mode = await env.AUTH_KV.get('cfg:moderation_mode');
    expect(mode).toBe('regex_only');

    // Second trip same day: should NOT emit another kill_switch_flip line
    // (alreadyFlipped short-circuit).
    logSpy.mockClear();
    const second = makeCtx();
    await bumpDailyAndMaybeFlip(env, second.ctx, 0.0001);
    await Promise.all(second.tasks);
    const flipLinesAfter = logSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.includes('kill_switch_flip'));
    expect(flipLinesAfter.length).toBe(0);
  });

  it('does not flip when cost stays under 0.7 * budget', async () => {
    const day = new Date().toISOString().slice(0, 10);
    // 50 calls * 0.0001 = 0.005 USD, < 0.7 * 0.01 = 0.007.
    await env.AUTH_KV.put(`mcount:${day}`, '50');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { ctx, tasks } = makeCtx();
    await bumpDailyAndMaybeFlip(env, ctx, 0.0001);
    await Promise.all(tasks);

    const flipLines = logSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.includes('kill_switch_flip'));
    expect(flipLines.length).toBe(0);

    const mode = await env.AUTH_KV.get('cfg:moderation_mode');
    expect(mode).toBeNull();
  });
});
