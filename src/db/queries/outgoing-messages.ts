import { getAccountDb } from '../account.js'
import { outgoingMessages } from '../schema.js'
import { eq, desc } from 'drizzle-orm'

export async function insertOutgoingMessage(recipient: string, text: string, clientId?: number): Promise<number> {
  const db = getAccountDb()
  const rows = await db.insert(outgoingMessages)
    .values({ recipient, text, clientId: clientId ?? null, createdAt: new Date() })
    .returning({ id: outgoingMessages.id })
  return rows[0].id
}

export async function updateOutgoingMessageStatus(
  id: number,
  status: 'sent' | 'failed',
  opts?: { whatsappMessageId?: string; error?: string }
): Promise<void> {
  const db = getAccountDb()
  await db.update(outgoingMessages)
    .set({ status, sentAt: new Date(), ...opts })
    .where(eq(outgoingMessages.id, id))
}

export async function getRecentOutgoingMessages(limit: number = 50, clientId?: number) {
  const db = getAccountDb()
  const query = db.select().from(outgoingMessages)
  const filtered = clientId !== undefined ? query.where(eq(outgoingMessages.clientId, clientId)) : query
  return filtered.orderBy(desc(outgoingMessages.createdAt)).limit(limit)
}
