import { getAccountDb } from '../account.js'
import { outgoingMessages } from '../schema.js'
import { eq, desc } from 'drizzle-orm'

export function insertOutgoingMessage(recipient: string, text: string): number {
  const db = getAccountDb()
  const result = db.insert(outgoingMessages).values({ recipient, text, createdAt: new Date() }).run()
  return Number(result.lastInsertRowid)
}

export function updateOutgoingMessageStatus(
  id: number,
  status: 'sent' | 'failed',
  opts?: { whatsappMessageId?: string; error?: string }
): void {
  const db = getAccountDb()
  db.update(outgoingMessages)
    .set({ status, sentAt: new Date(), ...opts })
    .where(eq(outgoingMessages.id, id))
    .run()
}

export function getRecentOutgoingMessages(limit: number = 50) {
  const db = getAccountDb()
  return db.select().from(outgoingMessages).orderBy(desc(outgoingMessages.createdAt)).limit(limit).all()
}
