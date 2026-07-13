import { toWhatsAppNumber } from '@/lib/dashboard/fixtures'

export function buildRecordingWhatsAppUrl(args: {
  adminWhatsapp: string | null
  username: string
  tournamentTitle: string
  playerAName: string
  playerBName: string
}): string | null {
  if (!args.adminWhatsapp) return null
  const number = toWhatsAppNumber(args.adminWhatsapp)
  if (!number) return null
  const text = `Hi, I'm ${args.username} submitting my recording for ${args.tournamentTitle} - ${args.playerAName} vs ${args.playerBName}.`
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`
}
