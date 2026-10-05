// scripts/audit-avatars.ts — dry-run by default. `--apply` re-encodes non-WebP objects and is OWNER-GATED.
// Usage: npx tsx scripts/audit-avatars.ts            (counts only; needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
import { createAdminClient } from '@/lib/supabase/admin'

async function main() {
  const admin = createAdminClient()
  const apply = process.argv.includes('--apply')
  let offset = 0
  let total = 0
  const suspects: string[] = []
  for (;;) {
    const { data: folders } = await admin.storage.from('avatars').list('', { limit: 100, offset })
    if (!folders || folders.length === 0) break
    for (const f of folders) {
      const { data: files } = await admin.storage.from('avatars').list(f.name, { limit: 100 })
      for (const o of files ?? []) {
        total++
        const mime = (o.metadata as { mimetype?: string } | null)?.mimetype
        if (mime !== 'image/webp') suspects.push(`${f.name}/${o.name} (${mime ?? 'unknown'})`)
      }
    }
    offset += folders.length
  }
  console.log(JSON.stringify({ total, nonWebp: suspects.length, sample: suspects.slice(0, 20), apply }, null, 2))
  if (apply) {
    console.error('--apply is not implemented in this task: the owner must approve a scrub design from the dry-run counts first.')
    process.exit(2)
  }
}
void main()
