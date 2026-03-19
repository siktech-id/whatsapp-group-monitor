import { type BaileysEventMap, jidNormalizedUser } from 'baileys'
import { logger } from '../../utils/logger.js'
import { isAccountDbReady } from '../../db/account.js'
import { isGroupSyncing } from '../../db/queries/activity.js'
import { ActivityRecord } from '../activity/record.js'

export function handleMessagesReaction(reactions: BaileysEventMap['messages.reaction']) {
  if (!isAccountDbReady()) return

  for (const { key, reaction } of reactions) {
    const groupJid = key.remoteJid
    if (!groupJid || !groupJid.endsWith('@g.us')) continue

    const reactorJid = reaction.key?.participant
      ? jidNormalizedUser(reaction.key.participant)
      : reaction.key?.fromMe ? 'self' : null
    if (!reactorJid) continue

    const record = ActivityRecord.fromReaction(key, reaction, reactorJid)
    if (!record) continue

    const syncing = isGroupSyncing(groupJid)
    record.saveAndProcess(!syncing)

    logger.debug({ groupJid, messageId: record.messageId, emoji: reaction.text }, 'Reaction logged')
  }
}
