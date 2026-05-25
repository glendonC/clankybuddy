// Settings modal · replaces the previous /settings printInfo dump, which
// (a) duplicated output every time the command ran and (b) was read-only.
// This panel is a singleton overlay (no accumulation), with at least one
// inline-editable surface (bridge toggles) and shortcuts for the actions
// that already live elsewhere (re-roll handle, edit config in $EDITOR).

import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useState } from 'react';
import { spawn } from 'child_process';
import {
  bridgeStatePath,
  configPath,
  writeConfig,
  type Config,
} from '../config.js';
import {
  deleteBridgeState,
  writeInitialBridgeSnapshot,
} from '../bridge-poller.js';

type Row =
  | { id: 'handle';   label: string; value: string; action: 'reroll' }
  | { id: 'color';    label: string; value: string; action: 'note-handle' }
  | { id: 'bridge';   label: string; value: string; action: 'toggle-bridge' }
  | { id: 'share';    label: string; value: string; action: 'toggle-share' }
  | { id: 'api';      label: string; value: string; action: null }
  | { id: 'config';   label: string; value: string; action: 'open-editor' };

export function SettingsView({
  config,
  onClose,
  onConfigChange,
  onRerollIdentity,
}: {
  config: Config;
  onClose: () => void;
  // Slash commands that mutate config (bridge toggles) call this so the
  // host (chat.tsx) re-renders with the new value AND any side-effect
  // pollers can re-derive themselves.
  onConfigChange?: (next: Config) => void;
  // Routes through the existing "Switch Identity" pipe · clears local
  // creds and re-bootstraps. The modal shows a confirm before triggering
  // this so accidental Enter doesn't blow up the account.
  onRerollIdentity: () => void;
}) {
  const { stdout } = useStdout();
  const { exit } = useApp();
  const [cursor, setCursor] = useState(0);
  // Confirmation state for re-roll · we don't reuse Welcome's confirm
  // because it'd require routing through Chat's showWelcome path; this is
  // a tighter inline confirm.
  const [confirm, setConfirm] = useState<null | 'reroll'>(null);
  const [flash, setFlash] = useState('');

  const showFlash = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash((m) => (m === msg ? '' : m)), 2500);
  };

  const rows: Row[] = [
    {
      id: 'handle',
      label: 'Handle',
      value: config.handle,
      action: 'reroll',
    },
    {
      id: 'color',
      label: 'Color',
      value: config.color,
      action: 'note-handle',
    },
    {
      id: 'bridge',
      label: 'AI bridge',
      value: config.bridge?.enabled ? 'enabled' : 'disabled',
      action: 'toggle-bridge',
    },
    {
      id: 'share',
      label: 'Share with assistants',
      value: config.bridge?.enabled
        ? (config.bridge?.share_with_assistants ? 'on' : 'off')
        : 'n/a, bridge is off',
      action: 'toggle-share',
    },
    {
      id: 'api',
      label: 'API base',
      value: config.api_base,
      action: null,
    },
    {
      id: 'config',
      label: 'Config file',
      value: configPath(),
      action: 'open-editor',
    },
  ];

  const activate = async (row: Row) => {
    if (confirm === 'reroll') return;
    if (row.action === 'reroll') {
      setConfirm('reroll');
      return;
    }
    if (row.action === 'note-handle') {
      showFlash(
        'color is assigned with your handle, re-roll handle to get a new one',
      );
      return;
    }
    if (row.action === 'toggle-bridge') {
      const next: Config = {
        ...config,
        bridge: {
          ...(config.bridge ?? {
            enabled: false,
            share_with_assistants: true,
          }),
          enabled: !(config.bridge?.enabled ?? false),
          granted_at: config.bridge?.granted_at ?? Date.now(),
        },
      };
      try {
        await writeConfig(next);
        if (next.bridge?.enabled) {
          await writeInitialBridgeSnapshot(next).catch(() => undefined);
        } else {
          await deleteBridgeState(bridgeStatePath(next));
        }
        onConfigChange?.(next);
        showFlash(`bridge ${next.bridge?.enabled ? 'enabled' : 'disabled'}`);
      } catch (err) {
        showFlash(
          `bridge toggle failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }
    if (row.action === 'toggle-share') {
      if (!config.bridge?.enabled) {
        showFlash('enable bridge first, share flag only matters when on');
        return;
      }
      const next: Config = {
        ...config,
        bridge: {
          ...config.bridge,
          share_with_assistants: !config.bridge.share_with_assistants,
        },
      };
      try {
        await writeConfig(next);
        onConfigChange?.(next);
        showFlash(
          `share with assistants ${next.bridge?.share_with_assistants ? 'on' : 'off'}`,
        );
      } catch (err) {
        showFlash(
          `share toggle failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }
    if (row.action === 'open-editor') {
      const editor = process.env.VISUAL || process.env.EDITOR || 'vi';
      try {
        const child = spawn(editor, [configPath()], {
          stdio: 'inherit',
          detached: false,
        });
        child.on('exit', () => {
          showFlash('config edits will apply on next launch, /reconnect or restart');
        });
      } catch (err) {
        showFlash(
          `couldn't launch ${editor}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }
  };

  useInput((char, key) => {
    if (key.ctrl && (char === 'c' || char === 'd')) {
      exit();
      return;
    }
    if (confirm === 'reroll') {
      if (char === 'y' || char === 'Y' || key.return) {
        onRerollIdentity();
        return;
      }
      if (char === 'n' || char === 'N' || key.escape) {
        setConfirm(null);
        return;
      }
      return;
    }
    if (key.escape || char === 'q') {
      onClose();
      return;
    }
    if (key.upArrow || char === 'k') {
      setCursor((c) => (c - 1 + rows.length) % rows.length);
      return;
    }
    if (key.downArrow || char === 'j') {
      setCursor((c) => (c + 1) % rows.length);
      return;
    }
    if (key.return || char === ' ') {
      void activate(rows[cursor]!);
      return;
    }
  });

  const cols = stdout?.columns ?? 80;
  const modalWidth = Math.min(80, cols);

  if (confirm === 'reroll') {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={2}
        paddingY={1}
        width={modalWidth}
      >
        <Text bold>Get a new handle?</Text>
        <Box marginTop={1}>
          <Text>You'll lose </Text>
          <Text bold>{config.handle}</Text>
          <Text> and get a fresh handle + color. Chat history persists on the server.</Text>
        </Box>
        <Box marginTop={1}>
          <Text>
            <Text color="cyan">[Y]</Text>
            <Text color="gray"> confirm   </Text>
            <Text color="cyan">[N]</Text>
            <Text color="gray"> / </Text>
            <Text color="cyan">[esc]</Text>
            <Text color="gray"> cancel</Text>
          </Text>
        </Box>
      </Box>
    );
  }

  // Pad labels to the same width so values align in a single column.
  const labelW = Math.max(...rows.map((r) => r.label.length)) + 2;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={2}
      paddingY={1}
      width={modalWidth}
    >
      <Text bold>Settings</Text>

      <Box marginTop={1} flexDirection="column">
        {rows.map((row, i) => {
          const selected = i === cursor;
          const labelPadded = padEnd(`${row.label}:`, labelW);
          const editableHint =
            row.action === 'toggle-bridge' || row.action === 'toggle-share'
              ? '  [toggle]'
              : row.action === 'reroll'
                ? '  [re-roll]'
                : row.action === 'open-editor'
                  ? '  [open in $EDITOR]'
                  : '';
          if (selected) {
            return (
              <Text key={row.id}>
                <Text color="cyan" bold>▸ </Text>
                <Text color="cyan" bold>{labelPadded}</Text>
                <Text>{row.value}</Text>
                <Text color="gray">{editableHint}</Text>
              </Text>
            );
          }
          return (
            <Text key={row.id}>
              <Text>  </Text>
              <Text color="gray">{labelPadded}</Text>
              <Text>{row.value}</Text>
            </Text>
          );
        })}
      </Box>

      {flash ? (
        <Box marginTop={1}>
          <Text color="yellow">{flash}</Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text>
          <Text color="cyan">[↑↓]</Text>
          <Text color="gray"> select   </Text>
          <Text color="cyan">[enter]</Text>
          <Text color="gray"> activate   </Text>
          <Text color="cyan">[esc]</Text>
          <Text color="gray"> back to chat</Text>
        </Text>
      </Box>
    </Box>
  );
}

function padEnd(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}
