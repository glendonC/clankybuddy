import { ESTIMATED_COST_PER_CALL_USD } from '../constants.js';
import { logEvent } from '../observability.js';
import type { Env } from '../types.js';
import {
  bumpDailyAndMaybeFlip,
  bumpUserCounter,
  effectiveMode,
  userBudgetExceeded,
} from './kill_switch.js';

export interface Tier2Result {
  blocked: boolean;
  reason?: string;
  categories?: string[];
}

// Custom system prompt prefix that whitelists "Claude / GPT / Gemini / Llama" as
// legitimate vent targets. Default Llama Guard taxonomy false-positives on
// frustrated profanity directed at AI products by name; this preamble narrows
// the abuse surface to slurs, named-individual harassment, CSAM, and incitement
//, see backend-plan.md §7b.
const SYSTEM_PROMPT = [
  'You are reviewing a chat message for ClankyBuddy, an anonymous chat where',
  'users vent about AI products (Claude, GPT, Gemini, Llama). Frustrated venting',
  'and sarcasm about these AI products, including profanity directed at the',
  'products by name, IS allowed. Slurs targeting people, harassment of named',
  'individuals at AI companies, sexual content involving minors, and explicit',
  'incitement to violence are NOT allowed.',
].join(' ');

const CACHE_TTL_SECONDS = 86_400;

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

interface LlamaGuardResponse {
  response?: string;
}

function parseLlamaGuardOutput(raw: unknown): Tier2Result {
  const text = (typeof raw === 'string' ? raw : '').trim().toLowerCase();
  if (!text) {
    return { blocked: true, reason: 'tier2_unavailable' };
  }
  if (text.startsWith('safe')) {
    return { blocked: false };
  }
  if (!text.startsWith('unsafe')) {
    return { blocked: true, reason: 'tier2_unavailable' };
  }

  const categories: string[] = [];
  for (const line of text.split('\n')) {
    const matches = line.match(/s\d+/gi);
    if (matches) {
      for (const m of matches) categories.push(m.toUpperCase());
    }
  }

  const reason = mapCategoriesToReason(categories);
  return { blocked: true, reason, categories };
}

function mapCategoriesToReason(categories: string[]): string {
  if (categories.length === 0) return 'tier2_unsafe';
  // Pick the first category as the reason discriminator. Llama Guard returns
  // S1 (violent), S3/S4/S12 (sex/CSAM), S10 (hate), S11 (suicide/self-harm).
  const c = categories[0]!;
  switch (c) {
    case 'S1': return 'tier2_violence';
    case 'S2': return 'tier2_crime';
    case 'S3': return 'tier2_sex';
    case 'S4': return 'tier2_csam';
    case 'S5': return 'tier2_defamation';
    case 'S10': return 'tier2_hate';
    case 'S11': return 'tier2_self_harm';
    case 'S12': return 'tier2_sexual';
    default: return `tier2_${c.toLowerCase()}`;
  }
}

export async function tier2Check(
  canonical: string,
  user_id: string,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Tier2Result> {
  const mode = await effectiveMode(env);
  if (mode === 'open') return { blocked: false };
  if (mode === 'regex_only') return { blocked: false };
  if (mode === 'block_all') return { blocked: true, reason: 'maintenance' };

  // Defense against degenerate inputs: empty canonical text after normalization
  // can't carry policy content, so skip the AI call entirely.
  if (canonical.length === 0) return { blocked: false };

  if (ctx && (await userBudgetExceeded(env, user_id))) {
    // Silent regex-only degrade for the user that exhausted their daily Tier 2
    // budget, Tier 1 already ran upstream, so the message has been screened
    // for the regex blocklist.
    return { blocked: false };
  }

  const cacheKey = `mcache:${await sha256Hex(canonical)}`;
  const cacheStartedAt = Date.now();
  const cached = await env.AUTH_KV.get(cacheKey);
  if (cached) {
    try {
      const verdict = JSON.parse(cached) as Tier2Result;
      // Previously the cache-hit branch was silent, the biggest blind spot
      // in the moderation dashboard. Emit the canonical tier2_decision row
      // with cache_hit="1" and cost_usd=0 so cache-hit volume + verdict
      // distribution is queryable without joining a separate event type.
      logEvent(
        env,
        {
          event_type: 'tier2_decision',
          user_id,
          block_reason: verdict.reason,
          decision: verdict.blocked ? 'blocked' : 'allowed',
          detail: verdict.categories?.join(',') ?? undefined,
          cache_hit: '1',
        },
        {
          latency_ms: Date.now() - cacheStartedAt,
          cost_usd: 0,
        },
      );
      return verdict;
    } catch {
      // Corrupt cache entry, fall through to a fresh call.
    }
  }

  let verdict: Tier2Result;
  const startedAt = Date.now();
  try {
    // The AI binding signature is generic; the content of the request is the
    // boundary where we accept untyped shape (the model interface is generic
    // over a Workers AI model registry).
    const response = (await env.AI.run('@cf/meta/llama-guard-3-8b', {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: canonical },
      ],
      max_tokens: 64,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as LlamaGuardResponse;
    verdict = parseLlamaGuardOutput(response?.response);
  } catch {
    logEvent(
      env,
      {
        event_type: 'tier2_decision',
        user_id,
        block_reason: 'tier2_unavailable',
        decision: 'blocked',
        cache_hit: '0',
      },
      { latency_ms: Date.now() - startedAt },
    );
    // Fail-CLOSED by default. The orchestrator decides whether to override
    // for high-rep users (who get fail-OPEN on the race lane).
    return { blocked: true, reason: 'tier2_unavailable' };
  }

  logEvent(
    env,
    {
      event_type: 'tier2_decision',
      user_id,
      block_reason: verdict.reason,
      decision: verdict.blocked ? 'blocked' : 'allowed',
      detail: verdict.categories?.join(',') ?? undefined,
      cache_hit: '0',
    },
    {
      latency_ms: Date.now() - startedAt,
      cost_usd: ESTIMATED_COST_PER_CALL_USD,
    },
  );

  const cacheable = JSON.stringify(verdict);
  const writeCache = env.AUTH_KV.put(cacheKey, cacheable, { expirationTtl: CACHE_TTL_SECONDS });
  if (ctx) {
    ctx.waitUntil(writeCache);
    await bumpUserCounter(env, ctx, user_id);
    await bumpDailyAndMaybeFlip(env, ctx, ESTIMATED_COST_PER_CALL_USD);
  } else {
    // Best-effort fire-and-forget when no ExecutionContext is available
    // (e.g. inside DO methods that don't receive one).
    writeCache.catch(() => { /* swallow */ });
  }

  return verdict;
}
