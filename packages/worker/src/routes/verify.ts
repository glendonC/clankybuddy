import type { Env } from '../types.js';

// GET /verify?session=<token>, terminal-friendly captcha completion page.
// Used by the TUI flow: when /auth/init returns `captcha_required` with a
// session_token, the TUI prints `verify_url` for the user to open in a
// browser. This route serves the page that hosts the Turnstile widget,
// posts back to /auth/init with the widget response, and surfaces a
// "verification complete" UI on success.
//
// The page is single-use (Cache-Control: no-store) and stylistically
// matches src/styles/tokens.css, same palette / type stack so a user
// who's seen the game UI recognizes the brand instantly.

const INIT_SESSION_PREFIX = 'init_session:';

interface PendingInitSession {
  state: 'pending';
  created_at: number;
  ip: string;
  asn: number;
}

interface VerifiedInitSession {
  state: 'verified';
}

type StoredInitSession = PendingInitSession | VerifiedInitSession;

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Single-use page; never let an intermediate cache it. Anything cached
      // would return a stale session_token to a different user.
      'Cache-Control': 'no-store',
      // The page embeds Turnstile from challenges.cloudflare.com; we keep
      // CSP narrow but functional.
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' https://challenges.cloudflare.com 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "frame-src https://challenges.cloudflare.com",
        "connect-src 'self'",
        "img-src 'self' data:",
      ].join('; '),
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// HTML-escape a value before interpolation. Session tokens are 32-char
// hex, but defense-in-depth: a future caller might pass in something
// different and HTML-escaping is cheap insurance.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function expiredPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ClankyBuddy, Verification expired</title>
<style>${baseStyles()}</style>
</head>
<body>
  <main class="card">
    <h1>Verification link expired</h1>
    <p class="muted">This verification session is no longer valid. Return to your terminal and run the sign-in command again to get a new link.</p>
  </main>
</body>
</html>`;
}

function verifyPage(sessionToken: string, sitekey: string): string {
  const safeToken = escapeHtml(sessionToken);
  const safeSitekey = escapeHtml(sitekey);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ClankyBuddy, Verify</title>
<style>${baseStyles()}</style>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</head>
<body>
  <main class="card">
    <h1>Verify it's you</h1>
    <p class="muted">Complete the challenge below, then return to your terminal.</p>
    <div class="widget">
      <div class="cf-turnstile"
           data-sitekey="${safeSitekey}"
           data-callback="onTurnstile"
           data-theme="dark"></div>
    </div>
    <p id="status" class="status"></p>
  </main>
  <script>
    (function () {
      var sessionToken = ${JSON.stringify(sessionToken)};
      var statusEl = document.getElementById('status');
      function setStatus(msg, kind) {
        statusEl.textContent = msg;
        statusEl.dataset.kind = kind || '';
      }
      window.onTurnstile = function (token) {
        setStatus('Verifying…', 'pending');
        fetch('/auth/init', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'cf-turnstile-response': token,
          },
          body: JSON.stringify({ session_token: sessionToken }),
        }).then(function (res) {
          if (res.ok) {
            setStatus('Verification complete, return to your terminal.', 'ok');
          } else {
            return res.json().catch(function () { return { error: 'unknown' }; })
              .then(function (j) {
                setStatus('Verification failed: ' + (j.error || res.status), 'err');
              });
          }
        }).catch(function () {
          setStatus('Network error. Please try again.', 'err');
        });
      };
    })();
  </script>
</body>
</html>`;
}

// Inline stylesheet, palette mirrors src/styles/tokens.css so the page
// reads as part of the same product. Kept as a function so we can reuse
// it across both the live and expired pages without duplication.
function baseStyles(): string {
  return `
    :root {
      --bg: #08080a;
      --surface: #101013;
      --border: #2a2a31;
      --fg: #ededf0;
      --fg-2: #888892;
      --accent: #34d399;
      --err: #f87171;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      font-size: 14px;
      letter-spacing: -0.01em;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 32px;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    h1 {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 8px;
      letter-spacing: -0.02em;
    }
    p.muted { color: var(--fg-2); line-height: 1.5; }
    .widget { margin: 24px 0 16px; min-height: 65px; }
    .status { font-size: 13px; min-height: 1.4em; }
    .status[data-kind="ok"]  { color: var(--accent); }
    .status[data-kind="err"] { color: var(--err); }
    .status[data-kind="pending"] { color: var(--fg-2); }
  `;
}

export async function handleVerify(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const sessionToken = url.searchParams.get('session');
  if (!sessionToken) {
    return htmlResponse(expiredPage(), 410);
  }

  // Validate session exists and is in 'pending' state. A 'verified' row
  // means somebody already completed this widget; the page is now stale.
  const raw = await env.AUTH_KV.get(`${INIT_SESSION_PREFIX}${sessionToken}`);
  if (!raw) {
    return htmlResponse(expiredPage(), 410);
  }
  let parsed: StoredInitSession;
  try {
    parsed = JSON.parse(raw) as StoredInitSession;
  } catch {
    return htmlResponse(expiredPage(), 410);
  }
  if (parsed.state !== 'pending') {
    return htmlResponse(expiredPage(), 410);
  }

  const sitekey = env.TURNSTILE_SITEKEY;
  if (!sitekey) {
    // Fail-soft: render a friendly explanation rather than a 500. Ops needs
    // to set TURNSTILE_SITEKEY for this route to function; a missing var
    // shouldn't surface as a stack trace to end users.
    return htmlResponse(
      `<!doctype html><html><head><meta charset="utf-8"><title>ClankyBuddy, Setup required</title><style>${baseStyles()}</style></head><body><main class="card"><h1>Verification temporarily unavailable</h1><p class="muted">The verification widget isn't configured on this server. Please try again later.</p></main></body></html>`,
      503,
    );
  }

  return htmlResponse(verifyPage(sessionToken, sitekey), 200);
}
