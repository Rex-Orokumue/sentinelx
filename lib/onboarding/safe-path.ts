// Only allow a same-origin relative path as a redirect target — never a
// protocol-relative ("//host") or absolute URL. Kept out of actions.ts because
// that file is 'use server' (every export there must be an async function).
export function safeInternalPath(next: string | null | undefined, fallback: string): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) return fallback
  return next
}
