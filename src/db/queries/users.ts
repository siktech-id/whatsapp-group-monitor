import { eq } from 'drizzle-orm'
import { getAccountDb } from '../account.js'
import { users } from '../schema.js'

function bareId(jid: string): string {
  return jid.split(':')[0].split('@')[0]
}

export async function upsertUser(jid: string, opts?: { phoneNumber?: string; displayName?: string }) {
  const db = getAccountDb()
  const now = new Date()
  const phone = opts?.phoneNumber ? bareId(opts.phoneNumber) : null

  await db.insert(users).values({
    jid,
    phoneNumber: phone,
    displayName: opts?.displayName || null,
    displayNameUpdatedAt: opts?.displayName ? now : null,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: users.jid,
    set: {
      ...(phone !== null ? { phoneNumber: phone } : {}),
      ...(opts?.displayName ? {
        displayName: opts.displayName,
        displayNameUpdatedAt: now,
      } : {}),
      updatedAt: now,
    },
  })
}

export async function getUser(jid: string) {
  const db = getAccountDb()
  const rows = await db.select().from(users).where(eq(users.jid, jid)).limit(1)
  return rows[0] ?? null
}

export async function userExists(jid: string): Promise<boolean> {
  const db = getAccountDb()
  const rows = await db.select({ jid: users.jid }).from(users).where(eq(users.jid, jid)).limit(1)
  return rows.length > 0
}

export async function updateDisplayName(jid: string, name: string) {
  const db = getAccountDb()
  const now = new Date()
  return db.update(users)
    .set({ displayName: name, displayNameUpdatedAt: now, updatedAt: now })
    .where(eq(users.jid, jid))
}

export async function updatePhoneNumber(jid: string, phoneJid: string) {
  const db = getAccountDb()
  return db.update(users)
    .set({ phoneNumber: bareId(phoneJid), updatedAt: new Date() })
    .where(eq(users.jid, jid))
}
