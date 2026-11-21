import { resolve } from 'path'
import crypto from 'crypto'

export const config = {
  dataDir: process.env.DATA_DIR || resolve('data'),
  get authDir() {
    return resolve(this.dataDir, 'auth')
  },
  get databaseUrl() {
    return process.env.DATABASE_URL || 'postgresql://localhost:5432/beesa_wa'
  },
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  logLevel: (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  /** Days to keep rows in shared.api_request_logs. */
  apiLogRetentionDays: Math.max(1, parseInt(process.env.API_LOG_RETENTION_DAYS || '30', 10) || 30),
  /**
   * Proxy hops to trust for X-Forwarded-For (Railway's edge = 1), so logs and
   * per-IP limits see the real client IP instead of the proxy's.
   */
  trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS || '1', 10) || 0,
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
}
