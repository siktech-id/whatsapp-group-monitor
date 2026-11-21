import type { FastifyInstance, FastifyRequest } from 'fastify'
import { config } from '../config.js'
import { logger } from '../utils/logger.js'
import { findActiveClientByKey } from '../db/queries/api-clients.js'
import { enqueueApiLog, flushApiLogs, purgeApiLogsOlderThan, startApiLogWriter } from '../db/queries/api-logs.js'

const MAX_BODY_CHARS = 4096
const MAX_ERROR_CHARS = 1000

declare module 'fastify' {
  interface FastifyRequest {
    /** Error text captured from a 4xx/5xx response, for the request log. */
    apiLogError?: string
  }
}

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max) + `… [truncated ${s.length - max} chars]` : s
}

function serializeBody(body: unknown): string | null {
  if (body === undefined || body === null || body === '') return null
  try {
    return truncate(typeof body === 'string' ? body : JSON.stringify(body), MAX_BODY_CHARS)
  } catch {
    return '[unserializable body]'
  }
}

function errorFromPayload(payload: unknown): string | undefined {
  if (typeof payload !== 'string' || !payload) return undefined
  try {
    const parsed = JSON.parse(payload)
    const parts = [parsed?.error, parsed?.details].filter(p => typeof p === 'string')
    if (parts.length) return truncate(parts.join(': '), MAX_ERROR_CHARS)
  } catch { /* not JSON */ }
  return truncate(payload, MAX_ERROR_CHARS)
}

/** Only API traffic that carries a key is logged; admin browser traffic is not. */
function shouldLog(req: FastifyRequest) {
  return req.url.startsWith('/api/') && !!req.headers['x-api-key']
}

/**
 * Logs every request that carries an x-api-key header — valid, invalid,
 * rate-limited or failing — to shared.api_request_logs.
 * The key itself is never stored, only its first 8 characters.
 */
export function registerRequestLogging(app: FastifyInstance) {
  startApiLogWriter()

  app.addHook('onSend', async (req, reply, payload) => {
    if (shouldLog(req) && reply.statusCode >= 400) {
      req.apiLogError = errorFromPayload(payload)
    }
    return payload
  })

  app.addHook('onResponse', async (req, reply) => {
    if (!shouldLog(req)) return
    const rawKey = String(req.headers['x-api-key'])
    const ua = req.headers['user-agent']

    // Capture everything before any await: once the socket closes, req.ip is gone
    const row = {
      clientId: req.apiClient?.id ?? null,
      keyPrefix: rawKey.slice(0, 8),
      method: req.method,
      route: req.routeOptions?.url ?? null,
      path: truncate(req.url, 2048),
      statusCode: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
      ip: req.ip ?? null,
      userAgent: typeof ua === 'string' ? truncate(ua, 512) : null,
      requestBody: serializeBody(req.body),
      error: req.apiLogError ?? null,
      createdAt: new Date(),
    }

    // A valid key on a session-only endpoint never ran requireApiKey; resolve it
    // (cached for valid keys) so the log still shows which client it was.
    if (row.clientId === null && !req.apiKeyChecked) {
      try { row.clientId = (await findActiveClientByKey(rawKey))?.id ?? null } catch { /* ignore */ }
    }

    enqueueApiLog(row)
  })

  app.addHook('onClose', async () => {
    await flushApiLogs()
  })
}

/** Delete logs older than the retention window: once at startup, then daily. */
export function startLogRetention() {
  const run = async () => {
    try {
      const deleted = await purgeApiLogsOlderThan(config.apiLogRetentionDays)
      if (deleted) logger.info({ deleted, days: config.apiLogRetentionDays }, 'Purged old API request logs')
    } catch (err) {
      logger.error({ error: err }, 'Failed to purge API request logs')
    }
  }
  void run()
  setInterval(run, 24 * 60 * 60 * 1000).unref()
}
