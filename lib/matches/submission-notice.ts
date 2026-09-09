// Copy and addressing for the notification the OTHER player gets when their
// opponent submits a match result.
//
// Until now a submission notified staff only, so the person with the strongest
// reason to look at it — the opponent, who is the one who would know the score
// is wrong — found out nothing until an admin had already confirmed it. That
// is the wrong order: disputes are cheap before confirmation and expensive
// after.
//
// Pure so the addressing rules are testable without a Supabase harness; the
// action supplies the row data.

export interface SubmissionNotice {
  recipientId: string
  title: string
  body: string
  link: string
}

export function opponentSubmissionNotice(input: {
  matchId: string
  submitterId: string
  playerAId: string | null
  playerBId: string | null
  playerAName: string | null
  playerBName: string | null
  tournamentTitle: string
  scoreA: number
  scoreB: number
  isResubmission: boolean
}): SubmissionNotice | null {
  const { submitterId, playerAId, playerBId } = input

  // A bye, or a knockout slot not yet drawn — there is nobody to tell.
  if (!playerAId || !playerBId) return null

  const recipientId = submitterId === playerAId ? playerBId : submitterId === playerBId ? playerAId : null
  if (!recipientId) return null

  const nameA = input.playerAName || 'Player'
  const nameB = input.playerBName || 'Player'
  // Deliberately NOT reordered to put the recipient first: score_a belongs to
  // player A whoever submitted, and this is the same scoreline the admin sees
  // in the review queue. Two renderings of one result is how a dispute starts.
  const scoreline = `${nameA} ${input.scoreA} – ${input.scoreB} ${nameB}`

  return input.isResubmission
    ? {
        recipientId,
        title: 'Opponent updated their result',
        body: `Your opponent updated it to ${scoreline} in ${input.tournamentTitle}. Check it now — tell an admin if it is wrong.`,
        link: `/matches/${input.matchId}`,
      }
    : {
        recipientId,
        title: 'Opponent submitted a result',
        body: `${scoreline} in ${input.tournamentTitle}. Check it now — tell an admin if it is wrong.`,
        link: `/matches/${input.matchId}`,
      }
}
