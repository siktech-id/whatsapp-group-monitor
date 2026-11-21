import type { FastifyRequest, FastifyReply } from 'fastify'
import crypto from 'crypto'
import type { ApiScope } from '../../db/schema.js'
import { findActiveClientByKey, touchLastUsed, type AuthenticatedClient } from '../../db/queries/api-clients.js'

declare module 'fastify' {
  interface Session {
    authenticated?: boolean
    csrfToken?: string
  }
  interface FastifyRequest {
    /** Set when the request authenticated with a valid per-client API key. */
    apiClient?: AuthenticatedClient
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

export async function requireApiKey(req: FastifyRequest, reply: FastifyReply) {
  const apiKey = req.headers['x-api-key']
  if (typeof apiKey !== 'string' || !apiKey) {
    return reply.status(401).send({ error: 'Unauthorized: Invalid or missing API key' })
  }

  const client = await findActiveClientByKey(apiKey)
  if (!client) {
    return reply.status(401).send({ error: 'Unauthorized: Invalid or missing API key' })
  }

  req.apiClient = client
  touchLastUsed(client.id)
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
