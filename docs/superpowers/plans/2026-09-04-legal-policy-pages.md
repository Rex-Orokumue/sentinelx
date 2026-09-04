# Legal & Policy Page System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the eight prose legal/policy pages a sticky table-of-contents shell with anchored sections, "last updated" pills and a plain-English summary; restyle `/contact` to match; and add coin-wagering coverage to Terms and Privacy — all copy staying in the `next-intl` catalogue with full `en`/`fr`/`pcm` parity.

**Architecture:** One new Server Component `LegalDocShell` composes the existing `StaticPageShell` header with a client `TocNav` island (rail + mobile disclosure, IntersectionObserver scroll-spy) and a `sections: {id,title,body}[]` model; each prose page swaps its flat `<div className={proseClassName}>` for a `sections` array built from its **existing** message keys. Content changes (Terms §8 wagering + renumber, Privacy wager data, cross-links, dates) ride along in the same per-page tasks. No betting/coin **code** changes.

**Tech Stack:** Next.js 14 App Router (RSC + one `'use client'` island), TypeScript, Tailwind (`sx-*` tokens), `next-intl` v3, vitest (node env — no DOM/RTL).

**Spec:** `docs/superpowers/specs/2026-09-04-legal-policy-pages-design.md` — read it alongside this plan.

## Global Constraints

- **Branch:** work on `feat/legal-policy-pages` (already created, spec already committed there). Do not work on `main`.
- **i18n parity:** every key added to `messages/en.json` MUST be added to `messages/fr.json` and `messages/pcm.json` in the **same commit** — `lib/i18n/message-parity.test.ts` fails the build otherwise. `fr` = standard French, `pcm` = Nigerian Pidgin.
- **No new dependencies.** No React Testing Library, no jsdom. Component behaviour is verified by `npm run build` + manual check; only pure logic gets a `.test.ts`.
- **Anchor ids are frozen** once chosen — use exactly the id strings in this plan (from spec §5.1).
- **Design tokens only:** `sx-bg`, `sx-surface`, `sx-border`, `sx-purple`, `sx-purple-light`, `sx-purple-text`, `sx-gray`, `sx-green`. Display type = `font-display` (Barlow Condensed). No raw hex.
- **`proseClassName`** stays exported from `components/static/StaticPageShell.tsx` and is reused, not replaced.
- **Coin-economy edit-lock:** do not touch `lib/coins/*`, `lib/wagers/*`, `match_wagers` schema, or registration-discount UI. This plan only *documents* existing behaviour.
- **Server Components by default;** `'use client'` only in `TocNav`.
- Commit after every task. Commit message trailer:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GR91xNG5SEECnM38aMUodA
  ```

---

## File Structure

**New**
| File | Responsibility |
|------|----------------|
| `lib/static/toc.ts` | Pure ToC helpers: `TocEntry` type, `slugifySection`, `buildToc` |
| `lib/static/toc.test.ts` | Unit tests for the above |
| `components/static/TocNav.tsx` | `'use client'` — renders the ToC (rail or disclosure variant) + scroll-spy |
| `components/static/LegalContactCta.tsx` | Server Component — "still have questions?" → `/contact` card |
| `components/static/LegalDocShell.tsx` | Server Component — header + pills + summary + ToC grid + anchored sections + CTA |

**Modified**
| File | Change |
|------|--------|
| `components/static/richTags.tsx` | `linkTag` uses locale-aware `Link` for internal hrefs |
| `app/[locale]/(public)/rules/page.tsx` | → `LegalDocShell` |
| `app/[locale]/(public)/safety/page.tsx` | → `LegalDocShell` |
| `app/[locale]/(public)/community-rules/page.tsx` | → `LegalDocShell` (+ `overviewHeading` key) |
| `app/[locale]/(public)/refund-policy/page.tsx` | → `LegalDocShell` |
| `app/[locale]/(public)/tournament-guide/page.tsx` | → `LegalDocShell` |
| `app/[locale]/(public)/escrow/page.tsx` | → `LegalDocShell` + "when available" qualifiers |
| `app/[locale]/(public)/privacy/page.tsx` | → `LegalDocShell` + wager data + table row + pills + summary |
| `app/[locale]/(public)/terms/page.tsx` | → `LegalDocShell` + new §8 wagering + renumber §8–14→§9–15 + §7 edit + cross-links + pills + summary |
| `app/[locale]/(public)/contact/page.tsx` | Restyle (method cards, `<dl>`, callout, "before you write" line) |
| `messages/en.json` `messages/fr.json` `messages/pcm.json` | New `legalCommon` namespace + per-page `summary`/`metaUpdated` + Terms/Privacy content keys |

---

## Task 1: Pure ToC helpers

**Files:**
- Create: `lib/static/toc.ts`
- Test: `lib/static/toc.test.ts`

**Interfaces:**
- Produces:
  - `type TocEntry = { id: string; title: string }`
  - `slugifySection(raw: string): string`
  - `buildToc(sections: { id: string; title: string }[]): TocEntry[]`

- [ ] **Step 1: Write the failing test**

`lib/static/toc.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { slugifySection, buildToc } from './toc'

describe('slugifySection', () => {
  it('drops a leading section number', () => {
    expect(slugifySection('1. Who We Are')).toBe('who-we-are')
    expect(slugifySection('14. Contact')).toBe('contact')
  })
  it('lowercases and hyphenates', () => {
    expect(slugifySection('Match Rules and Fair Play')).toBe('match-rules-and-fair-play')
  })
  it('strips diacritics from translated headings', () => {
    expect(slugifySection('4. Tournois et frais d’inscription')).toBe('tournois-et-frais-dinscription')
  })
  it('collapses punctuation runs and trims', () => {
    expect(slugifySection('Prizes & Withdrawals!')).toBe('prizes-withdrawals')
  })
})

describe('buildToc', () => {
  it('preserves order and pairs id/title, dropping body', () => {
    const sections = [
      { id: 'a', title: 'Alpha', body: null },
      { id: 'b', title: 'Beta', body: null },
    ]
    expect(buildToc(sections)).toEqual([
      { id: 'a', title: 'Alpha' },
      { id: 'b', title: 'Beta' },
    ])
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run lib/static/toc.test.ts`
Expected: FAIL — `Cannot find module './toc'`.

- [ ] **Step 3: Write the implementation**

`lib/static/toc.ts`:
```ts
export type TocEntry = { id: string; title: string }

/**
 * Turn a section heading into a stable URL anchor. Pages pass EXPLICIT ids to
 * LegalDocShell (a translated heading must never shift an anchor), so this
 * helper is for authoring those id lists — it is not run on request-time
 * translated strings.
 */
export function slugifySection(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/^\s*\d+[.)]\s*/, '') // drop a leading "1. " / "1) "
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function buildToc(sections: { id: string; title: string }[]): TocEntry[] {
  return sections.map(({ id, title }) => ({ id, title }))
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run lib/static/toc.test.ts`
Expected: PASS (2 suites, 5 assertions).

- [ ] **Step 5: Commit**

```bash
git add lib/static/toc.ts lib/static/toc.test.ts
git commit -m "feat(static): pure table-of-contents helpers"
```

---

## Task 2: `legalCommon` i18n namespace

**Files:**
- Modify: `messages/en.json`, `messages/fr.json`, `messages/pcm.json`

**Interfaces:**
- Produces: `legalCommon.{tocLabel,summaryLabel,contactCtaHeading,contactCtaButton}` in all three catalogues.

- [ ] **Step 1: Add the namespace to `messages/en.json`**

Add a top-level `"legalCommon"` key (alphabetical position near other top-level namespaces):
```json
"legalCommon": {
  "tocLabel": "On this page",
  "summaryLabel": "In plain English",
  "contactCtaHeading": "Still have questions?",
  "contactCtaButton": "Contact us"
}
```

- [ ] **Step 2: Add to `messages/fr.json`**

```json
"legalCommon": {
  "tocLabel": "Sur cette page",
  "summaryLabel": "En clair",
  "contactCtaHeading": "D’autres questions ?",
  "contactCtaButton": "Nous contacter"
}
```

- [ ] **Step 3: Add to `messages/pcm.json`**

```json
"legalCommon": {
  "tocLabel": "Wetin dey dis page",
  "summaryLabel": "For plain English",
  "contactCtaHeading": "You still get question?",
  "contactCtaButton": "Contact Us"
}
```

- [ ] **Step 4: Run the parity test**

Run: `npx vitest run lib/i18n/message-parity.test.ts`
Expected: PASS — key sets still match across locales.

- [ ] **Step 5: Commit**

```bash
git add messages/en.json messages/fr.json messages/pcm.json
git commit -m "feat(i18n): legalCommon namespace for shared legal-page chrome"
```

---

## Task 3: `LegalContactCta` component + locale-aware internal `linkTag`

**Files:**
- Create: `components/static/LegalContactCta.tsx`
- Modify: `components/static/richTags.tsx`

**Interfaces:**
- Consumes: `legalCommon.contactCtaHeading`, `legalCommon.contactCtaButton` (Task 2).
- Produces:
  - `async function LegalContactCta(): Promise<JSX.Element>`
  - `linkTag(href, opts?)` unchanged signature; internal (non-`external`) hrefs now render the `next-intl` `Link`.

- [ ] **Step 1: Update `linkTag` in `components/static/richTags.tsx`**

Replace the existing `linkTag` function with:
```tsx
import { Link } from '@/i18n/navigation'

export function linkTag(href: string, opts: { external?: boolean } = {}) {
  return {
    link: (chunks: ReactNode) =>
      opts.external ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {chunks}
        </a>
      ) : (
        <Link href={href}>{chunks}</Link>
      ),
  }
}
```
Leave `strongTag`, `listItemTag`, `emailTag`, `whatsappTag` untouched. Add the `Link` import at the top with the other imports.

- [ ] **Step 2: Verify existing internal-link usage still type-checks**

Run: `npx tsc --noEmit`
Expected: no new errors. (`/escrow` uses `linkTag('/exchange')` and `linkTag('/exchange')` inside `t.rich` — `Link` accepts a string `href`.)

- [ ] **Step 3: Create `components/static/LegalContactCta.tsx`**

```tsx
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'

export async function LegalContactCta() {
  const t = await getTranslations('legalCommon')
  return (
    <div className="mt-12 rounded-xl border border-sx-purple/30 bg-sx-surface p-6 text-center">
      <p className="font-display text-lg font-bold text-white">{t('contactCtaHeading')}</p>
      <Link
        href="/contact"
        className="mt-4 inline-flex items-center rounded-lg bg-sx-purple px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-sx-purple-light"
      >
        {t('contactCtaButton')}
      </Link>
    </div>
  )
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add components/static/richTags.tsx components/static/LegalContactCta.tsx
git commit -m "feat(static): LegalContactCta + locale-aware internal linkTag"
```

---

## Task 4: `TocNav` client island

**Files:**
- Create: `components/static/TocNav.tsx`

**Interfaces:**
- Consumes: `TocEntry` from `@/lib/static/toc` (Task 1).
- Produces: `function TocNav(props: { entries: TocEntry[]; label: string; variant: 'rail' | 'disclosure' }): JSX.Element`

- [ ] **Step 1: Create the component**

```tsx
'use client'

import { useEffect, useState } from 'react'
import type { TocEntry } from '@/lib/static/toc'

type TocNavProps = {
  entries: TocEntry[]
  label: string
  variant: 'rail' | 'disclosure'
}

export function TocNav({ entries, label, variant }: TocNavProps) {
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    const targets = entries
      .map((e) => document.getElementById(e.id))
      .filter((el): el is HTMLElement => el !== null)
    if (targets.length === 0) return

    const observer = new IntersectionObserver(
      (observed) => {
        const visible = observed
          .filter((o) => o.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActiveId(visible[0].target.id)
      },
      // top offset clears the sticky header; bottom bias so a section counts
      // as "active" only once it's well into view
      { rootMargin: '-80px 0px -70% 0px' },
    )
    targets.forEach((t) => observer.observe(t))
    return () => observer.disconnect()
  }, [entries])

  const list = (
    <ol className="space-y-1.5">
      {entries.map((entry) => (
        <li key={entry.id}>
          <a
            href={`#${entry.id}`}
            className={`block border-l-2 py-0.5 pl-3 text-sm transition-colors ${
              activeId === entry.id
                ? 'border-sx-purple font-semibold text-white'
                : 'border-transparent text-sx-gray hover:text-white'
            }`}
          >
            {entry.title}
          </a>
        </li>
      ))}
    </ol>
  )

  if (variant === 'disclosure') {
    return (
      <details className="mb-8 rounded-xl border border-sx-border bg-sx-surface p-4 lg:hidden">
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-widest text-sx-purple-text">
          {label}
        </summary>
        <nav aria-label={label} className="mt-3">
          {list}
        </nav>
      </details>
    )
  }

  return (
    <nav
      aria-label={label}
      className="hidden lg:block lg:sticky lg:top-24 lg:self-start"
    >
      <p className="mb-3 text-xs font-bold uppercase tracking-widest text-sx-purple-text">
        {label}
      </p>
      {list}
    </nav>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/static/TocNav.tsx
git commit -m "feat(static): TocNav scroll-spy island"
```

---

## Task 5: `LegalDocShell`

**Files:**
- Create: `components/static/LegalDocShell.tsx`

**Interfaces:**
- Consumes: `buildToc` + `TocEntry` (Task 1), `TocNav` (Task 4), `LegalContactCta` (Task 3), `proseClassName` from `components/static/StaticPageShell.tsx`, `legalCommon.*` (Task 2).
- Produces:
  ```ts
  type LegalSection = { id: string; title: string; body: ReactNode }
  function LegalDocShell(props: {
    eyebrow?: string
    title: string
    subtitle?: string
    meta?: string[]
    summary?: ReactNode
    sections: LegalSection[]
    contactCta?: boolean   // default true
  }): Promise<JSX.Element>
  ```

- [ ] **Step 1: Create the component**

```tsx
import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'
import { proseClassName } from '@/components/static/StaticPageShell'
import { buildToc } from '@/lib/static/toc'
import { TocNav } from '@/components/static/TocNav'
import { LegalContactCta } from '@/components/static/LegalContactCta'

export type LegalSection = { id: string; title: string; body: ReactNode }

type LegalDocShellProps = {
  eyebrow?: string
  title: string
  subtitle?: string
  meta?: string[]
  summary?: ReactNode
  sections: LegalSection[]
  contactCta?: boolean
}

export async function LegalDocShell({
  eyebrow,
  title,
  subtitle,
  meta,
  summary,
  sections,
  contactCta = true,
}: LegalDocShellProps) {
  const t = await getTranslations('legalCommon')
  const toc = buildToc(sections)

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <header className="mb-8 border-b border-sx-border pb-6">
        {eyebrow && (
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-sx-purple-text">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-3xl font-black uppercase leading-tight text-white sm:text-4xl">
          {title}
        </h1>
        {subtitle && <p className="mt-2 text-sm text-sx-gray">{subtitle}</p>}
        {meta && meta.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {meta.map((m) => (
              <span
                key={m}
                className="rounded-full border border-sx-border bg-sx-surface px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-sx-gray"
              >
                {m}
              </span>
            ))}
          </div>
        )}
      </header>

      {summary && (
        <div className="mb-8 rounded-xl border border-sx-purple/30 bg-sx-surface p-5">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-sx-purple-text">
            {t('summaryLabel')}
          </p>
          <div className="text-sm text-sx-gray">{summary}</div>
        </div>
      )}

      <TocNav variant="disclosure" entries={toc} label={t('tocLabel')} />

      <div className="lg:grid lg:grid-cols-[200px_1fr] lg:gap-10">
        <TocNav variant="rail" entries={toc} label={t('tocLabel')} />

        <div>
          {sections.map((section, i) => (
            <section
              key={section.id}
              id={section.id}
              className="scroll-mt-24 border-t border-sx-border pt-8 first:border-0 first:pt-0"
            >
              <h2 className="mb-4 font-display text-xl font-bold text-white">
                <span className="mr-2 text-sx-purple-text">{i + 1}.</span>
                {stripLeadingNumber(section.title)}
              </h2>
              <div className={proseClassName}>{section.body}</div>
            </section>
          ))}

          {contactCta && <LegalContactCta />}
        </div>
      </div>
    </div>
  )
}

// Section titles in the catalogue keep their "1. " / "9. " prefix (they are
// also the ToC labels). The shell renders its own number chip, so strip the
// baked-in one from the <h2>.
function stripLeadingNumber(title: string): string {
  return title.replace(/^\s*\d+[.)]\s*/, '')
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/static/LegalDocShell.tsx
git commit -m "feat(static): LegalDocShell — ToC + anchored sections"
```

---

## Task 6: Convert `/rules` (establishes the page-conversion pattern)

**Files:**
- Modify: `app/[locale]/(public)/rules/page.tsx`
- Modify: `messages/en.json`, `messages/fr.json`, `messages/pcm.json` (add `rules.summary`)

**Interfaces:**
- Consumes: `LegalDocShell`, `LegalSection` (Task 5); existing `rules.*` keys.

**Conversion pattern (used by Tasks 6–11):** replace
```tsx
<StaticPageShell eyebrow={t('eyebrow')} title={t('title')}>
  <div className={proseClassName}> ...<h2>{t('xHeading')}</h2><ul>{...}</ul>... </div>
</StaticPageShell>
```
with
```tsx
<LegalDocShell
  eyebrow={t('eyebrow')}
  title={t('title')}
  summary={t('summary')}
  sections={[
    { id: '<frozen-id>', title: t('xHeading'), body: <ul>{t.rich('xList', listItemTag)}</ul> },
    ...
  ]}
/>
```
Keep the same `getTranslations`, `generateMetadata`, and `t.rich` tag spreads. Drop the `StaticPageShell` / `proseClassName` imports if unused; add `LegalDocShell`.

- [ ] **Step 1: Add `rules.summary` to all three catalogues**

`en.json` → `rules`:
```json
"summary": "The short version: show up on time, play the format the tournament sets, keep a recording, and submit your result with proof. No-shows and cheating cost you SX Score. An admin’s ruling on a dispute is final."
```
`fr.json` → `rules`:
```json
"summary": "En résumé : soyez à l’heure, jouez le format défini par le tournoi, gardez un enregistrement et soumettez votre résultat avec des preuves. Les absences et la triche vous coûtent des points de SX Score. La décision d’un administrateur sur un litige est définitive."
```
`pcm.json` → `rules`:
```json
"summary": "Di short version: show up on time, play di format wey di tournament set, keep recording, and submit your result with evidence. No-show and cheating go cost you SX Score. Wetin admin rule for dispute, na im be final."
```

- [ ] **Step 2: Rewrite `app/[locale]/(public)/rules/page.tsx`**

```tsx
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { LegalDocShell } from '@/components/static/LegalDocShell'
import { listItemTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'rules' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/rules',
    locale,
  })
}

export default async function RulesPage() {
  const t = await getTranslations('rules')
  return (
    <LegalDocShell
      eyebrow={t('eyebrow')}
      title={t('title')}
      summary={t('summary')}
      sections={[
        { id: 'eligibility', title: t('eligibilityHeading'), body: <ul>{t.rich('eligibilityList', listItemTag)}</ul> },
        { id: 'before-your-match', title: t('beforeHeading'), body: <ul>{t.rich('beforeList', listItemTag)}</ul> },
        { id: 'during-play', title: t('playingHeading'), body: <ul>{t.rich('playingList', listItemTag)}</ul> },
        { id: 'submitting-results', title: t('submittingHeading'), body: <ul>{t.rich('submittingList', listItemTag)}</ul> },
        { id: 'no-shows', title: t('noShowHeading'), body: <ul>{t.rich('noShowList', listItemTag)}</ul> },
        { id: 'disputes', title: t('disputesHeading'), body: <ul>{t.rich('disputesList', listItemTag)}</ul> },
        { id: 'conduct', title: t('conductHeading'), body: <ul>{t.rich('conductList', listItemTag)}</ul> },
        { id: 'prizes', title: t('prizesHeading'), body: <ul>{t.rich('prizesList', listItemTag)}</ul> },
      ]}
    />
  )
}
```

- [ ] **Step 3: Parity test + build**

Run: `npx vitest run lib/i18n/message-parity.test.ts && npm run build`
Expected: parity PASS; build succeeds and lists `/[locale]/rules` as a route.

- [ ] **Step 4: Manual check**

Run `npm run dev`, open `http://localhost:3000/rules`:
- desktop ≥1024px: sticky ToC rail on the left, 8 entries, clicking one jumps with the heading clear of the sticky navbar
- 375px: "On this page" `<details>` above the body, closed by default, opens to the same list
- "In plain English" purple callout above the ToC
- "Still have questions?" card at the bottom linking to `/contact`
- `http://localhost:3000/fr/rules` renders French headings + French ToC

- [ ] **Step 5: Commit**

```bash
git add app/[locale]/(public)/rules/page.tsx messages/en.json messages/fr.json messages/pcm.json
git commit -m "feat(rules): convert to LegalDocShell with table of contents"
```

---

## Task 7: Convert `/safety` and `/community-rules`

**Files:**
- Modify: `app/[locale]/(public)/safety/page.tsx`, `app/[locale]/(public)/community-rules/page.tsx`
- Modify: `messages/{en,fr,pcm}.json` (`safety.summary`, `communityRules.summary`, `communityRules.overviewHeading`)

**Interfaces:** Consumes `LegalDocShell` (Task 5), existing `safety.*` / `communityRules.*` keys.

- [ ] **Step 1: Add keys to all three catalogues**

`en.json`:
```json
// safety
"summary": "The short version: protect your login and never share your password — we will never ask for it. Trade only through the platform’s escrow, and report anything that feels off."
// communityRules
"summary": "The short version: treat people with respect. No harassment, spam, doxxing, cheating talk, or NSFW content. Breaking these gets you muted, suspended, or banned.",
"overviewHeading": "Overview"
```
`fr.json`:
```json
// safety
"summary": "En résumé : protégez vos identifiants et ne partagez jamais votre mot de passe — nous ne vous le demanderons jamais. N’échangez qu’via l’escrow de la plateforme, et signalez tout ce qui vous semble suspect."
// communityRules
"summary": "En résumé : traitez les autres avec respect. Pas de harcèlement, de spam, de divulgation de données personnelles, d’incitation à la triche ni de contenu NSFW. Enfreindre ces règles entraîne une mise en sourdine, une suspension ou un bannissement.",
"overviewHeading": "Aperçu"
```
`pcm.json`:
```json
// safety
"summary": "Di short version: protect your login and no share your password with anybody — we no go ever ask you for am. Trade only through di platform escrow, and report anything wey no look right."
// communityRules
"summary": "Di short version: respect people. No harassment, no spam, no doxxing, no cheating talk, no NSFW content. If you break dis ones, dem go mute, suspend, or ban you.",
"overviewHeading": "Overview"
```

- [ ] **Step 2: Rewrite `app/[locale]/(public)/safety/page.tsx`**

Keep `generateMetadata` as-is (only swap the import block). Body:
```tsx
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { LegalDocShell } from '@/components/static/LegalDocShell'
import { emailTag, whatsappTag, listItemTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'safety' })
  return buildMetadata({ title: t('metaTitle'), description: t('metaDescription'), path: '/safety', locale })
}

export default async function SafetyPage() {
  const t = await getTranslations('safety')
  return (
    <LegalDocShell
      eyebrow={t('eyebrow')}
      title={t('title')}
      summary={t('summary')}
      sections={[
        { id: 'protect-your-account', title: t('protectAccountHeading'), body: <ul>{t.rich('protectAccountList', listItemTag)}</ul> },
        {
          id: 'what-we-never-ask',
          title: t('neverAskHeading'),
          body: (
            <>
              <p>{t('neverAskIntro')}</p>
              <ul>{t.rich('neverAskList', listItemTag)}</ul>
              <p>{t('neverAskP2')}</p>
            </>
          ),
        },
        { id: 'protect-your-prize', title: t('protectPrizeHeading'), body: <ul>{t.rich('protectPrizeList', listItemTag)}</ul> },
        { id: 'safe-trading', title: t('safeTradingHeading'), body: <ul>{t.rich('safeTradingList', listItemTag)}</ul> },
        { id: 'match-safety', title: t('matchSafetyHeading'), body: <ul>{t.rich('matchSafetyList', listItemTag)}</ul> },
        {
          id: 'reporting',
          title: t('reportHeading'),
          body: <p>{t.rich('reportP1', { ...emailTag(), ...whatsappTag(), br: () => <br /> })}</p>,
        },
      ]}
    />
  )
}
```

- [ ] **Step 3: Rewrite `app/[locale]/(public)/community-rules/page.tsx`**

```tsx
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { LegalDocShell } from '@/components/static/LegalDocShell'
import { emailTag, strongTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'communityRules' })
  return buildMetadata({ title: t('metaTitle'), description: t('metaDescription'), path: '/community-rules', locale })
}

export default async function CommunityRulesPage() {
  const t = await getTranslations('communityRules')
  return (
    <LegalDocShell
      eyebrow={t('eyebrow')}
      title={t('title')}
      summary={t('summary')}
      sections={[
        { id: 'overview', title: t('overviewHeading'), body: <p>{t('intro')}</p> },
        { id: 'the-basics', title: t('basicHeading'), body: <p>{t('basicP1')}</p> },
        {
          id: 'not-allowed',
          title: t('notAllowedHeading'),
          body: (
            <>
              <h3>{t('harassmentHeading')}</h3>
              <p>{t('harassmentP1')}</p>
              <h3>{t('spamHeading')}</h3>
              <p>{t('spamP1')}</p>
              <h3>{t('falseInfoHeading')}</h3>
              <p>{t('falseInfoP1')}</p>
              <h3>{t('privacyHeading')}</h3>
              <p>{t('privacyP1')}</p>
              <h3>{t('cheatingHeading')}</h3>
              <p>{t('cheatingP1')}</p>
              <h3>{t('nsfwHeading')}</h3>
              <p>{t('nsfwP1')}</p>
            </>
          ),
        },
        {
          id: 'consequences',
          title: t('consequencesHeading'),
          body: <p>{t.rich('consequencesP1', { ...strongTag, br: () => <br /> })}</p>,
        },
        { id: 'reporting', title: t('reportingHeading'), body: <p>{t.rich('reportingP1', emailTag())}</p> },
      ]}
    />
  )
}
```

- [ ] **Step 4: Parity + build**

Run: `npx vitest run lib/i18n/message-parity.test.ts && npm run build`
Expected: PASS + build OK.

- [ ] **Step 5: Manual check**

`/safety` and `/community-rules` at desktop + 375px: ToC present, `/community-rules` "Not allowed" section shows its six `<h3>` sub-blocks but only 5 ToC entries.

- [ ] **Step 6: Commit**

```bash
git add app/[locale]/(public)/safety/page.tsx app/[locale]/(public)/community-rules/page.tsx messages/en.json messages/fr.json messages/pcm.json
git commit -m "feat(safety,community-rules): convert to LegalDocShell"
```

---

## Task 8: Convert `/refund-policy` and `/tournament-guide`

**Files:**
- Modify: `app/[locale]/(public)/refund-policy/page.tsx`, `app/[locale]/(public)/tournament-guide/page.tsx`
- Modify: `messages/{en,fr,pcm}.json` (`refundPolicy.summary`, `tournamentGuide.summary`)

- [ ] **Step 1: Add summary keys**

`en.json`:
```json
// refundPolicy
"summary": "The short version: entry fees come back if a tournament is cancelled or cannot run — not if you are disqualified or simply change your mind. A payment that debited you but failed to register is always refunded."
// tournamentGuide
"summary": "The short version: check the game, format, and schedule before you register, keep your screen recording running through your match, and submit your result promptly with a screenshot."
```
`fr.json`:
```json
// refundPolicy
"summary": "En résumé : les frais d’inscription sont remboursés si un tournoi est annulé ou ne peut pas avoir lieu — pas si vous êtes disqualifié ou si vous changez simplement d’avis. Un paiement qui vous a été débité mais n’a pas validé l’inscription est toujours remboursé."
// tournamentGuide
"summary": "En résumé : vérifiez le jeu, le format et le calendrier avant de vous inscrire, laissez votre enregistrement d’écran tourner pendant tout le match, et soumettez votre résultat rapidement avec une capture d’écran."
```
`pcm.json`:
```json
// refundPolicy
"summary": "Di short version: entry fee dey come back if dem cancel tournament or e no fit run — no be if dem disqualify you or you just change your mind. Payment wey debit you but no register, we dey always refund am."
// tournamentGuide
"summary": "Di short version: check di game, format, and schedule before you register, make your screen recording dey run throughout your match, and submit your result quick quick with screenshot."
```

- [ ] **Step 2: Rewrite `app/[locale]/(public)/refund-policy/page.tsx`**

```tsx
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { LegalDocShell } from '@/components/static/LegalDocShell'
import { emailTag, listItemTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'refundPolicy' })
  return buildMetadata({ title: t('metaTitle'), description: t('metaDescription'), path: '/refund-policy', locale })
}

export default async function RefundPolicyPage() {
  const t = await getTranslations('refundPolicy')
  return (
    <LegalDocShell
      eyebrow={t('eyebrow')}
      title={t('title')}
      subtitle={t('subtitle')}
      summary={t('summary')}
      sections={[
        {
          id: 'entry-fees',
          title: t('s1Heading'),
          body: (
            <>
              <p>{t('s1P1')}</p>
              <p><strong>{t('s1RefundIntro')}</strong></p>
              <ul>{t.rich('s1RefundList', listItemTag)}</ul>
              <p><strong>{t('s1NoRefundIntro')}</strong></p>
              <ul>{t.rich('s1NoRefundList', listItemTag)}</ul>
              <p>{t('s1P2')}</p>
            </>
          ),
        },
        {
          id: 'tournament-cancelled',
          title: t('s2Heading'),
          body: (
            <>
              <p>{t('s2Intro')}</p>
              <ul>{t.rich('s2List', listItemTag)}</ul>
            </>
          ),
        },
        { id: 'disqualification', title: t('s3Heading'), body: <p>{t('s3P1')}</p> },
        { id: 'payment-failures', title: t('s4Heading'), body: <p>{t('s4P1')}</p> },
        { id: 'how-to-request', title: t('s5Heading'), body: <p>{t.rich('s5P1', emailTag())}</p> },
      ]}
    />
  )
}
```

- [ ] **Step 3: Rewrite `app/[locale]/(public)/tournament-guide/page.tsx`**

```tsx
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { LegalDocShell } from '@/components/static/LegalDocShell'
import { listItemTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'tournamentGuide' })
  return buildMetadata({ title: t('metaTitle'), description: t('metaDescription'), path: '/tournament-guide', locale })
}

export default async function TournamentGuidePage() {
  const t = await getTranslations('tournamentGuide')
  return (
    <LegalDocShell
      eyebrow={t('eyebrow')}
      title={t('title')}
      subtitle={t('subtitle')}
      summary={t('summary')}
      sections={[
        {
          id: 'before-you-register',
          title: t('beforeRegHeading'),
          body: (
            <>
              <p><strong>{t('checkGameLabel')}</strong> {t('checkGameP')}</p>
              <p><strong>{t('checkFormatLabel')}</strong> {t('checkFormatP')}</p>
              <p><strong>{t('checkScheduleLabel')}</strong> {t('checkScheduleP')}</p>
              <p><strong>{t('checkBalanceLabel')}</strong> {t('checkBalanceP')}</p>
            </>
          ),
        },
        { id: 'registering', title: t('registeringHeading'), body: <ol>{t.rich('registeringList', listItemTag)}</ol> },
        {
          id: 'after-registering',
          title: t('afterRegHeading'),
          body: <><p>{t('afterRegP1')}</p><p>{t('afterRegP2')}</p></>,
        },
        {
          id: 'playing',
          title: t('playingHeading'),
          body: (
            <>
              <p><strong>{t('prepareLabel')}</strong> {t('prepareP')}</p>
              <p><strong>{t('recordLabel')}</strong> {t('recordP')}</p>
              <p><strong>{t('joinLabel')}</strong> {t('joinP')}</p>
              <p><strong>{t('playLabel')}</strong> {t('playP')}</p>
            </>
          ),
        },
        {
          id: 'submitting',
          title: t('submittingHeading'),
          body: (
            <>
              <p>{t('submittingIntro')}</p>
              <ol>{t.rich('submittingList', listItemTag)}</ol>
              <p>{t('submittingP2')}</p>
            </>
          ),
        },
        {
          id: 'after-submission',
          title: t('afterSubmissionHeading'),
          body: <><p>{t('afterSubmissionP1')}</p><p>{t('afterSubmissionP2')}</p></>,
        },
        { id: 'tips', title: t('tipsHeading'), body: <ul>{t.rich('tipsList', listItemTag)}</ul> },
      ]}
    />
  )
}
```

- [ ] **Step 4: Parity + build**

Run: `npx vitest run lib/i18n/message-parity.test.ts && npm run build`
Expected: PASS + build OK.

- [ ] **Step 5: Manual check** — both pages, desktop + 375px.

- [ ] **Step 6: Commit**

```bash
git add app/[locale]/(public)/refund-policy/page.tsx app/[locale]/(public)/tournament-guide/page.tsx messages/en.json messages/fr.json messages/pcm.json
git commit -m "feat(refund-policy,tournament-guide): convert to LegalDocShell"
```

---

## Task 9: Convert `/escrow` + "when available" qualifiers

**Files:**
- Modify: `app/[locale]/(public)/escrow/page.tsx`
- Modify: `messages/{en,fr,pcm}.json` (`escrow.summary` + qualifier edits to `escrow.whatIsExchangeP1`, `escrow.whatIsEscrowP1`)

**Context:** The Gaming Exchange / Zolarux escrow is v3.0 — not built yet (spec §6.8). Two strings assert it is live (`whatIsExchangeP1`, `whatIsExchangeP2`); shift them present→future and add a "not live yet" clause. `whatIsEscrowP1/P2` are a generic explanation of what escrow *means* — leave them unchanged. Do **not** restructure.

- [ ] **Step 1: Edit `escrow` keys in all three catalogues (faithful edits — only the two liveness strings + new summary)**

`en.json` → `escrow`:
```json
"whatIsExchangeP1": "The Gaming Exchange will be SentinelX’s marketplace for gaming accounts, in-game items, and digital gaming assets — built for Nigerian mobile gamers who want to buy and sell safely, without the risk of being scammed. It is not live yet; this page explains how it will work when it launches.",
"whatIsExchangeP2": "Every transaction on the Exchange will be protected by Zolarux Escrow. <link>Browse the Exchange →</link>",
"summary": "The short version: the Gaming Exchange will hold the buyer’s payment safely until both sides confirm the deal is done. Trade outside the escrow and you carry the risk yourself."
```
> Every other `escrow` key stays exactly as it is now.

`fr.json` → `escrow`:
```json
"whatIsExchangeP1": "Le Gaming Exchange sera la place de marché de SentinelX pour les comptes de jeu, les objets in-game et les actifs de jeu numériques — conçue pour les joueurs mobiles nigérians qui veulent acheter et vendre en toute sécurité, sans risque d’arnaque. Il n’est pas encore actif ; cette page explique comment il fonctionnera à son lancement.",
"whatIsExchangeP2": "Chaque transaction sur l’Exchange sera protégée par Zolarux Escrow. <link>Parcourir l’Exchange →</link>",
"summary": "En résumé : le Gaming Exchange conservera le paiement de l’acheteur en toute sécurité jusqu’à ce que les deux parties confirment que la transaction est terminée. Si vous échangez en dehors de l’escrow, vous en assumez le risque."
```
`pcm.json` → `escrow`:
```json
"whatIsExchangeP1": "Di Gaming Exchange go be SentinelX marketplace for gaming accounts, in-game items, and digital gaming assets — dem build am for Naija mobile gamers wey wan buy and sell safely, without di risk of scam. E never dey live; dis page dey explain how e go work wen e launch.",
"whatIsExchangeP2": "Every transaction on di Exchange go dey protected by Zolarux Escrow. <link>Browse di Exchange →</link>",
"summary": "Di short version: di Gaming Exchange go hold di buyer payment safe until di two sides confirm say di deal don complete. If you trade outside di escrow, na you carry di risk."
```

- [ ] **Step 2: Rewrite `app/[locale]/(public)/escrow/page.tsx`**

```tsx
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { LegalDocShell } from '@/components/static/LegalDocShell'
import { emailTag, linkTag, listItemTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'escrow' })
  return buildMetadata({ title: t('metaTitle'), description: t('metaDescription'), path: '/escrow', locale })
}

export default async function EscrowPage() {
  const t = await getTranslations('escrow')
  return (
    <LegalDocShell
      eyebrow={t('eyebrow')}
      title={t('title')}
      summary={t('summary')}
      sections={[
        {
          id: 'what-is-the-exchange',
          title: t('whatIsExchangeHeading'),
          body: <><p>{t('whatIsExchangeP1')}</p><p>{t.rich('whatIsExchangeP2', linkTag('/exchange'))}</p></>,
        },
        {
          id: 'what-is-escrow',
          title: t('whatIsEscrowHeading'),
          body: <><p>{t('whatIsEscrowP1')}</p><p>{t('whatIsEscrowP2')}</p></>,
        },
        {
          id: 'how-it-works',
          title: t('howItWorksHeading'),
          body: (
            <>
              <p><strong>{t('buyerLabel')}</strong></p>
              <ol>{t.rich('buyerList', listItemTag)}</ol>
              <p>{t('buyerP2')}</p>
              <p><strong>{t('sellerLabel')}</strong></p>
              <ol>{t.rich('sellerList', listItemTag)}</ol>
              <p>{t('sellerP2')}</p>
            </>
          ),
        },
        {
          id: 'why-not-direct',
          title: t('whyNotDirectHeading'),
          body: <><p>{t('whyNotDirectP1')}</p><p>{t('whyNotDirectP2')}</p></>,
        },
        { id: 'questions', title: t('questionsHeading'), body: <p>{t.rich('questionsP1', emailTag())}</p> },
      ]}
    />
  )
}
```

- [ ] **Step 3: Parity + build**

Run: `npx vitest run lib/i18n/message-parity.test.ts && npm run build`

- [ ] **Step 4: Manual check** — `/escrow` desktop + 375px; the two edited sentences read as "not yet live".

- [ ] **Step 5: Commit**

```bash
git add app/[locale]/(public)/escrow/page.tsx messages/en.json messages/fr.json messages/pcm.json
git commit -m "feat(escrow): convert to LegalDocShell + mark exchange as not-yet-live"
```

---

## Task 10: Convert + update `/privacy`

**Files:**
- Modify: `app/[locale]/(public)/privacy/page.tsx`
- Modify: `messages/{en,fr,pcm}.json` — `privacy`: `summary`, `metaUpdated`, `metaCompliance`, new `subtitle`, edited `s2PlayList`, new `dataUses.wagering`

**Interfaces:**
- Consumes: `LegalDocShell` (Task 5), existing `privacy.*` keys.
- The legal-basis table stays **outside** `proseClassName` — it is rendered inside the relevant section's `body` as its own `not-prose` block (same markup as today).

- [ ] **Step 1: Edit `privacy` keys — `messages/en.json`**

- Replace `subtitle`:
  ```json
  "subtitle": "How we collect, use, and protect your personal data."
  ```
- Add:
  ```json
  "metaUpdated": "Last updated September 2026",
  "metaCompliance": "Nigeria Data Protection Act 2023",
  "summary": "The short version: we collect what we need to run your account, tournaments, and payouts — we don’t sell anything to advertisers. Your username, profile and match record are public. You can ask to see, correct, export or delete your data at any time. The full detail is below."
  ```
- Replace `s2PlayList` (adds two `<li>`):
  ```json
  "s2PlayList": "<li>Match history, scores, and results</li><li>SX Score and rankings</li><li>Achievements and SX Coins balance</li><li>Match screenshots and recordings you submit for result verification</li><li>Community wagering — the matches you staked on, your picks, stake amounts, and outcomes</li><li>SX Coins transaction history (earns, spends, wagers, refunds)</li>"
  ```
- In `dataUses`, add a `wagering` entry **before** `improving`:
  ```json
  "wagering": { "purpose": "Running community wagering", "basis": "Contract performance" },
  ```

- [ ] **Step 2: Edit `privacy` keys — `messages/fr.json`**

```json
"subtitle": "Comment nous collectons, utilisons et protégeons vos données personnelles.",
"metaUpdated": "Dernière mise à jour : septembre 2026",
"metaCompliance": "Loi nigériane sur la protection des données 2023",
"summary": "En résumé : nous collectons ce qui est nécessaire pour gérer votre compte, les tournois et les paiements — nous ne vendons rien à des annonceurs. Votre nom d’utilisateur, votre profil et votre historique de match sont publics. Vous pouvez demander à consulter, corriger, exporter ou supprimer vos données à tout moment. Tous les détails sont ci-dessous.",
"s2PlayList": "<li>Historique des matchs, scores et résultats</li><li>SX Score et classements</li><li>Succès et solde de SX Coins</li><li>Captures d’écran et enregistrements de match que vous soumettez pour la vérification des résultats</li><li>Paris communautaires — les matchs sur lesquels vous avez misé, vos choix, les montants misés et les résultats</li><li>Historique des transactions de SX Coins (gains, dépenses, paris, remboursements)</li>"
```
`dataUses.wagering` before `improving`:
```json
"wagering": { "purpose": "Gestion des paris communautaires", "basis": "Exécution du contrat" },
```

- [ ] **Step 3: Edit `privacy` keys — `messages/pcm.json`**

```json
"subtitle": "How we dey collect, use, and protect your personal data.",
"metaUpdated": "Last update: September 2026",
"metaCompliance": "Nigeria Data Protection Act 2023",
"summary": "Di short version: we dey collect wetin we need to run your account, tournaments, and payout — we no dey sell anything to advertisers. Your username, profile and match record dey public. You fit ask to see, correct, export or delete your data anytime. Di full detail dey below.",
"s2PlayList": "<li>Match history, score, and result</li><li>SX Score and ranking</li><li>Achievement and SX Coins balance</li><li>Match screenshot and recording wey you submit for result verification</li><li>Community wagering — di matches wey you stake on, your picks, stake amount, and outcome</li><li>SX Coins transaction history (earn, spend, wager, refund)</li>"
```
`dataUses.wagering` before `improving`:
```json
"wagering": { "purpose": "To run community wagering", "basis": "Contract performance" },
```

- [ ] **Step 4: Rewrite `app/[locale]/(public)/privacy/page.tsx`**

```tsx
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { LegalDocShell } from '@/components/static/LegalDocShell'
import { emailTag, linkTag, listItemTag, strongTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'privacy' })
  return buildMetadata({ title: t('metaTitle'), description: t('metaDescription'), path: '/privacy', locale })
}

const DATA_USE_KEYS = ['account', 'payment', 'prizes', 'whatsapp', 'wagering', 'improving', 'fraud', 'compliance'] as const

export default async function PrivacyPage() {
  const t = await getTranslations('privacy')
  const dataUses = DATA_USE_KEYS.map((key) => ({
    purpose: t(`dataUses.${key}.purpose`),
    basis: t(`dataUses.${key}.basis`),
  }))

  return (
    <LegalDocShell
      eyebrow={t('eyebrow')}
      title={t('title')}
      subtitle={t('subtitle')}
      meta={[t('metaUpdated'), t('metaCompliance')]}
      summary={t('summary')}
      sections={[
        { id: 'data-controller', title: t('s1Heading'), body: <p>{t.rich('s1P1', emailTag())}</p> },
        {
          id: 'what-we-collect',
          title: t('s2Heading'),
          body: (
            <>
              <p><strong>{t('s2Account')}</strong></p>
              <ul>{t.rich('s2AccountList', listItemTag)}</ul>
              <p><strong>{t('s2Profile')}</strong></p>
              <ul>{t.rich('s2ProfileList', listItemTag)}</ul>
              <p><strong>{t('s2Tournament')}</strong></p>
              <ul>{t.rich('s2TournamentList', listItemTag)}</ul>
              <p><strong>{t('s2Play')}</strong></p>
              <ul>{t.rich('s2PlayList', listItemTag)}</ul>
              <p><strong>{t('s2Auto')}</strong></p>
              <ul>{t.rich('s2AutoList', listItemTag)}</ul>
            </>
          ),
        },
        {
          id: 'why-we-use-it',
          title: t('s3Heading'),
          body: (
            <div className="not-prose my-2 overflow-x-auto rounded-lg border border-sx-border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-sx-border bg-sx-surface">
                    <th className="border-r border-sx-border px-4 py-2.5 text-left font-bold text-white">
                      {t('tableHeaderPurpose')}
                    </th>
                    <th className="px-4 py-2.5 text-left font-bold text-white">{t('tableHeaderBasis')}</th>
                  </tr>
                </thead>
                <tbody>
                  {dataUses.map((row) => (
                    <tr key={row.purpose} className="border-b border-sx-border last:border-0">
                      <td className="border-r border-sx-border px-4 py-2.5 text-sx-gray">{row.purpose}</td>
                      <td className="px-4 py-2.5 text-sx-gray">{row.basis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ),
        },
        {
          id: 'who-we-share-with',
          title: t('s4Heading'),
          body: (
            <>
              <p>{t('s4Intro')}</p>
              <ul>{t.rich('s4List', { ...listItemTag, ...strongTag })}</ul>
              <p>{t('s4P2')}</p>
              <p>{t('s4P3')}</p>
            </>
          ),
        },
        { id: 'public-profile', title: t('s5Heading'), body: <p>{t('s5P1')}</p> },
        {
          id: 'your-rights',
          title: t('s6Heading'),
          body: (
            <>
              <p>{t('s6Intro')}</p>
              <ul>{t.rich('s6List', { ...listItemTag, ...strongTag })}</ul>
              <p>{t.rich('s6P2', emailTag())}</p>
              <p>{t.rich('s6P3', linkTag('https://ndpc.gov.ng', { external: true }))}</p>
            </>
          ),
        },
        { id: 'retention', title: t('s7Heading'), body: <><p>{t('s7P1')}</p><p>{t('s7P2')}</p></> },
        { id: 'security', title: t('s8Heading'), body: <p>{t('s8P1')}</p> },
        { id: 'children', title: t('s9Heading'), body: <p>{t('s9P1')}</p> },
        { id: 'changes', title: t('s10Heading'), body: <p>{t('s10P1')}</p> },
      ]}
    />
  )
}
```
> Note: the old page had section 3's `<h2>` + table rendered *outside* `proseClassName`. Here the table lives in the `why-we-use-it` section body as a `not-prose` block, so `LegalDocShell` still wraps it in `proseClassName` but `not-prose` neutralises that for the table. Verify the table border/spacing still looks right in the manual check.

- [ ] **Step 5: Parity + build**

Run: `npx vitest run lib/i18n/message-parity.test.ts && npm run build`
Expected: PASS + build OK.

- [ ] **Step 6: Manual check**

`/privacy` desktop + 375px + `/fr/privacy`:
- 10 ToC entries; header shows two pills ("Last updated September 2026", "Nigeria Data Protection Act 2023")
- legal-basis table renders with 8 rows (new "Running community wagering" row present), scrolls horizontally on mobile, no double border
- "When you play" list shows the two new wager bullets

- [ ] **Step 7: Commit**

```bash
git add app/[locale]/(public)/privacy/page.tsx messages/en.json messages/fr.json messages/pcm.json
git commit -m "feat(privacy): LegalDocShell + coin-wagering data disclosure"
```

---

## Task 11: Convert + update `/terms` (new §8 wagering, renumber, cross-links)

**Files:**
- Modify: `app/[locale]/(public)/terms/page.tsx`
- Modify: `messages/{en,fr,pcm}.json` — `terms`: `summary`, `metaUpdated`, new `subtitle`, new `s8*` (wagering), **renumber `s8`–`s14` → `s9`–`s15`**, edit `s7P1` + cross-link strings

**Renumber map (apply to all three catalogues, keys AND the leading number inside each `sXHeading` string):**
| Old key | New key | Old heading → new heading |
|---------|---------|---------------------------|
| `s8Heading` `s8P1` | `s9Heading` `s9P1` | "8. Gaming Exchange" → "9. Gaming Exchange" |
| `s9Heading` `s9P1` | `s10Heading` `s10P1` | "9. Community Standards" → "10. …" |
| `s10Heading` `s10P1` | `s11Heading` `s11P1` | "10. Intellectual Property" → "11. …" |
| `s11Heading` `s11P1` `s11P2` | `s12Heading` `s12P1` `s12P2` | "11. Limitation of Liability" → "12. …" |
| `s12Heading` `s12P1` | `s13Heading` `s13P1` | "12. Changes to These Terms" → "13. …" |
| `s13Heading` `s13P1` | `s14Heading` `s14P1` | "13. Governing Law" → "14. …" |
| `s14Heading` `s14P1` | `s15Heading` `s15P1` | "14. Contact" → "15. …" |

- [ ] **Step 1: Renumber `s8`–`s14` → `s9`–`s15` in `messages/en.json`**

Do the rename bottom-up (s14→s15 first, then s13→s14, …, s8→s9) to avoid collisions. Update the leading number in each heading string ("8. Gaming Exchange" → "9. Gaming Exchange", etc.). No body wording changes in this step.

- [ ] **Step 2: Repeat the identical renumber in `messages/fr.json` and `messages/pcm.json`**

fr headings: "8. Gaming Exchange"→"9. …", "9. Standards communautaires"→"10. …", "10. Propriété intellectuelle"→"11. …", "11. Limitation de responsabilité"→"12. …", "12. Modifications des présentes conditions"→"13. …", "13. Droit applicable"→"14. …", "14. Contact"→"15. …".
pcm headings: "8. Gaming Exchange"→"9. …", "9. Community Standards"→"10. …", "10. Intellectual Property"→"11. …", "11. Limitation of Liability"→"12. …", "12. Changes to Dis Terms"→"13. …", "13. Governing Law"→"14. …", "14. Contact"→"15. …".

- [ ] **Step 3: Run parity test to confirm the renumber is symmetric**

Run: `npx vitest run lib/i18n/message-parity.test.ts`
Expected: PASS (all three files renamed the same keys).

- [ ] **Step 4: Add the new `terms` keys — `messages/en.json`**

Replace `subtitle`:
```json
"subtitle": "The terms that govern your use of the SentinelX platform."
```
Add:
```json
"metaUpdated": "Last updated September 2026",
"summary": "The short version: you must be 13 or older, one account per person, and you play fair — real results, backed by proof. Prize money pays to your bank through Paystack after an ID check. SX Coins are platform points with no cash value. Nigerian law applies. This summary is not the legal text — the sections below are.",
"s8Heading": "8. Community Wagering (SX Coins)",
"s8P1": "You may stake SX Coins on the outcome of a match you are not playing in. Wagering is optional and uses SX Coins only.",
"s8List": "<li>Wagering opens once both players are confirmed for a scheduled match and closes 15 minutes before the scheduled start time. For matches scheduled across a full day, it closes 24 hours after that day begins.</li><li>A 5% platform fee is taken from the losing pool. Winnings are paid in SX Coins only.</li><li>Wagers settle automatically from the admin-confirmed match result, and that settlement is final.</li><li>If a match is voided or a result is overturned, every stake is returned in full.</li>",
"s8P2": "Because SX Coins have no monetary value and cannot be exchanged for cash, community wagering is not betting for money."
```
Edit `s7P1` — append to the existing string:
```
 SX Coins may also be staked in community wagering (see section 8), and can be lost if your wager does not win.
```
Edit `s4P3` — wrap the Refund Policy mention in a `<link>`:
```json
"s4P3": "SX Coins may be used to reduce or eliminate entry fees where that option is offered. See the <link>Refund Policy</link> for how cancellations are handled."
```
Edit `s5P2` — append a sentence:
```json
"s5P2": "Match results must be submitted with supporting evidence (screenshot and screen recording). Admin decisions on disputed results are final. Full conduct and match rules are in the <link>Tournament Rules</link>."
```
Edit `s9P1` (Gaming Exchange, the renamed key) — append:
```
 See <link>how escrow works</link> for the step-by-step.
```
Edit `s10P1` (Community Standards, the renamed key) — wrap the existing "Community Rules" phrase:
```
...See our <link>Community Rules</link> for the full standards.
```

- [ ] **Step 5: Add the new `terms` keys — `messages/fr.json`**

```json
"subtitle": "Les conditions qui régissent votre utilisation de la plateforme SentinelX.",
"metaUpdated": "Dernière mise à jour : septembre 2026",
"summary": "En résumé : vous devez avoir au moins 13 ans, un seul compte par personne, et vous jouez loyalement — des résultats réels, appuyés par des preuves. Les gains sont versés sur votre compte bancaire via Paystack après une vérification d’identité. Les SX Coins sont des points de plateforme sans valeur monétaire. Le droit nigérian s’applique. Ce résumé n’est pas le texte juridique — les sections ci-dessous le sont.",
"s8Heading": "8. Paris communautaires (SX Coins)",
"s8P1": "Vous pouvez miser des SX Coins sur l’issue d’un match auquel vous ne participez pas. Le pari est facultatif et utilise uniquement des SX Coins.",
"s8List": "<li>Les paris ouvrent une fois les deux joueurs confirmés pour un match programmé et se ferment 15 minutes avant l’heure de début prévue. Pour les matchs programmés sur une journée entière, ils se ferment 24 heures après le début de cette journée.</li><li>Une commission de plateforme de 5 % est prélevée sur la cagnotte perdante. Les gains sont versés uniquement en SX Coins.</li><li>Les paris sont réglés automatiquement à partir du résultat du match confirmé par l’administrateur, et ce règlement est définitif.</li><li>Si un match est annulé ou qu’un résultat est infirmé, chaque mise est intégralement restituée.</li>",
"s8P2": "Comme les SX Coins n’ont aucune valeur monétaire et ne peuvent pas être échangés contre de l’argent, les paris communautaires ne constituent pas des paris d’argent."
```
- `s7P1` append: ` Les SX Coins peuvent aussi être misés dans les paris communautaires (voir la section 8) et peuvent être perdus si votre pari n’est pas gagnant.`
- `s4P3`: `"Les SX Coins peuvent être utilisés pour réduire ou annuler les frais d’inscription lorsque cette option est proposée. Consultez la <link>Politique de remboursement</link> pour savoir comment les annulations sont traitées."`
- `s5P2`: `"Les résultats de match doivent être soumis avec des preuves à l’appui (capture d’écran et enregistrement d’écran). Les décisions de l’administrateur sur les résultats contestés sont définitives. Le règlement complet de conduite et de match figure dans le <link>Règlement des tournois</link>."`
- `s9P1` append: ` Consultez <link>le fonctionnement de l’escrow</link> pour le détail étape par étape.`
- `s10P1`: `"Vous acceptez de traiter tous les autres membres de la communauté SentinelX avec respect. Les discours de haine, la discrimination, les menaces et le harcèlement ne sont pas tolérés et entraîneront une suspension ou un bannissement permanent. Consultez nos <link>Règles communautaires</link> pour la liste complète des standards."`

- [ ] **Step 6: Add the new `terms` keys — `messages/pcm.json`**

```json
"subtitle": "Di terms wey dey guide how you dey use SentinelX platform.",
"metaUpdated": "Last update: September 2026",
"summary": "Di short version: you must reach 13 years or pass, na one account per person, and you must play fair — real results, with evidence. Prize money dey enter your bank through Paystack after ID check. SX Coins na platform points wey no get cash value. Naija law dey apply. Dis summary no be di legal text — na di sections wey dey below.",
"s8Heading": "8. Community Wagering (SX Coins)",
"s8P1": "You fit stake SX Coins on di outcome of match wey you no dey play. Wagering na optional and na SX Coins only e dey use.",
"s8List": "<li>Wagering dey open once dem confirm di two players for scheduled match, and e dey close 15 minutes before di scheduled start time. For matches wey dem schedule for full day, e dey close 24 hours after dat day start.</li><li>Dem dey take 5% platform fee from di losing pool. Winnings na SX Coins only.</li><li>Wager dey settle automatically from di match result wey admin confirm, and dat settlement na final.</li><li>If dem void match or overturn result, dem go return every stake in full.</li>",
"s8P2": "Because SX Coins no get any cash value and you no fit change am to money, community wagering no be betting for money."
```
- `s7P1` append: ` You fit also stake SX Coins for community wagering (see section 8), and you fit lose am if your wager no win.`
- `s4P3`: `"You fit use SX Coins to reduce or waive entry fee where dem allow am. Check our <link>Refund Policy</link> to see how cancellation dey work."`
- `s5P2`: `"You must submit match result with evidence (screenshot and screen recording). Wetin admin decide for disputed result, na im be final. Di full conduct and match rules dey inside di <link>Tournament Rules</link>."`
- `s9P1` append: ` Check <link>how escrow dey work</link> for di step-by-step.`
- `s10P1`: `"You agree to respect every other member of SentinelX community. Hate speech, discrimination, threat, and harassment no get space here — e go cause suspension or permanent ban. Check our <link>Community Rules</link> to see di full standards."`

- [ ] **Step 7: Rewrite `app/[locale]/(public)/terms/page.tsx`**

```tsx
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { LegalDocShell } from '@/components/static/LegalDocShell'
import { emailTag, whatsappTag, linkTag, listItemTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'terms' })
  return buildMetadata({ title: t('metaTitle'), description: t('metaDescription'), path: '/terms', locale })
}

export default async function TermsPage() {
  const t = await getTranslations('terms')
  return (
    <LegalDocShell
      eyebrow={t('eyebrow')}
      title={t('title')}
      subtitle={t('subtitle')}
      meta={[t('metaUpdated')]}
      summary={t('summary')}
      sections={[
        { id: 'who-we-are', title: t('s1Heading'), body: <><p>{t('s1P1')}</p><p>{t('s1P2')}</p></> },
        { id: 'eligibility', title: t('s2Heading'), body: <><p>{t('s2P1')}</p><p>{t('s2P2')}</p></> },
        { id: 'your-account', title: t('s3Heading'), body: <><p>{t('s3P1')}</p><p>{t.rich('s3P2', emailTag())}</p></> },
        {
          id: 'entry-fees',
          title: t('s4Heading'),
          body: <><p>{t('s4P1')}</p><p>{t('s4P2')}</p><p>{t.rich('s4P3', linkTag('/refund-policy'))}</p></>,
        },
        {
          id: 'fair-play',
          title: t('s5Heading'),
          body: (
            <>
              <p>{t('s5Intro')}</p>
              <ul>{t.rich('s5List', listItemTag)}</ul>
              <p>{t.rich('s5P2', linkTag('/rules'))}</p>
              <p>{t('s5P3')}</p>
            </>
          ),
        },
        { id: 'prizes-withdrawals', title: t('s6Heading'), body: <><p>{t('s6P1')}</p><p>{t('s6P2')}</p></> },
        { id: 'sx-coins', title: t('s7Heading'), body: <p>{t('s7P1')}</p> },
        {
          id: 'community-wagering',
          title: t('s8Heading'),
          body: <><p>{t('s8P1')}</p><ul>{t.rich('s8List', listItemTag)}</ul><p>{t('s8P2')}</p></>,
        },
        { id: 'gaming-exchange', title: t('s9Heading'), body: <p>{t.rich('s9P1', linkTag('/escrow'))}</p> },
        { id: 'community-standards', title: t('s10Heading'), body: <p>{t.rich('s10P1', linkTag('/community-rules'))}</p> },
        { id: 'intellectual-property', title: t('s11Heading'), body: <p>{t('s11P1')}</p> },
        { id: 'liability', title: t('s12Heading'), body: <><p>{t('s12P1')}</p><p>{t('s12P2')}</p></> },
        { id: 'changes', title: t('s13Heading'), body: <p>{t('s13P1')}</p> },
        { id: 'governing-law', title: t('s14Heading'), body: <p>{t('s14P1')}</p> },
        {
          id: 'contact',
          title: t('s15Heading'),
          body: <p>{t.rich('s15P1', { ...emailTag(), ...whatsappTag() })}</p>,
        },
      ]}
    />
  )
}
```

- [ ] **Step 8: Parity + build**

Run: `npx vitest run lib/i18n/message-parity.test.ts && npm run build`
Expected: PASS + build OK.

- [ ] **Step 9: Manual check**

`/terms` desktop + 375px + `/fr/terms`:
- 15 ToC entries, "8. Community Wagering (SX Coins)" between "SX Coins" and "Gaming Exchange"
- header pill "Last updated September 2026"
- cross-links in §4, §5, §7, §9, §10 navigate to the right pages (and keep the `/fr` prefix on `/fr/terms`)
- §9–§15 headings show the new numbers, ToC chip numbers (1–15) match

- [ ] **Step 10: Commit**

```bash
git add app/[locale]/(public)/terms/page.tsx messages/en.json messages/fr.json messages/pcm.json
git commit -m "feat(terms): LegalDocShell + Community Wagering section + cross-links"
```

---

## Task 12: Restyle `/contact`

**Files:**
- Modify: `app/[locale]/(public)/contact/page.tsx`
- Modify: `messages/{en,fr,pcm}.json` — `contact`: `whatsappResponsePill`, `beforeYouWrite`

**Interfaces:** Stays on `StaticPageShell` (no ToC). Keeps every existing `contact.*` key; "Common issues" markup changes from `<p>` pairs to `<dl>`.

- [ ] **Step 1: Add keys — all three catalogues**

`en.json` → `contact`:
```json
"whatsappResponsePill": "Replies within 24h",
"beforeYouWrite": "Many answers are already in the <help>Help Centre</help> — or ask the in-app assistant. Still need us? Reach out below."
```
`fr.json` → `contact`:
```json
"whatsappResponsePill": "Réponse sous 24 h",
"beforeYouWrite": "De nombreuses réponses se trouvent déjà dans le <help>Centre d’aide</help> — ou demandez à l’assistant intégré. Besoin de nous ? Écrivez-nous ci-dessous."
```
`pcm.json` → `contact`:
```json
"whatsappResponsePill": "We dey reply within 24h",
"beforeYouWrite": "Plenty answers dey already for di <help>Help Centre</help> — or ask di in-app assistant. You still need us? Reach out below."
```

- [ ] **Step 2: Rewrite `app/[locale]/(public)/contact/page.tsx`**

```tsx
import type { ReactNode } from 'react'
import { Mail } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { Link } from '@/i18n/navigation'
import { StaticPageShell } from '@/components/static/StaticPageShell'
import { emailTag, listItemTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'contact' })
  return buildMetadata({ title: t('metaTitle'), description: t('metaDescription'), path: '/contact', locale })
}

const WHATSAPP_HREF = 'https://wa.me/2349032395685?text=Hi%20SentinelX%2C%20I%20need%20help%20with...'

const helpTag = {
  help: (chunks: ReactNode) => (
    <Link href="/help" className="font-semibold text-sx-purple-text hover:text-white">
      {chunks}
    </Link>
  ),
}

export default async function ContactPage() {
  const t = await getTranslations('contact')
  const commonIssues: { label: string; body: string }[] = [
    { label: t('forgotPasswordLabel'), body: t('forgotPasswordP') },
    { label: t('paymentIssueLabel'), body: t('paymentIssueP') },
    { label: t('matchDisputeLabel'), body: t('matchDisputeP') },
    { label: t('withdrawalLabel'), body: t('withdrawalP') },
  ]

  return (
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')}>
      <p className="mb-6 text-sm text-sx-gray">{t.rich('beforeYouWrite', helpTag)}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-sx-border bg-sx-surface p-6">
          <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-sx-purple/15 text-sx-purple-text">
            <Mail className="h-4 w-4" />
          </span>
          <p className="text-sm font-bold text-white">{t('emailLabel')}</p>
          <a
            href="mailto:sentinelxesports@gmail.com"
            className="mt-1 block text-sm font-semibold text-sx-purple-text hover:text-white"
          >
            sentinelxesports@gmail.com
          </a>
          <p className="mt-2 text-xs text-sx-gray">{t('emailResponseNote')}</p>
        </div>

        <div className="rounded-xl border border-sx-border bg-sx-surface p-6">
          <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-[#25D366]/15 text-[#25D366]">
            <WhatsAppIcon className="h-4 w-4" />
          </span>
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-white">{t('whatsappLabel')}</p>
            <span className="rounded-full bg-sx-green/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sx-green">
              {t('whatsappResponsePill')}
            </span>
          </div>
          <p className="mt-1 text-sm font-semibold text-white">+234 903 239 5685</p>
          <p className="mt-2 text-xs text-sx-gray">{t('whatsappNote')}</p>
          <a
            href={WHATSAPP_HREF}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-sx-purple px-4 py-2.5 text-xs font-bold text-white hover:bg-sx-purple-light"
          >
            {t('whatsappCta')}
          </a>
        </div>
      </div>

      <div className="prose prose-invert prose-sm sm:prose-base mt-10 max-w-none prose-headings:font-display prose-headings:font-bold prose-headings:text-white prose-h2:mt-8 prose-h2:text-lg prose-p:text-sx-gray prose-li:text-sx-gray prose-strong:text-white">
        <h2>{t('whatToIncludeHeading')}</h2>
        <p>{t('whatToIncludeIntro')}</p>
        <ul>{t.rich('whatToIncludeList', listItemTag)}</ul>
      </div>

      <div className="mt-8 rounded-xl border border-sx-border bg-sx-surface p-6">
        <h2 className="mb-4 font-display text-lg font-bold text-white">{t('commonIssuesHeading')}</h2>
        <dl className="space-y-3">
          {commonIssues.map((issue) => (
            <div key={issue.label}>
              <dt className="text-sm font-bold text-white">{issue.label}</dt>
              <dd className="text-sm text-sx-gray">{issue.body}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/5 p-6">
        <h2 className="mb-2 font-display text-lg font-bold text-white">{t('reportAbuseHeading')}</h2>
        <p className="text-sm text-sx-gray">{t.rich('reportAbuseP1', emailTag())}</p>
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
> `emailTag` in `richTags.tsx` renders `<a href="mailto:…">` with no className — that's unchanged from today, keep it. The `report abuse` callout reuses it exactly as the old page did.

- [ ] **Step 3: Parity + build**

Run: `npx vitest run lib/i18n/message-parity.test.ts && npm run build`
Expected: PASS + build OK.

- [ ] **Step 4: Manual check**

`/contact` desktop + 375px + `/fr/contact`:
- two method cards with icon tiles; WhatsApp card shows the green "Replies within 24h" pill
- "before you write" line links to `/help` (and `/fr/help` on the French page)
- "Common issues" is one bordered card with a `<dl>`
- "Report abuse" is a red-tinted callout

- [ ] **Step 5: Commit**

```bash
git add app/[locale]/(public)/contact/page.tsx messages/en.json messages/fr.json messages/pcm.json
git commit -m "feat(contact): restyle method cards, common-issues list, abuse callout"
```

---

## Task 13: Final verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm run test`
Expected: all green, including `lib/static/toc.test.ts` and `lib/i18n/message-parity.test.ts`. Note the count — if it looks doubled, check `git worktree list` (see the vitest-nested-worktree note) before worrying.

- [ ] **Step 2: Type-check + lint + build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: clean; build output lists every converted route under `/[locale]/…`.

- [ ] **Step 3: Cross-page manual sweep on `npm run dev`**

For each of `/terms /privacy /rules /safety /community-rules /refund-policy /escrow /tournament-guide`:
- desktop: sticky ToC rail, scroll-spy highlights the section in view, anchor jumps clear the header
- 375px: `<details>` ToC, no horizontal page scroll, tap targets fine
- `/contact`: restyled, no ToC
- spot-check one page under `/fr/…` and one under `/pcm/…`: translated headings + translated ToC + translated summary, cross-links keep the locale prefix

- [ ] **Step 4: Grep for leftovers**

Run: `git grep -n "proseClassName" app/\[locale\]/\(public\)`
Expected: only `/contact` (its inline prose block) and no `StaticPageShell` import left in the eight converted pages except where intended. `git grep -n "StaticPageShell" app/\[locale\]/\(public\)` → `/contact`, `/how-it-works`, `/help` only.

- [ ] **Step 5: Final commit (if the sweep produced fixes) and push**

```bash
git add -A
git commit -m "chore(legal-pages): verification-sweep fixes"
git push -u origin feat/legal-policy-pages
```
If the sweep produced no changes, just push.

- [ ] **Step 6: Merge to main**

Per the project workflow ("merge feature branch to main + push origin/main automatically once verified"):
```bash
git checkout main
git merge --no-ff feat/legal-policy-pages -m "Merge feat/legal-policy-pages"
git push origin main
```

---

## Self-Review

**Spec coverage:**
- §4.1 `LegalDocShell` → Task 5 ✓
- §4.2 `TocNav` → Task 4 ✓ (renamed from spec's `TocNav.tsx` — consistent)
- §4.3 `LegalContactCta` → Task 3 ✓
- §4.4 `lib/static/toc.ts` + test → Task 1 ✓
- §5 page conversions → Tasks 6–11 ✓ (all 8 prose pages + contact in Task 12)
- §5.1 anchor-id map → used verbatim in Tasks 6–11 ✓
- §5.2 contact restyle → Task 12 ✓
- §6.1 Terms wagering section → Task 11 steps 4–6 ✓
- §6.2 Terms §7 edit → Task 11 ✓
- §6.3 Terms cross-links → Task 11 (§4/§5/§9/§10) ✓ — note: spec also floated a §5→/rules link "where match rules is mentioned"; realised as the appended sentence in `s5P2`
- §6.4 Privacy `s2PlayList` → Task 10 ✓
- §6.5 Privacy table row → Task 10 (`DATA_USE_KEYS` + `dataUses.wagering`) ✓
- §6.6 last-updated pills → Tasks 10 & 11 ✓ (subtitles reworded, date moved to pill)
- §6.7 plain-English summaries → every page task ✓
- §6.8 Escrow/Termii qualifier → Task 9 (escrow) ✓; Privacy `s4List` already says "Termii (when active)" in all three locales — no edit needed, noted here so it isn't missed
- §6.9 `legalCommon` namespace → Task 2 ✓
- §7 i18n parity → every task runs `message-parity.test.ts`; fr/pcm strings provided inline ✓
- §8 testing → Task 1 (toc.test), Task 13 (full sweep) ✓
- §9 file-change summary → matches the File Structure table ✓
- §10 risks → renumber done bottom-up as one pass with immediate parity check (Task 11 steps 1–3) ✓

**Deviations from spec (intentional):**
- Spec §6.1 tentatively listed keys `s8Heading/s8P1/s8Intro/s8List/s8P2`; this plan uses `s8Heading/s8P1/s8List/s8P2` (no separate `s8Intro` — `s8P1` is the intro line). Simpler, same content.
- Spec §6.6 kept the NDPA clause in the privacy subtitle; this plan moves it to a second pill (`metaCompliance`) and gives the subtitle a plain description, matching the two-pill example in spec §4.1.

**Placeholder scan:** no TBD / "handle edge cases" / "similar to Task N" / bare "write tests" — every page task carries its full sections array and full translation strings.

**Type consistency:** `LegalSection`/`LegalDocShell` props (Task 5) match every call site (Tasks 6–11). `TocEntry` (Task 1) consumed by `TocNav` (Task 4) and `LegalDocShell` (Task 5). `slugifySection`/`buildToc` names consistent. `linkTag` signature unchanged (Task 3) — call sites in Tasks 8/9/10/11 pass `(string)` or `(string, {external:true})` as today.
