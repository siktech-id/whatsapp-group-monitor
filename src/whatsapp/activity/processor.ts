import type { ActivityEventType } from '../../db/schema.js'

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
