import { pgTable, pgSchema, text, boolean, timestamp, bigint, jsonb, serial, integer, primaryKey } from 'drizzle-orm/pg-core'

// --- Shared DB (settings in shared schema) ---

export const sharedSchema = pgSchema('shared')

export const settings = sharedSchema.table('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().$defaultFn(() => new Date()),
})

// --- Account DB (all operational tables in account schema) ---

export const accountSchema = pgSchema('account')

export const groups = accountSchema.table('groups', {
  jid: text('jid').primaryKey(),
  name: text('name').notNull(),
  isCommunity: boolean('is_community').notNull().default(false),
  parentCommunityJid: text('parent_community_jid'),
  permissions: jsonb('permissions').$type<{
    announce?: boolean
    restrict?: boolean
    memberAddMode?: boolean
    joinApprovalMode?: boolean
  }>(),
  botMembership: text('bot_membership', { enum: ['none', 'participant', 'admin', 'superadmin'] }).notNull().default('none'),
  botFunctions: integer('bot_functions').notNull().default(0),
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().$defaultFn(() => new Date()),
})

export type Group = typeof groups.$inferSelect

export const membershipLevels = ['none', 'pending_approval', 'participant', 'admin', 'superadmin'] as const
export type MembershipLevel = typeof membershipLevels[number]

export const users = accountSchema.table('users', {
  jid: text('jid').primaryKey(),
  phoneNumber: text('phone_number'),
  isBanned: boolean('is_banned').notNull().default(false),
  displayName: text('display_name'),
  displayNameUpdatedAt: timestamp('display_name_updated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().$defaultFn(() => new Date()),
})

export const groupMembers = accountSchema.table('group_members', {
  groupJid: text('group_jid').notNull().references(() => groups.jid),
  userJid: text('user_jid').notNull().references(() => users.jid),
  membership: text('membership', { enum: membershipLevels }).notNull().default('participant'),
  joinedAt: timestamp('joined_at', { withTimezone: true }),
  leftAt: timestamp('left_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().$defaultFn(() => new Date()),
  lastReadAt: text('last_read_at'),
}, (table) => [
  primaryKey({ columns: [table.groupJid, table.userJid] }),
])

export const activityEventTypes = [
  'message', 'reaction', 'edit', 'delete',
  'poll_create', 'poll_vote',
  'event_create', 'event_response',
] as const
export type ActivityEventType = typeof activityEventTypes[number]

export const groupActivityLog = accountSchema.table('group_activity_log', {
  id: serial('id').primaryKey(),
  groupJid: text('group_jid').notNull(),
  userJid: text('user_jid').notNull(),
  messageId: text('message_id').notNull(),
  parentId: text('parent_id'),
  eventType: text('event_type', { enum: activityEventTypes }).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  raw: jsonb('raw').$type<Record<string, unknown>>(),
  timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().$defaultFn(() => new Date()),
})

export type GroupActivityRow = typeof groupActivityLog.$inferSelect

export const outgoingMessages = accountSchema.table('outgoing_messages', {
  id: serial('id').primaryKey(),
  recipient: text('recipient').notNull(),
  text: text('text').notNull(),
  status: text('status', { enum: ['pending', 'sent', 'failed'] }).notNull().default('pending'),
  whatsappMessageId: text('whatsapp_message_id'),
  error: text('error'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().$defaultFn(() => new Date()),
})

export type OutgoingMessage = typeof outgoingMessages.$inferSelect

export const incomingMessages = accountSchema.table('incoming_messages', {
  id: serial('id').primaryKey(),
  senderJid: text('sender_jid').notNull(),
  text: text('text').notNull(),
  whatsappMessageId: text('whatsapp_message_id').notNull().unique(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().$defaultFn(() => new Date()),
})

export type IncomingMessage = typeof incomingMessages.$inferSelect
