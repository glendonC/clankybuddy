// CLI-only constants. Cross-package wire constants (PROTOCOL_VERSION,
// reconnect timings, message length cap, URLs) live in @clankybuddy/shared
// and are re-exported here so existing imports keep working.

export {
  CHAT_MAX_MESSAGE_LENGTH,
  HELLO_TIMEOUT_MS,
  MAX_RECONNECT_DELAY_MS,
  PROTOCOL_VERSION,
  RECONNECT_BASE_MS,
} from '../../shared/src/chat.js';

export {
  DEV_API,
  DEV_WEB,
  PROD_API,
  PROD_WEB,
} from '../../shared/src/urls.js';

export { ACCESS_TOKEN_REFRESH_THRESHOLD_MS } from '../../shared/src/auth-tokens.js';

import { tuiUserAgent } from '../../shared/src/agents.js';

export const CLI_VERSION = '0.1.0';
export const USER_AGENT = tuiUserAgent(CLI_VERSION);

// Bumped to 3 in Phase B Cluster G (AI-feedback bridge): schema gains
// optional `bridge` field (enabled / share_with_assistants /
// granted_at / state_path). v2 saves auto-migrate via parseConfig
// (bridge field absent until the user runs `/bridge enable`).
//
// v1 → v2 (Workstream C): added access_token_issued_at, refresh_token,
// optional age_gate.
export const CONFIG_VERSION = 3;

// Turnstile / verify-flow polling cadence. Initial 1.5s, exponential
// backoff capped at 6s, hard ceiling 5min total (the worker's session_token
// TTL, past this the verify_url is dead and we abort to onTimeout).
export const VERIFY_POLL_INTERVAL_MS = 1_500;
export const VERIFY_POLL_BACKOFF_MAX_MS = 6_000;
export const VERIFY_POLL_MAX_DURATION_MS = 5 * 60 * 1_000;
