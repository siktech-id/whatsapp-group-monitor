import type { ActivityEventType } from '../../db/schema.js'
import { getPendingActivities, markProcessed, updateGroupSyncing } from '../../db/queries/activity.js'
import { logger } from '../../utils/logger.js'

export interface ProcessableRecord {
  groupJid: string
  userJid: string
  messageId: string
  eventType: ActivityEventType
  metadata: Record<string, unknown> | null
  timestamp: number
}

/** Process a single activity record. Currently a no-op placeholder.
 *  Future: welcome messages, spam detection, notifications, etc. */
export function processRecord(_record: ProcessableRecord): void {
  // no-op for now
}

/** Process all pending records (processed=0) for a group, oldest first.
 *  Called after history sync completes for that group. */
export function processPendingRecords(groupJid: string): void {
  const pending = getPendingActivities(groupJid)
  if (pending.length === 0) {
    updateGroupSyncing(groupJid, 0)
    return
  }

  logger.info({ groupJid, count: pending.length }, 'Processing pending activity records')

  for (const row of pending) {
    processRecord(row)
    markProcessed(row.id)
  }

  updateGroupSyncing(groupJid, 0)
  logger.info({ groupJid }, 'Group sync complete, all pending records processed')
}
