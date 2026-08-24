import { UserPlus, Trophy, CalendarClock, Gamepad2, Upload, Wallet, Star, Coins, Users2, School } from 'lucide-react'
import { buildMetadata } from '@/lib/seo/metadata'
import { StaticPageShell } from '@/components/static/StaticPageShell'

export const metadata = buildMetadata({
  title: 'How SentinelX Works',
  description: 'From creating an account to getting paid — how Nigerian mobile gamers compete on SentinelX.',
  path: '/how-it-works',
})

const STEPS = [
  {
    icon: UserPlus,
    n: 1,
    title: 'Create Your Account',
    body: "Sign up with your email and choose a username. Your username is your esports identity on the platform — pick something you're proud of. Your player profile shows your SX Score, win rate, achievements, and match history. Build it up tournament by tournament.",
  },
  {
    icon: Trophy,
    n: 2,
    title: 'Enter a Tournament',
    body: "Browse the Tournaments page to find open registrations. Each tournament shows the game, entry fee, prize pool, format, and registration deadline. Pay the ₦500 entry fee with your card via Paystack. Or use SX Coins you've earned through competing — 1,000 coins get you a free entry.",
  },
  {
    icon: CalendarClock,
    n: 3,
    title: 'Check Your Fixture',
    body: "Once registration closes, admin generates the bracket. You'll see your fixture (who you're playing and when) on your Player Dashboard. You'll also receive a match reminder on WhatsApp if you've added your number in Settings.",
  },
  {
    icon: Gamepad2,
    n: 4,
    title: 'Play Your Match',
    body: 'Play the match at the scheduled time. Keep it clean — no exploits, no rage quits. After the match: the winner takes a screenshot of the final score and records the match on their phone. Both are required for result submission.',
  },
  {
    icon: Upload,
    n: 5,
    title: 'Submit Your Result',
    body: 'Go to your Player Dashboard → My Matches → Submit Result. Upload your screenshot and screen recording. Admin reviews the submission and confirms the result. The bracket updates only after admin confirms — never before.',
  },
  {
    icon: Wallet,
    n: 6,
    title: 'Win and Get Paid',
    body: 'Win your bracket and the prize money is credited to your wallet. Link your Nigerian bank account and request a withdrawal — money arrives in 1–5 business days.',
  },
]

export default function HowItWorksPage() {
  return (
    <StaticPageShell
      eyebrow="Nigeria's Home of Mobile Esports"
      title="How SentinelX Works"
      subtitle="SentinelX is where Nigerian mobile gamers compete in organised tournaments, build their reputation, and win real prize money — all from their phone. Here's how to get started."
    >
      <div className="space-y-4">
        {STEPS.map((s) => (
          <div key={s.n} className="flex gap-4 rounded-xl border border-sx-border bg-sx-surface p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sx-purple/15 text-sx-purple-text">
              <s.icon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-sx-purple-text">Step {s.n}</p>
              <p className="mt-0.5 font-bold text-white">{s.title}</p>
              <p className="mt-1 text-sm text-sx-gray">{s.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 space-y-4">
        <InfoSection icon={Star} title="SX Score — Your Reputation">
          Every player starts with an SX Score of 700. Win matches, show up on time, and behave well — your
          score goes up. No-shows and disputes bring it down. Your score determines your trust tier on the
          platform.
        </InfoSection>
        <InfoSection icon={Coins} title="SX Coins — The In-Platform Currency">
          You earn SX Coins by competing, completing weekly challenges, and unlocking achievements. Spend
          them on entry fee discounts, boosting your community posts, and the in-platform store. Coins are
          earned — they cannot be bought with cash, and they cannot be converted to naira.
        </InfoSection>
        <InfoSection icon={Users2} title="The Community">
          Post in the community feed, react to match highlights, and take on weekly challenges. The
          community is public — anyone can read it, but you need an account to post.
        </InfoSection>
      </div>

      <div className="mt-10 rounded-xl border border-sx-border/60 bg-sx-surface/40 p-5 opacity-70">
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-sx-gray">Coming Soon</p>
        <div className="space-y-2 text-sm text-sx-gray">
          <p className="flex items-center gap-2">
            <School className="h-4 w-4 shrink-0" />{' '}
            <span>
              <strong className="text-white">Team &amp; School Leagues</strong> — teams representing a school
              or state, with team-vs-team standings.
            </span>
          </p>
        </div>
      </div>
    </StaticPageShell>
  )
}

function InfoSection({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Star
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-sx-border bg-sx-surface p-5">
      <p className="mb-2 flex items-center gap-2 text-sm font-bold text-white">
        <Icon className="h-4 w-4 text-sx-purple-text" /> {title}
      </p>
      <p className="text-sm text-sx-gray">{children}</p>
    </div>
  )
}
