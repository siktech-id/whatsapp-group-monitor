import type { FastifyInstance } from 'fastify'
import QRCode from 'qrcode'
import { config } from '../../config.js'
import { sendPage } from '../server.js'
import { getCurrentQr, getConnectionState, getBotUser } from '../../whatsapp/handlers/connection.js'
import { getSock } from '../../whatsapp/client.js'
import { requireAuth, requireAuthApi, generateCsrf, verifyCsrf } from '../middleware/auth.js'
import { getSettingOrDefault, setSetting } from '../../db/queries/settings.js'
import { getAllGroups, getGroup } from '../../db/queries/groups.js'
import { getGroupMemberCounts, getGroupMembers } from '../../db/queries/members.js'
import { getGroupActivityCounts, getGroupLastActivity, getGroupUserActivity } from '../../db/queries/activity.js'
import { isAccountDbReady } from '../../db/account.js'
import { jidNormalizedUser } from 'baileys'

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

  // --- Protected: settings ---
  app.get('/settings', { preHandler: requireAuth }, async (req, reply) => {
    generateCsrf(req)
    return sendPage(reply, 'settings.html', req)
  })

  app.get('/api/settings', { preHandler: requireAuthApi }, async (_req, reply) => {
    return reply.send({
      project_name: getSettingOrDefault('project_name', 'WhatsApp Group Monitor'),
      page_size: getSettingOrDefault('page_size', '50'),
    })
  })

  app.post('/api/settings', { preHandler: requireAuthApi }, async (req, reply) => {
    if (!verifyCsrf(req)) {
      return reply.status(403).send({ error: 'Invalid CSRF token' })
    }
    const body = req.body as Record<string, string>
    const allowed = ['project_name', 'page_size']
    for (const key of allowed) {
      if (key in body && typeof body[key] === 'string') {
        setSetting(key, body[key])
      }
    }
    return reply.send({ ok: true })
  })

  // --- Protected API ---
  app.get('/api/groups', { preHandler: requireAuthApi }, async (_req, reply) => {
    if (!isAccountDbReady()) {
      return reply.send({ groups: [] })
    }
    const groups = getAllGroups()
    const jids = groups.map(g => g.jid)
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 86400)
    const memberCounts = getGroupMemberCounts(jids)
    const activityCounts = getGroupActivityCounts(jids, thirtyDaysAgo)
    const lastActivity = getGroupLastActivity(jids)

    const enriched = groups.map(g => ({
      ...g.toJSON(),
      memberCount: memberCounts.get(g.jid) ?? 0,
      monthlyActivity: activityCounts.get(g.jid) ?? 0,
      lastActivity: lastActivity.get(g.jid) ?? null,
    }))
    return reply.send({ groups: enriched })
  })

  app.get('/group/:jid', { preHandler: requireAuth }, async (req, reply) => {
    generateCsrf(req)
    return sendPage(reply, 'group.html', req)
  })

  app.get('/api/groups/:jid', { preHandler: requireAuthApi }, async (req, reply) => {
    if (!isAccountDbReady()) {
      return reply.status(503).send({ error: 'Not connected' })
    }
    const { jid } = req.params as { jid: string }
    const group = getGroup(jid)
    if (!group) {
      return reply.status(404).send({ error: 'Group not found' })
    }

    const members = getGroupMembers(jid, { includeLeft: true })
    const memberCounts = getGroupMemberCounts([jid])
    const lastActivity = getGroupLastActivity([jid])
    const userActivity = getGroupUserActivity(jid, 30)
    const activityMap = new Map(userActivity.map(a => [a.userJid, a]))

    let botUserJid: string | null = null
    try {
      const sock = getSock()
      if (sock.user?.lid) botUserJid = jidNormalizedUser(sock.user.lid)
      else if (sock.user?.id) botUserJid = jidNormalizedUser(sock.user.id)
    } catch { /* not connected */ }

    const enrichedMembers = members.map(m => {
      const activity = activityMap.get(m.userJid)
      return {
        ...m,
        isBot: botUserJid ? m.userJid === botUserJid : false,
        posts: activity?.posts ?? 0,
        reactions: activity?.reactions ?? 0,
        total: activity?.total ?? 0,
        lastActivity: activity?.lastActivity ?? null,
      }
    })

    return reply.send({
      group: {
        ...group.toJSON(),
        memberCount: memberCounts.get(jid) ?? 0,
        lastActivity: lastActivity.get(jid) ?? null,
      },
      members: enrichedMembers,
    })
  })

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
