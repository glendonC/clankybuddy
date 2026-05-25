import { REFRESH_TOKEN_TTL_SEC, TOKEN_TTL_SEC } from './constants.js';
import type { Env, User } from './types.js';

// Token metadata round-trips through KV with the value. We stamp issued_at so
// authenticate() can compare it against the user's tokens_revoked_at and
// reject tokens older than the most recent revoke event without waiting for
// the access-token TTL to expire.
export interface TokenMetadata {
  issued_at: number;
}

function generateToken(): string {
  const hex = crypto.randomUUID().replace(/-/g, '');
  return `tok_${hex}`;
}

function generateRefreshToken(): string {
  const hex = crypto.randomUUID().replace(/-/g, '');
  return `rt_${hex}`;
}

export interface IssuedTokenPair {
  token: string;
  refresh_token: string;
}

export async function issueToken(env: Env, userId: string): Promise<string> {
  const token = generateToken();
  const meta: TokenMetadata = { issued_at: Date.now() };
  await env.AUTH_KV.put(`token:${token}`, userId, {
    expirationTtl: TOKEN_TTL_SEC,
    metadata: meta,
  });
  return token;
}

export async function issueRefreshToken(env: Env, userId: string): Promise<string> {
  const refresh = generateRefreshToken();
  const meta: TokenMetadata = { issued_at: Date.now() };
  await env.AUTH_KV.put(`refresh:${refresh}`, userId, {
    expirationTtl: REFRESH_TOKEN_TTL_SEC,
    metadata: meta,
  });
  return refresh;
}

export async function issueTokenPair(env: Env, userId: string): Promise<IssuedTokenPair> {
  const [token, refresh_token] = await Promise.all([
    issueToken(env, userId),
    issueRefreshToken(env, userId),
  ]);
  return { token, refresh_token };
}

export function getDb(env: Env): DurableObjectStub<import('./database.js').DatabaseDO> {
  return env.DATABASE.get(env.DATABASE.idFromName('singleton'));
}

interface KvWithMetadata<V, M> {
  value: V | null;
  metadata: M | null;
}

export async function authenticate(env: Env, request: Request): Promise<User | null> {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);

  // getWithMetadata so we can enforce tokens_revoked_at: a token whose
  // issued_at predates the user's revocation timestamp is invalid even if it
  // hasn't aged out of KV yet (≤60s propagation budget per backend-plan TUI
  // threat model, combined with the per-RoomDO bloom filter that catches
  // already-connected sockets).
  const lookup = (await env.AUTH_KV.getWithMetadata(
    `token:${token}`,
  )) as KvWithMetadata<string, TokenMetadata>;
  const userId = lookup.value;
  if (!userId) return null;

  const user = await getDb(env).getUser(userId);
  if (!user) return null;

  const revokedAt = await getDb(env).getTokensRevokedAt(userId);
  if (revokedAt != null) {
    const issued = lookup.metadata?.issued_at ?? 0;
    if (issued <= revokedAt) return null;
  }

  return user;
}
