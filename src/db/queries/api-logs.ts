import { and, desc, eq, gte, ilike, isNull, lt, sql, type SQL } from 'drizzle-orm'
import { getSharedDb } from '../shared.js'
import { apiClients, apiRequestLogs } from '../schema.js'
import { logger } from '../../utils/logger.js'

export type NewApiLog = typeof apiRequestLogs.$inferInsert

// --- Buffered writer: requests never wait on the log insert ---

const FLUSH_INTERVAL_MS = 2_000
const FLUSH_BATCH = 200
const MAX_BUFFER = 10_000

let buffer: NewApiLog[] = []
let flushing = false
let timer: NodeJS.Timeout | null = null

export function enqueueApiLog(row: NewApiLog) {
  if (buffer.length >= MAX_BUFFER) buffer.shift() // DB unavailable for a while: drop oldest
  buffer.push(row)
  if (buffer.length >= FLUSH_BATCH) void flushApiLogs()
}

export async function flushApiLogs() {
  if (flushing || buffer.length === 0) return
  flushing = true
  const batch = buffer.splice(0, FLUSH_BATCH)
  try {
    await getSharedDb().insert(apiRequestLogs).values(batch)
  } catch (err) {
    logger.error({ error: err, dropped: batch.length }, 'Failed to write API request logs')
  } finally {
    flushing = false
  }
  if (buffer.length >= FLUSH_BATCH) void flushApiLogs()
}

export function startApiLogWriter() {
  if (timer) return
  timer = setInterval(() => void flushApiLogs(), FLUSH_INTERVAL_MS)
  timer.unref()
}

// --- Retention ---

export async function purgeApiLogsOlderThan(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000)
  const rows = await getSharedDb().delete(apiRequestLogs)
    .where(lt(apiRequestLogs.createdAt, cutoff))
    .returning({ id: apiRequestLogs.id })
  return rows.length
}

// --- Filters shared by list + stats ---

export interface LogFilters {
  clientId?: number | 'unknown'
  status?: '2xx' | '4xx' | '5xx' | '429' | 'errors'
  method?: string
  route?: string
  search?: string
  since: Date
}

function whereFor(f: LogFilters): SQL | undefined {
  const c: SQL[] = [gte(apiRequestLogs.createdAt, f.since)]
  if (f.clientId === 'unknown') c.push(isNull(apiRequestLogs.clientId))
  else if (typeof f.clientId === 'number') c.push(eq(apiRequestLogs.clientId, f.clientId))
  if (f.method) c.push(eq(apiRequestLogs.method, f.method))
  if (f.route) c.push(eq(apiRequestLogs.route, f.route))
  if (f.search) {
    const escaped = f.search.replace(/[\\%_]/g, m => '\\' + m)
    c.push(ilike(apiRequestLogs.path, `%${escaped}%`))
  }
  switch (f.status) {
    case '2xx': c.push(sql`${apiRequestLogs.statusCode} < 400`); break
    case '4xx': c.push(sql`${apiRequestLogs.statusCode} between 400 and 499 and ${apiRequestLogs.statusCode} <> 429`); break
    case '429': c.push(eq(apiRequestLogs.statusCode, 429)); break
    case '5xx': c.push(sql`${apiRequestLogs.statusCode} >= 500`); break
    case 'errors': c.push(sql`${apiRequestLogs.statusCode} >= 400`); break
  }
  return and(...c)
}

// --- Log list (cursor pagination by id) ---

export async function listApiLogs(f: LogFilters, opts: { before?: number; limit: number }) {
  const where = opts.before ? and(whereFor(f), lt(apiRequestLogs.id, opts.before)) : whereFor(f)
  const rows = await getSharedDb()
    .select({
      id: apiRequestLogs.id,
      clientId: apiRequestLogs.clientId,
      clientName: apiClients.name,
      keyPrefix: apiRequestLogs.keyPrefix,
      method: apiRequestLogs.method,
      route: apiRequestLogs.route,
      path: apiRequestLogs.path,
      statusCode: apiRequestLogs.statusCode,
      durationMs: apiRequestLogs.durationMs,
      ip: apiRequestLogs.ip,
      userAgent: apiRequestLogs.userAgent,
      requestBody: apiRequestLogs.requestBody,
      error: apiRequestLogs.error,
      createdAt: apiRequestLogs.createdAt,
    })
    .from(apiRequestLogs)
    .leftJoin(apiClients, eq(apiClients.id, apiRequestLogs.clientId))
    .where(where)
    .orderBy(desc(apiRequestLogs.id))
    .limit(opts.limit + 1)

  const hasMore = rows.length > opts.limit
  const logs = hasMore ? rows.slice(0, opts.limit) : rows
  return { logs, nextBefore: hasMore ? logs[logs.length - 1].id : null }
}

// --- Aggregates for the logs page ---

const n = (v: unknown) => Number(v ?? 0)

export async function getApiLogStats(f: LogFilters, bucket: 'hour' | 'day') {
  const db = getSharedDb()
  const where = whereFor(f)
  const L = apiRequestLogs

  const [totals] = await db.select({
    total: sql`count(*)`,
    ok: sql`count(*) filter (where ${L.statusCode} < 400)`,
    clientErrors: sql`count(*) filter (where ${L.statusCode} between 400 and 499 and ${L.statusCode} <> 429)`,
    rateLimited: sql`count(*) filter (where ${L.statusCode} = 429)`,
    serverErrors: sql`count(*) filter (where ${L.statusCode} >= 500)`,
    avgMs: sql`coalesce(avg(${L.durationMs}), 0)`,
    p95Ms: sql`coalesce(percentile_cont(0.95) within group (order by ${L.durationMs}), 0)`,
  }).from(L).where(where)

  const bucketExpr = sql`date_trunc(${sql.raw(`'${bucket}'`)}, ${L.createdAt})`
  const series = await db.select({
    t: sql<Date>`${bucketExpr}`,
    ok: sql`count(*) filter (where ${L.statusCode} < 400)`,
    errors: sql`count(*) filter (where ${L.statusCode} >= 400)`,
  }).from(L).where(where).groupBy(bucketExpr).orderBy(bucketExpr)

  const byRoute = await db.select({
    method: L.method,
    route: L.route,
    total: sql`count(*)`,
    errors: sql`count(*) filter (where ${L.statusCode} >= 400)`,
    avgMs: sql`coalesce(avg(${L.durationMs}), 0)`,
  }).from(L).where(where).groupBy(L.method, L.route).orderBy(sql`count(*) desc`).limit(20)

  const byClient = await db.select({
    clientId: L.clientId,
    clientName: apiClients.name,
    total: sql`count(*)`,
    errors: sql`count(*) filter (where ${L.statusCode} >= 400)`,
    rateLimited: sql`count(*) filter (where ${L.statusCode} = 429)`,
  }).from(L).leftJoin(apiClients, eq(apiClients.id, L.clientId))
    .where(where).groupBy(L.clientId, apiClients.name).orderBy(sql`count(*) desc`)

  return {
    totals: {
      total: n(totals.total),
      ok: n(totals.ok),
      clientErrors: n(totals.clientErrors),
      rateLimited: n(totals.rateLimited),
      serverErrors: n(totals.serverErrors),
      avgMs: Math.round(n(totals.avgMs)),
      p95Ms: Math.round(n(totals.p95Ms)),
    },
    bucket,
    series: series.map(s => ({ t: new Date(s.t).toISOString(), ok: n(s.ok), errors: n(s.errors) })),
    byRoute: byRoute.map(r => ({ method: r.method, route: r.route, total: n(r.total), errors: n(r.errors), avgMs: Math.round(n(r.avgMs)) })),
    byClient: byClient.map(c => ({ clientId: c.clientId, clientName: c.clientName, total: n(c.total), errors: n(c.errors), rateLimited: n(c.rateLimited) })),
  }
}

/** Last-24h counts per client, for the API Keys list. Key `null` = unidentified keys. */
export async function getClientUsage24h() {
  const L = apiRequestLogs
  const rows = await getSharedDb().select({
    clientId: L.clientId,
    total: sql`count(*)`,
    errors: sql`count(*) filter (where ${L.statusCode} >= 400 and ${L.statusCode} <> 429)`,
    rateLimited: sql`count(*) filter (where ${L.statusCode} = 429)`,
    lastAt: sql<Date>`max(${L.createdAt})`,
  }).from(L)
    .where(gte(L.createdAt, new Date(Date.now() - 86_400_000)))
    .groupBy(L.clientId)
  return rows.map(r => ({
    clientId: r.clientId,
    total: n(r.total),
    errors: n(r.errors),
    rateLimited: n(r.rateLimited),
    lastAt: r.lastAt ? new Date(r.lastAt).toISOString() : null,
  }))
}
