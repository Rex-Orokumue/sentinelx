import { buildMetadata } from '@/lib/seo/metadata'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'

export const metadata = buildMetadata({
  title: 'Terms of Service',
  description: 'The terms that govern using the SentinelX Esports platform.',
  path: '/terms',
})

export default function TermsPage() {
  return (
    <StaticPageShell eyebrow="Legal" title="Terms of Service" subtitle="Last updated: August 2026">
      <div className={proseClassName}>
        <h2>1. Who We Are</h2>
        <p>
          SentinelX Esports is a mobile esports platform operated by Samuel Chinoyerem Akpoke (&ldquo;we&rdquo;,
          &ldquo;us&rdquo;, &ldquo;our&rdquo;). We are based in Nigeria and our platform is available at
          sentinelxesports.com.
        </p>
        <p>
          By creating an account or using any part of SentinelX, you agree to these Terms of Service. If you
          do not agree, please do not use the platform.
        </p>

        <h2>2. Eligibility</h2>
        <p>
          You must be at least 13 years old to create an account. If you are under 18, you confirm that you
          have permission from a parent or guardian to use the platform. Players under 18 may not withdraw
          prize money without verifiable parental or guardian consent.
        </p>
        <p>
          You may only hold one account. Creating multiple accounts to gain an unfair advantage is prohibited
          and will result in a permanent ban.
        </p>

        <h2>3. Your Account</h2>
        <p>
          You are responsible for keeping your login details secure. Do not share your password with anyone.
          You are responsible for all activity that takes place under your account.
        </p>
        <p>
          If you believe your account has been compromised, contact us immediately at{' '}
          <a href="mailto:sentinelxesports@gmail.com">sentinelxesports@gmail.com</a>.
        </p>

        <h2>4. Tournaments and Entry Fees</h2>
        <p>
          Tournament entry fees are set per event and displayed clearly before registration. The current
          standard fee is ₦500. By registering and completing payment, you confirm your intent to
          participate.
        </p>
        <p>Entry fees are processed securely by Paystack. We do not store your card details.</p>
        <p>
          SX Coins may be used to reduce or eliminate entry fees where that option is offered. See the
          Refund Policy for how cancellations are handled.
        </p>

        <h2>5. Match Rules and Fair Play</h2>
        <p>All players must compete honestly. The following are prohibited:</p>
        <ul>
          <li>Submitting false or manipulated match results</li>
          <li>Using external tools, scripts, or exploits to gain an advantage</li>
          <li>Colluding with an opponent to produce a predetermined result</li>
          <li>Threatening, harassing, or abusing opponents</li>
        </ul>
        <p>
          Match results must be submitted with supporting evidence (screenshot and screen recording). Admin
          decisions on disputed results are final.
        </p>
        <p>
          A no-show — failing to appear for your scheduled match without notice — results in a forfeit and a
          penalty to your SX Score.
        </p>

        <h2>6. Prizes and Withdrawals</h2>
        <p>
          Prize money is paid to the bank account you link to your player dashboard via Paystack. You must
          complete identity verification before your first withdrawal.
        </p>
        <p>
          We aim to process approved withdrawals within 1–5 business days. We are not responsible for delays
          caused by your bank.
        </p>

        <h2>7. SX Coins</h2>
        <p>
          SX Coins are a virtual in-platform currency. They are earned by competing and spending time on the
          platform. SX Coins have no monetary value and cannot be exchanged for cash. They may be used within
          the platform for entry fee discounts, community features, and the in-platform store.
        </p>

        <h2>8. Gaming Exchange</h2>
        <p>
          The Gaming Exchange (powered by Zolarux escrow) allows players to buy and sell gaming accounts and
          in-game items. SentinelX provides the platform and escrow infrastructure. We are not party to the
          transaction between buyer and seller and are not liable for disputes that arise from transactions
          conducted outside the platform&apos;s escrow system.
        </p>

        <h2>9. Community Standards</h2>
        <p>
          You agree to treat all other members of the SentinelX community with respect. Hate speech,
          discrimination, threats, and harassment are not tolerated and will result in suspension or
          permanent ban. See our Community Rules for the full standards.
        </p>

        <h2>10. Intellectual Property</h2>
        <p>
          All SentinelX branding, design, and original content is owned by SentinelX Esports. You may not
          reproduce, copy, or distribute our content without written permission. Content you post (match
          screenshots, community posts) remains yours, but you grant us a licence to display it on the
          platform.
        </p>

        <h2>11. Limitation of Liability</h2>
        <p>
          SentinelX Esports is not liable for indirect, incidental, or consequential losses arising from your
          use of the platform. Our total liability to you for any claim shall not exceed the total entry fees
          you have paid to us in the 3 months prior to the claim.
        </p>
        <p>
          We do not guarantee uninterrupted access to the platform. We will make reasonable efforts to
          restore service promptly in the event of downtime.
        </p>

        <h2>12. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time. We will notify you via the platform or email when
          significant changes are made. Continuing to use SentinelX after changes are posted means you accept
          the updated terms.
        </p>

        <h2>13. Governing Law</h2>
        <p>
          These Terms are governed by the laws of the Federal Republic of Nigeria. Any disputes shall be
          subject to the jurisdiction of Nigerian courts.
        </p>

        <h2>14. Contact</h2>
        <p>
          Questions about these Terms? Email us at{' '}
          <a href="mailto:sentinelxesports@gmail.com">sentinelxesports@gmail.com</a> or message us on
          WhatsApp: <a href="https://wa.me/2349032395685">+234 903 239 5685</a>.
        </p>
      </div>
    </StaticPageShell>
  )
}
