// EU + UK geofence at v0. Per backend-plan §Legal posture, we picked option (b):
// geofence rather than build the DSA Statement-of-Reasons pipeline. Until that
// pipeline exists and UK age-estimation is in scope, EU + EEA + UK requests
// receive 451 Unavailable For Legal Reasons.
//
// The list intentionally combines EU member states with EEA non-EU (IS, LI, NO)
// because the DSA applies to "providers offering services in the Union" and the
// EEA states have aligned regulatory regimes. UK is separate because the
// blocking trigger there is the Online Safety Act / AADC, not DSA.

export interface GeofenceDecision {
  blocked: boolean;
  reason?: 'eu_dsa' | 'uk_aadc';
  message?: string;
}

const EU_COUNTRIES = new Set<string>([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  // EEA non-EU but DSA-aligned
  'IS', 'LI', 'NO',
]);

const UK_COUNTRIES = new Set<string>(['GB']);

const EU_MESSAGE =
  "ClankyBuddy is not yet available in your region. We're working on the " +
  'regulatory compliance required to serve EU users (DSA Statement-of-Reasons ' +
  'pipeline). Follow @clankybuddy for updates.';

const UK_MESSAGE =
  "ClankyBuddy is not yet available in your region. We're working on the " +
  'regulatory compliance required to serve UK users (Online Safety Act age ' +
  'estimation). Follow @clankybuddy for updates.';

// CF-edge sets `request.cf.country` in production. Local `wrangler dev` and
// some test harnesses leave it undefined or 'XX' (Cloudflare's "unknown"
// sentinel). Fall through rather than block, blocking on missing data would
// hard-fail every dev request.
export function geofenceDecision(country: string | undefined): GeofenceDecision {
  if (!country || country === 'XX') return { blocked: false };
  const normalized = country.toUpperCase();
  if (EU_COUNTRIES.has(normalized)) {
    return { blocked: true, reason: 'eu_dsa', message: EU_MESSAGE };
  }
  if (UK_COUNTRIES.has(normalized)) {
    return { blocked: true, reason: 'uk_aadc', message: UK_MESSAGE };
  }
  return { blocked: false };
}

// Header used by ops/CI/Workers Logs to bypass the geofence. Compare against
// env.GEOFENCE_BYPASS_SECRET; when the secret is unset, any bypass attempt
// fails closed (we treat the missing secret as "no one is authorized").
export const GEOFENCE_BYPASS_HEADER = 'X-Clanky-Geofence-Bypass';

export function isGeofenceBypassed(
  request: Request,
  bypassSecret: string | undefined,
): boolean {
  if (!bypassSecret) return false;
  const provided = request.headers.get(GEOFENCE_BYPASS_HEADER);
  if (!provided) return false;
  // Constant-time comparison isn't critical here (it's a server-internal
  // secret, not a user credential), but keep the obvious shortcut bounded.
  return provided === bypassSecret;
}
