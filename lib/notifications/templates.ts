export type TemplateInput =
  | { type: 'registration_confirmed'; tournament: string }
  | { type: 'fixture_reminder'; playerA: string; playerB: string; tournament: string; matchUrl: string }
  | { type: 'result_confirmed'; playerA: string; playerB: string; scoreA: number; scoreB: number; tournament: string }
  | { type: 'prize_credited'; amount: string }
  | { type: 'escrow_sale'; title: string }
  | { type: 'escrow_completed'; title: string }
  | { type: 'escrow_refunded'; title: string }

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
  }
}
