// A one-tap "message this buyer about their request" link for the admin
// buy-requests page, mirroring lib/exchange/admin-whatsapp.ts's seller
// contact pattern.
import { parsePlayerPhone } from '@/lib/phone/number'
import { formatNaira } from '@/lib/format'

export function buildBuyerWhatsAppUrl(args: {
  buyerWhatsapp: string | null | undefined
  buyerCountry?: string | null
  buyerName: string
  requestTitle: string
  budget: number
}): string | null {
  const phone = parsePlayerPhone(args.buyerWhatsapp, { country: args.buyerCountry })
  if (!phone) return null
  const text =
    `Hi ${args.buyerName} — SentinelX admin here about your Exchange request ` +
    `"${args.requestTitle}" (budget ${formatNaira(args.budget)}).`
  return `https://wa.me/${phone.waNumber}?text=${encodeURIComponent(text)}`
}
