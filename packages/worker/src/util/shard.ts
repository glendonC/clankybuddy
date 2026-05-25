// Shard-id derivation for ActionShardDO addressing. Lives here (not in
// constants.ts) because constants.ts is the cross-package wire-constant
// re-export hub; this is pure routing logic.
//
// Canonical placement contract: `idFromName(shardIdFor(userId))` MUST land
// in the same DO as the equivalent call in cron/aggregate.ts which iterates
// `ACTION_SHARD_IDS` directly. Both sides hash the *string* shard id, so as
// long as `shardIdFor` returns one of `ACTION_SHARD_IDS`, the write side and
// the rollup side agree.

/**
 * Map a `user_id` to one of 16 shard buckets.
 *
 * - `user_id` is `u_<uuid>` (database.ts createUser). The first hex character
 *   of the UUID portion gives 16 buckets uniformly. We tolerate ids without
 *   the `u_` prefix (legacy callers, tests) by reading the first character
 *   of the raw input.
 * - Falling back to '0' shouldn't happen in practice, Phase 1+ always emits
 *   the prefix and the suffix is always hex. Mapping non-hex to '0' is a
 *   conservative bias; observability for "fallback shard" rate is Phase 4.
 *
 * Returns one of '0'..'9', 'a'..'f', exactly the strings stored in
 * `ACTION_SHARD_IDS` in constants.ts.
 */
export function shardIdFor(userId: string): string {
  const slice =
    typeof userId === 'string' && userId.startsWith('u_')
      ? userId.slice(2)
      : (userId ?? '');
  const ch = typeof slice === 'string' ? slice.charAt(0).toLowerCase() : '';
  if (/^[0-9a-f]$/.test(ch)) return ch;
  // Fallback-shard observability: malformed/missing user_id maps to bucket
  // '0'. This is a debug counter (not Analytics Engine) so we can spot
  // ingest paths leaking non-`u_<hex>` ids. Keep the prefix tiny · we only
  // need enough to narrow down the offending caller, not the full id.
  try {
    console.log(
      JSON.stringify({
        evt: 'fallback_shard_hit',
        user_id_prefix:
          typeof userId === 'string' && userId.length > 0
            ? userId.slice(0, 4)
            : null,
        ts: Date.now(),
      }),
    );
  } catch {
    /* logging is best-effort */
  }
  return '0';
}

/**
 * Map a `user_id` to its RoomDO shard name. Thin wrapper over `shardIdFor`
 * so every chat-routing call site reads through one helper · grep-able
 * single source of truth. Both `handleWsConnect` (live WS upgrades) and
 * the per-user cron fan-outs (erase scrub, appeal-upheld notify) route via
 * this function.
 */
export function chatRoomNameFor(userId: string): string {
  return `room-shard-${shardIdFor(userId)}`;
}
