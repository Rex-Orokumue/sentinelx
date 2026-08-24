import { buildMetadata } from '@/lib/seo/metadata'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'

export const metadata = buildMetadata({
  title: 'Safe Trading with Zolarux Escrow',
  description: 'How Zolarux Escrow protects buyers and sellers on the SentinelX Gaming Exchange.',
  path: '/escrow',
})

export default function EscrowPage() {
  return (
    <StaticPageShell eyebrow="Gaming Exchange" title="Safe Trading with Zolarux Escrow">
      <div className={proseClassName}>
        <h2>What Is the Gaming Exchange?</h2>
        <p>
          The Gaming Exchange is SentinelX&apos;s marketplace for gaming accounts, in-game items, and
          digital gaming assets. It&apos;s built for Nigerian mobile gamers who want to buy and sell safely
          — without the risk of being scammed.
        </p>
        <p>
          Every transaction on the Exchange is protected by Zolarux Escrow.{' '}
          <a href="/exchange">Browse the Exchange →</a>
        </p>

        <h2>What Is Zolarux Escrow?</h2>
        <p>
          Zolarux is an independent escrow service. Escrow means a trusted third party holds a payment until
          both sides of a transaction are satisfied. Neither the buyer&apos;s money nor the seller&apos;s
          item is transferred until the deal is confirmed as complete.
        </p>
        <p>This protects both parties.</p>

        <h2>How It Works</h2>
        <p>
          <strong>Buyer&apos;s perspective:</strong>
        </p>
        <ol>
          <li>You find an item you want and agree on a price</li>
          <li>You send payment to Zolarux (not directly to the seller)</li>
          <li>The seller delivers the item or account</li>
          <li>You confirm you&apos;ve received it and it&apos;s as described</li>
          <li>Zolarux releases the payment to the seller</li>
        </ol>
        <p>If the item is not delivered or is misrepresented, you can raise a dispute and your money is returned.</p>
        <p>
          <strong>Seller&apos;s perspective:</strong>
        </p>
        <ol>
          <li>You list your item on the Exchange</li>
          <li>A buyer purchases it — their payment goes to Zolarux, not to you yet</li>
          <li>You deliver the item or transfer the account</li>
          <li>The buyer confirms receipt</li>
          <li>Zolarux releases your payment</li>
        </ol>
        <p>You only deliver once the buyer&apos;s payment is confirmed as held in escrow.</p>

        <h2>Why Not Trade Directly?</h2>
        <p>
          Trading outside of escrow — whether via WhatsApp, direct transfer, or any other method — is not
          protected. SentinelX cannot help you recover money or items lost in trades that took place outside
          the platform&apos;s escrow system.
        </p>
        <p>If a buyer or seller asks you to complete a trade outside the escrow system, decline and report them.</p>

        <h2>Have Questions?</h2>
        <p>
          Contact us at <a href="mailto:sentinelxesports@gmail.com">sentinelxesports@gmail.com</a>.
        </p>
      </div>
    </StaticPageShell>
  )
}
