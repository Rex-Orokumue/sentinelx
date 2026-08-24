import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  return buildMetadata({
    title: 'Stay Safe on SentinelX',
    description:
      'How to protect your account, your prize money, and yourself while trading or playing on SentinelX.',
    path: '/safety',
    locale,
  })
}

export default function SafetyPage() {
  return (
    <StaticPageShell eyebrow="Support" title="Stay Safe on SentinelX">
      <div className={proseClassName}>
        <h2>Protect Your Account</h2>
        <ul>
          <li>Use a strong, unique password for SentinelX — don&apos;t reuse it from another app</li>
          <li>Never share your password with anyone, including people claiming to be SentinelX staff</li>
          <li>Log out of shared devices after playing</li>
          <li>
            If your email gets a reset request you didn&apos;t make, change your password immediately and
            contact us
          </li>
        </ul>

        <h2>We Will Never Ask For This</h2>
        <p>SentinelX staff will never ask for your:</p>
        <ul>
          <li>Password</li>
          <li>Bank account PIN or BVN</li>
          <li>Paystack OTP codes</li>
          <li>Payment to &ldquo;unlock&rdquo; prize money</li>
        </ul>
        <p>If anyone claiming to be SentinelX asks for any of these, it is a scam. Report it to us immediately.</p>

        <h2>Protect Your Prize Money</h2>
        <ul>
          <li>Only link your own bank account for withdrawals</li>
          <li>Verify your account before your first withdrawal — this protects you</li>
          <li>
            Prize withdrawals only go through the platform dashboard. Anyone asking you to send money first to
            &ldquo;unlock&rdquo; winnings is a scammer
          </li>
        </ul>

        <h2>Safe Trading on the Exchange</h2>
        <ul>
          <li>
            Always use the Zolarux Escrow system for all trades. Funds held in escrow are protected until both
            parties confirm the transaction
          </li>
          <li>
            Never agree to complete a trade outside the platform — if a buyer or seller asks to go outside
            escrow, refuse and report them
          </li>
          <li>If a deal looks too good to be true, it probably is</li>
        </ul>

        <h2>Match Safety</h2>
        <ul>
          <li>Record your screen for every match — this is your protection if a result is disputed</li>
          <li>Save your recordings until after the result is officially confirmed on the platform</li>
          <li>
            If your opponent is being abusive or threatening, take screenshots and report via the platform or
            email us
          </li>
        </ul>

        <h2>Report a Problem</h2>
        <p>
          Email: <a href="mailto:sentinelxesports@gmail.com">sentinelxesports@gmail.com</a>
          <br />
          WhatsApp: <a href="https://wa.me/2349032395685">+234 903 239 5685</a>
        </p>
      </div>
    </StaticPageShell>
  )
}
