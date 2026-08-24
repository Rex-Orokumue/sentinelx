import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  return buildMetadata({
    title: 'Refund Policy',
    description: 'When tournament entry fees, coin discounts, and prize money are and are not refundable.',
    path: '/refund-policy',
    locale,
  })
}

export default function RefundPolicyPage() {
  return (
    <StaticPageShell eyebrow="Legal" title="Refund Policy" subtitle="Last updated: August 2026">
      <div className={proseClassName}>
        <h2>Tournament Entry Fees (₦500)</h2>
        <p>
          Entry fees are generally non-refundable once your registration is confirmed and the tournament has
          started.
        </p>
        <p>
          <strong>You are entitled to a full refund if:</strong>
        </p>
        <ul>
          <li>The tournament is cancelled by SentinelX before it begins</li>
          <li>Your registration is rejected by admin before the bracket is published</li>
          <li>A technical error on our platform prevents you from participating</li>
        </ul>
        <p>
          <strong>No refund is issued if:</strong>
        </p>
        <ul>
          <li>You no-show for your scheduled match</li>
          <li>You are disqualified for a rule violation after the tournament begins</li>
          <li>You change your mind after the bracket is published</li>
        </ul>
        <p>
          Refunds are processed via the original payment method and typically take 3–7 business days to
          appear.
        </p>

        <h2>Entry Fee Discounts Using SX Coins</h2>
        <p>If you used SX Coins to reduce or waive your entry fee:</p>
        <ul>
          <li>The coin portion is refunded as coins (not naira) in the event of a qualifying cancellation</li>
          <li>Coins are credited back to your balance immediately upon refund</li>
        </ul>

        <h2>Prize Money</h2>
        <p>
          Prize money is credited to your linked bank account after admin approval. Once approved, payouts
          cannot be reversed. If you believe a prize was incorrectly calculated, contact us within 7 days of
          the result being confirmed.
        </p>

        <h2>SX Coins</h2>
        <p>
          SX Coins are a virtual currency earned through platform activity. They have no cash value and are
          non-refundable. If your account is closed for a serious rule violation, coins are forfeited.
        </p>

        <h2>How to Request a Refund</h2>
        <p>
          Email <a href="mailto:sentinelxesports@gmail.com">sentinelxesports@gmail.com</a> with your username,
          the tournament name, and the reason for your request. We will respond within 3 business days.
        </p>
      </div>
    </StaticPageShell>
  )
}
