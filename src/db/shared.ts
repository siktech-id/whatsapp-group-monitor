import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { config } from '../config.js'
import { logger } from '../utils/logger.js'
import * as schema from './schema.js'

let db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getSharedDb() {
  if (!db) throw new Error('Shared database not initialized')
  return db
}

export async function initSharedDb() {
  const pool = new Pool({ connectionString: config.databaseUrl })

  db = drizzle(pool, { schema })

  try {
    // Ensure shared schema exists
    await pool.query(`CREATE SCHEMA IF NOT EXISTS shared`)

    // Ensure settings table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shared.settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `)

    logger.info('Shared database initialized')
  } catch (err) {
    logger.error({ error: err }, 'Failed to initialize shared database')
    throw err
  }

  return db
}
