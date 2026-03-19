import { useMultiFileAuthState } from 'baileys'
import { config } from '../config.js'

export async function initAuthState() {
  return useMultiFileAuthState(config.authDir)
}
