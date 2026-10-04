// Storage paths for DM media are "<uploaderId>/<file>". Only a path the CALLER uploaded may arrive from client
// input. Forwarding is the one legitimate caller of the core send with someone else's path, and it does not go
// through this check (it reads the path from the database row after a participant check).
const SEGMENT = /^[A-Za-z0-9._-]+$/

export function isOwnMediaPath(path: string, userId: string): boolean {
  const parts = path.split('/')
  if (parts.length !== 2) return false
  const [folder, file] = parts
  return folder === userId && SEGMENT.test(file) && file !== '.' && file !== '..'
}
