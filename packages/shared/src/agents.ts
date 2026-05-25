// User-Agent prefix used to identify the official TUI client. Worker uses
// this to allow a no-Origin request through CORS (the TUI isn't a browser
// context); CLI sets its UA header to start with this prefix.

export const TUI_USER_AGENT_PREFIX = 'clankybuddy-cli/';

// Convenience helper for the CLI side: build the full UA from a version.
export function tuiUserAgent(version: string): string {
  return `${TUI_USER_AGENT_PREFIX}${version}`;
}
