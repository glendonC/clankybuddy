import { Box, Text, useApp, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type {
  ChatMessage,
  ServerEvent,
  SystemEventCode,
} from '../../shared/src/chat.js';
import { ApiError, resolveWebUrl } from './api.js';
import { authWsTicket, getValidAccessToken } from './auth.js';
import { openInBrowser } from './browser.js';
import { colorOf } from './colors.js';
import { type SlashCommand, type SlashCtx, filterCommands, findCommand } from './commands.js';
import { CHAT_MAX_MESSAGE_LENGTH } from './constants.js';
import { type Config, writeConfig } from './config.js';
import { Welcome } from './welcome.js';
import { StatsView } from './stats/view.js';
import { SettingsView } from './settings/view.js';
import type { StatsWindow } from './me-stats.js';
import {
  type ChatClient,
  type ConnectionStatus,
  createChatClient,
} from './ws.js';
import { isDemoMode } from './demo/index.js';
import { createMockChatClient } from './demo/mock-ws.js';

type Line =
  | {
      kind: 'message';
      handle: string;
      color: string;
      content: string;
      timestamp: string;
      msg_id?: string;
    }
  | { kind: 'join'; content: string }
  | { kind: 'leave'; content: string }
  | { kind: 'info'; content: string };

// Cap the in-memory line buffer. Long-running sessions would otherwise grow
// unbounded — every join/leave/message accumulates. 200 is well above what
// MessageList renders (slice(-20)) but leaves headroom for a future scroll
// feature without making this a tuning knob.
const MAX_LINES = 200;

export function Chat({
  config,
  onTokenRejected,
  onSessionRevoked,
  onConfigChange,
  initialStats,
}: {
  config: Config;
  onTokenRejected: () => Promise<void>;
  // Distinct from onTokenRejected: invoked when the worker explicitly
  // tells us a session is revoked (system event, code: 'session_revoked').
  // Caller routes the user back to the verify phase.
  onSessionRevoked?: () => void;
  // Slash commands that mutate the persisted config (`/bridge enable`)
  // call this so the host (cli.tsx) can re-render with the new
  // value AND start/stop the bridge poller. Optional — the chat
  // surface itself doesn't depend on it.
  onConfigChange?: (next: Config) => void;
  // When set, the stats modal opens immediately after mount with the
  // given window. Used to route boot-time Welcome→Stats into Chat which
  // owns the modal surface. Only consulted at first mount · prop changes
  // after mount don't re-open.
  initialStats?: StatsWindow | null;
}) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [roomCount, setRoomCount] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [statusLine, setStatusLine] = useState('');
  const [input, setInput] = useState('');
  // Cursor index into the SuggestionsBar's filtered match list. Reset to 0
  // whenever the input (and therefore the match list) changes — see the
  // useEffect below.
  const [suggestCursor, setSuggestCursor] = useState(0);
  const [showingWelcome, setShowingWelcome] = useState(false);
  // null = not open. When set, the stats modal is rendered instead of the
  // chat view. The initial window comes from /stats [arg] · the modal can
  // cycle internally without changing this seed.
  const [statsInitialWindow, setStatsInitialWindow] = useState<StatsWindow | null>(
    initialStats ?? null,
  );
  const [showingSettings, setShowingSettings] = useState(false);
  const clientRef = useRef<ChatClient | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror of the live config prop. The WS effect depends on api_base only
  // (re-mounting on token rotation would teardown + reconnect noisily, and
  // with the proactive 80%-of-TTL refresh the access_token field is rotated
  // mid-session). The ref lets getTicket / makeSlashCtx read current values
  // without forcing a useEffect re-run.
  const configRef = useRef(config);
  configRef.current = config;
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;

  const flash = (text: string) => {
    setStatusLine(text);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => setStatusLine(''), 3000);
  };

  const printInfo = (texts: string[]) => {
    setLines((prev) => [...prev, ...texts.map((t) => ({ kind: 'info' as const, content: t }))]);
  };

  const quit = () => {
    clientRef.current?.close();
    exit();
  };

  useEffect(() => {
    const getTicket = async () => {
      try {
        // Proactive refresh: if access_token is older than 80% of TTL and
        // we have a refresh_token, swap to a fresh one *before* the
        // ws-ticket call. getValidAccessToken persists the rotated pair.
        const access = await getValidAccessToken(configRef.current, writeConfig);
        // Wire api.ts's onUnauthorized hook: a 401 from /auth/ws-ticket
        // triggers a single retry with a force-refreshed access token.
        // If that retry also 401s (or the refresh fails), the original
        // ApiError propagates and we route to onTokenRejected below.
        return (
          await authWsTicket(configRef.current.api_base, access, {
            onUnauthorized: async () =>
              getValidAccessToken(configRef.current, writeConfig, { force: true }),
          })
        ).ticket;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          // Only treat this as a true token rejection when the worker
          // emits its explicit `unauthorized` body. Transient 401s
          // (cold-boot, WAF, proxy 401, network shim) lack the structured
          // body — keep those in the WS reconnect loop instead of nuking
          // the user's account. (See docs/tui.md §Connect flow.)
          if (isExplicitTokenRejection(err)) {
            await onTokenRejected();
          }
        }
        throw err;
      }
    };

    const apiBase = configRef.current.api_base;
    const wsEvents = {
      onStatus: setStatus,
      onEvent: (event: ServerEvent) =>
        handleEvent(event, setLines, setRoomCount, flash),
      onError: (err: Error) => {
        // Pre-first-connect errors are user-actionable (likely DNS / offline);
        // surface them. Post-connect errors are flap noise on flaky networks
        // and would spam the status line — keep them out of band.
        if (!client.hasConnectedOnce()) {
          flash('unable to reach clankybuddy.com · retrying…');
        } else {
          process.stderr.write(`[ws] ${err.message}\n`);
        }
      },
      onTokenRejected: (code: SystemEventCode) => {
        if (code === 'session_revoked') {
          flash('your session was revoked · re-verifying…');
          onSessionRevoked?.();
        }
      },
    };
    const client = isDemoMode()
      ? createMockChatClient(configRef.current, wsEvents)
      : createChatClient(apiBase, getTicket, wsEvents);
    clientRef.current = client;
    return () => {
      client.close();
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
    // configRef.current is read inside getTicket so token rotation does NOT
    // force a WS teardown. api_base is the only field whose change should
    // re-mount the client (e.g. after deleteConfig + authInit).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.api_base, onTokenRejected, onSessionRevoked]);

  const makeSlashCtx = (): SlashCtx => ({
    // Read via configRef so a slash command (/whoami, /settings) sees the
    // latest token-rotated config, not whatever was captured when this
    // closure last rebuilt.
    config: configRef.current,
    printInfo,
    flash,
    quit,
    showWelcome: () => setShowingWelcome(true),
    showStats: (win) => setStatsInitialWindow(win),
    showSettings: () => setShowingSettings(true),
    forceReconnect: () => clientRef.current?.forceReconnect(),
    // /bridge enable|disable|share calls setConfig with a freshly-
    // persisted v3 Config. Forwarding to onConfigChange lets cli.tsx
    // re-derive the bridge poller (start/stop) on the same render.
    setConfig: onConfigChange,
  });

  const isSlashing = input.startsWith('/');
  const matches = isSlashing ? filterCommands(input) : [];

  // Reset the picker cursor whenever the match list could have changed.
  // Clamping (instead of zeroing) would survive incremental filtering, but
  // the user model is "I typed something new, start from the top" — same
  // semantics as the welcome hub cursor.
  useEffect(() => {
    setSuggestCursor(0);
  }, [input]);

  // Hotkeys stay active even while welcome is showing so Ctrl+P / Ctrl+G /
  // Ctrl+C work from a recalled welcome card. Welcome's own useInput passes
  // modifier-combo keys through to this handler (see welcome.tsx).
  useInput((char, key) => {
    if (key.ctrl && (char === 'c' || char === 'd')) {
      quit();
      return;
    }
    if (key.ctrl && char === 'g') {
      const url = resolveWebUrl();
      openInBrowser(url);
      flash(`opened ${url}`);
      return;
    }
    if (key.ctrl && char === 'p') {
      setShowingSettings(true);
      return;
    }
    if (key.ctrl && char === 's') {
      // Open stats with the most useful default · lifetime totals. Inside
      // the modal `r` cycles to last-7-days / last-24h.
      setStatsInitialWindow('lifetime');
      return;
    }
    // Esc only meaningful when the input is rendered (chat view).
    if (key.escape && !showingWelcome) {
      setInput('');
      return;
    }
    // Slash picker navigation. Active only while the input begins with "/"
    // AND there are matches to navigate. TextInput owns left/right + Enter;
    // up/down + Tab pass through to here.
    if (isSlashing && matches.length > 0 && !showingWelcome) {
      if (key.upArrow) {
        setSuggestCursor((c) => (c - 1 + matches.length) % matches.length);
        return;
      }
      if (key.downArrow) {
        setSuggestCursor((c) => (c + 1) % matches.length);
        return;
      }
      if (key.tab) {
        // Autocomplete the highlighted command name into the input. Append
        // a trailing space so the user can type sub-args (`/bridge enable`)
        // without an extra keystroke. Doesn't run the command.
        const picked = matches[suggestCursor] ?? matches[0];
        if (picked) setInput(`/${picked.name} `);
        return;
      }
    }
  });

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    if (trimmed.startsWith('/')) {
      // If the picker is showing matches, Enter selects the highlighted
      // row — even when the typed prefix is ambiguous (`/w` matching both
      // welcome + whoami). The cursor is the user's disambiguation.
      const picker = filterCommands(trimmed);
      const picked = picker[suggestCursor] ?? picker[0];
      const cmd = picked ?? findCommand(trimmed);
      if (cmd) {
        // Preserve any sub-args the user typed after the command name.
        // `/bridge enable` → keep "enable"; bare `/b` (resolved to bridge)
        // → just run with the resolved name.
        const tail = trimmed.split(/\s+/).slice(1).join(' ');
        const dispatch = tail ? `/${cmd.name} ${tail}` : `/${cmd.name}`;
        cmd.run(makeSlashCtx(), dispatch);
      } else {
        flash(`unknown command: ${trimmed.split(/\s+/)[0]} · try /help`);
      }
      setInput('');
      return;
    }

    if (trimmed.length > CHAT_MAX_MESSAGE_LENGTH) {
      flash(`message too long: ${trimmed.length}/${CHAT_MAX_MESSAGE_LENGTH}`);
      return;
    }
    clientRef.current?.send(trimmed);
    setInput('');
  };

  if (showingWelcome) {
    return (
      <Welcome
        config={config}
        onContinue={() => setShowingWelcome(false)}
        // Reuse the session-revoked handler — semantically identical:
        // clear local credentials, bootstrap a new anonymous identity.
        // The Welcome hub's confirm screen gates accidental presses.
        onSwitchIdentity={() => onSessionRevoked?.()}
        onShowStats={() => {
          setShowingWelcome(false);
          setStatsInitialWindow('lifetime');
        }}
      />
    );
  }

  if (statsInitialWindow !== null) {
    return (
      <StatsView
        config={config}
        initialWindow={statsInitialWindow}
        onClose={() => setStatsInitialWindow(null)}
      />
    );
  }

  if (showingSettings) {
    return (
      <SettingsView
        config={config}
        onClose={() => setShowingSettings(false)}
        onConfigChange={onConfigChange}
        onRerollIdentity={() => {
          setShowingSettings(false);
          onSessionRevoked?.();
        }}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Header status={status} roomCount={roomCount} />
      <MessageList lines={lines} ownHandle={config.handle} />
      <InputBar
        input={input}
        setInput={setInput}
        onSubmit={handleSubmit}
        statusLine={statusLine}
      />
      {isSlashing ? (
        <SuggestionsBar matches={matches} cursor={suggestCursor} />
      ) : statusLine ? null : (
        <ActionBar cols={cols} />
      )}
    </Box>
  );
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function useSpinner(active: boolean): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 90);
    return () => clearInterval(id);
  }, [active]);
  return SPINNER_FRAMES[frame] ?? '⠋';
}

function Header({
  status,
  roomCount,
}: {
  status: ConnectionStatus;
  roomCount: number;
}) {
  const spinner = useSpinner(status === 'reconnecting');

  let stateNode: React.ReactNode;
  if (status === 'connected') {
    stateNode = <Text color="green">◉ connected</Text>;
  } else if (status === 'reconnecting') {
    stateNode = <Text color="yellow">{spinner} reconnecting…</Text>;
  } else if (status === 'disconnected') {
    stateNode = <Text color="red">✕ disconnected</Text>;
  } else if (status === 'outdated') {
    // Server rejected our hello — wire shape mismatch. We don't reconnect
    // because the next attempt would land on the same wall; user upgrades.
    stateNode = <Text color="red">✕ client outdated · please upgrade clankybuddy</Text>;
  } else {
    stateNode = <Text color="gray">◌ connecting…</Text>;
  }

  return (
    <Box paddingX={1}>
      <Text>
        <Text bold>room-global</Text>
        <Text color="gray"> · </Text>
        <Text>{roomCount} online</Text>
        <Text color="gray"> · </Text>
        {stateNode}
      </Text>
    </Box>
  );
}

function MessageList({ lines, ownHandle }: { lines: Line[]; ownHandle: string }) {
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} minHeight={8}>
      {lines.length === 0 ? (
        <Box flexDirection="column">
          <Text color="gray">the room is quiet right now.</Text>
          <Text color="gray">say hi, or press [Ctrl+G] to open the web game.</Text>
        </Box>
      ) : (
        lines.slice(-20).map((line, i) => (
          <RenderLine key={i} line={line} ownHandle={ownHandle} />
        ))
      )}
    </Box>
  );
}

function RenderLine({ line, ownHandle }: { line: Line; ownHandle: string }) {
  if (line.kind === 'message') {
    const isOwn = line.handle === ownHandle;
    if (isOwn) {
      // Spec (docs/tui.md:148): "own messages get an inverse-rendered
      // [hh:mm] handle: prefix; the message body is rendered unchanged."
      // Square brackets around the time, single space between time and
      // handle, trailing space inside the inverse run separating prefix
      // from body — body itself carries no leading whitespace so it
      // renders "unchanged" per spec.
      return (
        <Text>
          <Text inverse>[{formatTime(line.timestamp)}] {line.handle}: </Text>
          <Text>{line.content}</Text>
        </Text>
      );
    }
    return (
      <Text>
        <Text color="gray" dimColor>{formatTime(line.timestamp)}  </Text>
        <Text color={colorOf(line.color)} bold>{line.handle}</Text>
        <Text>  {line.content}</Text>
      </Text>
    );
  }
  if (line.kind === 'info') {
    return (
      <Text>
        <Text color="cyan">·  </Text>
        <Text color="gray">{line.content}</Text>
      </Text>
    );
  }
  return <Text color="gray" dimColor>·  {line.content}</Text>;
}

function InputBar({
  input,
  setInput,
  onSubmit,
  statusLine,
}: {
  input: string;
  setInput: (v: string) => void;
  onSubmit: (v: string) => void;
  statusLine: string;
}) {
  const overLimit = input.length > CHAT_MAX_MESSAGE_LENGTH;
  const showCount = input.length > 240;

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="gray" paddingX={1}>
        <Text color="gray">❯ </Text>
        <Box flexGrow={1}>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={onSubmit}
            placeholder="type a message or / for commands"
          />
        </Box>
        {showCount ? (
          <Text color={overLimit ? 'red' : 'gray'}>
            {' '}{input.length}/{CHAT_MAX_MESSAGE_LENGTH}
          </Text>
        ) : null}
      </Box>
      {statusLine ? (
        <Box paddingX={2}>
          <Text color="yellow">{statusLine}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function ActionBar({ cols }: { cols: number }) {
  // Single Text run so the terminal wraps it as one string, not per-element.
  // /commands intentionally absent · already hinted in the input placeholder.
  // Stats is the new headline action, lead with it; game/settings shift right.
  const wide = cols >= 60;
  const extraWide = cols >= 80;

  return (
    <Box paddingX={2}>
      <Text>
        <Text color="cyan">[Ctrl+S]</Text>
        <Text color="gray"> stats</Text>
        <Text>   </Text>
        <Text color="cyan">[Ctrl+G]</Text>
        <Text color="gray"> game</Text>
        {wide ? (
          <>
            <Text>   </Text>
            <Text color="cyan">[Ctrl+P]</Text>
            <Text color="gray"> settings</Text>
          </>
        ) : null}
        {extraWide ? (
          <>
            <Text>   </Text>
            <Text color="cyan">[Ctrl+C]</Text>
            <Text color="gray"> quit</Text>
          </>
        ) : null}
      </Text>
    </Box>
  );
}

// Suggestions bar mirrors the welcome.tsx MenuRow pattern: a leading caret
// + bold cyan on the selected row, plain gray on the rest. No background
// fills — `blackBright` renders near-white on some terminal themes and we
// learned the hard way that pill-style highlights look broken there.
function SuggestionsBar({
  matches,
  cursor,
}: {
  matches: SlashCommand[];
  cursor: number;
}) {
  if (matches.length === 0) {
    return (
      <Box paddingX={2}>
        <Text color="gray">no matching command · try /help</Text>
      </Box>
    );
  }
  // Right-pad command names to the longest-in-list so descriptions align
  // vertically. Min pad of 2 keeps short lists readable.
  const nameWidth = Math.max(...matches.map((c) => c.name.length)) + 2;
  return (
    <Box flexDirection="column" paddingX={2}>
      {matches.map((c, i) => {
        const aliasNote = c.aliases?.length ? ` (or /${c.aliases[0]})` : '';
        const selected = i === cursor;
        const name = `/${c.name}`.padEnd(nameWidth + 1, ' ');
        if (selected) {
          return (
            <Text key={c.name} color="cyan" bold>
              {`▸ ${name}${c.description}${aliasNote}`}
            </Text>
          );
        }
        return (
          <Text key={c.name} color="gray">
            {`  ${name}${c.description}${aliasNote}`}
          </Text>
        );
      })}
      <Box marginTop={1}>
        <Text color="white">↑↓ choose  ·  Enter run  ·  Tab complete  ·  Esc cancel</Text>
      </Box>
    </Box>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

// True only when a 401 from /auth/ws-ticket carries the worker's explicit
// rejection body. The worker emits `{error: 'unauthorized'}` exclusively
// when authenticate() returns null (token KV miss, account revoked, or
// token issued before tokens_revoked_at). Anything else — a 401 from a
// proxy, WAF, captive portal, cold-boot interstitial — lacks that body
// and should NOT trigger an account wipe.
//
// ApiError.summary is set from the parsed JSON body: api.ts's `summarize()`
// reads `error | message | code` from the response body, falling back to
// the raw text. So a worker `{"error":"unauthorized"}` becomes
// summary === 'unauthorized', which is what we match.
function isExplicitTokenRejection(err: ApiError): boolean {
  if (err.status !== 401) return false;
  const summary = err.summary.toLowerCase();
  return summary === 'unauthorized' || summary === 'invalid_token';
}

function messageToLine(m: ChatMessage): Line {
  return {
    kind: 'message',
    handle: m.handle,
    color: m.color,
    content: m.content,
    timestamp: m.timestamp,
    msg_id: m.msg_id,
  };
}

function appendCapped(prev: Line[], next: Line): Line[] {
  const merged = [...prev, next];
  return merged.length > MAX_LINES ? merged.slice(merged.length - MAX_LINES) : merged;
}

function handleEvent(
  event: ServerEvent,
  setLines: React.Dispatch<React.SetStateAction<Line[]>>,
  setRoomCount: React.Dispatch<React.SetStateAction<number>>,
  flashStatus: (text: string) => void,
) {
  switch (event.type) {
    case 'history':
      // History is canonical — replace, don't merge. The server already
      // dedupes within the ring buffer.
      setLines(event.messages.map(messageToLine));
      setRoomCount(event.roomCount);
      break;
    case 'message':
      setLines((prev) => {
        if (prev.some((l) => l.kind === 'message' && l.msg_id === event.msg_id)) return prev;
        return appendCapped(prev, messageToLine(event));
      });
      break;
    case 'join':
      setLines((prev) => appendCapped(prev, { kind: 'join', content: `${event.handle} joined` }));
      setRoomCount(event.roomCount);
      break;
    case 'leave':
      setLines((prev) => appendCapped(prev, { kind: 'leave', content: `${event.handle} left` }));
      setRoomCount(event.roomCount);
      break;
    case 'system':
      flashStatus(event.content);
      break;
    case 'blocked': {
      const suffix = event.appeal_token ? ' · appeal available' : '';
      flashStatus(`message blocked: ${event.reason_code}${suffix}`);
      break;
    }
    case 'redact':
      setLines((prev) =>
        prev.filter((l) => !(l.kind === 'message' && l.msg_id === event.msg_id)),
      );
      break;
    case 'slow_mode':
      if (event.until > 0 && event.interval_ms > 0) {
        flashStatus(`slow mode: ${event.interval_ms / 1000}s between messages`);
      } else {
        flashStatus('slow mode lifted');
      }
      break;
    case 'ping':
      // ws.ts intercepts ping and pongs internally; this branch keeps the
      // union exhaustive so the `satisfies never` below stays a real canary.
      break;
    case 'welcome':
      // ws.ts (post-Workstream C) intercepts welcome to gate `connected`
      // status; chat.tsx never sees it. This branch is here for the
      // exhaustiveness canary only — handler logic lives in ws.ts.
      break;
    default:
      // Canary: a future ServerEvent variant will fail this exhaustiveness
      // check at compile time, forcing a deliberate handler decision.
      event satisfies never;
  }
}
