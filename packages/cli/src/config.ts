import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CONFIG_VERSION } from './constants.js';

// ──────────────────────────────────────────────────────────────────────────
// Config schema reference (read this before editing).
//
// CURRENT (v3, Phase B Cluster G, AI-feedback bridge):
//
//   type ConfigV3 = ConfigV2 & {
//     version: 3;
//     bridge?: {
//       enabled: boolean;             // writes file at all
//       share_with_assistants: boolean; // separate flag for AI-tool consumption
//       granted_at?: number;
//       state_path?: string;          // override default ~/.clankybuddy/state.json
//     };
//   };
//
// LEGACY (v2, Workstream C):
//   { version: 2, access_token, access_token_issued_at, refresh_token,
//     user_id, handle, color, api_base, age_gate? }
//
// LEGACY (v1):
//   { version: 1, token, user_id, handle, color, api_base }
//
// The v2 fields are owned jointly by Workstreams C (auth fields) and D
// (age_gate field). Both surfaces (web auth-storage.js v2 and TUI) MUST
// use the literal field names above, `access_token` (not `token`),
// `access_token_issued_at` (not `issued_at`), to keep their shapes in
// vocabulary lockstep.
//
// Migration v1 → v2: copy `token` -> `access_token`, set
// `access_token_issued_at = 0` (forces refresh on next call), set
// `refresh_token = null`, omit `age_gate` (forces re-prompt).
// Migration v2 → v3: spread v2 fields, set `version: 3`, omit `bridge`
// (the user explicitly opts in via `/bridge enable`).
// ──────────────────────────────────────────────────────────────────────────

export type AgeGateRecord = { confirmed_at: number; version: number };

// AI-feedback bridge config. Two flags so the user can disable AI
// consumption (`share_with_assistants: false`) WITHOUT killing the
// poller (e.g. the user wants a local mood readout in their terminal
// status bar but doesn't want Claude Code to know). When the file
// IS written, `consent.share_with_assistants` lets the consuming AI
// tool decide whether to read it.
export type BridgeConfig = {
  enabled: boolean;
  share_with_assistants: boolean;
  granted_at?: number;
  state_path?: string;
};

export type Config = {
  version: 3;
  access_token: string;
  access_token_issued_at: number;
  refresh_token: string | null;
  user_id: string;
  handle: string;
  color: string;
  api_base: string;
  age_gate?: AgeGateRecord;
  bridge?: BridgeConfig;
};

export function configPath(): string {
  return join(homedir(), '.clankybuddy', 'config.json');
}

// Default location for the bridge state file. Overridable via
// `bridge.state_path` (e.g. for users with custom XDG layouts or who
// want the file checked into a per-project directory). Co-located with
// config.json so both share the same 0700 directory.
export function defaultBridgeStatePath(): string {
  return join(homedir(), '.clankybuddy', 'state.json');
}

export function bridgeStatePath(cfg: Config): string {
  return cfg.bridge?.state_path ?? defaultBridgeStatePath();
}

// `Date.now() - access_token_issued_at`. v1-migrated configs carry
// `issued_at = 0`, which yields a value larger than any sane threshold,
// callers treat that as "infinitely stale" and trigger a refresh.
export function accessTokenAge(cfg: Config): number {
  return Date.now() - cfg.access_token_issued_at;
}

function isAgeGateRecord(v: unknown): v is AgeGateRecord {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.confirmed_at === 'number' && typeof o.version === 'number';
}

function isBridgeConfig(v: unknown): v is BridgeConfig {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.enabled !== 'boolean') return false;
  if (typeof o.share_with_assistants !== 'boolean') return false;
  if (o.granted_at !== undefined && typeof o.granted_at !== 'number') return false;
  if (o.state_path !== undefined && typeof o.state_path !== 'string') return false;
  return true;
}

// v2 → v3 migration. Spread the v2 fields, set version 3, omit bridge
// (the user opts in explicitly via `/bridge enable`). Idempotent.
export function v2_to_v3(v2: {
  version: 2;
  access_token: string;
  access_token_issued_at: number;
  refresh_token: string | null;
  user_id: string;
  handle: string;
  color: string;
  api_base: string;
  age_gate?: AgeGateRecord;
}): Config {
  return {
    version: 3,
    access_token: v2.access_token,
    access_token_issued_at: v2.access_token_issued_at,
    refresh_token: v2.refresh_token,
    user_id: v2.user_id,
    handle: v2.handle,
    color: v2.color,
    api_base: v2.api_base,
    age_gate: v2.age_gate,
  };
}

// Returns null on parse failure or unrecognized shape (forces re-init).
// Returns { config, migrated } so the caller can persist the v2 blob the
// first time a v1 file is read. Migration is transparent: the user's
// access_token is preserved (still valid until the next 401 / proactive
// refresh) and the handle/color/user_id stay put.
function parseConfig(raw: string): { config: Config; migrated: boolean } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    process.stderr.write('[clankybuddy] warning: config parse failed (corrupt JSON)\n');
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    process.stderr.write('[clankybuddy] warning: config not an object\n');
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const version = obj.version;

  // v1 → v2 → v3 inline migration. v1 is missing access_token shape and
  // the bridge field; we hop straight through v2 by spreading into the
  // v3 builder.
  if (version === 1) {
    if (
      typeof obj.token !== 'string' ||
      typeof obj.user_id !== 'string' ||
      typeof obj.handle !== 'string' ||
      typeof obj.color !== 'string' ||
      typeof obj.api_base !== 'string'
    ) {
      process.stderr.write('[clankybuddy] warning: v1 config missing fields; ignoring\n');
      return null;
    }
    const migrated: Config = {
      version: 3,
      access_token: obj.token,
      access_token_issued_at: 0,
      refresh_token: null,
      user_id: obj.user_id,
      handle: obj.handle,
      color: obj.color,
      api_base: obj.api_base,
    };
    return { config: migrated, migrated: true };
  }

  // v2 → v3 inline migration. v2 has the full auth shape; we just bump
  // the version field (and omit bridge, opt-in only).
  if (version === 2) {
    if (
      typeof obj.access_token !== 'string' ||
      typeof obj.access_token_issued_at !== 'number' ||
      !(typeof obj.refresh_token === 'string' || obj.refresh_token === null) ||
      typeof obj.user_id !== 'string' ||
      typeof obj.handle !== 'string' ||
      typeof obj.color !== 'string' ||
      typeof obj.api_base !== 'string'
    ) {
      process.stderr.write('[clankybuddy] warning: v2 config missing or malformed fields\n');
      return null;
    }
    const v2Cfg = {
      version: 2 as const,
      access_token: obj.access_token,
      access_token_issued_at: obj.access_token_issued_at,
      refresh_token: obj.refresh_token,
      user_id: obj.user_id,
      handle: obj.handle,
      color: obj.color,
      api_base: obj.api_base,
      ...(obj.age_gate !== undefined && isAgeGateRecord(obj.age_gate)
        ? { age_gate: obj.age_gate }
        : {}),
    };
    return { config: v2_to_v3(v2Cfg), migrated: true };
  }

  if (version !== 3) {
    process.stderr.write(
      `[clankybuddy] warning: config version ${String(version)} unrecognized\n`,
    );
    return null;
  }

  // v3 strict validation, refuse anything malformed so the boot path
  // re-runs verify rather than wedging on a half-written blob.
  if (
    typeof obj.access_token !== 'string' ||
    typeof obj.access_token_issued_at !== 'number' ||
    !(typeof obj.refresh_token === 'string' || obj.refresh_token === null) ||
    typeof obj.user_id !== 'string' ||
    typeof obj.handle !== 'string' ||
    typeof obj.color !== 'string' ||
    typeof obj.api_base !== 'string'
  ) {
    process.stderr.write('[clankybuddy] warning: v3 config missing or malformed fields\n');
    return null;
  }

  const cfg: Config = {
    version: 3,
    access_token: obj.access_token,
    access_token_issued_at: obj.access_token_issued_at,
    refresh_token: obj.refresh_token,
    user_id: obj.user_id,
    handle: obj.handle,
    color: obj.color,
    api_base: obj.api_base,
  };

  // age_gate is optional. Reject only if present and malformed; missing is fine.
  if (obj.age_gate !== undefined) {
    if (!isAgeGateRecord(obj.age_gate)) {
      process.stderr.write('[clankybuddy] warning: age_gate field malformed; dropping\n');
    } else {
      cfg.age_gate = obj.age_gate;
    }
  }

  // bridge is optional. Reject only if present and malformed.
  if (obj.bridge !== undefined) {
    if (!isBridgeConfig(obj.bridge)) {
      process.stderr.write('[clankybuddy] warning: bridge field malformed; dropping\n');
    } else {
      cfg.bridge = obj.bridge;
    }
  }

  return { config: cfg, migrated: false };
}

export async function readConfig(): Promise<Config | null> {
  const path = configPath();
  let raw: string;
  try {
    raw = await fs.readFile(path, 'utf8');
  } catch {
    return null;
  }

  // fs.chmod / fs.stat mode bits are a no-op on Windows (NTFS uses ACLs);
  // skip the check rather than ship a perpetual false-positive warning.
  if (process.platform !== 'win32') {
    try {
      const stats = await fs.stat(path);
      if ((stats.mode & 0o077) !== 0) {
        process.stderr.write(
          `[clankybuddy] warning: ${path} is world-readable; tightening to 0600\n`,
        );
        try {
          await fs.chmod(path, 0o600);
        } catch (err) {
          process.stderr.write(
            `[clankybuddy] warning: chmod 0600 failed: ${err instanceof Error ? err.message : String(err)}\n`,
          );
        }
      }
    } catch (err) {
      process.stderr.write(
        `[clankybuddy] warning: stat failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  const result = parseConfig(raw);
  if (!result) return null;
  if (result.config.version !== CONFIG_VERSION) return null;

  // v1 → v2 transparent persist. Don't gate boot on this; if the disk
  // write fails the in-memory config still works for this session.
  if (result.migrated) {
    try {
      await writeConfig(result.config);
    } catch (err) {
      process.stderr.write(
        `[clankybuddy] warning: failed to persist v2 migration: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  return result.config;
}

export async function writeConfig(config: Config): Promise<void> {
  const path = configPath();
  const dir = dirname(path);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  // mkdir's `mode` is filtered through umask; chmod to guarantee bits on POSIX.
  if (process.platform !== 'win32') {
    try {
      await fs.chmod(dir, 0o700);
    } catch (err) {
      process.stderr.write(
        `[clankybuddy] warning: chmod 0700 on ${dir} failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
  await fs.writeFile(path, JSON.stringify(config, null, 2), { mode: 0o600 });
  // writeFile's `mode` is also filtered through umask; chmod to guarantee bits.
  if (process.platform !== 'win32') {
    try {
      await fs.chmod(path, 0o600);
    } catch (err) {
      process.stderr.write(
        `[clankybuddy] warning: chmod 0600 on ${path} failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}

export async function deleteConfig(): Promise<void> {
  try {
    await fs.unlink(configPath());
  } catch (err) {
    if (err && typeof err === 'object' && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    process.stderr.write(
      `[clankybuddy] warning: failed to delete config: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}
