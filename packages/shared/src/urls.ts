// Cross-package URL constants. Single source of truth for the public domain
// and dev fallbacks. Update these here and every consumer (worker, cli, web)
// picks up the change.
//
// Conventions:
//   PROD_* , what we ship publicly. Buy the domain, point DNS, done.
//   DEV_*  , what `wrangler dev` and `vite` bind locally.
//   TURNSTILE_HOSTNAME_DEFAULT, used by the worker as a fallback when the
//     wrangler env var is unset. The worker still reads env.TURNSTILE_HOSTNAME
//     first; this is just the floor.

export const PROD_API_HOST = 'api.clankybuddy.com';
export const PROD_WEB_HOST = 'clankybuddy.com';
export const PROD_WEB_HOST_WWW = 'www.clankybuddy.com';

export const PROD_API = `https://${PROD_API_HOST}`;
export const PROD_WEB = `https://${PROD_WEB_HOST}`;
export const PROD_WEB_WWW = `https://${PROD_WEB_HOST_WWW}`;

export const DEV_API = 'http://localhost:8788';
export const DEV_WEB = 'http://localhost:5173';

export const PROD_ORIGINS: readonly string[] = [PROD_WEB, PROD_WEB_WWW];
// Vite (5173) plus the common React-dev-server fallback (3000), both
// origins must be allowlisted because contributors run either depending on
// which app they're hacking on.
export const DEV_ORIGINS: readonly string[] = [DEV_WEB, 'http://localhost:3000'];

// Worker uses this as a fallback when env.TURNSTILE_HOSTNAME is unset. It is
// the host name embedded in `verify_url` returned with a captcha_required
// 403, NOT the API host (the page needs the Turnstile widget, which lives on
// the marketing site).
export const TURNSTILE_HOSTNAME_DEFAULT = PROD_WEB_HOST;

// Public-facing geofence policy doc. Worker returns this in the 451 body so
// EU/UK users see a real explanation rather than just an HTTP code.
export function geofenceDocUrl(host: string = PROD_WEB_HOST): string {
  return `https://${host}/legal/geofence`;
}

// Legal documents linked from the age-gate consent line on both surfaces.
// Markdown sources live at `legal/tos.md` and `legal/privacy.md`; the web
// build serves them at these paths.
export const TOS_URL = `${PROD_WEB}/legal/tos`;
export const PRIVACY_URL = `${PROD_WEB}/legal/privacy`;
