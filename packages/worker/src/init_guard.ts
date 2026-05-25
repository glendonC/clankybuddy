import { logEvent } from './observability.js';
import type { Env } from './types.js';

export interface InitContext {
  ip: string;
  asn: number;
  country: string;
  ua: string;
  // 'a.b.c' for v4; for v6, the /48 prefix joined by ':'.
  subnet24: string;
  // Present iff the client passed cf-turnstile-response.
  turnstileToken?: string;
}

export type GateDecision =
  | { decision: 'allow' }
  | { decision: 'captcha' }
  | { decision: 'reject'; reason: string };

const LIMITS = {
  ipPerHour: 5,
  subnet24PerHour: 20,
  asnPer10Min: 50,
  asnPerHour: 200,
  countryPerMin: 500,
} as const;

// Carrier ASNs share single-ASN identity across millions of legitimate users
// (mobile carriers, VPN/relay providers). Auto-rejecting these is a
// denial-of-service against legitimate populations, captcha-gating is the
// correct escalation per backend-plan §8.
const CARRIER_ALLOWLIST = new Set<number>([
  13335, // Cloudflare WARP
  6185,  // Apple iCloud Private Relay
  20057, // AT&T Mobility
  6167,  // Verizon Wireless
  21928, // T-Mobile USA
  3320,  // Deutsche Telekom (high mobile share in EU)
  7922,  // Comcast
  // extend as observed
]);

const SUSPICIOUS_UA_RE = /curl|wget|python|http/i;

function isSuspiciousUa(ua: string): boolean {
  return ua.length < 20 || SUSPICIOUS_UA_RE.test(ua);
}

export function subnetPrefix(ip: string): string {
  if (ip.includes(':')) {
    // IPv6, first three hextets form the /48. cf-connecting-ip can hand us
    // shorthand like '2001:db8::1'; expand only as far as we need.
    const expanded = expandV6(ip);
    return expanded.slice(0, 3).join(':');
  }
  const parts = ip.split('.');
  if (parts.length !== 4) return ip;
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

function expandV6(ip: string): string[] {
  const doubleColonIdx = ip.indexOf('::');
  if (doubleColonIdx === -1) return ip.split(':');
  const left = ip.slice(0, doubleColonIdx);
  const right = ip.slice(doubleColonIdx + 2);
  const leftParts = left ? left.split(':') : [];
  const rightParts = right ? right.split(':') : [];
  const missing = 8 - leftParts.length - rightParts.length;
  return [...leftParts, ...new Array<string>(missing).fill('0'), ...rightParts];
}

// KV counters are eventually consistent. That's fine, these are bands, not
// exact cutoffs; one slot of double-counting at the boundary is acceptable.
// Trying to harden this with a DO would burn writes that don't change outcomes.
async function countAndIncrement(
  kv: KVNamespace,
  key: string,
  ttlSec: number,
): Promise<number> {
  const current = await kv.get(key);
  const next = (current ? parseInt(current, 10) || 0 : 0) + 1;
  await kv.put(key, String(next), { expirationTtl: ttlSec });
  return next;
}

async function readCounter(kv: KVNamespace, key: string): Promise<number> {
  const v = await kv.get(key);
  return v ? parseInt(v, 10) || 0 : 0;
}

// Soft signal for the carrier-allowlist branch: if any of the same counters
// are already over 50% of their limit, escalate to captcha rather than allow.
// This catches abuse riding on a carrier ASN without locking out the whole
// carrier population.
async function carrierSoftSignal(
  kv: KVNamespace,
  ctx: InitContext,
): Promise<boolean> {
  const [ip, subnet, asn10, asnHr] = await Promise.all([
    readCounter(kv, `ratelimit:init:${ctx.ip}`),
    readCounter(kv, `init:net:${ctx.subnet24}`),
    readCounter(kv, `init:asn10m:${ctx.asn}`),
    readCounter(kv, `init:asnhr:${ctx.asn}`),
  ]);
  if (ip > LIMITS.ipPerHour * 0.5) return true;
  if (subnet > LIMITS.subnet24PerHour * 0.5) return true;
  if (asn10 > LIMITS.asnPer10Min * 0.5) return true;
  if (asnHr > LIMITS.asnPerHour * 0.5) return true;
  if (isSuspiciousUa(ctx.ua)) return true;
  return false;
}

export async function gateAccountCreation(
  env: Env,
  ctx: InitContext,
): Promise<GateDecision> {
  const decision = await computeGateDecision(env, ctx);
  logEvent(env, {
    event_type: 'init_gate',
    decision: decision.decision,
    asn: String(ctx.asn),
    country: ctx.country,
    block_reason: decision.decision === 'reject' ? decision.reason : undefined,
  });
  return decision;
}

async function computeGateDecision(
  env: Env,
  ctx: InitContext,
): Promise<GateDecision> {
  const kv = env.AUTH_KV;

  if (CARRIER_ALLOWLIST.has(ctx.asn)) {
    const soft = await carrierSoftSignal(kv, ctx);
    return soft ? { decision: 'captcha' } : { decision: 'allow' };
  }

  const [ipCount, subnetCount, asn10Count, asnHrCount] = await Promise.all([
    countAndIncrement(kv, `ratelimit:init:${ctx.ip}`, 3600),
    countAndIncrement(kv, `init:net:${ctx.subnet24}`, 3600),
    countAndIncrement(kv, `init:asn10m:${ctx.asn}`, 600),
    countAndIncrement(kv, `init:asnhr:${ctx.asn}`, 3600),
  ]);

  if (ipCount > LIMITS.ipPerHour) return { decision: 'captcha' };
  if (subnetCount > LIMITS.subnet24PerHour) return { decision: 'captcha' };
  if (asn10Count > LIMITS.asnPer10Min) return { decision: 'captcha' };
  if (asnHrCount > LIMITS.asnPerHour) return { decision: 'captcha' };

  if (isSuspiciousUa(ctx.ua)) return { decision: 'captcha' };

  return { decision: 'allow' };
}

interface TurnstileVerifyResponse {
  success: boolean;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
}

let turnstileSecretWarned = false;

// 5s timeout: Turnstile siteverify p99 is well under a second; anything past
// 5s is almost certainly a network issue and we'd rather fail-closed than
// hold the /auth/init handler. Failing closed is correct here, captcha is
// the gate for already-elevated traffic.
const TURNSTILE_TIMEOUT_MS = 5_000;

export async function verifyTurnstile(
  token: string,
  env: Env,
  ctx: InitContext,
): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET;
  if (!secret) {
    if (!turnstileSecretWarned) {
      console.warn(
        '[init_guard] TURNSTILE_SECRET not set; verifyTurnstile fails closed. ' +
        'Set it via `wrangler secret put TURNSTILE_SECRET` for non-alpha envs.',
      );
      turnstileSecretWarned = true;
    }
    return false;
  }

  const body = new URLSearchParams({
    secret,
    response: token,
    remoteip: ctx.ip,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);

  try {
    const res = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: controller.signal,
      },
    );
    if (!res.ok) return false;
    const json = (await res.json()) as TurnstileVerifyResponse;
    return json.success === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
