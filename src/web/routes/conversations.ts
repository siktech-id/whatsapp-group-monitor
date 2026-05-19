import type { FastifyInstance } from 'fastify'
import { isAccountDbReady } from '../../db/account.js'
import { requireApiKeyOrSession } from '../middleware/auth.js'
import { getAllGroups } from '../../db/queries/groups.js'
import { getUser } from '../../db/queries/users.js'
import { getDistinctDmRecipients, getLastOutgoingPerRecipient, getGroupMessages, getOutgoingMessagesByRecipient, getIncomingMessagesBySender, getDistinctDmSenders } from '../../db/queries/conversations.js'
import { GroupRecord } from '../../whatsapp/group/record.js'
import { logger } from '../../utils/logger.js'

function isGroupId(id: string): boolean {
  return id.endsWith('@g.us')
}

function isDmId(id: string): boolean {
  return id.endsWith('@s.whatsapp.net') || id.endsWith('@lid')
}

export function registerConversationRoutes(app: FastifyInstance) {
  app.get(
    '/api/conversations',
    { preHandler: requireApiKeyOrSession },
    async (_req, reply) => {
      if (!isAccountDbReady()) {
        return reply.status(503).send({ error: 'Not connected' })
      }

      const conversations: any[] = []

      try {
        // Groups
        const allGroups = await getAllGroups()
        const activeGroups = allGroups.filter(g => g.botMembership !== 'none' && !g.isArchived)
        await GroupRecord.populateAllSummaries(activeGroups)

        for (const group of activeGroups) {
          conversations.push({
            id: group.jid,
            type: 'group',
            name: group.name,
            memberCount: group.memberCount,
            lastActivity: group.lastActivity,
            isArchived: group.isArchived,
            isCommunity: group.isCommunity,
          })
        }
      } catch (err) {
        logger.error({ error: err }, 'Error loading groups')
      }

      try {
        // DMs
        const dmRecipients = await getDistinctDmRecipients()
        const lastOutgoing = await getLastOutgoingPerRecipient()

        for (const { recipient } of dmRecipients) {
          const user = await getUser(recipient)
          const lastMsg = lastOutgoing.get(recipient)

          conversations.push({
            id: recipient,
            type: 'dm',
            name: user?.displayName || user?.phoneNumber || recipient.replace('@s.whatsapp.net', ''),
            lastMessageText: lastMsg?.text || null,
            lastMessageAt: lastMsg?.sentAt ? lastMsg.sentAt.toISOString() : null,
            lastMessageStatus: lastMsg?.status || null,
          })
        }
      } catch (err) {
        logger.error({ error: err }, 'Error loading DMs')
      }

      // Sort by most recent activity
      conversations.sort((a, b) => {
        const aTime = a.type === 'group' ? (a.lastActivity || 0) : (a.lastMessageAt ? new Date(a.lastMessageAt).getTime() / 1000 : 0)
        const bTime = b.type === 'group' ? (b.lastActivity || 0) : (b.lastMessageAt ? new Date(b.lastMessageAt).getTime() / 1000 : 0)
        return bTime - aTime
      })

      return reply.send({ conversations })
    }
  )

  app.get<{ Params: { id: string }; Querystring: { limit?: string; before?: string } }>(
    '/api/conversations/:id/messages',
    { preHandler: requireApiKeyOrSession },
    async (req, reply) => {
      if (!isAccountDbReady()) {
        return reply.status(503).send({ error: 'Not connected' })
      }

      const { id } = req.params
      const limit = Math.min(parseInt(req.query.limit || '50', 10), 100)
      const before = req.query.before

      if (!isGroupId(id) && !isDmId(id)) {
        return reply.status(400).send({ error: 'Invalid conversation ID format' })
      }

      if (isGroupId(id)) {
        // Group messages
        try {
          const opts: any = { limit }
          if (before) {
            const cursor = parseInt(before, 10)
            if (isNaN(cursor)) {
              return reply.status(400).send({ error: 'Invalid before cursor' })
            }
            opts.before = cursor
          }

          const messages = await getGroupMessages(id, opts)
          const userCache = new Map<string, any>()

          const enrichedMessages = await Promise.all(messages.map(async msg => {
            let senderName = msg.userJid

            if (!userCache.has(msg.userJid)) {
              try {
                const user = await getUser(msg.userJid)
                userCache.set(msg.userJid, user)
                if (user?.displayName) senderName = user.displayName
                else if (user?.phoneNumber) senderName = user.phoneNumber
              } catch {
                userCache.set(msg.userJid, null)
              }
            } else {
              const user = userCache.get(msg.userJid)
              if (user?.displayName) senderName = user.displayName
              else if (user?.phoneNumber) senderName = user.phoneNumber
            }

            return {
              id: msg.id,
              messageId: msg.messageId,
              senderJid: msg.userJid,
              senderName,
              text: (msg.metadata as any)?.text || null,
              timestamp: msg.timestamp,
              eventType: msg.eventType,
            }
          }))

          const nextCursor = enrichedMessages.length > 0 ? enrichedMessages[enrichedMessages.length - 1].timestamp : null

          return reply.send({
            conversationId: id,
            type: 'group',
            messages: enrichedMessages,
            nextCursor,
          })
        } catch (err) {
          logger.error({ error: err, groupJid: id }, 'Error loading group messages')
          return reply.status(500).send({ error: 'Failed to load messages' })
        }
      } else {
        // DM messages (both incoming and outgoing)
        try {
          const opts: any = { limit: limit * 2 }
          if (before) {
            try {
              opts.before = new Date(before)
              if (isNaN(opts.before.getTime())) {
                return reply.status(400).send({ error: 'Invalid before cursor format' })
              }
            } catch {
              return reply.status(400).send({ error: 'Invalid before cursor' })
            }
          }

          const outgoing = await getOutgoingMessagesByRecipient(id, opts)
          const incoming = await getIncomingMessagesBySender(id, opts)

          // Combine outgoing and incoming messages (no echoes since handleDmMessage skips fromMe)
          const allMessages = [
            ...outgoing.map(msg => ({
              id: msg.id,
              text: msg.text,
              status: msg.status,
              whatsappMessageId: msg.whatsappMessageId,
              timestamp: msg.sentAt || msg.createdAt,
              direction: 'outgoing' as const,
            })),
            ...incoming.map(msg => ({
              id: msg.id,
              text: msg.text,
              status: 'received' as const,
              whatsappMessageId: msg.whatsappMessageId,
              timestamp: msg.receivedAt,
              direction: 'incoming' as const,
            })),
          ].sort((a, b) => (a.timestamp?.getTime() || 0) - (b.timestamp?.getTime() || 0))
            .slice(0, limit)

          const nextCursor = allMessages.length > 0 ? allMessages[allMessages.length - 1].timestamp : null

          return reply.send({
            conversationId: id,
            type: 'dm',
            messages: allMessages,
            nextCursor,
          })
        } catch (err) {
          logger.error({ error: err, recipient: id }, 'Error loading DM messages')
          return reply.status(500).send({ error: 'Failed to load messages' })
        }
      }
    }
  )
}
