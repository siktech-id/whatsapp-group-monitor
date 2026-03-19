import { resolve } from 'path'
import crypto from 'crypto'

export const config = {
  dataDir: process.env.DATA_DIR || resolve('data'),
  get authDir() {
    return resolve(this.dataDir, 'auth')
  },
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  logLevel: (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
}
