import { toWhatsAppNumber } from '@/lib/dashboard/fixtures'
import { formatFixtureDate } from '@/lib/format'

// The number an admin should reach a player on for a specific tournament.
// Their registration number wins — it's what they gave for THIS tournament —
// but a mangled entry there falls through to their profile number rather than
// leaving admin with no way to reach them. Null when neither parses.
export function resolvePlayerWhatsApp(
  regWhatsapp: string | null | undefined,
  profileWhatsapp: string | null | undefined,
): string | null {
  for (const candidate of [regWhatsapp, profileWhatsapp]) {
    if (!candidate) continue
    const number = toWhatsAppNumber(candidate)
    if (number) return number
  }
  return null
}

/**
 * A wa.me link an admin taps to chase one player about one fixture, pre-filled
 * with who they're playing and when. Null when the player has no reachable
 * number — callers render a "no WhatsApp" state so admin can see *which*
 * player needs chasing another way.
 */
export function buildAdminPlayerWhatsAppUrl(args: {
  regWhatsapp: string | null | undefined
  profileWhatsapp: string | null | undefined
  playerName: string
  opponentName: string | null
  tournamentTitle: string
  scheduledAt: string | null
  isFullDay: boolean
}): string | null {
  const number = resolvePlayerWhatsApp(args.regWhatsapp, args.profileWhatsapp)
  if (!number) return null

  const opponent = args.opponentName ?? 'your opponent'
  const when = formatFixtureDate(args.scheduledAt, args.isFullDay)
  const match = `your ${args.tournamentTitle} match vs ${opponent}`

  const text = !when
    ? `Hi ${args.playerName} — SentinelX admin here about ${match}. ` +
      `It's not scheduled yet — when are you available to play?`
    : args.isFullDay
      ? `Hi ${args.playerName} — SentinelX admin here. Your ${args.tournamentTitle} match vs ${opponent} ` +
        `is scheduled for ${when} — you can play any time that day. Please confirm you'll be ready.`
      : `Hi ${args.playerName} — SentinelX admin here. Your ${args.tournamentTitle} match vs ${opponent} ` +
        `is scheduled for ${when}. Please confirm you'll be ready to play.`

  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`
}
