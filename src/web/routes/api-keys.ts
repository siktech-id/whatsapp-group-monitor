import type { FastifyInstance } from 'fastify'
import { sendPage } from '../server.js'
import { requireAuth, requireAuthApi, generateCsrf, verifyCsrf } from '../middleware/auth.js'
import { createApiClient, listApiClients, revokeApiClient, updateApiClient, getApiClientByName, isValidScope, LIMIT_BOUNDS } from '../../db/queries/api-clients.js'
import { listApiLogs, getApiLogStats, getClientUsage24h, type LogFilters } from '../../db/queries/api-logs.js'
import type { ApiScope } from '../../db/schema.js'
import { logger } from '../../utils/logger.js'

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/

type LimitField = keyof typeof LIMIT_BOUNDS

/** undefined = not provided; null = invalid; number = valid */
function parseLimit(value: unknown, field: LimitField): number | null | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const num = Number(value)
  const { min, max } = LIMIT_BOUNDS[field]
  return Number.isInteger(num) && num >= min && num <= max ? num : null
}

function limitError(field: LimitField) {
  const { min, max } = LIMIT_BOUNDS[field]
  return `${field} must be a whole number between ${min} and ${max}`
}

function parseScopes(raw: unknown): ApiScope[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isValidScope)) return null
  return [...new Set(raw)] as ApiScope[]
}

const RANGES: Record<string, { ms: number; bucket: 'hour' | 'day' }> = {
  '1h': { ms: 3_600_000, bucket: 'hour' },
  '24h': { ms: 86_400_000, bucket: 'hour' },
  '7d': { ms: 7 * 86_400_000, bucket: 'day' },
  '30d': { ms: 30 * 86_400_000, bucket: 'day' },
}
const STATUS_FILTERS = ['2xx', '4xx', '5xx', '429', 'errors'] as const

type LogQuery = { client?: string; range?: string; status?: string; method?: string; route?: string; q?: string; before?: string; limit?: string }

function parseLogFilters(q: LogQuery): { filters: LogFilters; bucket: 'hour' | 'day' } | { error: string } {
  const range = RANGES[q.range || '24h']
  if (!range) return { error: 'range must be one of 1h, 24h, 7d, 30d' }
  const filters: LogFilters = { since: new Date(Date.now() - range.ms) }

  if (q.client === 'unknown') filters.clientId = 'unknown'
  else if (q.client) {
    const id = Number(q.client)
    if (!Number.isInteger(id) || id <= 0) return { error: 'Invalid client' }
    filters.clientId = id
  }
  if (q.status) {
    if (!(STATUS_FILTERS as readonly string[]).includes(q.status)) return { error: 'Invalid status filter' }
    filters.status = q.status as LogFilters['status']
  }
  if (q.method) filters.method = q.method.toUpperCase().slice(0, 10)
  if (q.route) filters.route = q.route.slice(0, 200)
  if (q.q) filters.search = q.q.slice(0, 200)
  return { filters, bucket: range.bucket }
}

/** Admin-only (session) management of per-client API keys. */
export function registerApiKeyRoutes(app: FastifyInstance) {
  app.get('/api-keys', { preHandler: requireAuth }, async (req, reply) => {
    generateCsrf(req)
    return await sendPage(reply, 'api-keys.html', req)
  })

  app.get('/api-keys/logs', { preHandler: requireAuth }, async (req, reply) => {
    generateCsrf(req)
    return await sendPage(reply, 'api-logs.html', req)
  })

  app.get('/api/api-keys', { preHandler: requireAuthApi }, async (_req, reply) => {
    const [clients, usage] = await Promise.all([listApiClients(), getClientUsage24h()])
    const byId = new Map(usage.map(u => [u.clientId, u]))
    const empty = { total: 0, errors: 0, rateLimited: 0, lastAt: null }
    return reply.send({
      clients: clients.map(c => ({ ...c, usage24h: byId.get(c.id) ?? empty })),
      unknownKeys24h: byId.get(null) ?? empty,
      limitBounds: LIMIT_BOUNDS,
    })
  })

  app.post<{ Body: { name?: unknown; scopes?: unknown; rateLimitPerMin?: unknown; sendLimitPerMin?: unknown } }>(
    '/api/api-keys',
    { preHandler: requireAuthApi },
    async (req, reply) => {
      if (!verifyCsrf(req)) {
        return reply.status(403).send({ error: 'Invalid CSRF token' })
      }

      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
      if (!NAME_PATTERN.test(name)) {
        return reply.status(400).send({ error: 'Name must be 1-64 characters: letters, digits, space, _ . -' })
      }

      const scopes = parseScopes(req.body?.scopes)
      if (!scopes) {
        return reply.status(400).send({ error: 'Scopes must be a non-empty list of: read, send, settings' })
      }

      const rateLimitPerMin = parseLimit(req.body?.rateLimitPerMin, 'rateLimitPerMin')
      if (rateLimitPerMin === null) return reply.status(400).send({ error: limitError('rateLimitPerMin') })
      const sendLimitPerMin = parseLimit(req.body?.sendLimitPerMin, 'sendLimitPerMin')
      if (sendLimitPerMin === null) return reply.status(400).send({ error: limitError('sendLimitPerMin') })

      if (await getApiClientByName(name)) {
        return reply.status(409).send({ error: 'A client with this name already exists' })
      }

      const { client, rawKey } = await createApiClient(name, scopes, { rateLimitPerMin, sendLimitPerMin })
      logger.info({ clientId: client.id, name, scopes, rateLimitPerMin: client.rateLimitPerMin, sendLimitPerMin: client.sendLimitPerMin }, 'API client created')
      // The raw key is returned only here and never stored
      return reply.send({ client, key: rawKey })
    }
  )

  app.patch<{ Params: { id: string }; Body: { scopes?: unknown; rateLimitPerMin?: unknown; sendLimitPerMin?: unknown } }>(
    '/api/api-keys/:id',
    { preHandler: requireAuthApi },
    async (req, reply) => {
      if (!verifyCsrf(req)) {
        return reply.status(403).send({ error: 'Invalid CSRF token' })
      }

      const id = Number(req.params.id)
      if (!Number.isInteger(id) || id <= 0) {
        return reply.status(400).send({ error: 'Invalid id' })
      }

      const changes: { scopes?: ApiScope[]; rateLimitPerMin?: number; sendLimitPerMin?: number } = {}
      if (req.body?.scopes !== undefined) {
        const scopes = parseScopes(req.body.scopes)
        if (!scopes) return reply.status(400).send({ error: 'Scopes must be a non-empty list of: read, send, settings' })
        changes.scopes = scopes
      }
      for (const field of ['rateLimitPerMin', 'sendLimitPerMin'] as const) {
        const v = parseLimit(req.body?.[field], field)
        if (v === null) return reply.status(400).send({ error: limitError(field) })
        if (v !== undefined) changes[field] = v
      }
      if (Object.keys(changes).length === 0) {
        return reply.status(400).send({ error: 'Nothing to update' })
      }

      const client = await updateApiClient(id, changes)
      if (!client) {
        return reply.status(404).send({ error: 'Client not found or revoked' })
      }

      logger.info({ clientId: id, changes }, 'API client updated')
      return reply.send({ client })
    }
  )

  app.get<{ Querystring: LogQuery }>('/api/api-logs', { preHandler: requireAuthApi }, async (req, reply) => {
    const parsed = parseLogFilters(req.query)
    if ('error' in parsed) return reply.status(400).send({ error: parsed.error })
    const before = req.query.before ? Number(req.query.before) : undefined
    if (before !== undefined && (!Number.isInteger(before) || before <= 0)) {
      return reply.status(400).send({ error: 'Invalid before cursor' })
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10) || 50, 1), 200)
    return reply.send(await listApiLogs(parsed.filters, { before, limit }))
  })

  app.get<{ Querystring: LogQuery }>('/api/api-logs/stats', { preHandler: requireAuthApi }, async (req, reply) => {
    const parsed = parseLogFilters(req.query)
    if ('error' in parsed) return reply.status(400).send({ error: parsed.error })
    return reply.send(await getApiLogStats(parsed.filters, parsed.bucket))
  })

  app.delete<{ Params: { id: string } }>(
    '/api/api-keys/:id',
    { preHandler: requireAuthApi },
    async (req, reply) => {
      if (!verifyCsrf(req)) {
        return reply.status(403).send({ error: 'Invalid CSRF token' })
      }

      const id = Number(req.params.id)
      if (!Number.isInteger(id) || id <= 0) {
        return reply.status(400).send({ error: 'Invalid id' })
      }

      const revoked = await revokeApiClient(id)
      if (!revoked) {
        return reply.status(404).send({ error: 'Client not found or already revoked' })
      }

      logger.info({ clientId: id }, 'API client revoked')
      return reply.send({ ok: true })
    }
  )
}
