# AI-feedback bridge (CLI)

Polling-based file bridge between the ClankyBuddy worker and your local
AI coding assistant. When enabled, the TUI polls `GET /me/state` every
5 seconds and writes the result atomically to a state file on disk.
Your AI assistant (Claude Code, an MCP-aware tool, a hook script) can
read that file and adjust tone to match how the user has been treating
their buddy.

## What gets written

- **Path:** `~/.clankybuddy/state.json` (overridable via
  `bridge.state_path` in the CLI config).
- **Permissions:** mode 0600 on POSIX (chmod skipped on Windows; NTFS
  uses ACLs). The parent directory is mode 0700.
- **Atomic write:** `state.json.tmp` -> `fs.rename` -> `state.json`.
  No reader sees a half-written file.
- **Schema:** `version: 1` envelope; see `bridge-poller.ts`
  `BridgeStateFile`. Includes:
  - `session.id / started_at / character`
  - `mood.state / value / transitioned_at`
  - `recent.help_count_60s / hurt_count_60s / last_verb / last_verb_at`
  - `totals_session.help_count / hurt_count / fires / duration_ms`
  - `consent.bridge_enabled / share_with_assistants` (CLI-side; the
    worker never sees the consent flags)

## Who can read it

Only the local user (mode 0600). The file lives in your home directory
under `.clankybuddy/`. We do not push it anywhere.

## Opt-out

Three knobs:

- `/bridge disable`, turns off the poller AND deletes the state file.
- `/bridge share off`, keeps the poller running and the file present,
  but flips `consent.share_with_assistants` to `false`. AI tools that
  respect the flag should refuse to read the file when it's `false`.
  (This is a CLI-side projection, we cannot enforce it on the AI side.)
- Manual: delete `~/.clankybuddy/state.json` yourself. The poller will
  recreate it on the next tick if `bridge.enabled` is still true; for a
  durable opt-out use `/bridge disable`.

## Why polling and not push

The worker has no per-user dispatch path. RoomDO is a global room
fan-out; routing a user-targeted WebSocket message would require
infrastructure we haven't built. A 5-second poll is 10× simpler, and
AI tool calls are async anyway, fresher than 5s buys nothing for the
"adjust your tone" use case.

The worker rate-limits `/me/state` to 1 req/3s per user. The TUI polls
at 5s, which leaves headroom for clock skew. Behind a 3s edge cache so
back-to-back polls within a window collapse to one DO read.

## Future lanes (not implemented)

These are sketched here so the design is on record; the code does NOT
ship them today.

### MCP server

Expose `get_buddy_status` as an MCP tool that reads the same state file
and returns it as a structured tool response. Lives in a future
`packages/mcp/` directory; users would add it to their Claude Code MCP
config.

### Claude Code hook

Add a `UserPromptSubmit` hook to `~/.claude/settings.json` that runs a
script reading `~/.clankybuddy/state.json` and prepending a one-line
mood summary to the prompt. The hook is installable via something like
`/bridge install-hook` (not built).

Both lanes consume the same state file. The schema in this README is
the source of truth for them.

## Failure modes

- **Worker offline / 5xx:** poller logs once on the first failure in a
  streak, stays quiet, retries every 5s. Logs again only when the
  connection recovers (one "recovered after N failed polls" line).
- **401 explicit (token revoked):** poller calls the host's
  `onUnauthorized` hook. Same hook the WS uses; the TUI normally
  routes to verify.
- **401 transient (proxy/WAF):** silently skipped, retried next tick.
- **429:** worker rate limit. Treated like 5xx, first occurrence
  logged, retries on cadence.
- **Disk write failure:** logged once per streak; the in-memory state
  is fine, just the file write failed.

## Privacy contract

- The TUI never writes anything to the state file that the worker did
  not authorize for `user.id` (the `Authorization` bearer is the
  source of truth on the worker side).
- The worker's `/me/state` body is read-only, it never mutates
  events / counters / leaderboard.
- The `consent` block is added by the TUI immediately before the write.
  Unlike everything else in the file, it never leaves the local
  machine.
- `bridge.granted_at` (in the CLI config, not the state file) is the
  audit timestamp for when the user opted in. We don't ship it
  anywhere; it's local-only for the user's own records.
