import { type BaileysEventMap } from 'baileys'
import { logger } from '../../utils/logger.js'
import { isAccountDbReady } from '../../db/account.js'
import { updateLastReadAt } from '../../db/queries/members.js'

export function handleMessageReceiptUpdate(updates: BaileysEventMap['message-receipt.update']) {
  if (!isAccountDbReady()) return

  for (const { key, receipt } of updates) {
    const groupJid = key.remoteJid
    if (!groupJid || !groupJid.endsWith('@g.us')) continue
    if (!receipt.readTimestamp) continue

    const userJid = receipt.userJid
    if (!userJid) continue

    const date = new Date().toISOString().slice(0, 10)

    updateLastReadAt(groupJid, userJid, date)
    logger.debug({ groupJid, userJid, date }, 'Read receipt recorded')
  }
}
