export type TemplateInput =
  | { type: 'registration_confirmed'; tournament: string }
  | { type: 'fixture_reminder'; playerA: string; playerB: string; tournament: string; matchUrl: string }
  | { type: 'result_confirmed'; playerA: string; playerB: string; scoreA: number; scoreB: number; tournament: string }
  | { type: 'prize_credited'; amount: string }

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
  }
}
