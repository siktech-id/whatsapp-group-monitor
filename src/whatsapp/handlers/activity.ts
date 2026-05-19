import type { BaileysEventMap } from 'baileys'
import { logger } from '../../utils/logger.js'
import { isAccountDbReady } from '../../db/account.js'
import { updateDisplayName } from '../../db/queries/users.js'
import { insertIncomingMessage } from '../../db/queries/conversations.js'
import { cacheMessage } from '../client.js'
import { ActivityRecord } from '../activity/record.js'

export async function handleMessagesUpsert(event: BaileysEventMap['messages.upsert']) {
  if (!isAccountDbReady()) return
  const { messages, type } = event
  if (type !== 'notify' && type !== 'append') return

  logger.info({ type, count: messages.length }, 'Messages upsert')

  for (const msg of messages) {
    const jid = msg.key.remoteJid
    if (!jid) continue

    logger.info({ jid, fromMe: msg.key.fromMe }, 'Processing message')

    // Handle group messages
    if (jid.endsWith('@g.us')) {
      void handleGroupMessage(msg, jid)
    }
    // Handle DM messages (both @s.whatsapp.net and @lid formats)
    else if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')) {
      void handleDmMessage(msg, jid)
    }
  }
}

async function handleGroupMessage(msg: any, groupJid: string) {
  if (!groupJid.endsWith('@g.us')) return

  // Cache messages that have messageSecret (polls, events) for later decryption
  if (msg.message?.messageContextInfo?.messageSecret) {
    cacheMessage(msg)
  }

  const record = ActivityRecord.fromMessage(msg, groupJid)
  if (!record) return

  if (msg.pushName && record.userJid) {
    await updateDisplayName(record.userJid, msg.pushName)
  }

  await record.saveAndProcess()

  logger.debug({ groupJid, messageId: record.messageId, eventType: record.eventType }, 'Activity logged')
}

async function handleDmMessage(msg: any, senderJid: string) {
  logger.info({ senderJid, fromMe: msg.key.fromMe }, 'handleDmMessage')

  // Skip messages sent by self (echoes from WhatsApp)
  if (msg.key.fromMe) {
    logger.info({ senderJid }, 'Skipping self message')
    return
  }

  // Get the text content
  const textContent = msg.message?.conversation || msg.message?.extendedTextMessage?.text
  logger.info({ senderJid, hasText: !!textContent, hasId: !!msg.key.id, msgKeys: Object.keys(msg.message || {}) }, 'DM text check')
  if (!textContent || !msg.key.id) {
    logger.info({ senderJid }, 'Skipping - no text or ID')
    return
  }

  // Update sender display name if available
  if (msg.pushName) {
    await updateDisplayName(senderJid, msg.pushName)
  }

  // Store incoming message
  const timestamp = typeof msg.messageTimestamp === 'number'
    ? msg.messageTimestamp * 1000
    : Number(msg.messageTimestamp || 0) * 1000
  try {
    await insertIncomingMessage(senderJid, textContent, msg.key.id, timestamp)
    logger.info({ senderJid, messageId: msg.key.id, text: textContent }, 'Incoming DM logged')
  } catch (err) {
    logger.error({ senderJid, error: err }, 'Failed to store incoming message')
    throw err
  }
}
