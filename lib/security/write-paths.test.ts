import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Ratchet for docs/superpowers/specs/2026-09-18-flutter-mobile-app-master-design.md §2.5.
// Heuristic, deliberately: by repo convention the RLS-scoped user client is a
// variable named `supabase` and the service-role client is `admin` (or an inline
// createAdminClient()). Renaming the user client would defeat it — don't.

const ROOT = process.cwd()
const SCAN_DIRS = ['lib', 'app', 'components']
const SKIP = /(\.test\.tsx?$|[\\/]types\.ts$|node_modules)/

// Written only by the service role after supabase/migrations/20260918200000_*.
const SERVER_ONLY_WRITE_TABLES = [
  'profiles',
  'tournament_registrations',
  'withdrawal_requests',
  'match_results',
  'friendly_matches',
  'friendly_match_results',
]
// Hidden from anon/authenticated by the same migration.
const PRIVATE_PROFILE_COLUMNS = ['phone', 'whatsapp_number', 'notification_prefs', 'referred_by', 'deletion_requested_at']

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (SKIP.test(p)) continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))).map((p) => ({
  path: relative(ROOT, p).replace(/\\/g, '/'),
  text: readFileSync(p, 'utf8'),
}))

const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length
const hasPrivate = (s: string) => PRIVATE_PROFILE_COLUMNS.some((c) => new RegExp(`\\b${c}\\b`).test(s))

describe('server-only tables and private profile columns', () => {
  it('never writes a server-only table through the RLS-scoped `supabase` client', () => {
    const re = new RegExp(
      `\\bsupabase\\s*\\.from\\(\\s*['"](${SERVER_ONLY_WRITE_TABLES.join('|')})['"]\\s*\\)\\s*\\.(insert|update|upsert|delete)\\b`,
      'g',
    )
    const violations: string[] = []
    for (const f of files) for (const m of Array.from(f.text.matchAll(re))) violations.push(`${f.path}:${lineOf(f.text, m.index!)} ${m[1]}.${m[2]}`)
    expect(violations).toEqual([])
  })

  it('never selects a private profile column through the `supabase` client directly', () => {
    const re = /\bsupabase\s*\.from\(\s*['"]profiles['"]\s*\)\s*\.select\(\s*(['"`])([\s\S]*?)\1/g
    const violations: string[] = []
    for (const f of files)
      for (const m of Array.from(f.text.matchAll(re))) if (hasPrivate(m[2])) violations.push(`${f.path}:${lineOf(f.text, m.index!)}`)
    expect(violations).toEqual([])
  })

  it('never embeds a private profile column in a `supabase` (user-client) select', () => {
    const start = /\bsupabase\s*\.from\(\s*['"][a-z_]+['"]\s*\)\s*\.select\(/g
    const violations: string[] = []
    for (const f of files) {
      for (const m of Array.from(f.text.matchAll(start))) {
        const from = m.index! + m[0].length
        const rest = f.text.slice(from, from + 1200)
        const end = rest.search(/\n\s*\.(eq|in|is|neq|not|order|limit|range|lt|lte|gt|gte|maybeSingle|single)\(/)
        const window = end === -1 ? rest : rest.slice(0, end)
        for (const emb of Array.from(window.matchAll(/profiles(?:!\w+)?\(([^)]*)\)/g)))
          if (hasPrivate(emb[1])) violations.push(`${f.path}:${lineOf(f.text, m.index!)}`)
      }
    }
    expect(violations).toEqual([])
  })

  it("never uses select('*') on profiles (breaks once column-level SELECT applies)", () => {
    const re = /from\(\s*['"]profiles['"]\s*\)\s*\.select\(\s*['"]\*['"]/g
    const violations: string[] = []
    for (const f of files) for (const m of Array.from(f.text.matchAll(re))) violations.push(`${f.path}:${lineOf(f.text, m.index!)}`)
    expect(violations).toEqual([])
  })
})
