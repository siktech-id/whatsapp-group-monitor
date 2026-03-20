import type { Contact } from 'baileys'
import { updateDisplayName, updatePhoneNumber, userExists } from '../../db/queries/users.js'
import { isAccountDbReady } from '../../db/account.js'
import { logger } from '../../utils/logger.js'

/**
 * Handle contacts.upsert / contacts.update events.
 * Only update users who already exist in the DB (group members).
 * Only use notify (self-set name), never contact.name (address book name).
 */
export function handleContactsUpsert(contacts: Contact[]) {
  if (!isAccountDbReady()) return
  let updated = 0
  for (const contact of contacts) {
    if (!contact.id || !userExists(contact.id)) continue
    if (contact.notify) {
      updateDisplayName(contact.id, contact.notify)
      updated++
    }
    if (contact.phoneNumber) {
      updatePhoneNumber(contact.id, contact.phoneNumber)
    }
  }
  if (updated > 0) logger.debug({ count: contacts.length, updated }, 'Contacts upserted (existing users only)')
}

export function handleContactsUpdate(contacts: Partial<Contact>[]) {
  if (!isAccountDbReady()) return
  let updated = 0
  for (const contact of contacts) {
    if (!contact.id || !userExists(contact.id)) continue
    if (contact.notify) {
      updateDisplayName(contact.id, contact.notify)
      updated++
    }
    if (contact.phoneNumber) {
      updatePhoneNumber(contact.id, contact.phoneNumber)
    }
  }
  if (updated > 0) logger.debug({ count: contacts.length, updated }, 'Contacts updated (existing users only)')
}
