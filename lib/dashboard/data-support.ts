import { toWhatsAppNumber } from './fixtures'

export interface DataSupportMatch {
  round: string
  tournamentId: string
  tournamentTitle: string
  dataSupportText: string | null
  dataSupportWhatsapp: string | null
}

export interface DataSupportEligibility {
  tournamentId: string
  tournamentTitle: string
  text: string
  whatsapp: string
  stage: 'semi-final' | 'final'
}

// One row per tournament the player is eligible in — 'final' wins over
// 'semi-final' when both rounds exist for the same tournament (a finalist
// reached the semifinal too, but the claim message names the furthest stage).
export function computeDataSupportEligibility(matches: DataSupportMatch[]): DataSupportEligibility[] {
  const byTournament = new Map<string, DataSupportEligibility>()

  for (const m of matches) {
    if (m.round !== 'semi_final' && m.round !== 'final') continue
    if (!m.dataSupportText || !m.dataSupportWhatsapp) continue

    const stage: 'semi-final' | 'final' = m.round === 'final' ? 'final' : 'semi-final'
    const existing = byTournament.get(m.tournamentId)
    if (existing && existing.stage === 'final') continue // already at the furthest stage

    byTournament.set(m.tournamentId, {
      tournamentId: m.tournamentId,
      tournamentTitle: m.tournamentTitle,
      text: m.dataSupportText,
      whatsapp: m.dataSupportWhatsapp,
      stage,
    })
  }

  return Array.from(byTournament.values())
}

export function buildDataSupportClaimUrl(args: {
  whatsapp: string
  username: string
  tournamentTitle: string
  stage: 'semi-final' | 'final'
}): string | null {
  const number = toWhatsAppNumber(args.whatsapp)
  if (!number) return null
  const text = `Hi, I'm ${args.username} and I reached the ${args.stage} of ${args.tournamentTitle}. I'd like to claim my data support.`
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`
}
