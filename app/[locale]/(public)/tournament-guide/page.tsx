import { buildMetadata } from '@/lib/seo/metadata'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'

export const metadata = buildMetadata({
  title: 'Tournament Guide',
  description: 'Everything you need to know before, during, and after a SentinelX tournament match.',
  path: '/tournament-guide',
})

export default function TournamentGuidePage() {
  return (
    <StaticPageShell eyebrow="Support" title="Tournament Guide" subtitle="Everything you need to know.">
      <div className={proseClassName}>
        <h2>Before You Register</h2>
        <p>
          <strong>Check the game.</strong> Each tournament specifies which game is being played. Make sure
          you have it installed and your in-game account is ready.
        </p>
        <p>
          <strong>Check the format.</strong> Tournaments use group stages (for large fields) followed by
          single-elimination knockout rounds. The tournament page shows how many groups, how many advance,
          and the prize structure.
        </p>
        <p>
          <strong>Check the schedule.</strong> Tournaments have a registration deadline and a start date.
          Once registration closes, the bracket is generated and no late entries are accepted.
        </p>
        <p>
          <strong>Check your balance.</strong> Entry fee is ₦500. If you don&apos;t have enough SX Coins for
          a discount, make sure your card is ready for the Paystack payment.
        </p>

        <h2>Registering</h2>
        <ol>
          <li>Go to Tournaments → find an open tournament → click Register</li>
          <li>Choose your coin discount option (if available)</li>
          <li>Complete payment via Paystack (or confirm free entry if using full coin discount)</li>
          <li>You&apos;ll receive a WhatsApp confirmation if you have a number saved in Settings</li>
        </ol>

        <h2>After Registration</h2>
        <p>
          Your fixture appears in Dashboard → My Matches once the bracket is published. This shows you who
          you&apos;re playing, what time, and which round.
        </p>
        <p>
          Set a reminder. SentinelX will send a WhatsApp reminder 1 hour before your match if notifications
          are enabled.
        </p>

        <h2>Playing the Match</h2>
        <p>
          <strong>Prepare your connection.</strong> Unstable internet is your responsibility — connection
          issues during a match are not grounds for a result reversal.
        </p>
        <p>
          <strong>Start recording before the match begins.</strong> Go to your phone&apos;s screen recorder
          and start it before you enter the game lobby. This recording is your evidence if the result is ever
          disputed.
        </p>
        <p>
          <strong>Join at the scheduled time.</strong> If you can&apos;t find your opponent 10 minutes after
          the scheduled start, screenshot the empty lobby and report it as a no-show.
        </p>
        <p>
          <strong>Play the game.</strong> No exploits, no rage quits, no abuse.
        </p>

        <h2>Submitting the Result</h2>
        <p>The winner submits the result — not the loser.</p>
        <ol>
          <li>Go to Dashboard → My Matches → the match → Submit Result</li>
          <li>Upload your screenshot (final scoreline clearly visible)</li>
          <li>Upload your screen recording</li>
          <li>Click Submit</li>
        </ol>
        <p>
          You have 2 hours from the end of the match to submit. After that, a no-submission may be treated as
          a no-show.
        </p>

        <h2>After Submission</h2>
        <p>
          Admin reviews your submission. If the result looks clean, it&apos;s confirmed within 24 hours and
          the bracket updates. The loser has 1 hour after submission to raise a dispute if they believe the
          result is wrong.
        </p>
        <p>If you win a prize, it appears in your wallet after the final result is confirmed.</p>

        <h2>Tips from Experience</h2>
        <ul>
          <li>Save all your recordings until after the official confirmation — you may need them for a dispute</li>
          <li>If you lose, don&apos;t quit the app mid-match — abandoning counts against your SX Score</li>
          <li>Good sportsmanship in the community is noticed. Your reputation matters beyond just your score</li>
        </ul>
      </div>
    </StaticPageShell>
  )
}
