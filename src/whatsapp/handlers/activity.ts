import type { BaileysEventMap } from 'baileys'
import { logger } from '../../utils/logger.js'
import { isAccountDbReady } from '../../db/account.js'
import { ActivityRecord } from '../activity/record.js'

export function handleMessagesUpsert(event: BaileysEventMap['messages.upsert']) {
  if (!isAccountDbReady()) return
  const { messages, type } = event
  if (type !== 'notify' && type !== 'append') return

  for (const msg of messages) {
    const groupJid = msg.key.remoteJid
    if (!groupJid || !groupJid.endsWith('@g.us')) continue

    const record = ActivityRecord.fromMessage(msg, groupJid)
    if (!record) continue

    record.saveAndProcess()

    logger.debug({ groupJid, messageId: record.messageId, eventType: record.eventType }, 'Activity logged')
  }
}
