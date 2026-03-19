import type { BaileysEventMap } from 'baileys'
import { logger } from '../../utils/logger.js'
import { isAccountDbReady } from '../../db/account.js'
import { isGroupSyncing } from '../../db/queries/activity.js'
import { ActivityRecord } from '../activity/record.js'

export function handleMessagesUpsert(event: BaileysEventMap['messages.upsert']) {
  if (!isAccountDbReady()) return
  const { messages, type } = event
  if (type !== 'notify') return

  for (const msg of messages) {
    const groupJid = msg.key.remoteJid
    if (!groupJid || !groupJid.endsWith('@g.us')) continue

    const record = ActivityRecord.fromMessage(msg, groupJid)
    if (!record) continue

    const syncing = isGroupSyncing(groupJid)
    record.saveAndProcess(!syncing)

    logger.debug({ groupJid, messageId: record.messageId, eventType: record.eventType, syncing }, 'Activity logged')
  }
}
