import { parsePlayerPhone, type PlayerPhone } from '@/lib/phone/number'
import { formatFixtureDate } from '@/lib/format'

export interface PlayerContactInput {
  regWhatsapp: string | null | undefined
  profileWhatsapp: string | null | undefined
  // The player's `profiles.country`. Both candidate numbers are parsed against
  // it — a registration row carries no country of its own, and a player abroad
  // types their registration number in their own national format.
  country?: string | null
}

// The number an admin should reach a player on for a specific tournament.
// Their registration number wins — it's what they gave for THIS tournament —
// but an unusable entry there falls through to their profile number rather than
// leaving admin with no way to reach them. Null when neither is a valid number.
export function resolvePlayerPhone(input: PlayerContactInput): PlayerPhone | null {
  for (const candidate of [input.regWhatsapp, input.profileWhatsapp]) {
    const parsed = parsePlayerPhone(candidate, { country: input.country })
    if (parsed) return parsed
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
  player: PlayerContactInput
  playerName: string
  opponentName: string | null
  // The opponent's parsed number, appended to the message so the player can
  // reach them without admin having to relay it. Omitted when unreachable.
  opponentPhone?: PlayerPhone | null
  tournamentTitle: string
  scheduledAt: string | null
  isFullDay: boolean
}): string | null {
  const phone = resolvePlayerPhone(args.player)
  if (!phone) return null

  const opponent = args.opponentName ?? 'your opponent'
  const when = formatFixtureDate(args.scheduledAt, args.isFullDay)

  const body = !when
    ? `Hi ${args.playerName} — SentinelX admin here about your ${args.tournamentTitle} match vs ${opponent}. ` +
      `It's not scheduled yet — when are you available to play?`
    : args.isFullDay
      ? `Hi ${args.playerName} — SentinelX admin here. Your ${args.tournamentTitle} match vs ${opponent} ` +
        `is scheduled for ${when} — you can play any time that day. Please confirm you'll be ready.`
      : `Hi ${args.playerName} — SentinelX admin here. Your ${args.tournamentTitle} match vs ${opponent} ` +
        `is scheduled for ${when}. Please confirm you'll be ready to play.`

  // Two blank-line-separated blocks: the readable number (to save as a contact
  // or dial) and a tap-to-chat link that works even when the number isn't saved.
  const text = args.opponentPhone
    ? `${body}\n\n${opponent}: ${args.opponentPhone.display}\n` +
      `Message them: https://wa.me/${args.opponentPhone.waNumber}`
    : body

  return `https://wa.me/${phone.waNumber}?text=${encodeURIComponent(text)}`
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
  countryByPlayer?: Map<string, string | null>
}): FixtureContacts {
  const contactInputFor = (playerId: string): PlayerContactInput => ({
    regWhatsapp: args.regWhatsappByPlayer.get(playerId),
    profileWhatsapp: args.profileWhatsappByPlayer.get(playerId),
    country: args.countryByPlayer?.get(playerId),
  })

  const contacts: FixtureContacts = {}
  for (const f of args.fixtures) {
    const phoneA = resolvePlayerPhone(contactInputFor(f.playerA.id))
    const phoneB = resolvePlayerPhone(contactInputFor(f.playerB.id))
    const linkFor = (
      player: { id: string; name: string },
      opponent: { name: string },
      opponentPhone: PlayerPhone | null,
    ) =>
      buildAdminPlayerWhatsAppUrl({
        player: contactInputFor(player.id),
        playerName: player.name,
        opponentName: opponent.name,
        opponentPhone,
        tournamentTitle: args.tournamentTitle,
        scheduledAt: f.scheduled_at,
        isFullDay: f.is_full_day,
      })
    contacts[f.id] = {
      a: linkFor(f.playerA, f.playerB, phoneB),
      b: linkFor(f.playerB, f.playerA, phoneA),
    }
  }
  return contacts
}
