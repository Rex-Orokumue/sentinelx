// The tournament `rules` field is a single markdown string. For the
// accept-one-by-one registration gate we need it as an ordered list of
// individual rules. Strategy:
//   1. If it reads as a bullet / numbered list, one item per rule.
//   2. Otherwise, one blank-line-separated paragraph per rule.
//   3. Otherwise, the whole thing as a single rule.
// Inline markdown is preserved (each rule is rendered with ReactMarkdown);
// only leading heading (`#`) and list markers are stripped.

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/
const HEADING = /^\s*#{1,6}\s+/
const LEADING_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/

function stripHeading(line: string): string {
  return line.replace(HEADING, '').trim()
}

export function splitRules(rules: string | null | undefined): string[] {
  if (!rules) return []
  const text = rules.replace(/\r\n?/g, '\n').trim()
  if (!text) return []

  const lines = text.split('\n')
  const listItems = lines
    .map((l) => l.match(LIST_ITEM)?.[1])
    .filter((v): v is string => !!v && v.trim().length > 0)

  if (listItems.length >= 2) return listItems.map((s) => s.trim())

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split('\n')
        .map(stripHeading)
        .filter(Boolean)
        .join(' ')
        .trim(),
    )
    .filter(Boolean)

  if (paragraphs.length >= 2) return paragraphs

  const single = stripHeading(text).replace(LEADING_MARKER, '').trim()
  return single ? [single] : []
}
