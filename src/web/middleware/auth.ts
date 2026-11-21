import type { FastifyRequest, FastifyReply } from 'fastify'
import crypto from 'crypto'
import type { ApiScope } from '../../db/schema.js'
import { findActiveClientByKey, touchLastUsed, type AuthenticatedClient } from '../../db/queries/api-clients.js'
import { requestLimiter, sendLimiter, failedAuthLimiter, FAILED_AUTH_LIMIT_PER_MIN, type LimitResult } from '../rate-limit.js'

declare module 'fastify' {
  interface Session {
    authenticated?: boolean
    csrfToken?: string
  }
  interface FastifyRequest {
    /** Set when the request authenticated with a valid per-client API key. */
    apiClient?: AuthenticatedClient
    /** True once requireApiKey has looked up the x-api-key header. */
    apiKeyChecked?: boolean
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!req.session.authenticated) {
    return reply.redirect('/login')
  }
}

export async function requireAuthApi(req: FastifyRequest, reply: FastifyReply) {
  if (!req.session.authenticated) {
    return reply.status(401).send({ error: 'Unauthorized' })
  }
}

function tooManyRequests(reply: FastifyReply, r: LimitResult, what: string) {
  return reply
    .status(429)
    .header('Retry-After', String(r.resetSec))
    .send({ error: `Rate limit exceeded: ${what}`, limit: r.limit, retryAfterSec: r.resetSec })
}

export async function requireApiKey(req: FastifyRequest, reply: FastifyReply) {
  const apiKey = req.headers['x-api-key']
  const ipKey = `ip:${req.ip}`
  req.apiKeyChecked = true

  const client = typeof apiKey === 'string' && apiKey ? await findActiveClientByKey(apiKey) : null
  if (!client) {
    // Throttle bad keys per IP. Valid keys are never blocked by this, so one
    // misconfigured client can't lock out others sharing the same outbound IP.
    const r = failedAuthLimiter.consume(ipKey, FAILED_AUTH_LIMIT_PER_MIN)
    if (!r.allowed) {
      return tooManyRequests(reply, r, `${FAILED_AUTH_LIMIT_PER_MIN} failed key attempts per minute`)
    }
    return reply.status(401).send({ error: 'Unauthorized: Invalid or missing API key' })
  }

  req.apiClient = client
  touchLastUsed(client.id)

  const r = requestLimiter.consume(`client:${client.id}`, client.rateLimitPerMin)
  reply.header('X-RateLimit-Limit', String(r.limit))
  reply.header('X-RateLimit-Remaining', String(r.remaining))
  reply.header('X-RateLimit-Reset', String(r.resetSec))
  if (!r.allowed) {
    return tooManyRequests(reply, r, `${r.limit} requests per minute`)
  }
}

export async function requireApiKeyOrSession(req: FastifyRequest, reply: FastifyReply) {
  if (req.headers['x-api-key']) {
    return requireApiKey(req, reply)
  }
  return requireAuthApi(req, reply)
}

/**
 * Must run after requireApiKeyOrSession. Admin sessions always pass;
 * API-key clients need the given scope.
 */
export function requireScope(scope: ApiScope) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    if (!req.apiClient) return // session-authenticated admin
    if (!req.apiClient.scopes.includes(scope)) {
      return reply.status(403).send({ error: `Forbidden: missing scope '${scope}'` })
    }
  }
}

/**
 * Per-client send quota. Put it after requireScope('send') on send endpoints.
 * Admin sessions are not limited.
 */
export async function requireSendQuota(req: FastifyRequest, reply: FastifyReply) {
  const client = req.apiClient
  if (!client) return
  const r = sendLimiter.consume(`client:${client.id}`, client.sendLimitPerMin)
  reply.header('X-SendLimit-Limit', String(r.limit))
  reply.header('X-SendLimit-Remaining', String(r.remaining))
  if (!r.allowed) {
    return tooManyRequests(reply, r, `${r.limit} sends per minute`)
  }
}

/** True when the request was authenticated with a valid API key (not a session). */
export function isApiKeyRequest(req: FastifyRequest): boolean {
  return !!req.apiClient
}

/** Generate a CSRF token if not present, return it */
export function generateCsrf(req: FastifyRequest): string {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex')
  }
  return req.session.csrfToken
}

/** Verify CSRF token from POST body (_csrf) or header (x-csrf-token) */
export function verifyCsrf(req: FastifyRequest): boolean {
  const sessionToken = req.session.csrfToken
  if (!sessionToken) return false

  const body = req.body as Record<string, unknown> | undefined
  const bodyToken = body?._csrf as string | undefined
  const headerToken = req.headers['x-csrf-token'] as string | undefined

  return bodyToken === sessionToken || headerToken === sessionToken
}
