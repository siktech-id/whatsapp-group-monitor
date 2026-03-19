import type { WASocket } from 'baileys'
import { handleConnectionUpdate, updateBotUser } from './handlers/connection.js'
import { syncGroups } from './handlers/group-sync.js'
import { handleMessagesUpsert } from './handlers/activity.js'
import { handleMessagesReaction } from './handlers/activity-reactions.js'
import { handleHistorySync } from './handlers/history-sync.js'
import { logger } from '../utils/logger.js'

export function setupEventHandlers(sock: WASocket, saveCreds: () => Promise<void>) {
  sock.ev.process(async (events) => {
    if (events['connection.update']) {
      handleConnectionUpdate(events['connection.update'], sock.user)

      if (events['connection.update'].connection === 'open') {
        syncGroups(sock)
      }
    }

    if (events['creds.update']) {
      await saveCreds()
      updateBotUser(events['creds.update'].me)
      logger.debug('Credentials saved')
    }

    if (events['messages.upsert']) {
      handleMessagesUpsert(events['messages.upsert'])
    }

    if (events['messages.reaction']) {
      handleMessagesReaction(events['messages.reaction'])
    }

    if (events['messaging-history.set']) {
      handleHistorySync(events['messaging-history.set'], sock)
    }
  })
}
