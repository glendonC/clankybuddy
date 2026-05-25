import { authenticate } from '../auth.js';
import {
  ACTION_BATCH_MAX_ITEMS,
  ACTION_BATCH_MAX_TOTAL_COUNT,
  ACTION_ITEM_MAX_COUNT,
  ACTION_ITEM_MIN_COUNT,
  VALID_MODELS,
  type ModelId,
} from '../constants.js';
import type { IngestItem } from '../dos/action_shard.js';
import type { Env } from '../types.js';
import { shardIdFor } from '../util/shard.js';

interface BatchRequestBody {
  batch_id: string;
  items: IngestItem[];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// UUID v4-ish: 36 chars including hyphens; we don't enforce version bits but
// reject obviously-malformed shapes so a typo doesn't permanently consume a
// dedupe row. Server-side uniqueness is the actual idempotency key.
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const VALID_MODEL_SET = new Set<string>(VALID_MODELS);

function isValidModel(s: string): s is ModelId {
  return VALID_MODEL_SET.has(s);
}

export async function handleActionsBatch(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await authenticate(env, request);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  if (!body || typeof body !== 'object') {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }
  const candidate = body as Partial<BatchRequestBody>;
  if (typeof candidate.batch_id !== 'string' || !UUID_RE.test(candidate.batch_id)) {
    return jsonResponse({ error: 'invalid_batch_id' }, 400);
  }
  if (!Array.isArray(candidate.items)) {
    return jsonResponse({ error: 'invalid_items' }, 400);
  }
  if (candidate.items.length === 0) {
    return jsonResponse({ error: 'empty_items' }, 400);
  }
  if (candidate.items.length > ACTION_BATCH_MAX_ITEMS) {
    return jsonResponse(
      { error: 'batch_too_large', max_items: ACTION_BATCH_MAX_ITEMS },
      413,
    );
  }

  const sanitized: IngestItem[] = [];
  let totalCount = 0;
  for (const raw of candidate.items) {
    if (!raw || typeof raw !== 'object') {
      return jsonResponse({ error: 'invalid_item' }, 400);
    }
    const item = raw as Partial<IngestItem>;
    if (typeof item.model_id !== 'string') {
      return jsonResponse({ error: 'invalid_model_id' }, 400);
    }
    if (!isValidModel(item.model_id)) {
      return jsonResponse(
        { error: 'unknown_model_id', model_id: item.model_id },
        422,
      );
    }
    if (typeof item.verb !== 'string' || item.verb.length === 0 || item.verb.length > 64) {
      return jsonResponse({ error: 'invalid_verb' }, 400);
    }
    if (typeof item.count !== 'number' || !Number.isFinite(item.count) || !Number.isInteger(item.count)) {
      return jsonResponse({ error: 'invalid_count' }, 400);
    }
    if (item.count < ACTION_ITEM_MIN_COUNT || item.count > ACTION_ITEM_MAX_COUNT) {
      return jsonResponse(
        {
          error: 'count_out_of_range',
          min: ACTION_ITEM_MIN_COUNT,
          max: ACTION_ITEM_MAX_COUNT,
        },
        400,
      );
    }
    if (typeof item.t !== 'number' || !Number.isFinite(item.t)) {
      return jsonResponse({ error: 'invalid_t' }, 400);
    }
    totalCount += item.count;
    if (totalCount > ACTION_BATCH_MAX_TOTAL_COUNT) {
      return jsonResponse(
        {
          error: 'batch_total_too_large',
          max_total: ACTION_BATCH_MAX_TOTAL_COUNT,
        },
        413,
      );
    }
    sanitized.push({
      model_id: item.model_id,
      verb: item.verb,
      count: item.count,
      t: item.t,
    });
  }

  // Unknown verbs are accepted per-request so the client can extend the
  // ability roster without a worker redeploy. Polarity-bucketing happens
  // at aggregation time (cron/aggregate.ts), where unknowns are logged and
  // default to 'hurt'.

  const shardId = shardIdFor(user.id);
  const stub = env.ACTION_SHARD.get(env.ACTION_SHARD.idFromName(shardId));
  const result = await stub.ingest({
    user_id: user.id,
    batch_id: candidate.batch_id,
    items: sanitized,
  });

  return jsonResponse(result, 200);
}
