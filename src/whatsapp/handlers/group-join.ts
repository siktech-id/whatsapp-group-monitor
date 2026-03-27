import type { WASocket, GroupMetadata } from 'baileys'
import { logger } from '../../utils/logger.js'
import { upsertGroupFromMetadata } from '../../db/queries/groups.js'
import { syncGroupParticipants } from '../../db/queries/members.js'
import { isAccountDbReady } from '../../db/account.js'

type GroupUpsert = GroupMetadata & { author?: string; authorPn?: string }

export async function handleGroupsUpsert(groups: GroupUpsert[], sock: WASocket) {
  if (!isAccountDbReady()) return
  const botJid = sock.user?.id
  if (!botJid) return

  for (const group of groups) {
    logger.info({ groupJid: group.id, name: group.subject }, 'Bot added to new group')
    try {
      const meta = await sock.groupMetadata(group.id)
      upsertGroupFromMetadata(meta, botJid, sock.user?.lid)
      syncGroupParticipants(meta.id, meta.participants)
      logger.info({ groupJid: meta.id, name: meta.subject, participants: meta.participants.length }, 'Group and participants synced')
    } catch (err) {
      logger.error({ groupJid: group.id, err }, 'Failed to fetch and sync group metadata')
    }
  }
}
