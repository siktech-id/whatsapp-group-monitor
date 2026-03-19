import { eq } from 'drizzle-orm'
import { getSharedDb } from '../shared.js'
import { settings } from '../schema.js'

export function getSetting(key: string): string | null {
  const db = getSharedDb()
  const row = db.select().from(settings).where(eq(settings.key, key)).get()
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  const db = getSharedDb()
  db.insert(settings).values({
    key,
    value,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: settings.key,
    set: { value, updatedAt: new Date() },
  }).run()
}

export function getSettingOrDefault(key: string, defaultValue: string): string {
  return getSetting(key) ?? defaultValue
}
