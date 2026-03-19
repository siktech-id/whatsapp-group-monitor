import { eq } from 'drizzle-orm'
import { getAccountDb } from '../account.js'
import { users } from '../schema.js'

function bareId(jid: string): string {
  return jid.split(':')[0].split('@')[0]
}

export function upsertUser(jid: string, opts?: { phoneNumber?: string; displayName?: string }) {
  const db = getAccountDb()
  const now = new Date()
  const phone = opts?.phoneNumber ? bareId(opts.phoneNumber) : null

  return db.insert(users).values({
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
  }).run()
}
