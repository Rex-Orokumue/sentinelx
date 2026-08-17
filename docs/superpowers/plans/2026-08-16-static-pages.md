# Static Pages (Legal, Info, Support) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build 12 static, public, no-auth Server Component pages (legal/info/support) and repoint the 13 existing `/coming-soon` links across the footer, wallet sidebar, community page, and tournaments page at them.

**Architecture:** Three shared presentational pieces in `components/static/` (a page shell with header + prose typography class, and an FAQ accordion built on native `<details>/<summary>` — matching the pattern already used in `app/(public)/tournaments/page.tsx`'s `TournamentFaqCard`, zero new client-side JS). Each route is a standalone Server Component under `app/(public)/<route>/page.tsx` using `buildMetadata()` (existing site convention, see `lib/seo/metadata.ts` and `app/(public)/about/page.tsx`) for metadata — not raw `generateMetadata()`. Content is transcribed verbatim from the spec; no page does a DB query or requires auth.

**Tech Stack:** Next.js 14 Server Components, Tailwind + `@tailwindcss/typography` (new dependency — not currently installed), existing `sx-*` design tokens.

**Spec:** `docs/superpowers/specs/2026-08-16-static-pages-content.md` (full page copy, §1–§12) — this plan argues from that spec; read both together. Every "transcribe verbatim from §N" instruction below points at that file.

## Global Constraints

- No DB queries, no auth, no `"use client"` on any of the 12 page files — plain Server Components (CLAUDE.md rule 8).
- Content is verbatim from the spec — do not invent or paraphrase beyond what's written there.
- WhatsApp links use the number exactly as `2349032395685` (no `+`, no spaces, no dashes) — e.g. `https://wa.me/2349032395685`.
- The `/privacy` §2 data table renders as a real `<table>` (not a list), `border-collapse`, bordered with `sx-border`.
- **Deviation from the spec, confirmed with the user:** §11 (`/escrow`) drops the "coming soon" framing and status banner. The Gaming Exchange is live (`app/(public)/exchange/*`, real Zolarux escrow purchase flow — `lib/exchange/escrow.ts`, `lib/exchange/purchase.ts`, `app/api/zolarux/webhook/route.ts`). `/escrow` is rewritten to present tense, describing how escrow works today. Task 13 gives the exact replacement copy.
- **Second deviation, also confirmed with the user:** §7's `/how-it-works` "Coming Soon" list (Sentinel X TV, Gaming Exchange, multi-game support) is entirely stale — all three shipped (ROADMAP #11, #13a/13b, #21a). Task 8 repoints that section at the one real remaining gap, team/school/state leagues (ROADMAP #21b), instead of listing already-shipped features as upcoming.
- `components/community/QuickActionTiles.tsx` "Create Team" tile stays exactly as `/coming-soon?feature=Teams` — do not touch it (that IS the real #21b gap — team/school/state leagues aren't built yet, so this one link is correct as-is).
- Every page title format: `"[Page Name] — SentinelX Esports"`. `buildMetadata()` already appends `— SentinelX` via the root layout's title template (`app/layout.tsx:45`, `template: '%s — SentinelX'`), so pass just `"[Page Name]"` as `title` — do not double up the suffix.

---

## File Structure

New files:
- `components/static/StaticPageShell.tsx` — shared outer container (`max-w-3xl mx-auto px-4 py-12`) + header (eyebrow/title/subtitle) + exported `proseClassName` string for prose pages to apply to a content `<div>`.
- `components/static/FaqAccordion.tsx` — renders grouped Q&A using native `<details>/<summary>`, matching `TournamentFaqCard`'s existing markup/class pattern in `app/(public)/tournaments/page.tsx`.
- `app/(public)/terms/page.tsx`
- `app/(public)/privacy/page.tsx`
- `app/(public)/refund-policy/page.tsx`
- `app/(public)/safety/page.tsx`
- `app/(public)/rules/page.tsx`
- `app/(public)/community-rules/page.tsx`
- `app/(public)/how-it-works/page.tsx`
- `app/(public)/help/page.tsx`
- `app/(public)/tournament-guide/page.tsx`
- `app/(public)/tournament-faqs/page.tsx`
- `app/(public)/escrow/page.tsx`
- `app/(public)/contact/page.tsx`

Modified files:
- `tailwind.config.ts` — add `@tailwindcss/typography` plugin.
- `package.json` — add `@tailwindcss/typography` devDependency.
- `components/shared/SiteFooter.tsx` — 8 links (`LEGAL_LINKS` + `EXPANDED_SECTIONS` Support/Company sections) repointed from `/coming-soon?feature=...` to real routes.
- `components/wallet/WalletSidebarInfoCards.tsx` — "Learn More" → `/escrow`, "Contact Support" → `/contact`.
- `components/community/QuickActionTiles.tsx` — "Get Help" tile only → `/contact`.
- `components/community/CommunityHero.tsx` — "Community Rules" button → `/community-rules`.
- `app/(public)/tournaments/page.tsx` — `HowToJoinCard`'s "View Full Guide" → `/tournament-guide`; `TournamentFaqCard`'s "View All FAQs" → `/tournament-faqs`.

**No test files.** This codebase has zero test coverage for static/informational Server Component pages (`/about`, `/hall-of-fame`, etc. — confirmed via glob, none exist) because there's no branching logic to test, only markup. These 12 pages follow that precedent. Verification is a production build (`npm run build`) plus a manual route/link check in Task 15.

---

### Task 1: Typography plugin + shared shell + FAQ accordion

**Files:**
- Modify: `package.json` (add devDependency)
- Modify: `tailwind.config.ts:106` (`plugins: []` → typography plugin)
- Create: `components/static/StaticPageShell.tsx`
- Create: `components/static/FaqAccordion.tsx`

**Interfaces:**
- Produces: `StaticPageShell({ eyebrow?, title, subtitle?, children }): JSX.Element` and `proseClassName: string`, both from `components/static/StaticPageShell.tsx`.
- Produces: `FaqAccordion({ groups: FaqGroup[] }): JSX.Element`, `FaqGroup = { heading: string; items: { q: string; a: string }[] }`, from `components/static/FaqAccordion.tsx`.

- [ ] **Step 1: Install the typography plugin**

Run: `npm install -D @tailwindcss/typography`

- [ ] **Step 2: Register the plugin**

In `tailwind.config.ts`, change:
```ts
  plugins: [],
```
to:
```ts
  plugins: [require('@tailwindcss/typography')],
```

- [ ] **Step 3: Create the shared page shell**

```tsx
// components/static/StaticPageShell.tsx
import type { ReactNode } from 'react'

// Prose typography for the six pure-legal/rules pages plus /escrow and
// /tournament-guide (both prose-shaped in the spec). `prose-invert` matches
// the site's always-dark theme (app/layout.tsx renders <html class="dark">
// with no light variant). Colors mapped onto the sx-* design tokens instead
// of the plugin's defaults so it doesn't clash with the rest of the site.
export const proseClassName =
  'prose prose-invert prose-sm sm:prose-base max-w-none ' +
  'prose-headings:font-display prose-headings:font-bold prose-headings:text-white ' +
  'prose-h2:mt-10 prose-h2:text-xl prose-h3:mt-6 prose-h3:text-base ' +
  'prose-p:text-sx-gray prose-li:text-sx-gray prose-strong:text-white ' +
  'prose-a:text-sx-purple-text prose-a:no-underline hover:prose-a:underline'

export function StaticPageShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <header className="mb-8 border-b border-sx-border pb-6">
        {eyebrow && (
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-sx-purple-text">{eyebrow}</p>
        )}
        <h1 className="font-display text-3xl font-black uppercase leading-tight text-white sm:text-4xl">
          {title}
        </h1>
        {subtitle && <p className="mt-2 text-sm text-sx-gray">{subtitle}</p>}
      </header>
      {children}
    </div>
  )
}
```

- [ ] **Step 4: Create the FAQ accordion**

```tsx
// components/static/FaqAccordion.tsx
// Native <details>/<summary> — no client JS, matches the existing accordion
// pattern in app/(public)/tournaments/page.tsx's TournamentFaqCard.
export type FaqGroup = {
  heading: string
  items: { q: string; a: string }[]
}

export function FaqAccordion({ groups }: { groups: FaqGroup[] }) {
  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <div key={group.heading}>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-sx-purple-text">
            {group.heading}
          </h2>
          <div className="space-y-2">
            {group.items.map((item) => (
              <details key={item.q} className="group rounded-lg border border-sx-border bg-sx-surface p-4">
                <summary className="cursor-pointer text-sm font-semibold text-white marker:content-none">
                  {item.q}
                </summary>
                <p className="mt-2 text-sm text-sx-gray">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tailwind.config.ts components/static/
git commit -m "feat(static-pages): add typography plugin, page shell, FAQ accordion"
```

---

### Task 2: `/terms`

**Files:**
- Create: `app/(public)/terms/page.tsx`

**Interfaces:**
- Consumes: `StaticPageShell`, `proseClassName` from Task 1.

- [ ] **Step 1: Write the page**

```tsx
// app/(public)/terms/page.tsx
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
        {/* Transcribe verbatim from docs/superpowers/specs/2026-08-16-static-pages-content.md §1,
            sections "1. Who We Are" through "14. Contact", as <h2>/<p>/<ul> in order. */}
      </div>
    </StaticPageShell>
  )
}
```

- [ ] **Step 2: Fill in the body**

Replace the comment with the full §1 content as JSX: one `<h2>` per numbered heading ("1. Who We Are" … "14. Contact"), `<p>` per paragraph, `<ul><li>` for the bulleted list in "5. Match Rules and Fair Play". Text must match §1 exactly — no paraphrasing, no omissions. Use `<a href="mailto:sentinelxesports@gmail.com">` for the email mention in "14. Contact" and `<a href="https://wa.me/2349032395685">` for the WhatsApp mention.

- [ ] **Step 3: Verify it renders**

Run: `npm run dev`, load `http://localhost:3000/terms`. Confirm all 14 sections render in order, headings styled white/bold, body text `sx-gray`, no console errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(public)/terms/page.tsx"
git commit -m "feat(static-pages): add /terms"
```

---

### Task 3: `/privacy`

**Files:**
- Create: `app/(public)/privacy/page.tsx`

**Interfaces:**
- Consumes: `StaticPageShell`, `proseClassName` from Task 1.

- [ ] **Step 1: Write the page with the real HTML table for §2's "Why We Use Your Data"**

```tsx
// app/(public)/privacy/page.tsx
import { buildMetadata } from '@/lib/seo/metadata'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'

export const metadata = buildMetadata({
  title: 'Privacy Policy',
  description: "How SentinelX Esports collects, uses, and protects your personal data under Nigeria's Data Protection Act 2023.",
  path: '/privacy',
})

const DATA_USES: { purpose: string; basis: string }[] = [
  { purpose: 'Running your account and the platform', basis: 'Contract performance' },
  { purpose: 'Processing tournament entry payments', basis: 'Contract performance' },
  { purpose: 'Paying out prizes', basis: 'Contract performance' },
  { purpose: 'Sending match notifications (WhatsApp)', basis: 'Consent — you opt in by adding your phone number' },
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
        {/* §1 "Who Controls Your Data" — transcribe verbatim */}
        {/* §2 "What Data We Collect" — transcribe verbatim (4 subheadings: When you create
            an account / complete your profile / register for a tournament / play, plus
            "Automatically") — THEN insert the table below in place of §3's markdown table */}
      </div>

      <h2 className="mt-10 font-display text-xl font-bold text-white">3. Why We Use Your Data</h2>
      <div className="not-prose my-4 overflow-x-auto rounded-lg border border-sx-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-sx-border bg-sx-surface">
              <th className="border-r border-sx-border px-4 py-2.5 text-left font-bold text-white">Purpose</th>
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
        {/* §4 through §10 — transcribe verbatim, headings "4. Who We Share Your Data With"
            through "10. Changes to This Policy". §6's rights list as <ul><li>, each bolded
            right name followed by its description, matching the spec's "**Right** — text"
            formatting. */}
      </div>
    </StaticPageShell>
  )
}
```

- [ ] **Step 2: Fill in both prose blocks**

Transcribe §1–§2 into the first `className={proseClassName}` block and §4–§10 into the second, per the inline comments above. Do not touch the table markup — it already implements §3 in full from the `DATA_USES` array.

- [ ] **Step 3: Verify the table renders correctly**

Run: `npm run dev`, load `http://localhost:3000/privacy`. Confirm an actual bordered `<table>` appears (inspect via devtools — not a styled `<ul>`), all 7 rows present, mobile viewport (375px) scrolls the table horizontally without breaking page layout.

- [ ] **Step 4: Commit**

```bash
git add "app/(public)/privacy/page.tsx"
git commit -m "feat(static-pages): add /privacy with real data-use table"
```

---

### Task 4: `/refund-policy`

**Files:**
- Create: `app/(public)/refund-policy/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// app/(public)/refund-policy/page.tsx
import { buildMetadata } from '@/lib/seo/metadata'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'

export const metadata = buildMetadata({
  title: 'Refund Policy',
  description: 'When tournament entry fees, coin discounts, and prize money are and are not refundable.',
  path: '/refund-policy',
})

export default function RefundPolicyPage() {
  return (
    <StaticPageShell eyebrow="Legal" title="Refund Policy" subtitle="Last updated: August 2026">
      <div className={proseClassName}>
        {/* Transcribe §3 verbatim: "Tournament Entry Fees (₦500)" (with its two bulleted
            "entitled to a full refund if" / "no refund is issued if" lists), "Entry Fee
            Discounts Using SX Coins", "Prize Money", "SX Coins", "How to Request a Refund". */}
      </div>
    </StaticPageShell>
  )
}
```

- [ ] **Step 2: Fill in the body from §3, verify at `/refund-policy`, commit.**

```bash
git add "app/(public)/refund-policy/page.tsx"
git commit -m "feat(static-pages): add /refund-policy"
```

---

### Task 5: `/safety`

**Files:**
- Create: `app/(public)/safety/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// app/(public)/safety/page.tsx
import { buildMetadata } from '@/lib/seo/metadata'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'

export const metadata = buildMetadata({
  title: 'Stay Safe on SentinelX',
  description: 'How to protect your account, your prize money, and yourself while trading or playing on SentinelX.',
  path: '/safety',
})

export default function SafetyPage() {
  return (
    <StaticPageShell eyebrow="Support" title="Stay Safe on SentinelX">
      <div className={proseClassName}>
        {/* Transcribe §4 verbatim: "Protect Your Account", "We Will Never Ask For This",
            "Protect Your Prize Money", "Safe Trading on the Exchange", "Match Safety",
            "Report a Problem" (render the email as a mailto: link and the WhatsApp number
            as an https://wa.me/2349032395685 link). */}
      </div>
    </StaticPageShell>
  )
}
```

- [ ] **Step 2: Fill in the body from §4, verify at `/safety`, commit.**

```bash
git add "app/(public)/safety/page.tsx"
git commit -m "feat(static-pages): add /safety"
```

---

### Task 6: `/rules`

**Files:**
- Create: `app/(public)/rules/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// app/(public)/rules/page.tsx
import { buildMetadata } from '@/lib/seo/metadata'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'

export const metadata = buildMetadata({
  title: 'Tournament Rules',
  description: 'Eligibility, match, result-submission, dispute, and conduct rules that apply to every SentinelX tournament.',
  path: '/rules',
})

export default function RulesPage() {
  return (
    <StaticPageShell eyebrow="Support" title="Tournament Rules">
      <div className={proseClassName}>
        {/* Transcribe §5 verbatim: "Eligibility", "Before the Tournament", "Playing Your
            Match", "Submitting Results", "No-Shows", "Disputes", "Conduct", "Prizes". */}
      </div>
    </StaticPageShell>
  )
}
```

- [ ] **Step 2: Fill in the body from §5, verify at `/rules`, commit.**

```bash
git add "app/(public)/rules/page.tsx"
git commit -m "feat(static-pages): add /rules"
```

---

### Task 7: `/community-rules`

**Files:**
- Create: `app/(public)/community-rules/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// app/(public)/community-rules/page.tsx
import { buildMetadata } from '@/lib/seo/metadata'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'

export const metadata = buildMetadata({
  title: 'Community Rules',
  description: "The standards that keep SentinelX's community positive, competitive, and safe.",
  path: '/community-rules',
})

export default function CommunityRulesPage() {
  return (
    <StaticPageShell eyebrow="Community" title="Community Rules">
      <div className={proseClassName}>
        {/* Transcribe §6 verbatim: intro paragraph, "The Basic Standard", "What's Not
            Allowed" (6 bolded sub-items: Harassment and hate speech / Spam / False
            information / Privacy violations / Cheating promotion / NSFW content —
            each as <h3> + <p>), "Consequences" (3 bolded lines), "Reporting". */}
      </div>
    </StaticPageShell>
  )
}
```

- [ ] **Step 2: Fill in the body from §6, verify at `/community-rules`, commit.**

```bash
git add "app/(public)/community-rules/page.tsx"
git commit -m "feat(static-pages): add /community-rules"
```

---

### Task 8: `/how-it-works`

**Files:**
- Create: `app/(public)/how-it-works/page.tsx`

**Interfaces:**
- Consumes: `StaticPageShell` from Task 1 (used for the header only — this page's body is custom icon+card sections per the spec's "Sections with icons" style, not prose).

- [ ] **Step 1: Write the page**

```tsx
// app/(public)/how-it-works/page.tsx
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
          Every player starts with an SX Score of 700. Win matches, show up on time, and behave well —
          your score goes up. No-shows and disputes bring it down. Your score determines your trust tier
          on the platform.
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
            <School className="h-4 w-4 shrink-0" /> <span><strong className="text-white">Team &amp; School Leagues</strong> — teams representing a school or state, with team-vs-team standings.</span>
          </p>
        </div>
      </div>
    </StaticPageShell>
  )
}

function InfoSection({ icon: Icon, title, children }: { icon: typeof Star; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-sx-border bg-sx-surface p-5">
      <p className="mb-2 flex items-center gap-2 text-sm font-bold text-white">
        <Icon className="h-4 w-4 text-sx-purple-text" /> {title}
      </p>
      <p className="text-sm text-sx-gray">{children}</p>
    </div>
  )
}
```

**Deviation from spec §7, confirmed with the user (same session as the `/escrow` deviation):** §7's original "Coming Soon" list — Sentinel X TV, Gaming Exchange, multi-game support — is entirely stale; all three shipped (ROADMAP #11, #13a/13b, #21a). The section above is repointed at the one genuine remaining gap, team/school/state leagues (ROADMAP #21b), instead of being deleted outright.

- [ ] **Step 2: Verify at `/how-it-works`, commit.**

```bash
git add "app/(public)/how-it-works/page.tsx"
git commit -m "feat(static-pages): add /how-it-works"
```

---

### Task 9: `/help`

**Files:**
- Create: `app/(public)/help/page.tsx`

**Interfaces:**
- Consumes: `StaticPageShell` from Task 1, `FaqAccordion`/`FaqGroup` from Task 1.

- [ ] **Step 1: Write the page**

```tsx
// app/(public)/help/page.tsx
import { buildMetadata } from '@/lib/seo/metadata'
import { StaticPageShell } from '@/components/static/StaticPageShell'
import { FaqAccordion, type FaqGroup } from '@/components/static/FaqAccordion'

export const metadata = buildMetadata({
  title: 'Help Center',
  description: 'Answers to common questions about accounts, tournaments, prizes, SX Score, and SX Coins.',
  path: '/help',
})

// Transcribe every group/question/answer verbatim from spec §8. 6 groups:
// Getting Started (3), Tournaments (6), Prizes and Payments (4), SX Score (3),
// SX Coins (3), Account and Safety (3).
const GROUPS: FaqGroup[] = [
  {
    heading: 'Getting Started',
    items: [
      // { q: '...', a: '...' } × 3, from §8 "GETTING STARTED"
    ],
  },
  {
    heading: 'Tournaments',
    items: [
      // × 6, from §8 "TOURNAMENTS"
    ],
  },
  {
    heading: 'Prizes and Payments',
    items: [
      // × 4, from §8 "PRIZES AND PAYMENTS"
    ],
  },
  {
    heading: 'SX Score',
    items: [
      // × 3, from §8 "SX SCORE" — the tiers question's answer keeps the
      // 4-line tier list with emoji exactly as written in the spec.
    ],
  },
  {
    heading: 'SX Coins',
    items: [
      // × 3, from §8 "SX COINS"
    ],
  },
  {
    heading: 'Account and Safety',
    items: [
      // × 3, from §8 "ACCOUNT AND SAFETY"
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
```

- [ ] **Step 2: Fill in all 22 Q&A pairs from §8 into `GROUPS`, verify at `/help`** (confirm each `<details>` expands/collapses, all 6 group headings present), **commit.**

```bash
git add "app/(public)/help/page.tsx"
git commit -m "feat(static-pages): add /help"
```

---

### Task 10: `/tournament-guide`

**Files:**
- Create: `app/(public)/tournament-guide/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// app/(public)/tournament-guide/page.tsx
import { buildMetadata } from '@/lib/seo/metadata'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'

export const metadata = buildMetadata({
  title: 'Tournament Guide',
  description: 'Everything you need to know before, during, and after a SentinelX tournament match.',
  path: '/tournament-guide',
})

export default function TournamentGuidePage() {
  return (
    <StaticPageShell eyebrow="Support" title="Tournament Guide" subtitle="Everything you need to know.">
      <div className={proseClassName}>
        {/* Transcribe §9 verbatim, section by section, as <h2> + content:
            "Before You Register" (4 bolded lead-ins as <p><strong>…</strong> …</p>),
            "Registering" (<ol> 1–4), "After Registration", "Playing the Match"
            (3 bolded lead-ins), "Submitting the Result" (intro line + <ol> 1–4 +
            closing line), "After Submission", "Tips from Experience" (<ul> × 3). */}
      </div>
    </StaticPageShell>
  )
}
```

- [ ] **Step 2: Fill in the body from §9, verify at `/tournament-guide`, commit.**

```bash
git add "app/(public)/tournament-guide/page.tsx"
git commit -m "feat(static-pages): add /tournament-guide"
```

---

### Task 11: `/tournament-faqs`

**Files:**
- Create: `app/(public)/tournament-faqs/page.tsx`

**Interfaces:**
- Consumes: `StaticPageShell` from Task 1, `FaqAccordion`/`FaqGroup` from Task 1.

- [ ] **Step 1: Write the page**

```tsx
// app/(public)/tournament-faqs/page.tsx
import { buildMetadata } from '@/lib/seo/metadata'
import { StaticPageShell } from '@/components/static/StaticPageShell'
import { FaqAccordion, type FaqGroup } from '@/components/static/FaqAccordion'

export const metadata = buildMetadata({
  title: 'Tournament FAQs',
  description: 'Answers to the most common questions about entering, playing, and getting paid from SentinelX tournaments.',
  path: '/tournament-faqs',
})

// §10 is a flat list (no sub-headings) — one group, 10 Q&As, transcribed verbatim.
const GROUPS: FaqGroup[] = [
  {
    heading: 'Tournament FAQs',
    items: [
      // { q: '...', a: '...' } × 10, from §10
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
```

- [ ] **Step 2: Fill in all 10 Q&A pairs from §10, verify at `/tournament-faqs`, commit.**

```bash
git add "app/(public)/tournament-faqs/page.tsx"
git commit -m "feat(static-pages): add /tournament-faqs"
```

---

### Task 12: `/escrow` (rewritten to present tense — Exchange is live)

**Files:**
- Create: `app/(public)/escrow/page.tsx`

This is the one page that deviates from spec §11's literal text (see Global Constraints). §11's structure (what/why/how-it-works-for-buyer/how-it-works-for-seller/why-not-trade-directly) stays; only the framing changes from future ("coming soon", "in development") to present tense, and the "Current Status" section + banner are replaced.

- [ ] **Step 1: Write the page**

```tsx
// app/(public)/escrow/page.tsx
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
          digital gaming assets. It&apos;s built for Nigerian mobile gamers who want to buy and sell
          safely — without the risk of being scammed.
        </p>
        <p>
          Every transaction on the Exchange is protected by Zolarux Escrow. <a href="/exchange">Browse the Exchange →</a>
        </p>

        <h2>What Is Zolarux Escrow?</h2>
        <p>
          Zolarux is an independent escrow service. Escrow means a trusted third party holds a payment
          until both sides of a transaction are satisfied. Neither the buyer&apos;s money nor the
          seller&apos;s item is transferred until the deal is confirmed as complete.
        </p>
        <p>This protects both parties.</p>

        <h2>How It Works</h2>
        <p><strong>Buyer&apos;s perspective:</strong></p>
        <ol>
          <li>You find an item you want and agree on a price</li>
          <li>You send payment to Zolarux (not directly to the seller)</li>
          <li>The seller delivers the item or account</li>
          <li>You confirm you&apos;ve received it and it&apos;s as described</li>
          <li>Zolarux releases the payment to the seller</li>
        </ol>
        <p>If the item is not delivered or is misrepresented, you can raise a dispute and your money is returned.</p>
        <p><strong>Seller&apos;s perspective:</strong></p>
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
          Trading outside of escrow — whether via WhatsApp, direct transfer, or any other method — is
          not protected. SentinelX cannot help you recover money or items lost in trades that took place
          outside the platform&apos;s escrow system.
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
```

- [ ] **Step 2: Verify at `/escrow`** — confirm no "coming soon" language anywhere on the page, `/exchange` link works, **commit.**

```bash
git add "app/(public)/escrow/page.tsx"
git commit -m "feat(static-pages): add /escrow (live framing, not coming-soon)"
```

---

### Task 13: `/contact`

**Files:**
- Create: `app/(public)/contact/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// app/(public)/contact/page.tsx
import { Mail } from 'lucide-react'
import { buildMetadata } from '@/lib/seo/metadata'
import { StaticPageShell } from '@/components/static/StaticPageShell'

export const metadata = buildMetadata({
  title: 'Contact Us',
  description: "Reach the SentinelX team by email or WhatsApp — we aim to respond within 24 hours.",
  path: '/contact',
})

const WHATSAPP_HREF =
  'https://wa.me/2349032395685?text=Hi%20SentinelX%2C%20I%20need%20help%20with...'

export default function ContactPage() {
  return (
    <StaticPageShell
      eyebrow="Support"
      title="Contact Us"
      subtitle="Whether you have a question about a tournament, a problem with your account, or something else — we're reachable and we respond."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-sx-border bg-sx-surface p-6">
          <p className="mb-2 flex items-center gap-2 text-sm font-bold text-white">
            <Mail className="h-4 w-4 text-sx-purple-text" /> Email
          </p>
          <a href="mailto:sentinelxesports@gmail.com" className="text-sm font-semibold text-sx-purple-text hover:text-white">
            sentinelxesports@gmail.com
          </a>
          <p className="mt-2 text-xs text-sx-gray">We aim to respond within 24 hours on business days.</p>
        </div>
        <div className="rounded-xl border border-sx-border bg-sx-surface p-6">
          <p className="mb-2 flex items-center gap-2 text-sm font-bold text-white">
            <WhatsAppIcon className="h-4 w-4 text-[#25D366]" /> WhatsApp
          </p>
          <p className="text-sm font-semibold text-white">+234 903 239 5685</p>
          <p className="mt-2 text-xs text-sx-gray">
            Message us directly — fastest for urgent issues like match disputes or account problems.
          </p>
          <a
            href={WHATSAPP_HREF}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-sx-purple px-4 py-2.5 text-xs font-bold text-white hover:bg-sx-purple-light"
          >
            Message us on WhatsApp →
          </a>
        </div>
      </div>

      <div className="prose prose-invert prose-sm sm:prose-base max-w-none mt-10 prose-headings:font-display prose-headings:font-bold prose-headings:text-white prose-h2:mt-8 prose-h2:text-lg prose-p:text-sx-gray prose-li:text-sx-gray prose-strong:text-white">
        <h2>What to Include in Your Message</h2>
        <p>To help us resolve your issue quickly, include:</p>
        <ul>
          <li>Your SentinelX username</li>
          <li>The tournament name (if relevant)</li>
          <li>A clear description of the problem</li>
          <li>Any screenshots that help explain the issue</li>
        </ul>

        <h2>Common Issues</h2>
        <p><strong>Forgot your password?</strong> Use the &ldquo;Forgot Password&rdquo; link on the login page — no need to contact us.</p>
        <p><strong>Payment issue?</strong> Include your Paystack payment reference.</p>
        <p><strong>Match dispute?</strong> Include the match ID and your screen recording.</p>
        <p><strong>Withdrawal not received?</strong> Allow 1–5 business days before contacting us. Include your withdrawal request date and bank name.</p>

        <h2>Report Abuse or Safety Concerns</h2>
        <p>
          If you&apos;re experiencing harassment, threats, or have a safety concern, email{' '}
          <a href="mailto:sentinelxesports@gmail.com">sentinelxesports@gmail.com</a> with &ldquo;URGENT&rdquo;
          in the subject line. We prioritise these reports.
        </p>
      </div>
    </StaticPageShell>
  )
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
      <path d="M12.004 2c-5.514 0-9.997 4.483-9.997 9.997 0 1.762.462 3.482 1.34 5.003L2 22l5.126-1.334a9.973 9.973 0 0 0 4.878 1.243h.004c5.514 0 9.997-4.483 9.997-9.997S17.518 2 12.004 2Zm5.848 15.833a8.28 8.28 0 0 1-5.848 2.423h-.003a8.29 8.29 0 0 1-4.223-1.155l-.303-.18-3.043.792.812-2.968-.198-.305a8.284 8.284 0 0 1-1.269-4.443c0-4.59 3.735-8.325 8.328-8.325 2.225 0 4.316.867 5.888 2.44a8.267 8.267 0 0 1 2.436 5.888c0 4.593-3.734 8.328-8.328 8.328Z" />
    </svg>
  )
}
```

- [ ] **Step 2: Verify at `/contact`** — both cards render side by side ≥ 640px and stacked at 375px, WhatsApp CTA opens the prefilled `wa.me` link in a new tab, mailto link works, **commit.**

```bash
git add "app/(public)/contact/page.tsx"
git commit -m "feat(static-pages): add /contact"
```

---

### Task 14: Repoint the 13 `/coming-soon` links

**Files:**
- Modify: `components/shared/SiteFooter.tsx`
- Modify: `components/wallet/WalletSidebarInfoCards.tsx`
- Modify: `components/community/QuickActionTiles.tsx`
- Modify: `components/community/CommunityHero.tsx`
- Modify: `app/(public)/tournaments/page.tsx`

- [ ] **Step 1: `SiteFooter.tsx` — update `LEGAL_LINKS` (lines 18–23)**

```tsx
const LEGAL_LINKS = [
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/help', label: 'Help Center' },
  { href: '/contact', label: 'Contact Us' },
]
```

- [ ] **Step 2: `SiteFooter.tsx` — update the Support section of `EXPANDED_SECTIONS` (lines 41–48)**

```tsx
  {
    heading: 'Support',
    links: [
      { href: '/help', label: 'Help Center' },
      { href: '/safety', label: 'Safety Tips' },
      { href: '/how-it-works', label: 'How It Works' },
      { href: '/contact', label: 'Contact Us' },
      { href: '/rules', label: 'Rules' },
    ],
  },
```

- [ ] **Step 3: `SiteFooter.tsx` — update the Company section of `EXPANDED_SECTIONS` (lines 50–58)**

```tsx
  {
    heading: 'Company',
    links: [
      { href: '/about', label: 'About Us' },
      { href: '/terms', label: 'Terms of Service' },
      { href: '/privacy', label: 'Privacy Policy' },
      { href: '/refund-policy', label: 'Refund Policy' },
    ],
  },
```

- [ ] **Step 4: `WalletSidebarInfoCards.tsx` — repoint both links (lines 15 and 27)**

```tsx
          href="/escrow"
```
```tsx
          href="/contact"
```

- [ ] **Step 5: `QuickActionTiles.tsx` — repoint only "Get Help" (line 14)**

```tsx
  { label: 'Get Help', icon: '❓', href: '/contact' },
```
Leave `Find Friends`, `Create Team`, `Join Discussions`, `Share Content` untouched — "Create Team" stays `/coming-soon?feature=Teams` per Global Constraints.

- [ ] **Step 6: `CommunityHero.tsx` — repoint "Community Rules" (line 34)**

```tsx
              href="/community-rules"
```

- [ ] **Step 7: `app/(public)/tournaments/page.tsx` — repoint both links (lines 306 and 330)**

```tsx
        href="/tournament-guide"
```
```tsx
        href="/tournament-faqs"
```

- [ ] **Step 8: Grep to confirm no unintended `/coming-soon` references remain in these 5 files**

Run: `grep -n "coming-soon" components/shared/SiteFooter.tsx components/wallet/WalletSidebarInfoCards.tsx components/community/QuickActionTiles.tsx components/community/CommunityHero.tsx "app/(public)/tournaments/page.tsx"`
Expected: only the `Create Team` line in `QuickActionTiles.tsx` (Step 5's exclusion).

- [ ] **Step 9: Commit**

```bash
git add components/shared/SiteFooter.tsx components/wallet/WalletSidebarInfoCards.tsx components/community/QuickActionTiles.tsx components/community/CommunityHero.tsx "app/(public)/tournaments/page.tsx"
git commit -m "feat(static-pages): repoint footer/wallet/community/tournaments links to real routes"
```

---

### Task 15: Final verification

- [ ] **Step 1: Production build**

Run: `npm run build`
Expected: builds clean, all 12 new routes listed in the route output, no type errors.

- [ ] **Step 2: Route smoke check**

Run: `npm run dev`, then visit each of the 12 routes at 375px width: `/terms`, `/privacy`, `/refund-policy`, `/safety`, `/rules`, `/community-rules`, `/how-it-works`, `/help`, `/tournament-guide`, `/tournament-faqs`, `/escrow`, `/contact`. Confirm: header + footer render, no horizontal scroll, no console errors.

- [ ] **Step 3: Confirm all 13 originally-flagged links now resolve to real routes**

Re-run the Task 14 Step 8 grep across the full component tree:
`grep -rn "coming-soon" components/ app/ --include="*.tsx" | grep -v "Teams"`
Expected: empty (only the intentionally-untouched "Create Team" tile references `/coming-soon` anywhere in app/components).

- [ ] **Step 4: Commit if anything was fixed during verification, otherwise done — no commit needed.**
