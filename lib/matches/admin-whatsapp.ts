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

// A fixture as the bracket view shapes it (lib/tournaments/bracket.ts) — the
// subset this module needs.
export interface FixtureContactInput {
  id: string
  playerA: { id: string; name: string }
  playerB: { id: string; name: string }
  scheduled_at: string | null
  is_full_day: boolean
}

/** matchId → the wa.me link for each side, null where that player is unreachable. */
export type FixtureContacts = Record<string, { a: string | null; b: string | null }>

/**
 * Builds every fixture's pair of contact links in one pass, for admin surfaces
 * that render a list of fixtures (the bracket page's Fixtures tab).
 *
 * Returned as a plain serializable record because it crosses a Server → Client
 * component boundary. Admin pages pass it in; the public bracket page passes
 * nothing, which is what keeps player numbers out of the public bundle.
 */
export function buildFixtureContactMap(args: {
  fixtures: FixtureContactInput[]
  tournamentTitle: string
  regWhatsappByPlayer: Map<string, string | null>
  profileWhatsappByPlayer: Map<string, string | null>
}): FixtureContacts {
  const contacts: FixtureContacts = {}
  for (const f of args.fixtures) {
    const linkFor = (player: { id: string; name: string }, opponentName: string) =>
      buildAdminPlayerWhatsAppUrl({
        regWhatsapp: args.regWhatsappByPlayer.get(player.id),
        profileWhatsapp: args.profileWhatsappByPlayer.get(player.id),
        playerName: player.name,
        opponentName,
        tournamentTitle: args.tournamentTitle,
        scheduledAt: f.scheduled_at,
        isFullDay: f.is_full_day,
      })
    contacts[f.id] = {
      a: linkFor(f.playerA, f.playerB.name),
      b: linkFor(f.playerB, f.playerA.name),
    }
  }
  return contacts
}
