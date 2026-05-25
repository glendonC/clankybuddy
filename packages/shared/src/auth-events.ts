// Auth-lifecycle telemetry events. INTENTIONALLY a separate module from
// events.ts (the GameEvent union): these events do NOT ride the
// /events/batch route, that route's KNOWN_EVENT_TYPES gate would reject
// them, and storing per-user auth pings in the events SQL table costs
// hot-path writes for a signal we don't aggregate server-side.
//
// Sink (today): client-side console.debug via the existing telemetry layer
// in src/telemetry/events.js (web) and a TBD path in the TUI. Useful for
// devtools-driven debugging of the refresh / revocation flows.
//
// If we ever want server-side analytics on auth lifecycle, that's a future
// workstream that adds a /auth-events/batch route, keep this signal
// disjoint from the gameplay event log so the contracts can evolve
// independently.

export type AuthClientKind = 'web' | 'tui';

export type AuthLifecycleEvent =
  | { type: 'token_refresh_attempted'; client_kind: AuthClientKind }
  | {
      type: 'token_refresh_succeeded';
      client_kind: AuthClientKind;
      latency_ms: number;
    }
  | {
      type: 'token_refresh_failed';
      client_kind: AuthClientKind;
      status: number;
      reason: string;
    }
  | {
      type: 'token_revoked_seen';
      client_kind: AuthClientKind;
      source: 'system_event' | 'ws_close_4401' | 'http_401';
    }
  | {
      type: 'protocol_outdated_seen';
      client_kind: AuthClientKind;
      required_version: string;
      client_version: string;
    }
  | { type: 'auth_init_after_refresh_failed'; client_kind: AuthClientKind }
  | { type: 'age_gate_confirmed'; client_kind: AuthClientKind; version: number };

export const AUTH_LIFECYCLE_EVENT_TYPES = new Set<AuthLifecycleEvent['type']>([
  'token_refresh_attempted',
  'token_refresh_succeeded',
  'token_refresh_failed',
  'token_revoked_seen',
  'protocol_outdated_seen',
  'auth_init_after_refresh_failed',
  'age_gate_confirmed',
]);
