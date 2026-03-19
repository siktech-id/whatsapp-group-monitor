import { eq, and, asc, desc, ne, sql } from 'drizzle-orm'
import { getAccountDb } from '../account.js'
import { groupActivityLog, groups } from '../schema.js'
import type { ActivityRecord } from '../../whatsapp/activity/record.js'

/** Insert activity record. Returns true if inserted, false if duplicate. */
export function insertActivity(record: ActivityRecord, processed: -1 | 0 | 1): boolean {
  const db = getAccountDb()
  try {
    db.insert(groupActivityLog).values({
      groupJid: record.groupJid,
      userJid: record.userJid,
      messageId: record.messageId,
      parentId: record.parentId,
      eventType: record.eventType,
      metadata: record.metadata,
      raw: record.raw,
      processed,
      timestamp: record.timestamp,
      createdAt: new Date(),
    }).run()
    return true
  } catch (err: any) {
    // Unique constraint violation = duplicate
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') return false
    throw err
  }
}

export function hasActivityForGroup(groupJid: string): boolean {
  const db = getAccountDb()
  const row = db.select({ id: groupActivityLog.id })
    .from(groupActivityLog)
    .where(eq(groupActivityLog.groupJid, groupJid))
    .limit(1)
    .get()
  return !!row
}

export function getNewestActivity(groupJid: string) {
  const db = getAccountDb()
  return db.select()
    .from(groupActivityLog)
    .where(eq(groupActivityLog.groupJid, groupJid))
    .orderBy(desc(groupActivityLog.timestamp))
    .limit(1)
    .get()
}

export function getOldestActivity(groupJid: string) {
  const db = getAccountDb()
  return db.select()
    .from(groupActivityLog)
    .where(eq(groupActivityLog.groupJid, groupJid))
    .orderBy(asc(groupActivityLog.timestamp))
    .limit(1)
    .get()
}

export function getPendingActivities(groupJid: string) {
  const db = getAccountDb()
  return db.select()
    .from(groupActivityLog)
    .where(and(
      eq(groupActivityLog.groupJid, groupJid),
      eq(groupActivityLog.processed, 0),
    ))
    .orderBy(asc(groupActivityLog.timestamp))
    .all()
}

export function markProcessed(id: number) {
  const db = getAccountDb()
  return db.update(groupActivityLog)
    .set({ processed: 1 })
    .where(eq(groupActivityLog.id, id))
    .run()
}

export function updateGroupSyncing(groupJid: string, syncing: number | null) {
  const db = getAccountDb()
  return db.update(groups)
    .set({ syncing })
    .where(eq(groups.jid, groupJid))
    .run()
}

export function setAllActiveGroupsSyncing() {
  const db = getAccountDb()
  return db.update(groups)
    .set({ syncing: 1 })
    .where(ne(groups.botMembership, 'none'))
    .run()
}

export function getSyncingGroups() {
  const db = getAccountDb()
  return db.select({ jid: groups.jid })
    .from(groups)
    .where(eq(groups.syncing, 1))
    .all()
    .map(r => r.jid)
}

export function isGroupSyncing(groupJid: string): boolean {
  const db = getAccountDb()
  const row = db.select({ syncing: groups.syncing })
    .from(groups)
    .where(eq(groups.jid, groupJid))
    .get()
  return row?.syncing === 1
}
