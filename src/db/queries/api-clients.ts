import crypto from 'crypto'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { getSharedDb } from '../shared.js'
import { apiClients, apiScopes, type ApiClient, type ApiScope } from '../schema.js'

export interface AuthenticatedClient {
  id: number
  name: string
  scopes: ApiScope[]
}

/** Public view of a client — never includes the key hash. */
export type ApiClientInfo = Omit<ApiClient, 'keyHash'>

const KEY_PREFIX = 'bwa_'
const LOOKUP_CACHE_TTL_MS = 60_000
const TOUCH_INTERVAL_MS = 60_000

const lookupCache = new Map<string, { client: AuthenticatedClient; expires: number }>()
const lastTouched = new Map<number, number>()

export function hashKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex')
}

export function isValidScope(scope: unknown): scope is ApiScope {
  return typeof scope === 'string' && (apiScopes as readonly string[]).includes(scope)
}

function toInfo(row: ApiClient): ApiClientInfo {
  const { keyHash: _omit, ...info } = row
  return info
}

export async function createApiClient(name: string, scopes: ApiScope[]): Promise<{ client: ApiClientInfo; rawKey: string }> {
  const db = getSharedDb()
  const rawKey = KEY_PREFIX + crypto.randomBytes(32).toString('base64url')
  const rows = await db.insert(apiClients).values({
    name,
    keyPrefix: rawKey.slice(0, 8),
    keyHash: hashKey(rawKey),
    scopes,
    createdAt: new Date(),
  }).returning()
  return { client: toInfo(rows[0]), rawKey }
}

export async function listApiClients(): Promise<ApiClientInfo[]> {
  const db = getSharedDb()
  const rows = await db.select().from(apiClients).orderBy(asc(apiClients.createdAt))
  return rows.map(toInfo)
}

export async function getApiClientByName(name: string): Promise<ApiClientInfo | null> {
  const db = getSharedDb()
  const rows = await db.select().from(apiClients).where(eq(apiClients.name, name)).limit(1)
  return rows[0] ? toInfo(rows[0]) : null
}

/** Revoke a key. Returns false if it doesn't exist or is already revoked. */
export async function revokeApiClient(id: number): Promise<boolean> {
  const db = getSharedDb()
  const rows = await db.update(apiClients)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiClients.id, id), isNull(apiClients.revokedAt)))
    .returning({ id: apiClients.id })
  // Drop cached lookups so the revocation takes effect immediately
  lookupCache.clear()
  return rows.length > 0
}

/** Resolve a raw key to an active (non-revoked) client, or null. */
export async function findActiveClientByKey(rawKey: string): Promise<AuthenticatedClient | null> {
  const keyHash = hashKey(rawKey)
  const now = Date.now()
  const cached = lookupCache.get(keyHash)
  if (cached && cached.expires > now) return cached.client

  const db = getSharedDb()
  const rows = await db.select({ id: apiClients.id, name: apiClients.name, scopes: apiClients.scopes })
    .from(apiClients)
    .where(and(eq(apiClients.keyHash, keyHash), isNull(apiClients.revokedAt)))
    .limit(1)

  const client = rows[0] ?? null
  // Cache hits only — caching misses would let random invalid keys grow the map unbounded
  if (client) lookupCache.set(keyHash, { client, expires: now + LOOKUP_CACHE_TTL_MS })
  return client
}

/** Update last_used_at, at most once per minute per client. Fire-and-forget. */
export function touchLastUsed(id: number): void {
  const now = Date.now()
  if ((lastTouched.get(id) ?? 0) + TOUCH_INTERVAL_MS > now) return
  lastTouched.set(id, now)
  getSharedDb().update(apiClients)
    .set({ lastUsedAt: new Date(now) })
    .where(eq(apiClients.id, id))
    .catch(() => { /* non-critical */ })
}
