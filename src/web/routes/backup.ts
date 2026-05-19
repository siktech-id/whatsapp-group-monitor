import type { FastifyInstance } from 'fastify'
import { writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { promisify } from 'util'
import { execFile } from 'child_process'
import { PassThrough } from 'stream'
import archiver from 'archiver'
import AdmZip from 'adm-zip'
import { config } from '../../config.js'
import { logger } from '../../utils/logger.js'
import { sendPage, cleanupTmpUploads } from '../server.js'
import { requireAuth, generateCsrf, verifyCsrf as verifyAuthCsrf } from '../middleware/auth.js'
import { setSetting } from '../../db/queries/settings.js'

const execFileAsync = promisify(execFile)

function tmpDir(): string {
  const dir = resolve(config.dataDir, '.tmp')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function registerBackupRoutes(app: FastifyInstance) {
  // --- Backup page ---
  app.get('/backup', { preHandler: requireAuth }, async (req, reply) => {
    generateCsrf(req)
    return sendPage(reply, 'backup.html', req)
  })

  // --- Download backup ---
  app.post('/api/backup/download', { preHandler: requireAuth }, async (req, reply) => {
    if (!verifyAuthCsrf(req)) {
      return reply.status(403).send({ error: 'Invalid CSRF token' })
    }

    try {
      const { selected } = req.body as { selected?: string[] }
      const items = selected?.filter(s => s === 'settings' || s === 'account') || ['settings', 'account']

      const archive = archiver('zip', { zlib: { level: 9 } })
      const filename = `wa-backup-${new Date().toISOString().split('T')[0]}.zip`

      reply.header('Content-Type', 'application/zip')
      reply.header('Content-Disposition', `attachment; filename="${filename}"`)

      archive.pipe(reply.raw)

      // Dump shared schema (settings)
      if (items.includes('settings')) {
        try {
          const { stdout } = await execFileAsync('pg_dump', [
            '--schema=shared',
            '--format=custom',
            config.databaseUrl,
          ])
          archive.append(Buffer.from(stdout, 'binary'), { name: 'shared.pgdump' })
        } catch (err) {
          logger.warn({ error: err }, 'Failed to dump shared schema')
        }
      }

      // Dump account schema
      if (items.includes('account')) {
        try {
          const { stdout } = await execFileAsync('pg_dump', [
            '--schema=account',
            '--format=custom',
            config.databaseUrl,
          ])
          archive.append(Buffer.from(stdout, 'binary'), { name: 'account.pgdump' })
        } catch (err) {
          logger.warn({ error: err }, 'Failed to dump account schema')
        }
      }

      await archive.finalize()
    } catch (err) {
      logger.error({ error: err }, 'Backup failed')
      return reply.status(500).send({ error: 'Backup failed' })
    }
  })

  // --- Restore page ---
  app.get('/restore', { preHandler: requireAuth }, async (req, reply) => {
    generateCsrf(req)
    return sendPage(reply, 'restore.html', req)
  })

  // --- Upload and detect backup contents ---
  app.post('/api/backup/upload', { preHandler: requireAuth }, async (req, reply) => {
    if (!verifyAuthCsrf(req)) {
      return reply.status(403).send({ error: 'Invalid CSRF token' })
    }

    const file = await req.file()
    if (!file) {
      return reply.status(400).send({ error: 'No file provided' })
    }

    const tmpPath = resolve(tmpDir(), `backup-${Date.now()}.zip`)

    try {
      const buffer = await file.toBuffer()
      writeFileSync(tmpPath, buffer)

      const zip = new AdmZip(tmpPath)
      const entryNames = zip.getEntries().map(e => e.entryName)

      const items = []
      if (entryNames.includes('shared.pgdump')) {
        items.push({ id: 'settings', label: 'Settings', hasExisting: true })
      }
      if (entryNames.includes('account.pgdump')) {
        items.push({ id: 'account', label: 'Account data', hasExisting: true })
      }

      reply.send({
        uploadId: tmpPath,
        items,
      })
    } catch (err) {
      logger.error({ error: err }, 'Upload detection failed')
      try { unlinkSync(tmpPath) } catch {}
      return reply.status(400).send({ error: 'Invalid backup file' })
    }
  })

  // --- Execute restore ---
  app.post('/api/backup/restore', { preHandler: requireAuth }, async (req, reply) => {
    if (!verifyAuthCsrf(req)) {
      return reply.status(403).send({ error: 'Invalid CSRF token' })
    }

    const { uploadId, selected } = req.body as { uploadId: string; selected?: string[] }
    const items = selected || []

    const tmpZipPath = uploadId
    if (!tmpZipPath.startsWith(tmpDir())) {
      return reply.status(400).send({ error: 'Invalid upload ID' })
    }

    const tmpDir_ = tmpDir()

    try {
      const zip = new AdmZip(tmpZipPath)

      if (items.includes('settings')) {
        const entry = zip.getEntry('shared.pgdump')
        if (entry) {
          const dumpPath = resolve(tmpDir_, `shared-${Date.now()}.pgdump`)
          writeFileSync(dumpPath, entry.getData())

          await execFileAsync('pg_restore', [
            '--schema=shared',
            '--clean',
            '--if-exists',
            '-d', config.databaseUrl,
            dumpPath,
          ])

          try { unlinkSync(dumpPath) } catch {}
          logger.info('Settings restored')
        }
      }

      if (items.includes('account')) {
        const entry = zip.getEntry('account.pgdump')
        if (entry) {
          const dumpPath = resolve(tmpDir_, `account-${Date.now()}.pgdump`)
          writeFileSync(dumpPath, entry.getData())

          await execFileAsync('pg_restore', [
            '--schema=account',
            '--clean',
            '--if-exists',
            '-d', config.databaseUrl,
            dumpPath,
          ])

          try { unlinkSync(dumpPath) } catch {}
          logger.info('Account data restored')
        }
      }

      return reply.send({ ok: true })
    } catch (err) {
      logger.error({ error: err }, 'Restore failed')
      return reply.status(500).send({ error: 'Restore failed' })
    } finally {
      try { unlinkSync(tmpZipPath) } catch {}
    }
  })
}

