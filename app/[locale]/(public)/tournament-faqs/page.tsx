import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell } from '@/components/static/StaticPageShell'
import { FaqAccordion, type FaqGroup } from '@/components/static/FaqAccordion'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  return buildMetadata({
    title: 'Tournament FAQs',
    description:
      'Answers to the most common questions about entering, playing, and getting paid from SentinelX tournaments.',
    path: '/tournament-faqs',
    locale,
  })
}

const GROUPS: FaqGroup[] = [
  {
    heading: 'Tournament FAQs',
    items: [
      {
        q: 'Can I enter more than one tournament at a time?',
        a: 'Yes. You can be registered in multiple active tournaments simultaneously.',
      },
      {
        q: 'What games are currently supported?',
        a: 'DLS (Dream League Soccer) is the current primary game. EA FC Mobile, eFootball, PUBG Mobile, Free Fire, Call of Duty Mobile, and Mortal Kombat are coming in a future update.',
      },
      {
        q: 'How are groups and brackets decided?',
        a: 'When registration closes, the system automatically generates groups based on how many players registered. Admin can review and adjust before publishing. The bracket is then single-elimination from the group stage onwards.',
      },
      {
        q: 'What if I need to withdraw from a tournament after registering?',
        a: "Withdrawal after registration closes is not eligible for a refund unless the tournament is cancelled by SentinelX. If you know in advance you can't play, contact us as early as possible.",
      },
      {
        q: 'Can I play from any device?',
        a: 'Yes, as long as the required game is installed and you can maintain a stable connection. All supported games are mobile titles — PC or console play is not applicable.',
      },
      {
        q: 'What counts as a no-show?',
        a: "Failing to appear in the game lobby within 10 minutes of the scheduled match start time. If you're running late, message your opponent via the platform immediately.",
      },
      {
        q: 'Can I play a match early if both players agree?',
        a: 'No. Matches must be played at the scheduled time to maintain bracket integrity. Contact admin if you both need to reschedule — admin may approve it at their discretion.',
      },
      {
        q: 'What if I lose internet during a match?',
        a: 'Connection loss during a match is not grounds for a result reversal or replay. If you disconnect during a match and your opponent can demonstrate completion, the result stands.',
      },
      {
        q: 'How long are tournament prizes held before expiry?',
        a: 'Prize money does not expire — it stays in your wallet until you withdraw it. Ensure your bank account is linked and verified to withdraw.',
      },
      {
        q: "I won but my result wasn't confirmed — what do I do?",
        a: "First, check that you submitted within 2 hours with both a screenshot and a recording. If you did and it's been over 24 hours with no update, contact admin at sentinelxesports@gmail.com.",
      },
    ],
  },
]

export default function TournamentFaqsPage() {
  return (
    <StaticPageShell eyebrow="Support" title="Tournament FAQs">
      <FaqAccordion groups={GROUPS} />
    </StaticPageShell>
  )
}
