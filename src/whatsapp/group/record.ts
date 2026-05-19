import type { Group } from '../../db/schema.js'
import { getGroupMemberCounts, getGroupMembers, getDistinctMemberCount, getDistinctMembers } from '../../db/queries/members.js'
import { getGroupActivityCounts, getGroupLastActivity, getGroupUserActivity } from '../../db/queries/activity.js'

export class GroupRecord {
  jid: string
  name: string
  isCommunity: boolean
  parentCommunityJid: string | null
  permissions: Group['permissions']
  botMembership: Group['botMembership']
  botFunctions: number
  isArchived: boolean
  createdAt: Date | null

  // Summary properties — populated by populateAllSummaries()
  memberCount: number = 0
  activityCount: number = 0
  lastActivity: number | null = null

  private _parent: GroupRecord | null = null
  private _children: GroupRecord[] = []

  constructor(row: Group) {
    this.jid = row.jid
    this.name = row.name
    this.isCommunity = row.isCommunity ?? false
    this.parentCommunityJid = row.parentCommunityJid
    this.permissions = row.permissions
    this.botMembership = row.botMembership
    this.botFunctions = row.botFunctions
    this.isArchived = row.isArchived ?? false
    this.createdAt = row.createdAt
  }

  static fromDbRow(row: Group): GroupRecord {
    return new GroupRecord(row)
  }

  /** Populate parent/children references across all groups */
  static linkAll(groups: GroupRecord[]): void {
    for (const g of groups) {
      g._parent = null
      g._children = []
    }
    const byJid = new Map(groups.map(g => [g.jid, g]))
    for (const g of groups) {
      if (g.parentCommunityJid) {
        const parent = byJid.get(g.parentCommunityJid)
        if (parent) {
          g._parent = parent
          parent._children.push(g)
        }
      }
    }
  }

  /** Populate memberCount, activityCount, lastActivity for all groups in one batch */
  static async populateAllSummaries(groups: GroupRecord[]): Promise<void> {
    const nonCommunityJids = groups.filter(g => !g.isCommunity).map(g => g.jid)
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 86400)

    const memberCounts = await getGroupMemberCounts(nonCommunityJids)
    const activityCounts = await getGroupActivityCounts(nonCommunityJids, thirtyDaysAgo)
    const lastActivityMap = await getGroupLastActivity(nonCommunityJids)

    // Populate regular groups
    for (const g of groups) {
      if (g.isCommunity) continue
      g.memberCount = memberCounts.get(g.jid) ?? 0
      g.activityCount = activityCounts.get(g.jid) ?? 0
      g.lastActivity = lastActivityMap.get(g.jid) ?? null
    }

    // Populate communities from children
    for (const g of groups) {
      if (!g.isCommunity) continue
      const childJids = g.getChildJids()
      g.memberCount = childJids.length > 0 ? await getDistinctMemberCount(childJids) : 0
      g.activityCount = childJids.reduce((sum, jid) => sum + (activityCounts.get(jid) ?? 0), 0)
      const maxLast = childJids.reduce((max, jid) => {
        const ts = lastActivityMap.get(jid)
        return ts && ts > (max ?? 0) ? ts : max
      }, null as number | null)
      g.lastActivity = maxLast
    }
  }

  getParent(): GroupRecord | null {
    return this._parent
  }

  getChildren(): GroupRecord[] {
    return this._children
  }

  getChildJids(): string[] {
    return this._children.map(g => g.jid)
  }

  async getMemberCount(): Promise<number> {
    if (this.isCommunity) {
      const childJids = this.getChildJids()
      return childJids.length > 0 ? await getDistinctMemberCount(childJids) : 0
    }
    const counts = await getGroupMemberCounts([this.jid])
    return counts.get(this.jid) ?? 0
  }

  async getMembers(opts?: { includeLeft?: boolean }) {
    if (this.isCommunity) {
      return await getDistinctMembers(this.getChildJids(), opts)
    }
    return await getGroupMembers(this.jid, opts)
  }

  async getActivityCount(sinceTimestamp: number): Promise<number> {
    if (this.isCommunity) {
      const childJids = this.getChildJids()
      const counts = await getGroupActivityCounts(childJids, sinceTimestamp)
      let total = 0
      for (const cnt of counts.values()) total += cnt
      return total
    }
    const counts = await getGroupActivityCounts([this.jid], sinceTimestamp)
    return counts.get(this.jid) ?? 0
  }

  async getLastActivity(): Promise<number | null> {
    if (this.isCommunity) {
      const childJids = this.getChildJids()
      const map = await getGroupLastActivity(childJids)
      let max: number | null = null
      for (const ts of map.values()) {
        if (max === null || ts > max) max = ts
      }
      return max
    }
    const map = await getGroupLastActivity([this.jid])
    return map.get(this.jid) ?? null
  }

  async getUserActivity(sinceDays: number) {
    if (this.isCommunity) {
      const merged = new Map<string, { userJid: string; total: number; posts: number; reactions: number; lastActivity: number | null }>()
      for (const childJid of this.getChildJids()) {
        for (const a of await getGroupUserActivity(childJid, sinceDays)) {
          const existing = merged.get(a.userJid)
          if (existing) {
            existing.total += a.total
            existing.posts += a.posts
            existing.reactions += a.reactions
            existing.lastActivity = Math.max(existing.lastActivity ?? 0, a.lastActivity ?? 0) || null
          } else {
            merged.set(a.userJid, { ...a })
          }
        }
      }
      return Array.from(merged.values()).sort((a, b) => b.total - a.total)
    }
    return getGroupUserActivity(this.jid, sinceDays)
  }

  toJSON() {
    return {
      jid: this.jid,
      name: this.name,
      isCommunity: this.isCommunity,
      parentCommunityJid: this.parentCommunityJid,
      permissions: this.permissions,
      botMembership: this.botMembership,
      botFunctions: this.botFunctions,
      isArchived: this.isArchived,
      memberCount: this.memberCount,
      activityCount: this.activityCount,
      lastActivity: this.lastActivity,
    }
  }
}
