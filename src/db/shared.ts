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

    // Per-client API keys (only SHA-256 hashes are stored)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shared.api_clients (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        scopes TEXT[] NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        last_used_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ
      )
    `)

    await pool.query(`
      ALTER TABLE shared.api_clients ADD COLUMN IF NOT EXISTS rate_limit_per_min INTEGER NOT NULL DEFAULT 60;
      ALTER TABLE shared.api_clients ADD COLUMN IF NOT EXISTS send_limit_per_min INTEGER NOT NULL DEFAULT 10;

      CREATE TABLE IF NOT EXISTS shared.api_request_logs (
        id BIGSERIAL PRIMARY KEY,
        client_id INTEGER,
        key_prefix TEXT,
        method TEXT NOT NULL,
        route TEXT,
        path TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        ip TEXT,
        user_agent TEXT,
        request_body TEXT,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_api_logs_created ON shared.api_request_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_api_logs_client_created ON shared.api_request_logs(client_id, created_at);
    `)

    logger.info('Shared database initialized')
  } catch (err) {
    logger.error({ error: err }, 'Failed to initialize shared database')
    throw err
  }

  return db
}
