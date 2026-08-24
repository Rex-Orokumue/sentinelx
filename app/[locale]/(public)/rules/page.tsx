import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  return buildMetadata({
    title: 'Tournament Rules',
    description:
      'Eligibility, match, result-submission, dispute, and conduct rules that apply to every SentinelX tournament.',
    path: '/rules',
    locale,
  })
}

export default function RulesPage() {
  return (
    <StaticPageShell eyebrow="Support" title="Tournament Rules">
      <div className={proseClassName}>
        <h2>Eligibility</h2>
        <ul>
          <li>You must have a registered and verified SentinelX account</li>
          <li>You must pay the entry fee (₦500 or reduced with SX Coins) before the registration deadline</li>
          <li>Players serving an active suspension are not eligible to enter</li>
        </ul>

        <h2>Before the Tournament</h2>
        <ul>
          <li>Registration closes before the bracket is generated — you cannot register after the deadline</li>
          <li>Check your fixture (your scheduled match) on your Player Dashboard after the bracket is published</li>
          <li>Be online and ready 15 minutes before your scheduled match time</li>
        </ul>

        <h2>Playing Your Match</h2>
        <ul>
          <li>
            Matches are played on the agreed game and platform (DLS, EA FC Mobile, eFootball, etc.) as
            specified in the tournament details
          </li>
          <li>Both players must join the match lobby at the scheduled time</li>
          <li>
            If you cannot find your opponent after waiting 10 minutes from the scheduled start time, take a
            screenshot of the empty lobby and submit it as a no-show report
          </li>
        </ul>

        <h2>Submitting Results</h2>
        <ul>
          <li>The winner is responsible for submitting the result</li>
          <li>Submit a screenshot of the final scoreline AND a screen recording of the match</li>
          <li>Results must be submitted within 2 hours of the match ending</li>
          <li>Admin reviews and confirms the result — the bracket updates only after confirmation</li>
        </ul>

        <h2>No-Shows</h2>
        <ul>
          <li>Failing to appear for your scheduled match is a no-show</li>
          <li>No-show: your opponent advances automatically, and you lose 100 SX Score points</li>
          <li>Repeated no-shows may result in suspension from future tournaments</li>
        </ul>

        <h2>Disputes</h2>
        <ul>
          <li>If the submitted result is incorrect, the losing player may raise a dispute within 1 hour of submission</li>
          <li>Admin will review both players&apos; screen recordings and make a final decision</li>
          <li>Admin decisions on disputes are final</li>
          <li>
            Raising a false dispute (deliberately contesting a correct result) results in an SX Score penalty
          </li>
        </ul>

        <h2>Conduct</h2>
        <ul>
          <li>
            Treat your opponent with respect — harassment, hate speech, or threats will result in immediate
            disqualification and suspension
          </li>
          <li>Match fixing or collusion is a permanent ban offence</li>
          <li>Using game exploits or external tools is a permanent ban offence</li>
        </ul>

        <h2>Prizes</h2>
        <ul>
          <li>Prizes are credited to the winner&apos;s wallet after admin confirms the final result</li>
          <li>Players must complete KYC verification before withdrawing prize money</li>
          <li>Withdrawal requests are processed within 1–5 business days</li>
        </ul>
      </div>
    </StaticPageShell>
  )
}
