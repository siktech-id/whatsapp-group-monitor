import { eq, and, notInArray, sql, inArray, or, isNull, lt } from 'drizzle-orm'
import type { GroupParticipant } from 'baileys'
import { getAccountDb } from '../account.js'
import { groupMembers, users, groups, type MembershipLevel } from '../schema.js'
import { upsertUser } from './users.js'

export function membershipFromAdmin(admin: GroupParticipant['admin']): MembershipLevel {
  if (admin === 'superadmin') return 'superadmin'
  if (admin === 'admin') return 'admin'
  return 'participant'
}

export async function getUserGroupMemberships(userJid: string) {
  const db = getAccountDb()
  return db.select({
    groupJid: groupMembers.groupJid,
    groupName: groups.name,
    isCommunity: groups.isCommunity,
    parentCommunityJid: groups.parentCommunityJid,
    membership: groupMembers.membership,
    lastReadAt: groupMembers.lastReadAt,
    joinedAt: groupMembers.joinedAt,
    leftAt: groupMembers.leftAt,
  })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupJid, groups.jid))
    .where(eq(groupMembers.userJid, userJid))
}

export async function updateLastReadAt(groupJid: string, userJid: string, date: string) {
  const db = getAccountDb()
  await db.update(groupMembers)
    .set({ lastReadAt: date })
    .where(and(
      eq(groupMembers.groupJid, groupJid),
      eq(groupMembers.userJid, userJid),
      or(isNull(groupMembers.lastReadAt), lt(groupMembers.lastReadAt, date)),
    ))
}

export async function upsertMembership(groupJid: string, userJid: string, membership: MembershipLevel) {
  const db = getAccountDb()
  const now = new Date()
  const isLeaving = membership === 'none'
  const isJoining = membership !== 'none' && membership !== 'pending_approval'

  await db.insert(groupMembers).values({
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
  })
}

export async function syncGroupParticipants(groupJid: string, participants: GroupParticipant[]) {
  const db = getAccountDb()
  const activeUserJids: string[] = []

  await db.transaction(async (tx) => {
    for (const p of participants) {
      await upsertUser(p.id, {
        phoneNumber: p.phoneNumber || undefined,
        displayName: p.notify || undefined,
      })
      const membership = membershipFromAdmin(p.admin)
      await upsertMembership(groupJid, p.id, membership)
      activeUserJids.push(p.id)
    }

    if (activeUserJids.length > 0) {
      const now = new Date()
      await tx.update(groupMembers)
        .set({ membership: 'none', leftAt: now, updatedAt: now })
        .where(
          and(
            eq(groupMembers.groupJid, groupJid),
            notInArray(groupMembers.userJid, activeUserJids),
          )
        )
    }
  })
}

export async function getGroupMembers(groupJid: string, opts?: { includeLeft?: boolean }) {
  const db = getAccountDb()
  const conditions = [eq(groupMembers.groupJid, groupJid)]
  if (!opts?.includeLeft) {
    conditions.push(notInArray(groupMembers.membership, ['none']))
  }
  return db.select({
    userJid: groupMembers.userJid,
    membership: groupMembers.membership,
    joinedAt: groupMembers.joinedAt,
    leftAt: groupMembers.leftAt,
    lastReadAt: groupMembers.lastReadAt,
    displayName: users.displayName,
    phoneNumber: users.phoneNumber,
    isBanned: users.isBanned,
  })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userJid, users.jid))
    .where(and(...conditions))
}

export async function getDistinctMemberCount(groupJids: string[]): Promise<number> {
  if (groupJids.length === 0) return 0
  const db = getAccountDb()
  const rows = await db.select({
    cnt: sql<number>`count(distinct ${groupMembers.userJid})`.as('cnt'),
  })
    .from(groupMembers)
    .where(and(
      inArray(groupMembers.groupJid, groupJids),
      notInArray(groupMembers.membership, ['none']),
    ))
  return rows[0]?.cnt ?? 0
}

export async function getDistinctMembers(groupJids: string[], opts?: { includeLeft?: boolean }) {
  if (groupJids.length === 0) return []
  const db = getAccountDb()
  const conditions = [inArray(groupMembers.groupJid, groupJids)]
  if (!opts?.includeLeft) {
    conditions.push(notInArray(groupMembers.membership, ['none']))
  }
  return db.select({
    userJid: groupMembers.userJid,
    membership: sql<string>`case max(
      case when ${groupMembers.membership} = 'superadmin' then 5
      when ${groupMembers.membership} = 'admin' then 4
      when ${groupMembers.membership} = 'participant' then 3
      when ${groupMembers.membership} = 'pending_approval' then 2
      when ${groupMembers.membership} = 'none' then 1
      else 0 end)
      when 5 then 'superadmin'
      when 4 then 'admin'
      when 3 then 'participant'
      when 2 then 'pending_approval'
      when 1 then 'none'
      else 'participant' end`.as('membership'),
    joinedAt: sql<Date | null>`min(${groupMembers.joinedAt})`.as('joined_at'),
    leftAt: sql<Date | null>`max(${groupMembers.leftAt})`.as('left_at'),
    lastReadAt: sql<string | null>`max(${groupMembers.lastReadAt})`.as('last_read_at'),
    displayName: users.displayName,
    phoneNumber: users.phoneNumber,
    isBanned: users.isBanned,
  })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userJid, users.jid))
    .where(and(...conditions))
    .groupBy(groupMembers.userJid)
}

export async function getGroupMemberCounts(groupJids: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (groupJids.length === 0) return result

  const db = getAccountDb()
  const rows = await db.select({
    groupJid: groupMembers.groupJid,
    cnt: sql<number>`count(*)`.as('cnt'),
  })
    .from(groupMembers)
    .where(and(
      inArray(groupMembers.groupJid, groupJids),
      notInArray(groupMembers.membership, ['none']),
    ))
    .groupBy(groupMembers.groupJid)

  for (const row of rows) {
    result.set(row.groupJid, row.cnt)
  }
  return result
}
