import { eq, and, desc, sql, gte, inArray } from 'drizzle-orm'
import { getAccountDb } from '../account.js'
import { groupActivityLog } from '../schema.js'
import type { ActivityRecord } from '../../whatsapp/activity/record.js'

export async function insertActivity(record: ActivityRecord): Promise<boolean> {
  const db = getAccountDb()
  try {
    await db.insert(groupActivityLog).values({
      groupJid: record.groupJid,
      userJid: record.userJid,
      messageId: record.messageId,
      parentId: record.parentId,
      eventType: record.eventType,
      metadata: record.metadata,
      raw: record.raw,
      timestamp: record.timestamp,
      createdAt: new Date(),
    })
    return true
  } catch (err: any) {
    if (err?.code === '23505') return false
    throw err
  }
}

export async function getCreationRecord(groupJid: string, messageId: string) {
  const db = getAccountDb()
  const rows = await db.select()
    .from(groupActivityLog)
    .where(and(
      eq(groupActivityLog.groupJid, groupJid),
      eq(groupActivityLog.messageId, messageId),
    ))
    .limit(1)
  return rows[0]
}

export async function getGroupActivityCounts(groupJids: string[], sinceTimestamp: number): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (groupJids.length === 0) return result
  const db = getAccountDb()
  const rows = await db.select({
    groupJid: groupActivityLog.groupJid,
    cnt: sql<number>`count(*)`.as('cnt'),
  })
    .from(groupActivityLog)
    .where(and(
      inArray(groupActivityLog.groupJid, groupJids),
      gte(groupActivityLog.timestamp, sinceTimestamp),
    ))
    .groupBy(groupActivityLog.groupJid)
  for (const row of rows) result.set(row.groupJid, row.cnt)
  return result
}

export async function getGroupLastActivity(groupJids: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (groupJids.length === 0) return result
  const db = getAccountDb()
  const rows = await db.select({
    groupJid: groupActivityLog.groupJid,
    lastTs: sql<number>`max(timestamp)`.as('last_ts'),
  })
    .from(groupActivityLog)
    .where(inArray(groupActivityLog.groupJid, groupJids))
    .groupBy(groupActivityLog.groupJid)
  for (const row of rows) {
    if (row.lastTs) result.set(row.groupJid, row.lastTs)
  }
  return result
}

export async function getUserActivityPerGroup(userJid: string, sinceDays: number) {
  const db = getAccountDb()
  const sinceTs = Math.floor(Date.now() / 1000) - (sinceDays * 86400)
  return db.select({
    groupJid: groupActivityLog.groupJid,
    total: sql<number>`count(*)`.as('total'),
    posts: sql<number>`sum(case when event_type in ('message', 'poll_create', 'event_create') then 1 else 0 end)`.as('posts'),
    reactions: sql<number>`sum(case when event_type in ('reaction', 'poll_vote', 'event_response') then 1 else 0 end)`.as('reactions'),
    lastActivity: sql<number>`max(timestamp)`.as('last_activity'),
  })
    .from(groupActivityLog)
    .where(and(
      eq(groupActivityLog.userJid, userJid),
      gte(groupActivityLog.timestamp, sinceTs),
    ))
    .groupBy(groupActivityLog.groupJid)
}

export async function getGroupUserActivity(groupJid: string, sinceDays: number) {
  const db = getAccountDb()
  const sinceTs = Math.floor(Date.now() / 1000) - (sinceDays * 86400)
  return db.select({
    userJid: groupActivityLog.userJid,
    total: sql<number>`count(*)`.as('total'),
    posts: sql<number>`sum(case when event_type in ('message', 'poll_create', 'event_create') then 1 else 0 end)`.as('posts'),
    reactions: sql<number>`sum(case when event_type in ('reaction', 'poll_vote', 'event_response') then 1 else 0 end)`.as('reactions'),
    lastActivity: sql<number>`max(timestamp)`.as('last_activity'),
  })
    .from(groupActivityLog)
    .where(and(
      eq(groupActivityLog.groupJid, groupJid),
      gte(groupActivityLog.timestamp, sinceTs),
    ))
    .groupBy(groupActivityLog.userJid)
    .orderBy(desc(sql`total`))
}
