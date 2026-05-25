// Welcome hub — shown after age-gate / verify completes, on every boot.
//
// Why a hub instead of a press-any-key splash:
//   - Surfaces the user's handle prominently (it's the only persistent
//     identity in the anonymous-account model).
//   - Gives the screen real work to do — opens the browser to the web
//     app, lets you re-roll your identity, or drops you into chat.
//   - Keeps the speed of the common path: Global Chat is the default
//     selection, so Enter still enters chat in one keystroke.
//
// Layout:
//   <username>            ← big shimmer, AI-palette wave (ShimmerTitle)
//   clankybuddy · …       ← brand demoted to subtitle, plain white
//   ─────────────
//   [ Global Chat ]       ← vertical menu, age-gate Pill style
//   [ Open Web App ]
//   [ Switch Identity ]
//   ↑↓ choose · Enter open · Esc quit
//
// Keybinds:
//   ↑ ↓ / k j   move highlight
//   Enter / Space   activate highlighted action
//   1 / 2 / 3   jump-activate by index
//   Esc / Q / Ctrl-C / Ctrl-D   quit the TUI
//
// Switch-Identity confirm screen: a 1-step "are you sure" Yes/No flow
// before clearing config — accidental reset = lost handle.

import { spawn } from 'child_process';
import { Box, Text, useApp, useInput } from 'ink';
import { useState } from 'react';
import { resolveWebUrl } from './api.js';
import { colorOf } from './colors.js';
import type { Config } from './config.js';
import { ShimmerTitle } from './shimmer-title.js';

type Action = 'chat' | 'stats' | 'web' | 'new-handle';
type Screen = 'menu' | 'confirm-new-handle';

const ACTIONS: { id: Action; label: string }[] = [
  { id: 'chat', label: 'Global Chat' },
  { id: 'stats', label: 'Stats' },
  { id: 'web', label: 'Open Web App' },
  { id: 'new-handle', label: 'New Handle' },
];

// Right-pad labels to the longest label length + 2 so the [N] shortcuts
// line up vertically. Computed at module load — list is static.
const LABEL_WIDTH = Math.max(...ACTIONS.map((a) => a.label.length)) + 2;

// Cross-platform "open this URL in the default browser." Spawns detached
// + ignores stdio so the child doesn't tether the TUI's lifecycle. We
// don't await — the user's browser launches in the background while the
// TUI keeps rendering.
function openInBrowser(url: string): void {
  const platform = process.platform;
  let cmd: string;
  let args: string[];
  if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    // Browser launch failed silently. User can still copy the URL from
    // the visible subtitle or relaunch manually. Surface nothing — a
    // crash here would be worse than a no-op.
  }
}

export function Welcome({
  config,
  onContinue,
  onSwitchIdentity,
  onShowStats,
}: {
  config: Config;
  onContinue: () => void;
  onSwitchIdentity: () => void;
  // Opens the StatsView modal directly from the hub · Welcome closes itself
  // and the host (chat.tsx) routes the user into stats. Treated as optional
  // so callers that don't wire stats degrade gracefully (the menu row is
  // still rendered, but a press becomes a no-op).
  onShowStats?: () => void;
}) {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>('menu');
  const [cursor, setCursor] = useState<number>(0); // index into ACTIONS

  const activate = (id: Action) => {
    if (id === 'chat') {
      onContinue();
      return;
    }
    if (id === 'stats') {
      onShowStats?.();
      return;
    }
    if (id === 'web') {
      openInBrowser(resolveWebUrl());
      // Stay on the hub — the user might want to launch chat next.
      return;
    }
    if (id === 'new-handle') {
      setScreen('confirm-new-handle');
      return;
    }
  };

  useInput((char, key) => {
    if (key.ctrl && (char === 'c' || char === 'd')) {
      exit();
      return;
    }

    if (screen === 'confirm-new-handle') {
      if (char === 'y' || char === 'Y' || key.return) {
        onSwitchIdentity();
        return;
      }
      if (char === 'n' || char === 'N' || key.escape) {
        setScreen('menu');
        return;
      }
      return;
    }

    // menu screen
    if (key.escape || char === 'q' || char === 'Q') {
      exit();
      return;
    }
    if (key.upArrow || char === 'k') {
      setCursor((c) => (c - 1 + ACTIONS.length) % ACTIONS.length);
      return;
    }
    if (key.downArrow || char === 'j') {
      setCursor((c) => (c + 1) % ACTIONS.length);
      return;
    }
    // Number shortcuts (1/2/3) jump-activate.
    const numIdx = ACTIONS.findIndex((_, i) => char === String(i + 1));
    if (numIdx >= 0) {
      setCursor(numIdx);
      activate(ACTIONS[numIdx]!.id);
      return;
    }
    if (key.return || char === ' ') {
      activate(ACTIONS[cursor]!.id);
      return;
    }
  });

  if (screen === 'confirm-new-handle') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={2} paddingY={1}>
        <Text bold>Get a new handle?</Text>
        <Box marginTop={1}>
          <Text>You'll lose </Text>
          <Text color={colorOf(config.color)} bold>{config.handle}</Text>
          <Text> and get a randomly-rolled one. Chat history persists on the server.</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="white">Y confirm  ·  N / Esc cancel</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={2} paddingY={1}>
      <ShimmerTitle text={config.handle} />

      <Box marginTop={1} flexDirection="column">
        {ACTIONS.map((a, i) => (
          <MenuRow
            key={a.id}
            label={a.label}
            shortcut={String(i + 1)}
            selected={i === cursor}
          />
        ))}
      </Box>

      <Box marginTop={1}>
        <Text color="white">↑↓ choose  ·  Enter open  ·  Esc quit</Text>
      </Box>
    </Box>
  );
}

// Single-row menu item. No background fills (terminal themes render
// `blackBright` inconsistently — frequently as near-white over dark BG —
// which makes pill-style buttons look broken). Instead: a leading caret
// on the selected row + bold cyan label, plain dim row for unselected.
// Labels are right-padded to LABEL_WIDTH so the [N] shortcuts align
// vertically across the list.
function MenuRow({
  label,
  shortcut,
  selected,
}: {
  label: string;
  shortcut: string;
  selected: boolean;
}) {
  const padded = label.padEnd(LABEL_WIDTH, ' ');
  if (selected) {
    return (
      <Text color="cyan" bold>
        {`▸ ${padded}[${shortcut}]`}
      </Text>
    );
  }
  return (
    <Text color="gray">
      {`  ${padded}[${shortcut}]`}
    </Text>
  );
}
