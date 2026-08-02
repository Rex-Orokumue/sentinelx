// A one-tap "message this seller about this listing" link for the admin
// Exchange page, mirroring lib/matches/admin-whatsapp.ts's player-contact
// pattern. Takes the seller's raw stored number + country and returns a
// finished wa.me URL (or null if unreachable) so no phone number reaches
// the client for a seller who can't be reached — components/shared/
// WhatsAppChip.tsx already renders that null case as a labelled dead chip.
import { parsePlayerPhone } from '@/lib/phone/number'
import { formatNaira } from '@/lib/format'

export function buildSellerWhatsAppUrl(args: {
  sellerWhatsapp: string | null | undefined
  sellerCountry?: string | null
  sellerName: string
  listingTitle: string
  price: number
}): string | null {
  const phone = parsePlayerPhone(args.sellerWhatsapp, { country: args.sellerCountry })
  if (!phone) return null
  const text =
    `Hi ${args.sellerName} — SentinelX admin here about your Exchange listing ` +
    `"${args.listingTitle}" (${formatNaira(args.price)}).`
  return `https://wa.me/${phone.waNumber}?text=${encodeURIComponent(text)}`
}
