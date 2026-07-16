import { SITE_URL, SITE_NAME } from '../site'

export type ListingProductInput = {
  id: string
  title: string
  description: string | null
  price: number
  image: string | null
  status: string
}

export function buildListingJsonLd(l: ListingProductInput) {
  const url = `${SITE_URL}/exchange/${l.id}`
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: l.title,
    description: l.description ?? `${l.title} on the Sentinel X Gaming Exchange.`,
    url,
    ...(l.image ? { image: l.image } : {}),
    offers: {
      '@type': 'Offer',
      price: l.price,
      priceCurrency: 'NGN',
      availability: l.status === 'active' ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
      url,
    },
    seller: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
  }
}
