import type { Group } from '../../db/schema.js'

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

  getParent(): GroupRecord | null {
    return this._parent
  }

  getChildren(): GroupRecord[] {
    return this._children
  }

  /** Get child group JIDs for this community */
  getChildJids(): string[] {
    return this._children.map(g => g.jid)
  }

  /** Serialize for API response */
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
    }
  }
}
