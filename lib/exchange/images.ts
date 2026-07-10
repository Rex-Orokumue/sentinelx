import type { ListingCategory } from './schema'

const IMAGE_REQUIRED: ReadonlySet<ListingCategory> = new Set(['account', 'controller', 'phone'])

export function imageRequired(category: ListingCategory): boolean {
  return IMAGE_REQUIRED.has(category)
}

export function validateImageCount(category: ListingCategory, count: number): boolean {
  return imageRequired(category) ? count >= 1 : true
}

export function primaryImageUrl(images: { image_url: string; display_order: number }[]): string | null {
  if (images.length === 0) return null
  return [...images].sort((a, b) => a.display_order - b.display_order)[0].image_url
}
