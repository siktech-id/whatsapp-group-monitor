import { eq, notInArray } from 'drizzle-orm'
import type { GroupMetadata, GroupParticipant } from 'baileys'
import { getAccountDb } from '../account.js'
import { groups, type Group } from '../schema.js'
import { GroupRecord } from '../../whatsapp/group/record.js'

function bareId(jid: string): string {
  return jid.split(':')[0].split('@')[0]
}

function botMembershipFromParticipant(p: GroupParticipant | undefined): Group['botMembership'] {
  if (!p) return 'none'
  if (p.admin === 'superadmin') return 'superadmin'
  if (p.admin === 'admin') return 'admin'
  return 'participant'
}

export async function upsertGroupFromMetadata(meta: GroupMetadata, botJid: string, botLid?: string) {
  const db = getAccountDb()
  const botPhone = bareId(botJid)
  const botLidBare = botLid ? bareId(botLid) : null
  const botParticipant = meta.participants.find(p => {
    const pid = bareId(p.id)
    return pid === botPhone || (botLidBare && pid === botLidBare)
  })

  const values = {
    jid: meta.id,
    name: meta.subject,
    isCommunity: meta.isCommunity ?? false,
    parentCommunityJid: meta.linkedParent ?? null,
    permissions: {
      announce: meta.announce ?? false,
      restrict: meta.restrict ?? false,
      memberAddMode: meta.memberAddMode ?? false,
      joinApprovalMode: meta.joinApprovalMode ?? false,
    },
    botMembership: botMembershipFromParticipant(botParticipant),
  }

  await db.insert(groups).values({
    ...values,
    createdAt: new Date(),
  }).onConflictDoUpdate({
    target: groups.jid,
    set: values,
  })
}

export async function getAllGroups(): Promise<GroupRecord[]> {
  const db = getAccountDb()
  const allGroups = await db.select().from(groups)
  const records = allGroups.map(r => new GroupRecord(r))
  GroupRecord.linkAll(records)
  return records
}

export async function getGroup(jid: string): Promise<GroupRecord | null> {
  const allGroups = await getAllGroups()
  return allGroups.find(g => g.jid === jid) ?? null
}

export async function updateBotMembership(groupJid: string, membership: Group['botMembership']) {
  const db = getAccountDb()
  return db.update(groups).set({ botMembership: membership }).where(eq(groups.jid, groupJid))
}

export async function markAbsentGroupsAsNone(activeJids: string[]) {
  const db = getAccountDb()
  if (activeJids.length === 0) {
    return db.update(groups).set({ botMembership: 'none' })
  }
  return db.update(groups)
    .set({ botMembership: 'none' })
    .where(notInArray(groups.jid, activeJids))
}
