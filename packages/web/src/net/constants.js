// Web-side wire constants. Single-source of the chat protocol values lives in
// packages/shared; this module just adds the Vite-specific API base resolution.
//
// Vite handles .ts imports from .js files transparently via esbuild, no
// build wiring required.

export {
  CHAT_MAX_MESSAGE_LENGTH,
  HELLO_TIMEOUT_MS,
  MAX_RECONNECT_DELAY_MS,
  PROTOCOL_VERSION,
  RECONNECT_BASE_MS,
} from '@clankybuddy/shared/chat';

import { DEV_API, PROD_API } from '@clankybuddy/shared/urls';

// Override with VITE_CLANKYBUDDY_API in `.env.local` to point at a non-default
// backend. `import.meta.env.DEV` is true under `vite dev` and false in builds.
// When loaded inside the VS Code extension's webview, the extension injects
// `window.__clankybuddyExtConfig.apiBase` before the bundle runs, that wins
// over the build-time default so users can re-target staging from a setting.
export function resolveApiBase() {
  const ext = typeof window !== 'undefined' ? window.__clankybuddyExtConfig?.apiBase : null;
  if (ext) return ext;
  const override = import.meta.env?.VITE_CLANKYBUDDY_API;
  if (override) return override;
  return import.meta.env?.DEV ? DEV_API : PROD_API;
}

// Bumped from v1 → v2 on the introduction of the rotating refresh-token
// pair. v1 readers in legacy code paths are gone; v1 blobs on disk are
// migrated transparently in src/net/auth-storage.js#migrateV1IfPresent.
export const AUTH_STORAGE_KEY = 'clankybuddy.auth.v2';
export const AUTH_STORAGE_VERSION = 2;
