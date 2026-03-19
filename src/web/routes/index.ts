import type { FastifyInstance } from 'fastify'
import QRCode from 'qrcode'
import { config } from '../../config.js'
import { sendPage } from '../server.js'
import { getCurrentQr, getConnectionState, getBotUser } from '../../whatsapp/handlers/connection.js'
import { getSock } from '../../whatsapp/client.js'
import { requireAuth, requireAuthApi, generateCsrf, verifyCsrf } from '../middleware/auth.js'

export function registerRoutes(app: FastifyInstance) {
  // --- Public: login ---
  app.get('/login', async (req, reply) => {
    if (req.session.authenticated) {
      return reply.redirect('/')
    }
    generateCsrf(req)
    return sendPage(reply, 'login.html', req)
  })

  app.post('/login', async (req, reply) => {
    if (!verifyCsrf(req)) {
      return reply.status(403).send('Invalid CSRF token')
    }

    const { username, password } = req.body as { username?: string; password?: string }

    if (!config.adminPassword) {
      return reply.status(503).send('ADMIN_PASSWORD not configured in .env')
    }

    if (username === config.adminUsername && password === config.adminPassword) {
      req.session.authenticated = true
      return reply.redirect('/')
    }

    return reply.redirect('/login?error=1')
  })

  // --- Protected: main page ---
  app.get('/', { preHandler: requireAuth }, async (req, reply) => {
    generateCsrf(req)
    const state = getConnectionState()
    if (state === 'open') {
      return sendPage(reply, 'dashboard.html', req)
    }
    return sendPage(reply, 'connection.html', req)
  })

  app.post('/logout', { preHandler: requireAuth }, async (req, reply) => {
    if (!verifyCsrf(req)) {
      return reply.status(403).send('Invalid CSRF token')
    }
    await req.session.destroy()
    return reply.redirect('/login')
  })

  app.post('/disconnect', { preHandler: requireAuth }, async (req, reply) => {
    if (!verifyCsrf(req)) {
      return reply.status(403).send('Invalid CSRF token')
    }
    try {
      const sock = getSock()
      await sock.logout('User requested disconnect')
    } catch {
      // not connected
    }
    return reply.redirect('/')
  })

  // --- Protected API ---
  app.get('/api/status', { preHandler: requireAuthApi }, async (_req, reply) => {
    const qr = getCurrentQr()
    const state = getConnectionState()
    const user = state === 'open' ? getBotUser() : null

    let qrDataUrl: string | null = null
    if (qr) {
      qrDataUrl = await QRCode.toDataURL(qr, { width: 300 })
    }

    return reply.send({
      qr: qrDataUrl,
      state: state ?? 'connecting',
      user,
    })
  })
}
