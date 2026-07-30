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

export interface RenderedTemplate {
  templateName: string
  body: string
}

export function renderTemplate(input: TemplateInput): RenderedTemplate {
  switch (input.type) {
    case 'registration_confirmed':
      return {
        templateName: 'registration_confirmed',
        body: `✅ You're registered for ${input.tournament} on Sentinel X! Entry confirmed — we'll remind you before your matches. Good luck! 🎮`,
      }
    case 'fixture_reminder':
      return {
        templateName: 'fixture_reminder',
        body: `⏰ Your Sentinel X match starts in ~1 hour: ${input.playerA} vs ${input.playerB} (${input.tournament}). Get ready → ${input.matchUrl}`,
      }
    case 'fixture_assigned':
      return {
        templateName: 'fixture_assigned',
        body: `📅 New Sentinel X fixture: ${input.playerA} vs ${input.playerB} (${input.tournament})${
          input.whenLabel ? ` — ${input.whenLabel}` : ''
        }. ${input.matchUrl}`,
      }
    case 'result_confirmed':
      return {
        templateName: 'result_confirmed',
        body: `🏁 Result confirmed: ${input.playerA} ${input.scoreA}–${input.scoreB} ${input.playerB} (${input.tournament}). See the updated bracket on Sentinel X.`,
      }
    case 'prize_credited':
      return {
        templateName: 'prize_credited',
        body: `💸 Your prize withdrawal of ${input.amount} has been paid to your bank account. Thanks for competing on Sentinel X! 🏆`,
      }
    case 'escrow_sale':
      return {
        templateName: 'escrow_sale',
        body: `💰 You've got a sale on Sentinel X! "${input.title}" — funds are held safely in Zolarux escrow. Deliver to the buyer now; you're paid once they confirm.`,
      }
    case 'escrow_completed':
      return {
        templateName: 'escrow_completed',
        body: `✅ Your Sentinel X escrow order for "${input.title}" is complete — funds have been released to the seller. Enjoy!`,
      }
    case 'escrow_refunded':
      return {
        templateName: 'escrow_refunded',
        body: `↩️ Your Sentinel X escrow order for "${input.title}" has been refunded. The money is on its way back to you.`,
      }
    case 'player_disqualified':
      return {
        templateName: 'player_disqualified',
        body: `🚫 You've been removed from ${input.tournament} on Sentinel X. Reason: ${input.reason} If you think this is a mistake, reach out to support.`,
      }
    case 'noshow_needs_decision': {
      const contacts = [
        input.playerAWhatsAppUrl ? `${input.playerA}: ${input.playerAWhatsAppUrl}` : null,
        input.playerBWhatsAppUrl ? `${input.playerB}: ${input.playerBWhatsAppUrl}` : null,
      ].filter(Boolean)
      return {
        templateName: 'noshow_needs_decision',
        body:
          `⚠️ No-show needs a decision: ${input.playerA} vs ${input.playerB} (${input.tournament}, ${input.round.replace(/_/g, ' ')}) passed its deadline with no confirmed result. Review it on the Sentinel X admin dashboard.` +
          (contacts.length > 0 ? `\n\nMessage them:\n${contacts.join('\n')}` : ''),
      }
    }
  }
}
