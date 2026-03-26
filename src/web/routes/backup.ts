import type { FastifyInstance } from 'fastify'
import { readdirSync, existsSync, statSync } from 'fs'
import { resolve } from 'path'
import { PassThrough } from 'stream'
import archiver from 'archiver'
import { config } from '../../config.js'
import { sendPage } from '../server.js'
import { requireAuth, requireAuthApi, generateCsrf, verifyCsrf } from '../middleware/auth.js'
import { checkpointSharedDb } from '../../db/shared.js'
import { checkpointAccountDb, getAccountPhone } from '../../db/account.js'

function discoverPhones(): string[] {
  try {
    return readdirSync(config.dataDir).filter(entry => {
      const dir = resolve(config.dataDir, entry)
      return statSync(dir).isDirectory() && existsSync(resolve(dir, 'account.db'))
    })
  } catch {
    return []
  }
}

export function registerBackupRoutes(app: FastifyInstance) {
  app.get('/backup', { preHandler: requireAuth }, async (req, reply) => {
    generateCsrf(req)
    return sendPage(reply, 'backup.html', req)
  })

  app.get('/api/backup/items', { preHandler: requireAuthApi }, async (_req, reply) => {
    const items = [{ id: 'settings', label: 'Settings' }]
    for (const phone of discoverPhones()) {
      items.push({ id: `phone:${phone}`, label: `Data for +${phone}` })
    }
    return reply.send({ items })
  })

  app.post('/backup/download', { preHandler: requireAuth }, async (req, reply) => {
    if (!verifyCsrf(req)) {
      return reply.status(403).send('Invalid CSRF token')
    }

    const body = req.body as Record<string, string | string[]>
    const rawItems = body.items
    const selected: string[] = rawItems
      ? Array.isArray(rawItems) ? rawItems : [rawItems]
      : []

    const date = new Date().toISOString().slice(0, 10)
    reply.header('Content-Type', 'application/zip')
    reply.header('Content-Disposition', `attachment; filename="backup-${date}.zip"`)

    const pass = new PassThrough()
    const archive = archiver('zip', { zlib: { level: 6 } })
    archive.pipe(pass)
    archive.on('error', (err) => pass.destroy(err))

    if (selected.includes('settings')) {
      checkpointSharedDb()
      const dbPath = resolve(config.dataDir, 'monitor.db')
      if (existsSync(dbPath)) {
        archive.file(dbPath, { name: 'settings/monitor.db' })
      }
    }

    const currentPhone = getAccountPhone()
    for (const item of selected) {
      if (!item.startsWith('phone:')) continue
      const phone = item.slice('phone:'.length)
      const dbPath = resolve(config.dataDir, phone, 'account.db')
      if (!existsSync(dbPath)) continue
      if (phone === currentPhone) checkpointAccountDb()
      archive.file(dbPath, { name: `${phone}/account.db` })
    }

    archive.finalize()
    return reply.send(pass)
  })
}
