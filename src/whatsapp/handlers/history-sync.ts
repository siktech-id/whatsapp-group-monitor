import type { BaileysEventMap, WASocket } from 'baileys'
import { proto } from 'baileys'
import { logger } from '../../utils/logger.js'
import { isAccountDbReady } from '../../db/account.js'
import {
  hasActivityForGroup,
  getNewestActivity,
  getOldestActivity,
  updateGroupSyncing,
  getSyncingGroups,
} from '../../db/queries/activity.js'
import { ActivityRecord } from '../activity/record.js'
import { processPendingRecords } from '../activity/processor.js'

export function handleHistorySync(
  event: BaileysEventMap['messaging-history.set'],
  sock: WASocket,
) {
  if (!isAccountDbReady()) return

  const { messages, syncType, isLatest, progress } = event
  logger.info({ syncType, messageCount: messages.length, isLatest, progress }, 'History sync received')

  // Filter to group messages only
  const groupMessages = messages.filter(m => m.key.remoteJid?.endsWith('@g.us'))
  if (groupMessages.length === 0) {
    logger.debug('No group messages in history sync batch')
    checkSyncComplete()
    return
  }

  // Group by chat
  const byGroup = new Map<string, typeof groupMessages>()
  for (const msg of groupMessages) {
    const jid = msg.key.remoteJid!
    if (!byGroup.has(jid)) byGroup.set(jid, [])
    byGroup.get(jid)!.push(msg)
  }

  for (const [groupJid, msgs] of byGroup) {
    processGroupHistory(groupJid, msgs, sock)
  }

  // Check if all groups are done syncing
  if (isLatest) {
    checkSyncComplete()
  }
}

function processGroupHistory(groupJid: string, messages: BaileysEventMap['messaging-history.set']['messages'], sock: WASocket) {
  const hadExistingRecords = hasActivityForGroup(groupJid)
  let inserted = 0
  let skipped = 0

  // Determine processed value: -1 for first-time history (unprocessable), 0 for backfill
  const processedValue = hadExistingRecords ? 0 : -1

  for (const msg of messages) {
    const record = ActivityRecord.fromMessage(msg, groupJid)
    if (!record) continue

    const wasInserted = record.save(processedValue as -1 | 0)
    if (wasInserted) inserted++
    else skipped++
  }

  logger.info({ groupJid, inserted, skipped, processedValue }, 'Group history batch processed')

  // Gap detection: if we had existing records and no overlap, there might be a gap
  if (hadExistingRecords && skipped === 0 && inserted > 0) {
    // All messages were new — possible gap between history and existing records
    const oldest = getOldestActivity(groupJid)
    const oldestHistoryMsg = messages
      .map(m => ({ id: m.key.id ?? undefined, ts: Number(m.messageTimestamp || 0) }))
      .sort((a, b) => a.ts - b.ts)[0]

    if (oldest && oldestHistoryMsg && oldestHistoryMsg.ts > oldest.timestamp) {
      // History messages are all newer than our oldest — no gap (history is more recent)
    } else if (oldest && oldestHistoryMsg) {
      // There might be messages between our newest and the oldest history message
      // Request on-demand history to fill the gap
      const newestExisting = getNewestActivity(groupJid)
      if (newestExisting) {
        logger.info({ groupJid, gapFrom: newestExisting.timestamp, gapTo: oldestHistoryMsg.ts }, 'Gap detected, requesting on-demand history')
        requestGapFill(groupJid, oldestHistoryMsg, sock)
      }
    }
  }
}

async function requestGapFill(
  groupJid: string,
  oldestMsg: { id: string | undefined; ts: number },
  sock: WASocket,
) {
  if (!oldestMsg.id) return
  try {
    await sock.fetchMessageHistory(50, {
      remoteJid: groupJid,
      id: oldestMsg.id,
      fromMe: false,
    }, oldestMsg.ts)
    logger.debug({ groupJid }, 'On-demand history requested for gap fill')
  } catch (err) {
    logger.error({ groupJid, err }, 'Failed to request on-demand history')
  }
}

function checkSyncComplete() {
  const stillSyncing = getSyncingGroups()
  if (stillSyncing.length === 0) return

  logger.info({ groups: stillSyncing.length }, 'History sync complete, processing pending records')
  for (const groupJid of stillSyncing) {
    processPendingRecords(groupJid)
  }
}
