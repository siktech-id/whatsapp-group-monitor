import type { FastifyInstance } from 'fastify'
import { getSock } from '../../whatsapp/client.js'
import { isAccountDbReady } from '../../db/account.js'
import { requireApiKeyOrSession, requireScope, isApiKeyRequest, verifyCsrf } from '../middleware/auth.js'
import { insertOutgoingMessage, updateOutgoingMessageStatus, getRecentOutgoingMessages } from '../../db/queries/outgoing-messages.js'
import { logger } from '../../utils/logger.js'

function normalizeRecipient(recipient: string): string {
  if (recipient.includes('@')) return recipient
  return `${recipient}@s.whatsapp.net`
}

export function registerMessageRoutes(app: FastifyInstance) {
  app.post<{ Body: { recipient: string; text: string } }>(
    '/api/messages/send',
    { preHandler: [requireApiKeyOrSession, requireScope('send')] },
    async (req, reply) => {
      if (!isApiKeyRequest(req) && !verifyCsrf(req)) {
        return reply.status(403).send({ error: 'Invalid CSRF token' })
      }

      if (!isAccountDbReady()) {
        return reply.status(503).send({ error: 'Not connected' })
      }

      const { recipient, text } = req.body

      if (!recipient || !text) {
        return reply.status(400).send({ error: 'Missing recipient or text' })
      }

      if (text.length > 16384) {
        return reply.status(400).send({ error: 'Message too long (max 16KB)' })
      }

      const normalizedRecipient = normalizeRecipient(recipient)
      const messageId = await insertOutgoingMessage(normalizedRecipient, text, req.apiClient?.id)

      try {
        const sock = getSock()
        const sentMessage = await sock.sendMessage(normalizedRecipient, { text })

        await updateOutgoingMessageStatus(messageId, 'sent', {
          whatsappMessageId: sentMessage?.key?.id || undefined,
        })

        logger.info({ messageId, recipient: normalizedRecipient, client: req.apiClient?.name ?? 'admin' }, 'Message sent')
        return reply.send({ ok: true, messageId, whatsappMessageId: sentMessage?.key?.id || null })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        await updateOutgoingMessageStatus(messageId, 'failed', { error: errorMsg })

        logger.error({ messageId, recipient: normalizedRecipient, error: errorMsg }, 'Failed to send message')
        return reply.status(500).send({ error: 'Failed to send message', details: errorMsg })
      }
    }
  )

  app.post<{ Params: { jid: string }; Body: { text: string } }>(
    '/api/groups/:jid/send',
    { preHandler: [requireApiKeyOrSession, requireScope('send')] },
    async (req, reply) => {
      if (!isApiKeyRequest(req) && !verifyCsrf(req)) {
        return reply.status(403).send({ error: 'Invalid CSRF token' })
      }

      if (!isAccountDbReady()) {
        return reply.status(503).send({ error: 'Not connected' })
      }

      const { jid } = req.params
      const { text } = req.body

      if (!text) {
        return reply.status(400).send({ error: 'Missing text' })
      }

      if (text.length > 16384) {
        return reply.status(400).send({ error: 'Message too long (max 16KB)' })
      }

      const messageId = await insertOutgoingMessage(jid, text, req.apiClient?.id)

      try {
        const sock = getSock()
        const sentMessage = await sock.sendMessage(jid, { text })

        await updateOutgoingMessageStatus(messageId, 'sent', {
          whatsappMessageId: sentMessage?.key?.id || undefined,
        })

        logger.info({ messageId, groupJid: jid, client: req.apiClient?.name ?? 'admin' }, 'Group message sent')
        return reply.send({ ok: true, messageId, whatsappMessageId: sentMessage?.key?.id || null })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        await updateOutgoingMessageStatus(messageId, 'failed', { error: errorMsg })

        logger.error({ messageId, groupJid: jid, error: errorMsg }, 'Failed to send group message')
        return reply.status(500).send({ error: 'Failed to send message', details: errorMsg })
      }
    }
  )

  app.get(
    '/api/messages/sent',
    { preHandler: [requireApiKeyOrSession, requireScope('read')] },
    async (req, reply) => {
      if (!isAccountDbReady()) {
        return reply.status(503).send({ error: 'Not connected' })
      }

      // API clients only see their own sends; admin sessions see everything
      const messages = await getRecentOutgoingMessages(50, req.apiClient?.id)
      return reply.send({ messages })
    }
  )
}
