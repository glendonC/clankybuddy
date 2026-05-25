import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { ApiError, apiFetch } from './api.js';
import { getValidAccessToken } from './auth.js';
import { type Config, bridgeStatePath, writeConfig } from './config.js';

// AI-feedback bridge poller.
//
// What this is:
//   A 5s interval that GETs `/me/state` from the worker and writes the
//   response (plus a CLI-side `consent` block) atomically into
//   `~/.clankybuddy/state.json`. AI assistants like Claude Code can
//   read that file via filesystem tools and adjust their tone to match
//   the buddy's mood (pet the Claude buddy → Claude Code feels happier,
//   punch it for an hour → tone shifts).
//
// What this isn't:
//   - NOT a worker WS push. Polling only. The worker has no per-user
//     dispatch; polling is 10× simpler and AI tool calls are async
//     anyway. (Per Phase B Cluster G red-team.)
//   - NOT an MCP server. The MCP lane is sketched in bridge-readme.md
//     but unimplemented.
//   - NOT a Claude Code hook. Sketched, not wired. Documented in
//     bridge-readme.md so users know this is a future direction.
//
// Privacy:
//   - The state file is written with mode 0600 on POSIX (skipped on
//     Windows, NTFS uses ACLs, no chmod).
//   - The `consent.share_with_assistants` flag is layered on locally,
//     the worker never sees it. AI tools that respect the flag should
//     refuse to read the file when it's false (see bridge-readme.md).
//   - On `/bridge disable`, the state file is deleted (best-effort) and
//     the poller is stopped. The user owns the file; rm-ing it manually
//     is also fine, the poller will recreate it on the next tick if
//     the bridge is still enabled, so users who want to opt out should
//     prefer `/bridge disable` over deleting the file.
//
// Failure modes:
//   - Worker offline / 5xx / network: log to stderr, retry next tick.
//     No error spam, only the first error in a streak is logged
//     (suppressed thereafter until a successful poll resets the latch).
//   - 401 from /me/state: trigger onUnauthorized() and skip this tick.
//     The host (cli.tsx) decides whether to wipe config and re-verify;
//     the poller blindly trusts the hook to either return a fresh
//     token (in which case the next tick succeeds) or take the user
//     out of the bridge phase entirely (in which case stop() will be
//     called externally).
//   - 429: the worker rate-limits to 1 req per 3s per user. We poll at
//     5s so this shouldn't happen, but if it does, treat as a
//     transient, log on first occurrence, keep polling.

export const BRIDGE_POLL_INTERVAL_MS = 5_000;

// File schema written to disk. Versioned so a future schema bump can
// branch reads in consumer tools (MCP server, Claude Code hook). The
// `consent` block is a CLI-side projection of the user's config; the
// worker doesn't know about it.
export interface BridgeStateFile {
  version: 1;
  updated_at: number;
  session: {
    id: string | null;
    started_at: number | null;
    character: string | null;
  };
  mood: {
    state: string | null;
    value: number | null;
    transitioned_at: number | null;
  };
  recent: {
    help_count_60s: number;
    hurt_count_60s: number;
    last_verb: string | null;
    last_verb_at: number | null;
  };
  totals_session: {
    help_count: number;
    hurt_count: number;
    fires: number;
    duration_ms: number;
  } | null;
  consent: {
    bridge_enabled: boolean;
    share_with_assistants: boolean;
  };
}

// Worker /me/state response shape mirror. Kept as a local interface
// rather than re-imported from the worker so bundling stays clean
// (the CLI does not depend on the worker package).
interface WorkerStateResponse {
  user_id: string;
  schema_version: number;
  updated_at: number;
  session: BridgeStateFile['session'];
  mood: BridgeStateFile['mood'];
  recent: BridgeStateFile['recent'];
  totals_session: BridgeStateFile['totals_session'];
}

export type BridgePoller = {
  // Stop the poller. Idempotent, calling stop() on an already-stopped
  // poller is a no-op.
  stop: () => void;
};

export type BridgePollerOpts = {
  // Hook fired when /me/state returns 401. The host decides whether to
  // wipe config + re-verify (chat.tsx's onTokenRejected pattern) or
  // ignore (transient 401 from a proxy). Same contract as ws.ts.
  onUnauthorized?: () => Promise<void> | void;
};

// Atomic write: write the temp file, fsync via writeFile (Node default),
// then rename. The rename is atomic on POSIX and best-effort on Windows
// (Node 22 docs note Windows rename across-volume can fail; we land in
// the same dir so this is fine).
//
// Mode 0600 is set both at writeFile time and via chmod after-the-fact
// because Node's writeFile mode is filtered through umask on POSIX.
async function writeStateAtomic(
  path: string,
  body: BridgeStateFile,
): Promise<void> {
  const dir = dirname(path);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  // Best-effort dir chmod (writeFile's mode is umask-filtered).
  if (process.platform !== 'win32') {
    try {
      await fs.chmod(dir, 0o700);
    } catch {
      /* not fatal, directory already exists with looser perms is okay */
    }
  }
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(body, null, 2), { mode: 0o600 });
  if (process.platform !== 'win32') {
    try {
      await fs.chmod(tmp, 0o600);
    } catch {
      /* same, non-fatal */
    }
  }
  await fs.rename(tmp, path);
  if (process.platform !== 'win32') {
    try {
      await fs.chmod(path, 0o600);
    } catch {
      /* the rename may have lost the bits on some filesystems; retry once */
    }
  }
}

// Best-effort delete. ENOENT is the normal "already gone" case; other
// errors are logged to stderr but not raised, the bridge is never
// allowed to wedge the TUI.
export async function deleteBridgeState(path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch (err) {
    if (err && typeof err === 'object' && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    process.stderr.write(
      `[clankybuddy bridge] failed to delete state file: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

// Public helper: write a one-shot snapshot at /bridge enable time so
// the file appears immediately, before the first poll tick. Used by
// the slash command's "enable" branch.
export async function writeInitialBridgeSnapshot(cfg: Config): Promise<void> {
  if (!cfg.bridge?.enabled) return;
  const snap: BridgeStateFile = {
    version: 1,
    updated_at: Date.now(),
    session: { id: null, started_at: null, character: null },
    mood: { state: null, value: null, transitioned_at: null },
    recent: {
      help_count_60s: 0,
      hurt_count_60s: 0,
      last_verb: null,
      last_verb_at: null,
    },
    totals_session: null,
    consent: {
      bridge_enabled: cfg.bridge.enabled,
      share_with_assistants: cfg.bridge.share_with_assistants,
    },
  };
  await writeStateAtomic(bridgeStatePath(cfg), snap);
}

// Start the poller. Returns a handle whose stop() cancels the interval
// + cleans up. Safe to call multiple times, caller must stop the old
// instance before starting a new one (we don't track instances here).
export function startBridgePoller(
  cfgRef: { current: Config },
  opts: BridgePollerOpts = {},
): BridgePoller {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Consecutive-failure latch. We log on the first failure in a streak
  // and stay quiet thereafter; reset on the next successful poll.
  // Without this, a 30-min outage would write 360 lines of "failed to
  // poll bridge" into the user's terminal and out of the React render
  // tree (Ink shares stderr with the rendered output).
  let failureStreak = 0;

  const tick = async () => {
    if (stopped) return;
    const cfg = cfgRef.current;
    if (!cfg.bridge?.enabled) {
      // Bridge was toggled off between ticks. Stop quietly; the
      // calling code is expected to call stop() too, but this guard
      // keeps us from writing snapshots after the user opted out.
      return;
    }

    try {
      const access = await getValidAccessToken(cfg, writeConfig);
      const body = await apiFetch<WorkerStateResponse>(
        cfg.api_base,
        '/me/state',
        { method: 'GET' },
        access,
        {
          onUnauthorized: async () =>
            getValidAccessToken(cfg, writeConfig, { force: true }),
        },
      );

      const snap: BridgeStateFile = {
        version: 1,
        updated_at: body.updated_at,
        session: body.session,
        mood: body.mood,
        recent: body.recent,
        totals_session: body.totals_session,
        consent: {
          bridge_enabled: cfg.bridge.enabled,
          share_with_assistants: cfg.bridge.share_with_assistants,
        },
      };
      await writeStateAtomic(bridgeStatePath(cfg), snap);
      if (failureStreak > 0) {
        process.stderr.write(
          `[clankybuddy bridge] recovered after ${failureStreak} failed poll(s)\n`,
        );
        failureStreak = 0;
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Same handshake as chat.tsx: only fire onUnauthorized for
        // explicit token rejection. Transient 401s (proxy / WAF /
        // captive-portal interstitial) shouldn't nuke the user's
        // account just because the bridge tripped on one.
        const summary = err.summary.toLowerCase();
        if (summary === 'unauthorized' || summary === 'invalid_token') {
          try {
            await opts.onUnauthorized?.();
          } catch {
            /* host hook should not bubble; swallow */
          }
        }
        // Don't bump failureStreak on 401, the auth layer is handling it
        // and we'll either come back online next tick or get stopped by
        // the host. Logging would just confuse users mid-re-verify.
      } else {
        failureStreak++;
        if (failureStreak === 1) {
          process.stderr.write(
            `[clankybuddy bridge] poll failed: ${err instanceof Error ? err.message : String(err)}, retrying every ${BRIDGE_POLL_INTERVAL_MS / 1000}s\n`,
          );
        }
      }
    }
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      void tick().finally(schedule);
    }, BRIDGE_POLL_INTERVAL_MS);
  };

  // Run the first tick immediately so a freshly-enabled bridge has a
  // populated file before any AI tool reads from it. After this, the
  // tick chain re-arms every BRIDGE_POLL_INTERVAL_MS.
  void tick().finally(schedule);

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
