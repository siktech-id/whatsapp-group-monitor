import { mkdirSync } from 'fs'
import { config } from './config.js'
import { logger } from './utils/logger.js'
import { startConnection } from './whatsapp/client.js'
import { startWebServer } from './web/server.js'

async function main() {
  mkdirSync(config.authDir, { recursive: true })

  logger.info('Starting WhatsApp Group Monitor...')

  await startWebServer()
  await startConnection()
}

main().catch((err) => {
  logger.fatal(err, 'Failed to start')
  process.exit(1)
})
