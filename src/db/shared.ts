import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { resolve } from 'path'
import { config } from '../config.js'
import { logger } from '../utils/logger.js'
import * as schema from './schema.js'

let db: ReturnType<typeof drizzle<typeof schema>>

export function getSharedDb() {
  if (!db) throw new Error('Shared database not initialized')
  return db
}

export function initSharedDb() {
  const dbPath = resolve(config.dataDir, 'monitor.db')
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')

  db = drizzle(sqlite, { schema })

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)

  logger.info({ path: dbPath }, 'Shared database initialized')
  return db
}
