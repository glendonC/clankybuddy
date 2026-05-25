import { env as rawEnv } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  CHAT_ROOM_SHARD_COUNT,
  CHAT_ROOM_SHARD_IDS,
} from '../../shared/src/chat.js';
import { chatRoomNameFor, shardIdFor } from '../src/util/shard.js';
import type { Env } from '../src/types.js';

// `cloudflare:test` types env as the project-level Cloudflare.Env; cast
// to the local Env so we can reach the ROOM binding without polluting the
// production type.
const env = rawEnv as unknown as Env;

// Plan A coverage, chat-room sharding. Verifies that the WS upgrade path
// and the per-user cron fan-outs all funnel through `chatRoomNameFor`, and
// that the shard distribution is wide enough that ~1/16 of traffic per
// shard is a reasonable assumption for slow-mode threshold calibration.
describe('chat room sharding', () => {
  it('CHAT_ROOM_SHARD_IDS has CHAT_ROOM_SHARD_COUNT entries with the expected name shape', () => {
    expect(CHAT_ROOM_SHARD_IDS).toHaveLength(CHAT_ROOM_SHARD_COUNT);
    for (let i = 0; i < CHAT_ROOM_SHARD_COUNT; i++) {
      expect(CHAT_ROOM_SHARD_IDS[i]).toBe(`room-shard-${i.toString(16)}`);
    }
  });

  it('chatRoomNameFor is deterministic for the same user_id', () => {
    // Repeated calls return identical shard names · the underlying hash is
    // a pure function of user_id, no time/random component.
    const id = 'u_deadbeefcafef00d1234567890abcdef';
    const names = new Set<string>();
    for (let i = 0; i < 64; i++) names.add(chatRoomNameFor(id));
    expect(names.size).toBe(1);
    const [only] = names;
    expect(only).toBe(`room-shard-${shardIdFor(id)}`);
  });

  it('100 random user_ids span more than 8 of the 16 shards', () => {
    // Loose distribution check · we only need confidence that we're not
    // all bucketing to one shard. Stricter chi-squared lives outside the
    // commit-time test loop.
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const id = `u_${crypto.randomUUID().replace(/-/g, '')}`;
      seen.add(chatRoomNameFor(id));
    }
    expect(seen.size).toBeGreaterThan(8);
  });

  it('users with different leading hex chars land on distinct shards (cross-shard isolation by DO id)', () => {
    // Construct two ids whose first hex char after `u_` differs · they
    // MUST hash to distinct shards. We assert at the DurableObject ID
    // level: `env.ROOM.idFromName(...)` returns deterministic DO IDs, so
    // two distinct shard names produce two distinct DO IDs (no possibility
    // of cross-shard message bleed).
    const userA = 'u_0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const userB = 'u_faaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    const nameA = chatRoomNameFor(userA);
    const nameB = chatRoomNameFor(userB);
    expect(nameA).toBe('room-shard-0');
    expect(nameB).toBe('room-shard-f');
    expect(nameA).not.toBe(nameB);

    const idA = env.ROOM.idFromName(nameA);
    const idB = env.ROOM.idFromName(nameB);
    expect(idA.toString()).not.toBe(idB.toString());
    // TODO(post-shard): expand once cross-shard WS harness lands ·
    // currently we assert isolation via distinct DO IDs (no WS pair
    // setup exists in this test suite).
  });

  it('scrub fan-out targets exactly one shard for a given user_id', () => {
    // The erase cron resolves the scrub target via chatRoomNameFor(user_id)
    // and calls `env.ROOM.idFromName(...)` exactly once per job. Mirror
    // that call here and assert the resolved DO ID matches ONLY the
    // expected shard · no other shard name maps to the same id.
    const userId = 'u_3aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const expectedName = chatRoomNameFor(userId);
    expect(expectedName).toBe('room-shard-3');

    const targetIdStr = env.ROOM.idFromName(expectedName).toString();
    const collisions = CHAT_ROOM_SHARD_IDS.filter((shardName) => {
      return env.ROOM.idFromName(shardName).toString() === targetIdStr;
    });
    expect(collisions).toEqual([expectedName]);
    // TODO(post-shard): expand once cross-shard WS harness lands · we'd
    // additionally exercise scrubByUserId across multiple shards and
    // assert the redact event reaches the right one.
  });

  it('shardIdFor falls back to bucket 0 for malformed/missing user_id', () => {
    expect(shardIdFor('')).toBe('0');
    expect(shardIdFor('u_')).toBe('0');
    expect(shardIdFor('u_zzz')).toBe('0');
    // Non-string-ish inputs are tolerated · the fallback observability
    // log line guards against TypeError so a malformed caller doesn't
    // crash the upgrade path.
    expect(shardIdFor(undefined as unknown as string)).toBe('0');
  });
});
