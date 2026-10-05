// C0/C1 controls (except \n \t \r), bidi overrides/isolates and marks. ZWJ (U+200D) and ZWNJ are kept for emoji.
const UNSAFE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁩]/g
export function stripUnsafeChars(s: string): string {
  return s.replace(UNSAFE, '')
}
export function sanitizeLabel(s: string | null | undefined, max = 40): string {
  if (!s) return ''
  return stripUnsafeChars(s).replace(/\s+/g, ' ').trim().slice(0, max)
}
