// Exported so the Guide System's visitor tour (components/guide/GuidePanel.tsx)
// can render a condensed version without re-authoring the copy.
export const STEPS = [
  {
    num: '01',
    icon: '👤',
    title: 'Create Your Account',
    body: "Sign up free. Choose your username — it's your identity on the platform and your referral code.",
  },
  {
    num: '02',
    icon: '🎮',
    title: 'Enter a Tournament',
    body: 'Pay the ₦500 entry fee via Paystack. Registration closes, brackets auto-generate, fixtures are posted.',
  },
  {
    num: '03',
    icon: '⚔️',
    title: 'Play Your Match',
    body: 'Meet your opponent at the scheduled time. Play fair. Screen record your game as proof of the result.',
  },
  {
    num: '04',
    icon: '📸',
    title: 'Submit Your Proof',
    body: 'Upload your screenshot and screen recording via your Player Dashboard within the submission window.',
  },
  {
    num: '05',
    icon: '✅',
    title: 'Admin Verifies',
    body: 'Our admin reviews submissions and confirms the result. The bracket updates — no guesswork, no disputes left unresolved.',
  },
  {
    num: '06',
    icon: '💰',
    title: 'Withdraw Your Prize',
    body: 'Win and your prize lands in your wallet. Withdraw directly to your bank account via Paystack Transfer.',
  },
] as const

// id="how-it-works" is the real anchor target now (moved off the old
// FeatureGrid, which never had matching content to scroll to).
export function HowItWorks() {
  return (
    <section id="how-it-works" className="mb-10 scroll-mt-20">
      <p className="mb-1 text-xs font-bold uppercase tracking-widest text-sx-purple-text">How It Works</p>
      <h2 className="mb-2 font-display text-3xl font-black uppercase leading-none text-white">
        From Sign-Up to Pay-Out
      </h2>
      <p className="mb-6 max-w-lg text-sm leading-relaxed text-sx-gray">
        SentinelX is built around a simple, fair loop: create your account, enter a tournament, play, submit
        proof, get paid.
      </p>
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.num} className="flex flex-col gap-2 rounded-xl border border-sx-border bg-sx-surface p-5">
            <span className="font-display text-4xl font-black leading-none text-sx-purple/50">{s.num}</span>
            <span className="text-2xl">{s.icon}</span>
            <p className="font-display text-lg font-bold uppercase tracking-wide text-white">{s.title}</p>
            <p className="text-sm leading-relaxed text-sx-gray">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
