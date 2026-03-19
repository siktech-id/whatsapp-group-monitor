import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { resolve } from 'path'
import { mkdirSync } from 'fs'
import { config } from '../config.js'
import { logger } from '../utils/logger.js'
import * as schema from './schema.js'

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

export function initAccountDb(phone: string) {
  // If already open for the same phone, skip
  if (currentPhone === phone && db) return db

  // Close previous if different phone
  closeAccountDb()

  const accountDir = resolve(config.dataDir, phone)
  mkdirSync(accountDir, { recursive: true })

  const dbPath = resolve(accountDir, 'account.db')
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  db = drizzle(sqlite, { schema })

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_community INTEGER NOT NULL DEFAULT 0,
      parent_community_jid TEXT,
      permissions TEXT,
      bot_membership TEXT NOT NULL DEFAULT 'none',
      bot_functions INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      syncing INTEGER,
      synced_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      jid TEXT PRIMARY KEY,
      phone_number TEXT,
      is_banned INTEGER NOT NULL DEFAULT 0,
      display_name TEXT,
      display_name_updated_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);

    CREATE TABLE IF NOT EXISTS group_members (
      group_jid TEXT NOT NULL REFERENCES groups(jid),
      user_jid TEXT NOT NULL REFERENCES users(jid),
      membership TEXT NOT NULL DEFAULT 'participant',
      joined_at INTEGER,
      left_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (group_jid, user_jid)
    );

    CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_jid);

    CREATE TABLE IF NOT EXISTS group_activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_jid TEXT NOT NULL,
      user_jid TEXT NOT NULL,
      message_id TEXT NOT NULL,
      parent_id TEXT,
      event_type TEXT NOT NULL,
      metadata TEXT,
      raw TEXT,
      processed INTEGER NOT NULL DEFAULT 0,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_group_message ON group_activity_log(group_jid, message_id);
    CREATE INDEX IF NOT EXISTS idx_activity_group_ts ON group_activity_log(group_jid, timestamp);
    CREATE INDEX IF NOT EXISTS idx_activity_user_group ON group_activity_log(user_jid, group_jid);
    CREATE INDEX IF NOT EXISTS idx_activity_parent ON group_activity_log(parent_id);
  `)

  currentPhone = phone
  logger.info({ phone, path: dbPath }, 'Account database initialized')
  return db
}

export function closeAccountDb() {
  if (db) {
    try {
      // Drizzle doesn't expose close directly, but the underlying sqlite instance does
      // Access it via the session property
      (db as any).session?.client?.close?.()
    } catch {
      // ignore close errors
    }
    db = null
    logger.info({ phone: currentPhone }, 'Account database closed')
    currentPhone = null
  }
}
