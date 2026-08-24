import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  return buildMetadata({
    title: 'Privacy Policy',
    description:
      "How SentinelX Esports collects, uses, and protects your personal data under Nigeria's Data Protection Act 2023.",
    path: '/privacy',
    locale,
  })
}

const DATA_USES: { purpose: string; basis: string }[] = [
  { purpose: 'Running your account and the platform', basis: 'Contract performance' },
  { purpose: 'Processing tournament entry payments', basis: 'Contract performance' },
  { purpose: 'Paying out prizes', basis: 'Contract performance' },
  {
    purpose: 'Sending match notifications (WhatsApp)',
    basis: 'Consent — you opt in by adding your phone number',
  },
  { purpose: 'Improving the platform', basis: 'Legitimate interest' },
  { purpose: 'Preventing fraud and cheating', basis: 'Legitimate interest' },
  { purpose: 'Complying with Nigerian law', basis: 'Legal obligation' },
]

export default function PrivacyPage() {
  return (
    <StaticPageShell
      eyebrow="Legal"
      title="Privacy Policy"
      subtitle="Last updated: August 2026 · Compliant with the Nigeria Data Protection Act 2023 (NDPA)"
    >
      <div className={proseClassName}>
        <h2>1. Who Controls Your Data</h2>
        <p>
          SentinelX Esports, operated by Samuel Chinoyerem Akpoke, is the data controller for personal
          information collected through this platform. Contact:{' '}
          <a href="mailto:sentinelxesports@gmail.com">sentinelxesports@gmail.com</a>.
        </p>

        <h2>2. What Data We Collect</h2>
        <p>
          <strong>When you create an account:</strong>
        </p>
        <ul>
          <li>Email address</li>
          <li>Username and display name</li>
          <li>Country</li>
          <li>Password (stored as a secure hash — we never see your plain password)</li>
        </ul>
        <p>
          <strong>When you complete your profile:</strong>
        </p>
        <ul>
          <li>WhatsApp phone number (optional — used only for match notifications if you opt in)</li>
          <li>Profile photo</li>
          <li>Bio</li>
        </ul>
        <p>
          <strong>When you register for a tournament:</strong>
        </p>
        <ul>
          <li>
            Payment information (processed by Paystack — we receive a transaction reference, not your card
            details)
          </li>
          <li>Bank account details (collected by Paystack for prize withdrawals — stored by Paystack, not by us)</li>
        </ul>
        <p>
          <strong>When you play:</strong>
        </p>
        <ul>
          <li>Match history, scores, and results</li>
          <li>SX Score and rankings</li>
          <li>Achievements and SX Coins balance</li>
          <li>Match screenshots and recordings you submit for result verification</li>
        </ul>
        <p>
          <strong>Automatically:</strong>
        </p>
        <ul>
          <li>Log data (IP address, browser type, pages visited) — used for security and to fix bugs</li>
          <li>Session cookies (required for login to work)</li>
        </ul>
      </div>

      <h2 className="mt-10 font-display text-xl font-bold text-white">3. Why We Use Your Data</h2>
      <div className="not-prose my-4 overflow-x-auto rounded-lg border border-sx-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-sx-border bg-sx-surface">
              <th className="border-r border-sx-border px-4 py-2.5 text-left font-bold text-white">
                Purpose
              </th>
              <th className="px-4 py-2.5 text-left font-bold text-white">Legal basis</th>
            </tr>
          </thead>
          <tbody>
            {DATA_USES.map((row) => (
              <tr key={row.purpose} className="border-b border-sx-border last:border-0">
                <td className="border-r border-sx-border px-4 py-2.5 text-sx-gray">{row.purpose}</td>
                <td className="px-4 py-2.5 text-sx-gray">{row.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={proseClassName}>
        <h2>4. Who We Share Your Data With</h2>
        <p>We share data only where necessary:</p>
        <ul>
          <li>
            <strong>Paystack</strong> — payment processing and bank account verification for prize payouts
          </li>
          <li>
            <strong>Supabase</strong> — database and authentication infrastructure (servers may be located
            outside Nigeria; Supabase Inc. operates under appropriate data transfer safeguards)
          </li>
          <li>
            <strong>Vercel</strong> — web hosting
          </li>
          <li>
            <strong>Termii</strong> (when active) — WhatsApp notification delivery, only for players who have
            added a phone number
          </li>
          <li>
            <strong>Firebase / Google</strong> — push notification delivery (FCM)
          </li>
        </ul>
        <p>We do not sell your personal data. We do not share it with advertisers.</p>
        <p>We may disclose data to Nigerian law enforcement or regulatory bodies if legally required to do so.</p>

        <h2>5. Your Public Profile</h2>
        <p>
          Your username, display name, country, profile photo, SX Score, match history, and achievements are
          visible to all visitors of the platform. This is necessary for the competitive, community nature of
          the platform. You can update your display name and photo at any time in Settings.
        </p>

        <h2>6. Your Rights Under the NDPA 2023</h2>
        <p>As a data subject, you have the right to:</p>
        <ul>
          <li>
            <strong>Access</strong> — request a copy of the personal data we hold about you
          </li>
          <li>
            <strong>Rectification</strong> — ask us to correct inaccurate data
          </li>
          <li>
            <strong>Erasure</strong> — ask us to delete your account and personal data
          </li>
          <li>
            <strong>Restriction</strong> — ask us to limit how we process your data
          </li>
          <li>
            <strong>Portability</strong> — receive your data in a structured, machine-readable format
          </li>
          <li>
            <strong>Objection</strong> — object to processing based on legitimate interest
          </li>
          <li>
            <strong>Withdraw consent</strong> — remove your WhatsApp number or turn off notifications at any
            time in Settings
          </li>
        </ul>
        <p>
          To exercise any of these rights, email{' '}
          <a href="mailto:sentinelxesports@gmail.com">sentinelxesports@gmail.com</a>. We will respond within
          30 days.
        </p>
        <p>
          You also have the right to lodge a complaint with the Nigeria Data Protection Commission (NDPC) at{' '}
          <a href="https://ndpc.gov.ng" target="_blank" rel="noopener noreferrer">
            ndpc.gov.ng
          </a>
          .
        </p>

        <h2>7. Data Retention</h2>
        <p>
          We keep your account data for as long as your account is active. If you delete your account, we
          will erase your personal data within 30 days, except where we are required by law to retain it (for
          example, payment records may be retained for up to 7 years for tax and financial compliance).
        </p>
        <p>Match records and results may be retained in anonymised form for platform statistics.</p>

        <h2>8. Security</h2>
        <p>
          We use industry-standard security measures including encrypted connections (HTTPS), hashed
          passwords, and role-based access controls. No system is perfectly secure — if you believe your
          account has been compromised, contact us immediately.
        </p>

        <h2>9. Children</h2>
        <p>
          Players under 18 may use the platform with parental consent. We do not knowingly collect data from
          children under 13. If we become aware that a child under 13 has created an account, we will delete
          it.
        </p>

        <h2>10. Changes to This Policy</h2>
        <p>
          We will notify you via the platform or email if we make significant changes to this policy. The
          latest version is always available at sentinelxesports.com/privacy.
        </p>
      </div>
    </StaticPageShell>
  )
}
