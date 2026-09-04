# Legal & Policy Page System — Design

**Date:** 2026-09-04
**Status:** Approved → ready for implementation plan
**Author:** brainstorm session (Rex-Orokumue + Claude)

---

## 1. Problem

The nine static "static/legal" pages (`/contact`, `/terms`, `/privacy`, `/rules`,
`/safety`, `/community-rules`, `/refund-policy`, `/escrow`, `/tournament-guide`)
render as undifferentiated walls of prose inside `StaticPageShell` +
`proseClassName`. On the two longest — Terms (14 sections) and Privacy (10
sections + a table) — there is no way to jump to a section, no visible "last
updated" treatment, and nothing that signals the platform's game-forward visual
identity. The content is also stale in two places:

1. **Coin wagering is undocumented.** `lib/wagers/*` (live via
   `components/match/WagerWidget.tsx` on the Match Centre page) lets a player
   stake virtual SX Coins on a match they are not playing, with a 5% platform
   fee on the losing pool. Neither Terms nor Privacy mentions it.
2. **"Last updated: August 2026"** on Terms and Privacy predates content changes
   this work introduces.

Real-money betting was **removed** (`supabase/migrations/063_remove_money_betting.sql`);
SX Coins are earn-only, non-purchasable, non-cash-convertible
(`docs/superpowers/specs/2026-08-15-coin-economy-extension.md` §1). Terms §7's
"SX Coins have no monetary value and cannot be exchanged for cash" is correct
and stays.

## 2. Goals

- A reusable shell that gives long legal/policy pages a sticky table of
  contents, anchored sections, "last updated" metadata, an optional
  plain-English summary, and a "questions?" contact CTA.
- Apply it to all eight prose pages; restyle `/contact` (which is card-shaped,
  not a document) to match without the shell.
- Add coin-wagering coverage to Terms and Privacy.
- Keep all body copy in the `next-intl` message catalogue with full `en`/`fr`/
  `pcm` parity (`lib/i18n/message-parity.test.ts`).

## 3. Non-goals

- No contact form (mailto + WhatsApp stay).
- No MDX / CMS migration — copy stays in `messages/*.json`.
- No changes to betting/coin **code** — this is documentation only. The
  coin-economy edit-lock (`lib/coins/*`, `lib/wagers/*`, wager schema,
  registration-discount UI) is respected.
- No React Testing Library / jsdom introduction (project has no component
  tests; environment is `node`). Testable logic is extracted to a pure module.

---

## 4. Architecture

### 4.1 `components/static/LegalDocShell.tsx` (Server Component)

```ts
type LegalSection = { id: string; title: string; body: ReactNode }

type LegalDocShellProps = {
  eyebrow?: string
  title: string
  subtitle?: string
  meta?: string[]            // pill labels, e.g. ['Last updated September 2026', 'NDPA 2023']
  summary?: ReactNode        // "In plain English" callout content
  sections: LegalSection[]
  contactCta?: boolean       // default true — renders <LegalContactCta/>
}
```

Layout:

- Reuses the `StaticPageShell` header treatment (eyebrow / `font-display`
  uppercase `h1` / subtitle) but widened to `max-w-5xl` to fit the ToC rail.
- `meta` renders a row of pills below the subtitle: `rounded-full border
  border-sx-border bg-sx-surface px-3 py-1 text-[11px] uppercase tracking-wide
  text-sx-gray`.
- `summary`, when present, renders above the content grid as a callout:
  `rounded-xl border border-sx-purple/30 bg-sx-surface p-5`, label "In plain
  English" in `text-sx-purple-text`.
- Content grid: `lg:grid lg:grid-cols-[200px_1fr] lg:gap-10`.
  - **ToC rail**: `<TocNav variant="rail" entries={buildToc(sections)}
    label={t('legalCommon.tocLabel')} />`, wrapped `hidden lg:block
    lg:sticky lg:top-24 lg:self-start`.
  - **Body**: each section as
    `<section id={id} className="scroll-mt-24 border-t border-sx-border
    pt-8 first:border-0 first:pt-0">`, an `<h2>` with a small numbered chip
    (`<span>` `text-sx-purple-text font-display`), then
    `<div className={proseClassName}>{body}</div>`.
- **Mobile ToC**: `<TocNav variant="disclosure" …>` directly under the header,
  `lg:hidden` — renders a `<details>` whose `<summary>` reads "Contents".
- `contactCta` renders `<LegalContactCta/>` after the last section.

### 4.2 `components/static/TocNav.tsx` (Client Component, ~50 lines)

`'use client'`. Props: `entries: TocEntry[]`, `label: string` (both plain
serializable data — no `ReactNode` crosses the boundary, so `LegalDocShell`
stays a Server Component). Renders the `<nav>` + ordered list of anchor links
for **both** the desktop rail and the mobile `<details>` (the shell places one
instance in each slot; a `variant: 'rail' | 'disclosure'` prop switches the
wrapper markup). A single `IntersectionObserver` over `document`'s
`section[id]` elements tracks the section nearest the top of the viewport and
applies the active class (`text-white border-l-2 border-sx-purple`) to the
matching `<a>` directly. With JS off, every link is still a working plain
anchor and the observer simply never runs.

### 4.3 `components/static/LegalContactCta.tsx` (Server Component)

Small card: "Questions about this policy?" + `<Link href="/contact">` styled as
the standard purple button. Pulls its two strings from a shared `legalCommon`
message namespace (see §6).

### 4.4 `lib/static/toc.ts` (pure, unit-tested)

```ts
export type TocEntry = { id: string; title: string }
export function buildToc(sections: { id: string; title: string }[]): TocEntry[]
export function slugifySection(raw: string): string   // e.g. "1. Who We Are" -> "who-we-are"
```

`slugifySection` strips a leading `"\d+\.\s*"`, lowercases, replaces
non-alphanumerics with `-`, collapses repeats, trims. Pages pass **explicit**
`id`s (stable, translation-independent — a French heading must not change the
anchor), so `slugifySection` is a helper for authoring the section arrays, not
run at request time on translated strings. `buildToc` is a thin map today;
it exists so the shell has one tested seam if ordering/filtering logic grows.

Test file `lib/static/toc.test.ts` covers `slugifySection` cases (leading
number, punctuation, accented input, collision-adjacent strings) and `buildToc`
identity/order.

---

## 5. Page conversions

Each page keeps its `generateMetadata`, its `getTranslations(namespace)`, and
every existing body message key and `t.rich` tag. The page body changes from:

```tsx
<StaticPageShell ...>
  <div className={proseClassName}>
    <h2>{t('s1Heading')}</h2>
    <p>{t('s1P1')}</p>
    ...
  </div>
</StaticPageShell>
```

to:

```tsx
<LegalDocShell
  eyebrow={t('eyebrow')}
  title={t('title')}
  subtitle={t('subtitle')}
  meta={[t('metaUpdated'), /* page-specific */]}
  summary={t('summary')}
  sections={[
    { id: 'who-we-are', title: t('s1Heading'), body: <><p>{t('s1P1')}</p><p>{t('s1P2')}</p></> },
    ...
  ]}
/>
```

### 5.1 Section id map

| Page | Section ids (stable anchors) |
|------|------------------------------|
| `/terms` | `who-we-are`, `eligibility`, `your-account`, `entry-fees`, `fair-play`, `prizes-withdrawals`, `sx-coins`, `community-wagering` *(new)*, `gaming-exchange`, `community-standards`, `intellectual-property`, `liability`, `changes`, `governing-law`, `contact` |
| `/privacy` | `data-controller`, `what-we-collect`, `why-we-use-it`, `who-we-share-with`, `public-profile`, `your-rights`, `retention`, `security`, `children`, `changes` |
| `/rules` | `eligibility`, `before-your-match`, `during-play`, `submitting-results`, `no-shows`, `disputes`, `conduct`, `prizes` |
| `/safety` | `protect-your-account`, `what-we-never-ask`, `protect-your-prize`, `safe-trading`, `match-safety`, `reporting` |
| `/community-rules` | `overview`, `the-basics`, `not-allowed`, `consequences`, `reporting` |
| `/refund-policy` | `entry-fees`, `tournament-cancelled`, `disqualification`, `payment-failures`, `how-to-request` |
| `/escrow` | `what-is-the-exchange`, `what-is-escrow`, `how-it-works`, `why-not-direct`, `questions` |
| `/tournament-guide` | `before-you-register`, `registering`, `after-registering`, `playing`, `submitting`, `after-submission`, `tips` |

`/community-rules` currently nests six `<h3>` under "Not allowed" — those stay
as `<h3>` inside that one section's `body`; they do not get their own ToC
entries.

### 5.2 `/contact` — restyle, no shell

Stays on `StaticPageShell`. Changes:

- Email / WhatsApp cards: icon bumped to `h-9 w-9` in a
  `rounded-lg bg-sx-purple/15` tile; WhatsApp card gets a green pill
  `t('whatsappResponsePill')` ("Replies within 24h").
- New line above "What to include": `t.rich('beforeYouWrite', …)` linking
  `/help` and mentioning the in-app chatbot.
- "Common issues" moves from `<p><strong>…</strong> …</p>` pairs to a `<dl>`
  inside a single `rounded-xl border border-sx-border bg-sx-surface` card.
- "Report abuse" wrapped in a callout: `border-red-500/30 bg-red-500/5`.

---

## 6. Content changes

### 6.1 Terms — new section `community-wagering` (§8, renumbering §8–14 → §9–15)

New keys in `terms` namespace: `s8Heading`, `s8P1`, `s8Intro`, `s8List`,
`s8P2`. Existing `s8`–`s14` keys shift to `s9`–`s15`. Copy:

> **8. Community Wagering (SX Coins)**
> You may stake SX Coins on the outcome of a match you are not playing in.
> Wagering opens once both players are confirmed for a scheduled match and
> closes 15 minutes before the scheduled start time (or, for full-day
> scheduled matches, 24 hours after the play day begins). A 5% platform fee is
> taken from the losing pool; winnings are paid in SX Coins only. Wagers are
> settled automatically from the admin-confirmed match result and that
> settlement is final. Because SX Coins have no monetary value and cannot be
> exchanged for cash, community wagering is not betting for money.

### 6.2 Terms — `s7P1` (SX Coins) edit

Append: "SX Coins may also be staked in community wagering (see section 8) and
can be lost if your wager does not win."

### 6.3 Terms — cross-links (no new keys; existing strings get `t.rich` link tags)

- `s5P2` / fair-play → link "Community Rules" to `/community-rules`.
- `s9` (was s8, Gaming Exchange) → link "/escrow".
- `s4P3` → link "Refund Policy" to `/refund-policy` (already references it as
  plain text).
- `s5` → link "/rules" where "match rules" is mentioned.

Where a target string has no existing anchor phrase, add one word wrapped in a
`<link>` tag rather than rewording the sentence.

### 6.4 Privacy — `s2PlayList` edit

Add two `<li>`: "Community wagering — the matches you staked on, your picks,
stake amounts, and outcomes" and "SX Coins balance and full transaction
history (earns, spends, wagers)".

### 6.5 Privacy — new legal-basis table row

`DATA_USE_KEYS` in `app/[locale]/(public)/privacy/page.tsx` gains `wagering`
before `improving`. New keys `dataUses.wagering.purpose` = "Running community
wagering", `.basis` = "Contract performance".

### 6.6 Privacy + Terms — "last updated"

- New key `metaUpdated` in both namespaces: `en` = "Last updated September
  2026". Subtitle strings (`privacy.subtitle`, `terms.subtitle`) drop the
  "Last updated: August 2026" clause — the pill carries it now. Privacy
  subtitle keeps "Compliant with the Nigeria Data Protection Act 2023 (NDPA)".

### 6.7 "In plain English" summaries

New `summary` key in each of the eight prose namespaces (1–2 sentences,
plain-language gist). Not legal text; explicitly framed as "a friendly summary,
not the legal version".

### 6.8 Escrow / Termii "when available" qualifier

`/escrow` copy and Privacy `s4List` Termii bullet read as if the feature is
live. Add "(when this feature launches)" / "when active" qualifiers. No
structural change. **Open flag for review:** alternative is to cut the Zolarux
and Termii references entirely until built — spec assumes the qualifier
approach unless the reviewer says otherwise.

### 6.9 Shared `legalCommon` namespace

New top-level namespace for strings used by shared components:
`legalCommon.tocLabel` ("Contents" / "On this page"),
`legalCommon.summaryLabel` ("In plain English"),
`legalCommon.contactCtaHeading` ("Questions about this policy?"),
`legalCommon.contactCtaButton` ("Contact us").

---

## 7. i18n

- Every new `en.json` key is added to `fr.json` and `pcm.json` in the **same
  commit**; `lib/i18n/message-parity.test.ts` fails the build otherwise.
- `fr` = standard French, `pcm` = Nigerian Pidgin, matching the register of the
  existing catalogue entries for each namespace.
- Renumbered Terms keys (`s8`→`s9` … `s14`→`s15`) must be renamed in all three
  files together.
- Estimated new keys: ~9 (terms wagering + meta) + ~4 (privacy) + 8 summaries +
  4 `legalCommon` + ~3 contact = **~28 keys × 3 locales**.

## 8. Testing

- `lib/static/toc.test.ts` — new, `slugifySection` + `buildToc` (node env,
  no DOM).
- `lib/i18n/message-parity.test.ts` — must stay green (catches any missed
  `fr`/`pcm` key).
- `npm run test` full run green.
- `npm run build` succeeds (catches server/client boundary mistakes in the
  shell).
- Manual verification:
  - `/terms` at 375px — mobile `<details>` ToC opens, anchor links jump with
    correct offset (`scroll-mt-24` clears the sticky header).
  - `/terms` desktop — sticky rail, scroll-spy highlights the section in view.
  - `/privacy` legal-basis table still renders (it's outside `proseClassName`).
  - One non-English locale (`/fr/terms`) renders with translated ToC + body.

## 9. File-change summary

**New**
```
components/static/LegalDocShell.tsx
components/static/TocNav.tsx
components/static/LegalContactCta.tsx
lib/static/toc.ts
lib/static/toc.test.ts
```

**Modified**
```
app/[locale]/(public)/terms/page.tsx
app/[locale]/(public)/privacy/page.tsx
app/[locale]/(public)/rules/page.tsx
app/[locale]/(public)/safety/page.tsx
app/[locale]/(public)/community-rules/page.tsx
app/[locale]/(public)/refund-policy/page.tsx
app/[locale]/(public)/escrow/page.tsx
app/[locale]/(public)/tournament-guide/page.tsx
app/[locale]/(public)/contact/page.tsx
messages/en.json
messages/fr.json
messages/pcm.json
```

`components/static/StaticPageShell.tsx` — unchanged (`proseClassName` still
exported and reused by `LegalDocShell` and `/contact`).

## 10. Risks

- **Anchor stability.** External links / bookmarks to these pages don't exist
  yet (pages are new), so introducing `id`s now has no breakage cost. Ids are
  chosen once and frozen.
- **Terms renumbering** is error-prone across 3 locale files — do it as one
  mechanical pass with a parity-test run immediately after.
- **Scroll-spy on mobile** is not rendered (`lg:` only) — acceptable; mobile
  uses the `<details>` list.
