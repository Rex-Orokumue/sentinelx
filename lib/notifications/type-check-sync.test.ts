import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

// player_notifications_type_check is a hand-maintained CHECK, not an enum. A
// NotificationType member that is missing from it fails the bell insert, and
// insertRendered/insertInAppNotification swallow the error — so the
// notification silently never appears (result_submitted was dropped this way
// from the day it was added). This pins the TypeScript union to the newest
// migration that defines the constraint.

const ROOT = path.resolve(__dirname, '../..')

function notificationTypeMembers(): string[] {
  const src = readFileSync(path.join(ROOT, 'lib/notifications/inbox.ts'), 'utf8').replaceAll('\r\n', '\n')
  const block = src.match(/export type NotificationType =([\s\S]*?)\n\n/)
  if (!block) throw new Error('NotificationType union not found in inbox.ts')
  return Array.from(block[1].matchAll(/'([a-z_]+)'/g), (m) => m[1])
}

function latestConstraintTypes(): { file: string; types: string[] } {
  const dir = path.join(ROOT, 'supabase/migrations')
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files.reverse()) {
    const sql = readFileSync(path.join(dir, file), 'utf8').replaceAll('\r\n', '\n')
    const add = sql.match(/ADD CONSTRAINT player_notifications_type_check\s+CHECK\s*\(([\s\S]*?)\]::text\[\]\)\)/i)
    if (add) return { file, types: Array.from(add[1].matchAll(/'([a-z_]+)'/g), (m) => m[1]) }
  }
  throw new Error('no migration defines player_notifications_type_check')
}

describe('player_notifications_type_check stays in sync with NotificationType', () => {
  it('allows every NotificationType member', () => {
    const members = notificationTypeMembers()
    const { file, types } = latestConstraintTypes()
    const missing = members.filter((t) => !types.includes(t))
    expect(missing, `missing from ${file} — add a migration widening the CHECK`).toEqual([])
  })

  it('found a plausible number of types (the parsers are not silently empty)', () => {
    expect(notificationTypeMembers().length).toBeGreaterThan(30)
    expect(latestConstraintTypes().types.length).toBeGreaterThan(30)
  })
})
