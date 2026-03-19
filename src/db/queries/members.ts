import { eq, and, notInArray, sql, inArray } from 'drizzle-orm'
import type { GroupParticipant } from 'baileys'
import { getAccountDb } from '../account.js'
import { groupMembers, users, type MembershipLevel } from '../schema.js'
import { upsertUser } from './users.js'

function membershipFromAdmin(admin: GroupParticipant['admin']): MembershipLevel {
  if (admin === 'superadmin') return 'superadmin'
  if (admin === 'admin') return 'admin'
  return 'participant'
}

export function upsertMembership(groupJid: string, userJid: string, membership: MembershipLevel) {
  const db = getAccountDb()
  const now = new Date()
  const isLeaving = membership === 'none'
  const isJoining = membership !== 'none' && membership !== 'pending_approval'

  return db.insert(groupMembers).values({
    groupJid,
    userJid,
    membership,
    joinedAt: isJoining ? now : null,
    leftAt: isLeaving ? now : null,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [groupMembers.groupJid, groupMembers.userJid],
    set: {
      membership,
      ...(isLeaving ? { leftAt: now } : {}),
      ...(isJoining ? { joinedAt: now, leftAt: null } : {}),
      updatedAt: now,
    },
  }).run()
}

export function syncGroupParticipants(groupJid: string, participants: GroupParticipant[]) {
  const db = getAccountDb()
  const activeUserJids: string[] = []

  db.transaction(() => {
    for (const p of participants) {
      upsertUser(p.id, {
        phoneNumber: p.phoneNumber || undefined,
        displayName: p.notify || undefined,
      })
      const membership = membershipFromAdmin(p.admin)
      upsertMembership(groupJid, p.id, membership)
      activeUserJids.push(p.id)
    }

    if (activeUserJids.length > 0) {
      const now = new Date()
      db.update(groupMembers)
        .set({ membership: 'none', leftAt: now, updatedAt: now })
        .where(
          and(
            eq(groupMembers.groupJid, groupJid),
            notInArray(groupMembers.userJid, activeUserJids),
          )
        )
        .run()
    }
  })
}

export function getGroupMemberCounts(groupJids: string[]): Map<string, number> {
  const result = new Map<string, number>()
  if (groupJids.length === 0) return result

  const db = getAccountDb()
  const rows = db.select({
    groupJid: groupMembers.groupJid,
    cnt: sql<number>`count(*)`.as('cnt'),
  })
    .from(groupMembers)
    .where(and(
      inArray(groupMembers.groupJid, groupJids),
      notInArray(groupMembers.membership, ['none']),
    ))
    .groupBy(groupMembers.groupJid)
    .all()

  for (const row of rows) {
    result.set(row.groupJid, row.cnt)
  }
  return result
}
