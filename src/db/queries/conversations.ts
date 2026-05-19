import { getAccountDb } from '../account.js'
import { outgoingMessages, incomingMessages, groupActivityLog } from '../schema.js'
import { eq, and, desc, lt, like, sql, max } from 'drizzle-orm'
import type { OutgoingMessage, IncomingMessage, GroupActivityRow } from '../schema.js'

export async function getDistinctDmRecipients(): Promise<{ recipient: string }[]> {
  const db = getAccountDb()
  const rows = await db
    .select({ recipient: outgoingMessages.recipient })
    .from(outgoingMessages)
    .where(like(outgoingMessages.recipient, '%@s.whatsapp.net'))

  // Get distinct recipients, maintaining order by last message
  const seen = new Set<string>()
  const result: { recipient: string }[] = []
  for (const row of rows) {
    if (!seen.has(row.recipient)) {
      seen.add(row.recipient)
      result.push(row)
    }
  }
  return result
}

export async function getLastOutgoingPerRecipient(): Promise<Map<string, { text: string; sentAt: Date | null; status: string }>> {
  const db = getAccountDb()
  const subquery = db
    .select({ maxId: max(outgoingMessages.id).as('max_id') })
    .from(outgoingMessages)
    .groupBy(outgoingMessages.recipient)
    .as('sub')

  const rows = await db
    .select({
      recipient: outgoingMessages.recipient,
      text: outgoingMessages.text,
      status: outgoingMessages.status,
      sentAt: outgoingMessages.sentAt,
    })
    .from(outgoingMessages)
    .innerJoin(subquery, eq(outgoingMessages.id, subquery.maxId))

  const map = new Map<string, { text: string; sentAt: Date | null; status: string }>()
  for (const row of rows) {
    map.set(row.recipient, {
      text: row.text,
      sentAt: row.sentAt,
      status: row.status,
    })
  }
  return map
}

export async function getGroupMessages(
  groupJid: string,
  opts: { limit: number; before?: number }
): Promise<GroupActivityRow[]> {
  const db = getAccountDb()
  let conditions = [
    eq(groupActivityLog.groupJid, groupJid),
    eq(groupActivityLog.eventType, 'message'),
  ]

  if (opts.before) {
    conditions.push(lt(groupActivityLog.timestamp, opts.before))
  }

  return db
    .select()
    .from(groupActivityLog)
    .where(and(...conditions))
    .orderBy(desc(groupActivityLog.timestamp))
    .limit(opts.limit)
}

export async function getOutgoingMessagesByRecipient(
  recipient: string,
  opts: { limit: number; before?: Date }
): Promise<OutgoingMessage[]> {
  const db = getAccountDb()
  let conditions = [eq(outgoingMessages.recipient, recipient)]

  if (opts.before) {
    conditions.push(lt(outgoingMessages.createdAt, opts.before))
  }

  return db
    .select()
    .from(outgoingMessages)
    .where(and(...conditions))
    .orderBy(desc(outgoingMessages.createdAt))
    .limit(opts.limit)
}

export async function getIncomingMessagesBySender(
  senderJid: string,
  opts: { limit: number; before?: Date }
): Promise<IncomingMessage[]> {
  const db = getAccountDb()
  let conditions = [eq(incomingMessages.senderJid, senderJid)]

  if (opts.before) {
    conditions.push(lt(incomingMessages.receivedAt, opts.before))
  }

  return db
    .select()
    .from(incomingMessages)
    .where(and(...conditions))
    .orderBy(desc(incomingMessages.receivedAt))
    .limit(opts.limit)
}

export async function getDistinctDmSenders(): Promise<{ senderJid: string }[]> {
  const db = getAccountDb()
  const rows = await db
    .select({ senderJid: incomingMessages.senderJid })
    .from(incomingMessages)

  const seen = new Set<string>()
  const result: { senderJid: string }[] = []
  for (const row of rows) {
    if (!seen.has(row.senderJid)) {
      seen.add(row.senderJid)
      result.push(row)
    }
  }
  return result
}

export async function insertIncomingMessage(senderJid: string, text: string, whatsappMessageId: string, receivedAt: number): Promise<void> {
  const db = getAccountDb()
  await db.insert(incomingMessages)
    .values({ senderJid, text, whatsappMessageId, receivedAt: new Date(receivedAt) })
    .onConflictDoNothing()
}
