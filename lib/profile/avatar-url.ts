// An avatar URL must point at THIS player's own folder in the public `avatars` bucket (storage RLS
// already restricts writes to `<uid>/...`); anything else is a hotlink to an arbitrary host.
export function isOwnAvatarUrl(url: string, userId: string, supabaseUrl: string): boolean {
  let u: URL
  let base: URL
  try {
    u = new URL(url)
    base = new URL(supabaseUrl)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.host !== base.host) return false
  const prefix = `/storage/v1/object/public/avatars/${userId}/`
  if (!u.pathname.startsWith(prefix)) return false
  const rest = u.pathname.slice(prefix.length)
  return rest.length > 0 && !rest.split('/').some((seg) => seg === '..' || seg === '.')
}
