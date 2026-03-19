import type { ConnectionState, Contact } from 'baileys'
import { logger } from '../../utils/logger.js'

let currentQr: string | null = null
let connectionState: string | null = null
let botUser: { name: string | null; phone: string | null } | null = null

export function getCurrentQr() { return currentQr }
export function getConnectionState() { return connectionState }
export function getBotUser() { return botUser }

export function handleConnectionUpdate(update: Partial<ConnectionState>, user?: Contact | null) {
  if (update.qr) {
    currentQr = update.qr
    logger.debug('New QR code generated')
  }

  if (update.connection) {
    connectionState = update.connection
    if (update.connection === 'open') {
      currentQr = null
      const phone = user?.id?.split(':')[0].split('@')[0] || null
      const name = user?.name || user?.notify || null
      botUser = { name, phone }
      logger.info({ phone }, 'WhatsApp connection established')
    } else if (update.connection === 'close') {
      botUser = null
    }
  }
}

export function updateBotUser(user?: Contact | null) {
  if (!user) return
  const phone = user.id?.split(':')[0].split('@')[0] || botUser?.phone || null
  const name = user.name || user.notify || botUser?.name || null
  botUser = { name, phone }
}
