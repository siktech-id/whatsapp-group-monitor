import type { FastifyRequest, FastifyReply } from 'fastify'
import crypto from 'crypto'
import { config } from '../../config.js'

declare module 'fastify' {
  interface Session {
    authenticated?: boolean
    csrfToken?: string
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
  const apiKey = req.headers['x-api-key'] as string | undefined
  if (!apiKey || apiKey !== config.apiKey) {
    return reply.status(401).send({ error: 'Unauthorized: Invalid or missing API key' })
  }
}

export async function requireApiKeyOrSession(req: FastifyRequest, reply: FastifyReply) {
  const apiKey = req.headers['x-api-key'] as string | undefined

  if (apiKey) {
    await requireApiKey(req, reply)
  } else {
    await requireAuthApi(req, reply)
  }
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
