import { CATEGORY_LABELS, type ListingCategory } from './schema'

export const SPEC_LINE_MAX_LENGTH = 60

export interface SpecLineInput {
  subtitle: string | null
  description: string | null
  gameName: string | null
  category: ListingCategory
}

function firstMeaningfulLine(text: string | null): string | null {
  if (!text) return null
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0)
  return line ?? null
}

function truncate(text: string): string {
  return text.length <= SPEC_LINE_MAX_LENGTH
    ? text
    : `${text.slice(0, SPEC_LINE_MAX_LENGTH - 1).trimEnd()}…`
}

// The card's second line, resolved from whatever the listing actually has:
// the seller's own hook line, else the opening line of their description, else
// a generated game/category label. Always non-empty, so a card never renders a
// blank row where the spec line goes.
export function resolveSpecLine({ subtitle, description, gameName, category }: SpecLineInput): string {
  const own = firstMeaningfulLine(subtitle) ?? firstMeaningfulLine(description)
  if (own) return truncate(own)

  const label = CATEGORY_LABELS[category]
  return gameName?.trim() ? `${gameName.trim()} · ${label}` : label
}
