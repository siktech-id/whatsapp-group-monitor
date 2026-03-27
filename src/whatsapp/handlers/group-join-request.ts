import type { WASocket, BaileysEventMap } from 'baileys'
import { logger } from '../../utils/logger.js'
import { upsertUser } from '../../db/queries/users.js'
import { upsertMembership } from '../../db/queries/members.js'
import { isAccountDbReady } from '../../db/account.js'

type JoinRequest = BaileysEventMap['group.join-request']

export async function handleGroupJoinRequest(event: JoinRequest, _sock: WASocket) {
  if (!isAccountDbReady()) return
  const { id: groupJid, participant, participantPn, action } = event

  if (action === 'created') {
    upsertUser(participant, { phoneNumber: participantPn || undefined })
    upsertMembership(groupJid, participant, 'pending_approval')
    logger.info({ groupJid, participant }, 'Join request - marked pending_approval')
  } else if (action === 'rejected' || action === 'revoked') {
    upsertMembership(groupJid, participant, 'none')
    logger.info({ groupJid, participant, action }, 'Join request cancelled')
  }
}
