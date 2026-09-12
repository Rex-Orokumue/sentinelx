import type { Translate } from './locale'

export type TemplateInput =
  | { type: 'registration_confirmed'; tournament: string }
  | { type: 'fixture_reminder'; playerA: string; playerB: string; tournament: string; matchUrl: string }
  | { type: 'fixture_assigned'; playerA: string; playerB: string; tournament: string; matchUrl: string; whenLabel: string | null }
  | { type: 'result_confirmed'; playerA: string; playerB: string; scoreA: number; scoreB: number; tournament: string }
  | { type: 'prize_credited'; amount: string }
  | { type: 'escrow_sale'; title: string }
  | { type: 'escrow_completed'; title: string }
  | { type: 'escrow_refunded'; title: string }
  | { type: 'player_disqualified'; tournament: string; reason: string }
  | {
      type: 'noshow_needs_decision'
      tournament: string
      round: string
      playerA: string
      playerB: string
      // wa.me links for each player, so staff can chase them straight from the
      // alert instead of opening the dashboard to look numbers up. Null when a
      // player has no valid number on file.
      playerAWhatsAppUrl?: string | null
      playerBWhatsAppUrl?: string | null
    }
  | { type: 'masters_invitation'; tournamentName: string; rank: number; deadline: string; entryFee: string }
  | { type: 'champions_cup_invitation'; tournamentName: string; rank: number; deadline: string; entryFee: string }
  | { type: 'invitation_accepted'; tournamentName: string; playerName: string }
  | { type: 'invitation_expired_cascade'; tournamentName: string; rank: number; deadline: string; entryFee: string }

export interface RenderedTemplate {
  templateName: string
  body: string
}

// `templateName` is NOT translated and must never change: Termii/Meta register
// templates by that name, and a renamed template is an unregistered one. Only
// `body` is localised.
//
// The caller supplies a translator already bound to the RECIPIENT's locale and
// the `notifications.whatsapp` namespace — see notify() in notify.ts.
export function renderTemplate(input: TemplateInput, t: Translate): RenderedTemplate {
  switch (input.type) {
    case 'registration_confirmed':
      return {
        templateName: 'registration_confirmed',
        body: t('registrationConfirmed', { tournament: input.tournament }),
      }
    case 'fixture_reminder':
      return {
        templateName: 'fixture_reminder',
        body: t('fixtureReminder', {
          playerA: input.playerA,
          playerB: input.playerB,
          tournament: input.tournament,
          matchUrl: input.matchUrl,
        }),
      }
    case 'fixture_assigned':
      // Two keys rather than one with an optional clause: an ICU conditional on
      // a possibly-empty string reads worse in the catalog than two plain
      // sentences, and translators see complete sentences either way.
      return {
        templateName: 'fixture_assigned',
        body: input.whenLabel
          ? t('fixtureAssignedWhen', {
              playerA: input.playerA,
              playerB: input.playerB,
              tournament: input.tournament,
              whenLabel: input.whenLabel,
              matchUrl: input.matchUrl,
            })
          : t('fixtureAssigned', {
              playerA: input.playerA,
              playerB: input.playerB,
              tournament: input.tournament,
              matchUrl: input.matchUrl,
            }),
      }
    case 'result_confirmed':
      return {
        templateName: 'result_confirmed',
        body: t('resultConfirmed', {
          playerA: input.playerA,
          scoreA: input.scoreA,
          scoreB: input.scoreB,
          playerB: input.playerB,
          tournament: input.tournament,
        }),
      }
    case 'prize_credited':
      return { templateName: 'prize_credited', body: t('prizeCredited', { amount: input.amount }) }
    case 'escrow_sale':
      return { templateName: 'escrow_sale', body: t('escrowSale', { title: input.title }) }
    case 'escrow_completed':
      return { templateName: 'escrow_completed', body: t('escrowCompleted', { title: input.title }) }
    case 'escrow_refunded':
      return { templateName: 'escrow_refunded', body: t('escrowRefunded', { title: input.title }) }
    case 'player_disqualified':
      return {
        templateName: 'player_disqualified',
        body: t('playerDisqualified', { tournament: input.tournament, reason: input.reason }),
      }
    case 'noshow_needs_decision': {
      // The contact block is assembled here, not in the catalog: it is a
      // variable-length list of "name: url" pairs, which ICU cannot express and
      // which carries no translatable words beyond its heading.
      const contacts = [
        input.playerAWhatsAppUrl ? `${input.playerA}: ${input.playerAWhatsAppUrl}` : null,
        input.playerBWhatsAppUrl ? `${input.playerB}: ${input.playerBWhatsAppUrl}` : null,
      ].filter(Boolean)
      const base = t('noshowNeedsDecision', {
        playerA: input.playerA,
        playerB: input.playerB,
        tournament: input.tournament,
        round: input.round.replace(/_/g, ' '),
      })
      return {
        templateName: 'noshow_needs_decision',
        body: contacts.length > 0 ? `${base}\n\n${t('noshowContacts')}\n${contacts.join('\n')}` : base,
      }
    }
    case 'masters_invitation':
      return {
        templateName: 'masters_invitation',
        body: t('mastersInvitation', {
          tournamentName: input.tournamentName,
          rank: input.rank,
          entryFee: input.entryFee,
          deadline: input.deadline,
        }),
      }
    case 'champions_cup_invitation':
      return {
        templateName: 'champions_cup_invitation',
        body: t('championsCupInvitation', {
          tournamentName: input.tournamentName,
          rank: input.rank,
          deadline: input.deadline,
        }),
      }
    case 'invitation_accepted':
      return {
        templateName: 'invitation_accepted',
        body: t('invitationAccepted', {
          playerName: input.playerName,
          tournamentName: input.tournamentName,
        }),
      }
    case 'invitation_expired_cascade':
      return {
        templateName: 'invitation_expired_cascade',
        body: t('invitationExpiredCascade', {
          tournamentName: input.tournamentName,
          rank: input.rank,
          entryFee: input.entryFee,
          deadline: input.deadline,
        }),
      }
  }
}
