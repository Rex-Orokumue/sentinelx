import { buildMetadata } from '@/lib/seo/metadata'
import { StaticPageShell } from '@/components/static/StaticPageShell'
import { FaqAccordion, type FaqGroup } from '@/components/static/FaqAccordion'

export const metadata = buildMetadata({
  title: 'Help Center',
  description: 'Answers to common questions about accounts, tournaments, prizes, SX Score, and SX Coins.',
  path: '/help',
})

const GROUPS: FaqGroup[] = [
  {
    heading: 'Getting Started',
    items: [
      {
        q: 'How do I create an account?',
        a: 'Click "Sign Up" on the homepage. Enter your email address and choose a username. Verify your email using the link we send you, then complete your profile.',
      },
      {
        q: 'Can I change my username?',
        a: 'Yes, but only once. Go to Settings to make the change. After that, your username is locked — contact support if you have a serious reason to change it again.',
      },
      {
        q: 'Is SentinelX free to use?',
        a: 'Creating an account and browsing the platform is free. Entering tournaments costs ₦500 per tournament, or you can use SX Coins you\'ve earned to reduce or eliminate the fee.',
      },
    ],
  },
  {
    heading: 'Tournaments',
    items: [
      {
        q: 'How do I register for a tournament?',
        a: 'Go to the Tournaments page, find an open tournament, and click "Register." You\'ll be taken to the payment screen. Complete your ₦500 payment via Paystack to confirm your spot.',
      },
      {
        q: 'What happens if I miss my match?',
        a: 'A no-show means your opponent advances automatically and you lose 100 SX Score points. Always check your fixture on your Player Dashboard and set a reminder.',
      },
      {
        q: 'How do I submit a match result?',
        a: 'Go to Dashboard → My Matches → Submit Result. Upload a screenshot of the final scoreline and a screen recording of the match. Both are required.',
      },
      {
        q: 'What if my opponent submits a wrong result?',
        a: 'You can dispute the result within 1 hour of submission. Go to the match page and click "Dispute." Admin will review both players\' recordings and make a final decision.',
      },
      {
        q: 'How long does it take for results to be confirmed?',
        a: 'Admin aims to confirm results within 24 hours of submission. Complex disputes may take longer.',
      },
      {
        q: 'What if a tournament is cancelled?',
        a: "You'll receive a full refund to your original payment method within 3–7 business days.",
      },
    ],
  },
  {
    heading: 'Prizes and Payments',
    items: [
      {
        q: 'How do I withdraw my prize money?',
        a: "Go to Dashboard → Wallet → Withdraw. Link your Nigerian bank account (first time only), enter the amount, and submit a withdrawal request. We'll process it within 1–5 business days.",
      },
      {
        q: 'Is there a minimum withdrawal amount?',
        a: 'Yes — ₦1,000 minimum.',
      },
      {
        q: 'Why do I need to verify my identity before withdrawing?',
        a: 'We verify your bank account via Paystack to ensure prize money goes to the right person and to comply with Nigerian financial regulations.',
      },
      {
        q: 'When will I receive my withdrawal?',
        a: "Typically 1–5 business days after your request is approved. Delays can occur due to your bank's processing times, which are outside our control.",
      },
    ],
  },
  {
    heading: 'SX Score',
    items: [
      {
        q: 'What is SX Score?',
        a: 'SX Score is your reliability and fair-play rating on the platform. Every player starts at 700. It goes up when you win and behave well, and down when you no-show, cheat, or lose disputes.',
      },
      {
        q: 'What are the SX Score tiers?',
        a: '900 and above: Elite (🟢). 750–899: Trusted (🔵). 600–749: Developing (🟡). Below 600: At Risk (🔴).',
      },
      {
        q: 'Can my SX Score recover?',
        a: "Yes. There's no floor cap — you can always earn your way back up by competing fairly.",
      },
    ],
  },
  {
    heading: 'SX Coins',
    items: [
      {
        q: 'What are SX Coins?',
        a: 'SX Coins are an in-platform virtual currency. You earn them by competing, completing challenges, and unlocking achievements.',
      },
      {
        q: 'Can I convert SX Coins to naira?',
        a: 'No. SX Coins are virtual and cannot be exchanged for cash. They can only be spent within the platform.',
      },
      {
        q: 'What can I spend SX Coins on?',
        a: 'Tournament entry fee discounts (500 coins = ₦250 off, 1,000 coins = free entry), post boosts in the community, and items in the in-platform store.',
      },
    ],
  },
  {
    heading: 'Account and Safety',
    items: [
      {
        q: 'I forgot my password. What do I do?',
        a: 'Click "Forgot Password" on the login page. We\'ll send a reset link to your registered email address.',
      },
      {
        q: 'How do I report a player?',
        a: 'Email sentinelxesports@gmail.com with the player\'s username and details of the incident. For community posts, use the report button on the post.',
      },
      {
        q: 'I think my account has been hacked. What do I do?',
        a: 'Change your password immediately using the "Forgot Password" link on the login page, then email us at sentinelxesports@gmail.com. We\'ll lock the account and help you recover it.',
      },
    ],
  },
]

export default function HelpPage() {
  return (
    <StaticPageShell eyebrow="Support" title="Help Center">
      <FaqAccordion groups={GROUPS} />
    </StaticPageShell>
  )
}
