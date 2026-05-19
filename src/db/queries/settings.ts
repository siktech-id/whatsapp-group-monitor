import { eq } from 'drizzle-orm'
import { getSharedDb } from '../shared.js'
import { settings } from '../schema.js'

export async function getSetting(key: string): Promise<string | null> {
  const db = getSharedDb()
  const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1)
  return rows[0]?.value ?? null
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = getSharedDb()
  await db.insert(settings).values({
    key,
    value,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: settings.key,
    set: { value, updatedAt: new Date() },
  })
}

export async function getSettingOrDefault(key: string, defaultValue: string): Promise<string> {
  const result = await getSetting(key)
  return result ?? defaultValue
}
