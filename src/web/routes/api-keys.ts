import type { FastifyInstance } from 'fastify'
import { sendPage } from '../server.js'
import { requireAuth, requireAuthApi, generateCsrf, verifyCsrf } from '../middleware/auth.js'
import { createApiClient, listApiClients, revokeApiClient, getApiClientByName, isValidScope } from '../../db/queries/api-clients.js'
import type { ApiScope } from '../../db/schema.js'
import { logger } from '../../utils/logger.js'

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/

/** Admin-only (session) management of per-client API keys. */
export function registerApiKeyRoutes(app: FastifyInstance) {
  app.get('/api-keys', { preHandler: requireAuth }, async (req, reply) => {
    generateCsrf(req)
    return await sendPage(reply, 'api-keys.html', req)
  })

  app.get('/api/api-keys', { preHandler: requireAuthApi }, async (_req, reply) => {
    return reply.send({ clients: await listApiClients() })
  })

  app.post<{ Body: { name?: unknown; scopes?: unknown } }>(
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

      const rawScopes = req.body?.scopes
      if (!Array.isArray(rawScopes) || rawScopes.length === 0 || !rawScopes.every(isValidScope)) {
        return reply.status(400).send({ error: 'Scopes must be a non-empty list of: read, send, settings' })
      }
      const scopes = [...new Set(rawScopes)] as ApiScope[]

      if (await getApiClientByName(name)) {
        return reply.status(409).send({ error: 'A client with this name already exists' })
      }

      const { client, rawKey } = await createApiClient(name, scopes)
      logger.info({ clientId: client.id, name, scopes }, 'API client created')
      // The raw key is returned only here and never stored
      return reply.send({ client, key: rawKey })
    }
  )

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
