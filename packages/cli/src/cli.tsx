import { Box, render, Text } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AGE_GATE_VERSION, isAgeGateSatisfied } from '../../shared/src/age-gate.js';
import { AgeGate } from './age-gate.js';
import { resolveApiBase } from './api.js';
import { authInit, type InitSession } from './auth.js';
import {
  type BridgePoller,
  startBridgePoller,
} from './bridge-poller.js';
import { Chat } from './chat.js';
import {
  type AgeGateRecord,
  type Config,
  deleteConfig,
  readConfig,
  writeConfig,
} from './config.js';
import { Verify, type VerifyVerifiedPayload } from './verify.js';
import { Welcome } from './welcome.js';
import type { StatsWindow } from './me-stats.js';
import { DemoBanner } from './demo/banner.js';
import { getDemoConfig, initDemo, isDemoMode } from './demo/index.js';

// Parse `--demo[=name]` / CLANKYBUDDY_DEMO before anything else mounts.
// Subsequent isDemoMode() / getScenarioSpec() calls read this singleton.
initDemo();

type Phase = 'loading' | 'age_gate' | 'verify' | 'welcome' | 'chat' | 'error';

// CI / non-TTY guard. Printing the verify URL into a CI log would let any
// log scraper grab it and complete the captcha for us; refuse to even
// emit it. Real terminals only.
function isHeadless(): boolean {
  if (process.env.CI === 'true') return true;
  if (process.env.CLANKYBUDDY_HEADLESS === '1') return true;
  if (process.stdout.isTTY === false) return true;
  return false;
}

function exitHeadless(): never {
  process.stderr.write(
    'clankybuddy: interactive verification required. Run from a real terminal.\n',
  );
  process.exit(2);
}

// Build a v2 Config from a verified-init payload. Runs both for the
// 200-immediate path (no captcha needed) and for the 202→poll→verified
// path (Turnstile completed in browser).
function buildVerifiedConfig(args: {
  api_base: string;
  token: string;
  refresh_token: string;
  user_id: string;
  handle: string;
  color: string;
  age_gate?: AgeGateRecord;
}): Config {
  return {
    version: 3,
    access_token: args.token,
    access_token_issued_at: Date.now(),
    refresh_token: args.refresh_token,
    user_id: args.user_id,
    handle: args.handle,
    color: args.color,
    api_base: args.api_base,
    age_gate: args.age_gate,
  };
}

function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  // When in the verify phase, this carries the worker's session payload.
  const [session, setSession] = useState<InitSession | null>(null);
  // Set by Welcome's "Stats" action so the next chat mount opens the
  // stats modal immediately. Consumed-once on the chat phase render.
  const [pendingStatsWindow, setPendingStatsWindow] = useState<StatsWindow | null>(
    null,
  );
  // Preserved across phase transitions: the age_gate record we just
  // collected (set on age-gate confirm, consumed by verify-success /
  // session-revoked recovery / token-rejected recovery).
  const pendingAgeGateRef = useRef<AgeGateRecord | null>(null);

  const apiBaseRef = useRef<string>(resolveApiBase());

  // Mirror of `config` for the bridge poller. The poller reads
  // cfgRef.current on every tick so token rotation, bridge toggles,
  // etc. propagate without re-mounting the poller. Mirrors the same
  // pattern chat.tsx uses for its WS client.
  const bridgeCfgRef = useRef<Config | null>(null);
  bridgeCfgRef.current = config;
  const bridgePollerRef = useRef<BridgePoller | null>(null);

  // Boot: read config; if it satisfies age_gate, skip; else age_gate first.
  useEffect(() => {
    // Demo mode short-circuit · skip disk + authInit entirely. The demo
    // Config is synthesized in-process and lets us land on Welcome
    // without a verified account. No real network touches happen.
    if (isDemoMode()) {
      const demo = getDemoConfig();
      apiBaseRef.current = demo.api_base;
      setConfig(demo);
      setPhase('welcome');
      return;
    }
    void (async () => {
      try {
        const existing = await readConfig();
        if (existing) {
          // Detect "dead-legacy" configs: refresh_token is null AND
          // access_token_issued_at is 0. This is a v1-migrated record
          // whose access_token was minted by a worker session that no
          // longer recognizes it (common after a wrangler-dev restart
          // since each session has its own ephemeral DO storage). With
          // no refresh_token we can't renew, and the WS reconnect loop
          // would 401 forever. Delete and fall through to a fresh
          // authInit — we carry the saved age_gate forward so the user
          // doesn't re-attest. api_base is also preserved via the env-
          // override fallback in resolveApiBase().
          const isDeadLegacy =
            !existing.refresh_token && existing.access_token_issued_at === 0;
          if (isDeadLegacy) {
            pendingAgeGateRef.current = existing.age_gate ?? null;
            apiBaseRef.current = existing.api_base;
            await deleteConfig();
            // Fall through to the "no config" path below by leaving
            // `existing` un-set in the React state. We re-route to the
            // age_gate / fresh-init flow exactly as a first-run user.
            if (isAgeGateSatisfied(existing.age_gate)) {
              // Already age-gated — skip the prompt, bounce straight
              // into the fresh-init path via the session-revoked handler
              // (it's the same operation: clear local creds, run
              // /auth/init, persist, route to welcome).
              setPhase('loading');
              // Defer to next tick so handleSessionRevoked sees its
              // own useCallback closure rather than the stale boot-time
              // capture.
              setTimeout(() => handleSessionRevoked(), 0);
              return;
            }
            setPhase('age_gate');
            return;
          }

          setConfig(existing);
          // Carry the existing api_base forward so subsequent calls match
          // what was previously persisted (env override only matters for
          // first-run users).
          apiBaseRef.current = existing.api_base;
          if (isAgeGateSatisfied(existing.age_gate)) {
            // Age-gated and have a config with a refresh_token. The
            // proactive-refresh / 401-retry path handles ordinary token
            // expiry without re-prompting verify on every launch.
            setPhase('welcome');
            return;
          }
          // Config exists but predates age-gate (or the prompt version
          // changed). Re-prompt before doing anything that touches chat.
          setPhase('age_gate');
          return;
        }
        // No config — fresh user. Age-gate first.
        setPhase('age_gate');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    })();
    // handleSessionRevoked is declared later in the component — this
    // effect runs once at mount, by which time the callback is defined.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 401 from /me/state. Distinct from the WS path: we treat a true
  // token rejection on the bridge poll the same way the WS does
  // (route to onTokenRejected). Defined here so the bridge effect
  // below can reference it; declared before handleTokenRejected exists
  // would be a TDZ issue in the React render, hence the inline
  // closure that re-reads the ref-mirrored handler at call time.
  const tokenRejectedRef = useRef<(() => Promise<void>) | null>(null);

  // Bridge poller lifecycle: start when config has `bridge.enabled`
  // truthy and we're past the verify phase; stop on any of:
  //   - config flips bridge.enabled false (via /bridge disable)
  //   - config goes null (deleteConfig + back to verify)
  //   - app unmounts (Ink cleanup)
  // Token rotation is NOT a teardown trigger — bridgeCfgRef.current
  // resolves to the latest tokens on every poll tick.
  useEffect(() => {
    const enabled = config?.bridge?.enabled === true;
    if (!enabled) {
      if (bridgePollerRef.current) {
        bridgePollerRef.current.stop();
        bridgePollerRef.current = null;
      }
      return;
    }
    // Already running (the only way we get here with a poller in flight
    // is a re-render that doesn't change bridge.enabled — let it ride).
    if (bridgePollerRef.current) return;
    const cfgRefForPoller = { current: config };
    // Sync ref-style handle so the poller reads `bridgeCfgRef.current`
    // on every tick. Note: the {current} object passed in is a
    // disposable view; bridge-poller mutates it via getter only, never
    // reassigns. We reassign on each tick by updating bridgeCfgRef.
    const poller = startBridgePoller(
      // Adapter so the poller always sees the latest config from the
      // outer ref, not the snapshot we captured at start time.
      { get current() { return bridgeCfgRef.current ?? cfgRefForPoller.current; } } as { current: Config },
      {
        onUnauthorized: () => tokenRejectedRef.current?.(),
      },
    );
    bridgePollerRef.current = poller;
    return () => {
      poller.stop();
      if (bridgePollerRef.current === poller) {
        bridgePollerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.bridge?.enabled]);

  // Called when age_gate confirms. From here we either skip to welcome
  // (config present + has refresh) or enter verify (no config / v1-
  // migrated needs re-verify on next 401, but we always ensure the age
  // record is stamped first).
  const handleAgeGateConfirmed = useCallback(async () => {
    const record: AgeGateRecord = {
      confirmed_at: Date.now(),
      version: AGE_GATE_VERSION,
    };
    pendingAgeGateRef.current = record;

    // If we already have a usable config, just stamp the age_gate record
    // and proceed to welcome.
    if (config) {
      const next: Config = { ...config, age_gate: record };
      try {
        await writeConfig(next);
      } catch {
        // Persistence is best-effort. If writeConfig fails, the user re-
        // attests next launch — not a correctness issue, no PII at stake.
      }
      setConfig(next);
      setPhase('welcome');
      return;
    }

    // No config. We need to authInit. Headless detection: refuse to even
    // start authInit because the 202 path would print a verify URL into
    // CI logs (and the headless boot can't render the verify screen).
    if (isHeadless()) exitHeadless();

    try {
      const result = await authInit(apiBaseRef.current);
      if (result.kind === 'verified') {
        // Worker let us through without captcha (rare — IP/ASN gate).
        const next = buildVerifiedConfig({
          api_base: apiBaseRef.current,
          token: result.token,
          refresh_token: result.refresh_token,
          user_id: result.user_id,
          handle: result.handle,
          color: result.color,
          age_gate: record,
        });
        await writeConfig(next);
        setConfig(next);
        setPhase('welcome');
        return;
      }
      // 202: hand the user a verify URL + start polling.
      setSession(result);
      setPhase('verify');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [config]);

  const handleVerified = useCallback(
    async (payload: VerifyVerifiedPayload) => {
      const record = pendingAgeGateRef.current ?? config?.age_gate;
      const next = buildVerifiedConfig({
        api_base: apiBaseRef.current,
        token: payload.token,
        refresh_token: payload.refresh_token,
        user_id: payload.user_id,
        handle: payload.handle,
        color: payload.color,
        age_gate: record,
      });
      try {
        await writeConfig(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
        return;
      }
      setConfig(next);
      setSession(null);
      setPhase('welcome');
    },
    [config],
  );

  const handleVerifyTimeout = useCallback(() => {
    setError('verification timed out — please try again');
    setSession(null);
    setPhase('error');
  }, []);

  const handleVerifyCancel = useCallback(() => {
    setError('verification cancelled');
    setSession(null);
    setPhase('error');
  }, []);

  // /bridge enable|disable updates the persisted config and we need to
  // both re-render the Chat (so makeSlashCtx() sees the new config)
  // AND re-run the bridge useEffect (which keys on bridge.enabled).
  // The slash command already wrote to disk; we just sync React state.
  const handleConfigChange = useCallback((next: Config) => {
    setConfig(next);
  }, []);

  // 401 from ws-ticket: token rejected on the wire, fall back to authInit.
  // Distinct from session_revoked (handled below) in that we just retry
  // without a UI bounce — chat.tsx's effect will re-run with fresh config.
  const handleTokenRejected = useCallback(async () => {
    await deleteConfig();
    if (isHeadless()) exitHeadless();
    const result = await authInit(apiBaseRef.current);
    const carryAgeGate = pendingAgeGateRef.current ?? config?.age_gate;
    if (result.kind === 'verified') {
      const next = buildVerifiedConfig({
        api_base: apiBaseRef.current,
        token: result.token,
        refresh_token: result.refresh_token,
        user_id: result.user_id,
        handle: result.handle,
        color: result.color,
        age_gate: carryAgeGate,
      });
      await writeConfig(next);
      setConfig(next);
      return;
    }
    // Need a fresh verify pass — bounce to verify phase.
    setSession(result);
    setConfig(null);
    setPhase('verify');
  }, [config]);

  // Mirror handleTokenRejected through the ref for the bridge poller.
  // The poller sees the live ref so token rejection on /me/state
  // routes through the same wipe-and-re-verify path as the WS does,
  // without re-instantiating the poller every render.
  tokenRejectedRef.current = handleTokenRejected;

  // Worker emitted a system event with code 'session_revoked' — drop
  // config and route back to verify. chat.tsx surfaced the in-line
  // notice already; we just swap phase.
  const handleSessionRevoked = useCallback(() => {
    void (async () => {
      await deleteConfig();
      if (isHeadless()) exitHeadless();
      try {
        const result = await authInit(apiBaseRef.current);
        const carryAgeGate = pendingAgeGateRef.current ?? config?.age_gate;
        if (result.kind === 'verified') {
          const next = buildVerifiedConfig({
            api_base: apiBaseRef.current,
            token: result.token,
            refresh_token: result.refresh_token,
            user_id: result.user_id,
            handle: result.handle,
            color: result.color,
            age_gate: carryAgeGate,
          });
          await writeConfig(next);
          setConfig(next);
          setPhase('welcome');
          return;
        }
        setSession(result);
        setConfig(null);
        setPhase('verify');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    })();
  }, [config]);

  if (phase === 'error') return <Text color="red">error: {error}</Text>;
  if (phase === 'loading') return <Text>setting up your buddy chat account…</Text>;

  if (phase === 'age_gate') {
    return <AgeGate onConfirm={() => void handleAgeGateConfirmed()} />;
  }

  if (phase === 'verify') {
    if (!session) {
      return <Text color="red">internal error: verify phase without session</Text>;
    }
    return (
      <Verify
        api_base={apiBaseRef.current}
        session_token={session.session_token}
        verify_url={session.verify_url}
        expires_at={session.expires_at}
        onVerified={handleVerified}
        onCancel={handleVerifyCancel}
        onTimeout={handleVerifyTimeout}
      />
    );
  }

  if (!config) return <Text>setting up your buddy chat account…</Text>;
  if (phase === 'welcome') return (
    <Welcome
      config={config}
      onContinue={() => setPhase('chat')}
      onSwitchIdentity={handleSessionRevoked}
      onShowStats={() => {
        setPendingStatsWindow('lifetime');
        setPhase('chat');
      }}
    />
  );
  return (
    <Chat
      config={config}
      onTokenRejected={handleTokenRejected}
      onSessionRevoked={handleSessionRevoked}
      onConfigChange={handleConfigChange}
      initialStats={pendingStatsWindow}
    />
  );
}

function Shell() {
  return (
    <Box flexDirection="column">
      <DemoBanner />
      <App />
    </Box>
  );
}

render(<Shell />);
