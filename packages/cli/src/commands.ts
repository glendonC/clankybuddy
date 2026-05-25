import { resolveWebUrl } from './api.js';
import { openInBrowser } from './browser.js';
import {
  bridgeStatePath,
  type BridgeConfig,
  type Config,
  writeConfig,
} from './config.js';
import {
  deleteBridgeState,
  writeInitialBridgeSnapshot,
} from './bridge-poller.js';
import { parseStatsWindow, type StatsWindow } from './me-stats.js';

export type SlashCtx = {
  config: Config;
  printInfo: (texts: string[]) => void;
  flash: (text: string) => void;
  quit: () => void;
  showWelcome: () => void;
  // Opens the full-screen <StatsView> modal anchored to the given window
  // (lifetime / day / week). The user can then arrow-cycle tabs and `r`
  // to change date window inside the modal · this argument only sets the
  // initial state.
  showStats: (win: StatsWindow) => void;
  forceReconnect: () => void;
  // Opens the singleton Settings modal · replaces the previous printInfo
  // dump (which duplicated on each press and was read-only).
  showSettings: () => void;
  // Phase B Cluster G, `/bridge` updates the persisted config and the
  // host (cli.tsx) needs to re-render with the new value AND re-derive
  // the poller. setConfig is the React state setter passed in from
  // chat.tsx; the slash command treats it as opaque.
  setConfig?: (next: Config) => void;
};

export type SlashCommand = {
  name: string;
  aliases?: string[];
  description: string;
  // `input` is the full slash line as typed (e.g. "/bridge enable").
  // Most commands ignore it; ones with sub-args (`/bridge`) parse it.
  // Optional second parameter so existing handlers stay terse.
  run: (ctx: SlashCtx, input?: string) => void;
};

// Default flags for `/bridge enable`. Both true so opting in is
// one command; users who want to keep the file local-only run
// `/bridge share off` afterwards.
const BRIDGE_DEFAULTS: BridgeConfig = {
  enabled: true,
  share_with_assistants: true,
};

// Parse the args after `/bridge`. Returns the action token (`status`,
// `enable`, `disable`, `share`) and any remaining tokens. `status`
// when the user typed bare `/bridge`.
function parseBridgeArgs(input: string): {
  action: 'status' | 'enable' | 'disable' | 'share' | 'unknown';
  rest: string[];
  raw: string;
} {
  const parts = input.trim().split(/\s+/).slice(1); // drop "/bridge"
  if (parts.length === 0) return { action: 'status', rest: [], raw: '' };
  const head = (parts[0] ?? '').toLowerCase();
  if (head === 'enable' || head === 'on') {
    return { action: 'enable', rest: parts.slice(1), raw: parts.join(' ') };
  }
  if (head === 'disable' || head === 'off') {
    return { action: 'disable', rest: parts.slice(1), raw: parts.join(' ') };
  }
  if (head === 'share') {
    return { action: 'share', rest: parts.slice(1), raw: parts.join(' ') };
  }
  if (head === 'status' || head === '') {
    return { action: 'status', rest: parts.slice(1), raw: parts.join(' ') };
  }
  return { action: 'unknown', rest: parts.slice(1), raw: parts.join(' ') };
}

// Emit the bridge status block. Used by bare `/bridge` and as the tail
// of every action so the user always sees what they just changed.
function printBridgeStatus(ctx: SlashCtx, cfg: Config): void {
  const b = cfg.bridge;
  const enabled = b?.enabled ?? false;
  const shared = b?.share_with_assistants ?? false;
  const path = bridgeStatePath(cfg);
  const lines = [
    'AI bridge:',
    `  enabled:               ${enabled ? 'yes' : 'no'}`,
    `  share with assistants: ${shared ? 'yes' : 'no'}`,
    `  state file:            ${path}`,
  ];
  if (b?.granted_at) {
    lines.push(`  granted at:            ${new Date(b.granted_at).toISOString()}`);
  }
  if (!enabled) {
    lines.push('  enable with: /bridge enable');
  }
  ctx.printInfo(lines);
}

async function runBridgeEnable(ctx: SlashCtx): Promise<void> {
  const next: Config = {
    ...ctx.config,
    bridge: {
      ...BRIDGE_DEFAULTS,
      granted_at: Date.now(),
      // Carry forward any custom state_path the user set.
      ...(ctx.config.bridge?.state_path
        ? { state_path: ctx.config.bridge.state_path }
        : {}),
    },
  };
  try {
    await writeConfig(next);
  } catch (err) {
    ctx.flash(
      `bridge enable failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  ctx.setConfig?.(next);

  // Write a first snapshot now so the file appears immediately, before
  // the first poll tick. AI tools that race the poller see a populated
  // file, not an empty one.
  try {
    await writeInitialBridgeSnapshot(next);
  } catch (err) {
    ctx.flash(
      `bridge enabled, but first write failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    // Don't return, the poller will recover next tick. Status print
    // below still useful so the user knows the flag is on.
  }

  ctx.printInfo([
    'AI bridge ENABLED.',
    `  state file: ${bridgeStatePath(next)}`,
    '  permissions: 0600 (your user only, local file, never sent anywhere)',
    '  poll cadence: every 5 seconds',
    '  consent flags written into the file: bridge_enabled, share_with_assistants',
    '  toggle assistant access: /bridge share on|off',
    '  turn off: /bridge disable',
  ]);
}

async function runBridgeDisable(ctx: SlashCtx): Promise<void> {
  const next: Config = {
    ...ctx.config,
    bridge: {
      ...(ctx.config.bridge ?? BRIDGE_DEFAULTS),
      enabled: false,
      share_with_assistants: false,
    },
  };
  try {
    await writeConfig(next);
  } catch (err) {
    ctx.flash(
      `bridge disable failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  ctx.setConfig?.(next);

  // Best-effort delete. ENOENT is fine (already gone). Other errors
  // are logged inside deleteBridgeState; we don't bubble them, the
  // bridge is disabled in config either way, so the next start-up
  // won't bring it back.
  await deleteBridgeState(bridgeStatePath(next));

  ctx.printInfo([
    'AI bridge DISABLED.',
    '  state file deleted (best-effort)',
    '  no further polls, re-enable any time with /bridge enable',
  ]);
}

async function runBridgeShare(ctx: SlashCtx, value: 'on' | 'off'): Promise<void> {
  // `/bridge share on|off` only makes sense when the bridge is
  // enabled, the file isn't being written otherwise. Print a hint
  // rather than silently flipping a flag the user can't observe.
  if (!ctx.config.bridge?.enabled) {
    ctx.printInfo([
      'AI bridge is currently DISABLED.',
      '  /bridge share on|off only takes effect when the bridge is enabled.',
      '  enable first with: /bridge enable',
    ]);
    return;
  }
  const next: Config = {
    ...ctx.config,
    bridge: {
      ...ctx.config.bridge,
      share_with_assistants: value === 'on',
    },
  };
  try {
    await writeConfig(next);
  } catch (err) {
    ctx.flash(
      `bridge share toggle failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  ctx.setConfig?.(next);
  // Don't write a fresh snapshot here, the poller will pick up the
  // new flag on its next tick (≤5s) and overwrite the file. Forcing
  // a write now would race with an in-flight tick.
  printBridgeStatus(ctx, next);
}

function runBridge(ctx: SlashCtx, input: string): void {
  const parsed = parseBridgeArgs(input);
  if (parsed.action === 'status') {
    printBridgeStatus(ctx, ctx.config);
    return;
  }
  if (parsed.action === 'enable') {
    void runBridgeEnable(ctx);
    return;
  }
  if (parsed.action === 'disable') {
    void runBridgeDisable(ctx);
    return;
  }
  if (parsed.action === 'share') {
    const v = (parsed.rest[0] ?? '').toLowerCase();
    if (v === 'on' || v === 'off') {
      void runBridgeShare(ctx, v);
      return;
    }
    ctx.printInfo([
      'usage: /bridge share on  , assistants may read the state file',
      '       /bridge share off , assistants should ignore the state file',
    ]);
    return;
  }
  ctx.printInfo([
    'unknown /bridge sub-command. Try one of:',
    '  /bridge                , show status',
    '  /bridge enable         , start writing ~/.clankybuddy/state.json',
    '  /bridge disable        , stop and delete the file',
    '  /bridge share on|off   , toggle the share_with_assistants flag',
  ]);
}

export const COMMANDS: SlashCommand[] = [
  {
    name: 'help',
    description: 'show this list',
    run: (ctx) => {
      ctx.printInfo([
        'Commands:',
        ...COMMANDS.map((c) => `  /${c.name.padEnd(10)} ${c.description}`),
        'Keys: ctrl+g (open game), ctrl+p (settings), ctrl+c (quit), esc (clear input)',
      ]);
    },
  },
  {
    name: 'game',
    description: 'open the web game in your browser',
    run: (ctx) => {
      const url = resolveWebUrl();
      openInBrowser(url);
      ctx.flash(`opened ${url}`);
    },
  },
  {
    name: 'whoami',
    description: 'show your handle and color',
    run: (ctx) => {
      ctx.printInfo([`${ctx.config.handle} (${ctx.config.color}), ${ctx.config.user_id}`]);
    },
  },
  {
    name: 'settings',
    aliases: ['s'],
    description: 'open the settings panel',
    run: (ctx) => ctx.showSettings(),
  },
  {
    name: 'welcome',
    description: 'show the splash screen again',
    run: (ctx) => ctx.showWelcome(),
  },
  {
    name: 'reconnect',
    aliases: ['r'],
    description: 'force a reconnect to the chat server',
    run: (ctx) => {
      ctx.forceReconnect();
      ctx.flash('reconnecting…');
    },
  },
  {
    name: 'bridge',
    description: 'AI-feedback bridge: status / enable / disable / share on|off',
    // `input` carries sub-args ("/bridge enable", "/bridge share off").
    // findCommand splits on whitespace and looks at the head; the
    // tail comes through here.
    run: (ctx, input) => runBridge(ctx, input ?? '/bridge'),
  },
  {
    name: 'stats',
    description: 'your game stats · /stats [day|week|lifetime]',
    run: (ctx, input) => {
      const arg = (input ?? '/stats').split(/\s+/)[1];
      const win = parseStatsWindow(arg);
      if (!win) {
        ctx.printInfo([
          'usage: /stats           · lifetime totals',
          '       /stats day       · last 24h',
          '       /stats week      · last 7d',
        ]);
        return;
      }
      ctx.showStats(win);
    },
  },
  {
    name: 'quit',
    aliases: ['exit'],
    description: 'exit clankybuddy',
    run: (ctx) => ctx.quit(),
  },
];

export function findCommand(input: string): SlashCommand | undefined {
  const name = input.slice(1).split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!name) return undefined;

  // 1. Exact match on name or alias.
  const exact = COMMANDS.find(
    (c) => c.name === name || (c.aliases?.includes(name) ?? false),
  );
  if (exact) return exact;

  // 2. Unique prefix match. Only run if exactly one command starts with the typed prefix.
  const prefixMatches = COMMANDS.filter(
    (c) =>
      c.name.startsWith(name) ||
      (c.aliases?.some((a) => a.startsWith(name)) ?? false),
  );
  if (prefixMatches.length === 1) return prefixMatches[0];

  // 3. Ambiguous (e.g. "/w" matches both welcome + whoami), caller will surface an error.
  return undefined;
}

export function filterCommands(input: string): SlashCommand[] {
  if (!input.startsWith('/')) return [];
  const partial = input.slice(1).toLowerCase();
  if (partial === '') return COMMANDS;
  return COMMANDS.filter(
    (c) =>
      c.name.startsWith(partial) ||
      (c.aliases?.some((a) => a.startsWith(partial)) ?? false),
  );
}
