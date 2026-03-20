import type { BaileysEventMap } from 'baileys'
import { logger } from '../../utils/logger.js'
import { isAccountDbReady } from '../../db/account.js'
import { updateDisplayName } from '../../db/queries/users.js'
import { cacheMessage } from '../client.js'
import { ActivityRecord } from '../activity/record.js'

export function handleMessagesUpsert(event: BaileysEventMap['messages.upsert']) {
  if (!isAccountDbReady()) return
  const { messages, type } = event
  if (type !== 'notify' && type !== 'append') return

  for (const msg of messages) {
    const groupJid = msg.key.remoteJid
    if (!groupJid || !groupJid.endsWith('@g.us')) continue

    // Cache messages that have messageSecret (polls, events) for later decryption
    if (msg.message?.messageContextInfo?.messageSecret) {
      cacheMessage(msg)
    }

    const record = ActivityRecord.fromMessage(msg, groupJid)
    if (!record) continue

    if (msg.pushName && record.userJid) {
      updateDisplayName(record.userJid, msg.pushName)
    }

    record.saveAndProcess()

    logger.debug({ groupJid, messageId: record.messageId, eventType: record.eventType }, 'Activity logged')
  }
}
