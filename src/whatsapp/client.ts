import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
  type WAMessage,
  type WAMessageKey,
} from 'baileys'
import { Boom } from '@hapi/boom'
import { rmSync } from 'fs'
import { LRUCache } from 'lru-cache'
import { initAuthState } from './auth.js'
import { config } from '../config.js'
import { logger } from '../utils/logger.js'
import { setupEventHandlers } from './events.js'

let sock: WASocket | null = null

const msgCache = new LRUCache<string, WAMessage>({ max: 1000 })

export function getSock(): WASocket {
  if (!sock) throw new Error('WhatsApp socket not initialized')
  return sock
}

export function cacheMessage(msg: WAMessage) {
  const id = msg.key.id
  if (id) msgCache.set(id, msg)
}

export function getCachedMessage(id: string): WAMessage | undefined {
  return msgCache.get(id)
}

async function getMessage(key: WAMessageKey) {
  if (key.id) return msgCache.get(key.id)?.message ?? undefined
  return undefined
}

export async function startConnection(): Promise<void> {
  const { state, saveCreds } = await initAuthState()
  const { version } = await fetchLatestBaileysVersion()

  logger.info({ version: version.join('.') }, 'Using WA Web version')

  sock = makeWASocket({
    version,
    browser: ['WhatsApp Group Monitor', 'Chrome', '22.0'], // TODO: use project_name from settings table
    logger: logger.child({ module: 'baileys' }),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger.child({ module: 'signal' })),
    },
    generateHighQualityLinkPreview: false,
    getMessage,
  })

  setupEventHandlers(sock, saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update
    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
      if (statusCode !== DisconnectReason.loggedOut) {
        logger.info('Connection closed, reconnecting...')
        await startConnection()
      } else {
        logger.warn('Logged out. Clearing auth state and waiting for new QR scan...')
        rmSync(config.authDir, { recursive: true, force: true })
        await startConnection()
      }
    }
  })
}
