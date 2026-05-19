import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { config } from '../config.js'
import { logger } from '../utils/logger.js'
import * as schema from './schema.js'

let pool: Pool | null = null
let db: ReturnType<typeof drizzle<typeof schema>> | null = null
let currentPhone: string | null = null

export function getAccountDb() {
  if (!db) throw new Error('Account database not initialized (WhatsApp not connected)')
  return db
}

export function isAccountDbReady(): boolean {
  return db !== null
}

export function getAccountPhone(): string | null {
  return currentPhone
}

export async function initAccountDb(phone: string) {
  // If already open for the same phone, skip
  if (currentPhone === phone && db) return db

  if (!pool) {
    pool = new Pool({ connectionString: config.databaseUrl })
  }

  db = drizzle(pool, { schema })

  try {
    // Ensure account schema exists
    await pool.query(`CREATE SCHEMA IF NOT EXISTS account`)

    // Create all tables with if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS account.groups (
        jid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        is_community BOOLEAN NOT NULL DEFAULT false,
        parent_community_jid TEXT,
        permissions JSONB,
        bot_membership TEXT NOT NULL DEFAULT 'none',
        bot_functions INTEGER NOT NULL DEFAULT 0,
        is_archived BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS account.users (
        jid TEXT PRIMARY KEY,
        phone_number TEXT,
        is_banned BOOLEAN NOT NULL DEFAULT false,
        display_name TEXT,
        display_name_updated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_users_phone ON account.users(phone_number);

      CREATE TABLE IF NOT EXISTS account.group_members (
        group_jid TEXT NOT NULL REFERENCES account.groups(jid),
        user_jid TEXT NOT NULL REFERENCES account.users(jid),
        membership TEXT NOT NULL DEFAULT 'participant',
        joined_at TIMESTAMPTZ,
        left_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL,
        last_read_at TEXT,
        PRIMARY KEY (group_jid, user_jid)
      );

      CREATE INDEX IF NOT EXISTS idx_group_members_user ON account.group_members(user_jid);

      CREATE TABLE IF NOT EXISTS account.group_activity_log (
        id SERIAL PRIMARY KEY,
        group_jid TEXT NOT NULL,
        user_jid TEXT NOT NULL,
        message_id TEXT NOT NULL,
        parent_id TEXT,
        event_type TEXT NOT NULL,
        metadata JSONB,
        raw JSONB,
        timestamp BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_group_message ON account.group_activity_log(group_jid, message_id);
      CREATE INDEX IF NOT EXISTS idx_activity_group_ts ON account.group_activity_log(group_jid, timestamp);
      CREATE INDEX IF NOT EXISTS idx_activity_user_group ON account.group_activity_log(user_jid, group_jid);
      CREATE INDEX IF NOT EXISTS idx_activity_parent ON account.group_activity_log(parent_id);

      CREATE TABLE IF NOT EXISTS account.outgoing_messages (
        id SERIAL PRIMARY KEY,
        recipient TEXT NOT NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        whatsapp_message_id TEXT,
        error TEXT,
        sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_outgoing_recipient ON account.outgoing_messages(recipient);

      CREATE TABLE IF NOT EXISTS account.incoming_messages (
        id SERIAL PRIMARY KEY,
        sender_jid TEXT NOT NULL,
        text TEXT NOT NULL,
        whatsapp_message_id TEXT NOT NULL UNIQUE,
        received_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_incoming_sender ON account.incoming_messages(sender_jid);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_incoming_message_id ON account.incoming_messages(whatsapp_message_id);
    `)

    currentPhone = phone
    logger.info({ phone }, 'Account database initialized')
  } catch (err) {
    logger.error({ error: err, phone }, 'Failed to initialize account database')
    throw err
  }

  return db
}

export async function closeAccountDb() {
  db = null
  currentPhone = null
  logger.info('Account database deactivated')
}
