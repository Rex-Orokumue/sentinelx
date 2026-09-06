# i18n Static & Legal Pages Translation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate all 13 static/legal public pages (terms, privacy, refund-policy, rules, community-rules, safety, escrow, tournament-guide, tournament-faqs, about, contact, help, how-it-works) into French (`fr`) and Nigerian Pidgin (`pcm`), including their SEO metadata, closing the last major English-only surface on the public site.

**Architecture:** Each page gets its own message-catalog namespace (matching the page name) added to `messages/{en,fr,pcm}.json`. Plain labels/headings become `t('key')` calls. Prose paragraphs containing inline formatting (bold lead-ins, email/WhatsApp links) or list markup (`<li>` items) become `t.rich('key', {...tags})` calls using a new shared tag-renderer helper (`components/static/richTags.tsx`) so every page reuses the same `<strong>`/`<email>`/`<whatsapp>`/`<link>`/`<li>` renderers instead of redefining them. Every page's `generateMetadata()` is also switched from hardcoded English `title`/`description` strings to translated ones, closing a gap discovered during a previous session where `buildMetadata()` only ever localized `alternates.languages` (hreflang), never the visible title/description text.

**Tech Stack:** Next.js 14 App Router (Server Components), next-intl (`getTranslations` from `next-intl/server`), existing `StaticPageShell` / `FaqAccordion` components (unchanged).

**Spec:** `docs/superpowers/specs/2026-08-23-multi-language-support-design.md` (§6 UI Translation Content, §10 SEO). This is the "follow-on page conversion sweep" plan referenced by `docs/superpowers/plans/2026-08-23-multi-language-support-infrastructure.md` line 1033.

## Global Constraints

- Every locale JSON (`messages/en.json`, `messages/fr.json`, `messages/pcm.json`) must always have exactly the same set of nested keys — enforced by `lib/i18n/message-parity.test.ts`. Add the English key first, watch the test fail for `fr`/`pcm`, then add both translations.
- French translations use formal/neutral registers consistent with the existing `fr.json` content (e.g. `"Voir tout"`, `"Rejoindre la communauté WhatsApp"`) — no informal `tu` forms, always `vous`.
- Pidgin translations match the existing light-touch register already in `pcm.json` — most product/technical nouns stay in English (SX Score, SX Coins, Paystack, WhatsApp, bracket, admin, dispute, no-show, KYC, escrow, entry fee, withdrawal, dashboard), only grammar/connective words and general prose shift to Pidgin (dey, na, wey, don, go, abeg, sharp sharp, wetin). This matches how `pcm.json`'s existing footer/nav strings behave (e.g. `"Comot"` for Sign out, but `"Tournaments"` and `"Dashboard"` left as-is).
- **This is a first-draft, working translation, not final signed-off legal copy** — per spec §6, both `fr` and `pcm` content here needs human native-speaker review (a lawyer for `fr` on the Terms/Privacy pages specifically) before being treated as authoritative. Do not represent it as reviewed.
- Every page stays a Server Component (`async function ...Page()`), following the exact pattern already established in `app/[locale]/page.tsx`: `const t = await getTranslations('namespace')` inside the component, no explicit `locale` param needed (next-intl resolves it from request context).
- `generateMetadata()` on every page switches to `const t = await getTranslations({ locale, namespace: 'pageName' })` (the two-arg form, since `generateMetadata` runs outside the request-scoped context helpers rely on) and passes `t('metaTitle')` / `t('metaDescription')` into `buildMetadata()` instead of hardcoded English strings.
- Numbers, proper nouns, and symbols that are not language-dependent (₦500, dates like "August 2026" is NOT this — see below, stat values like "50K+", "∞", years like "2024") are only translated where the surrounding grammar requires it (e.g. "Last updated: August 2026" → month name changes in French) — never invent a fake precision change.
- No test files are added for these components — this codebase has zero `.tsx` component tests (verified: `find . -iname "*.test.tsx"` returns nothing). Verification is `tsc --noEmit`, the `message-parity` vitest test, `npm run build`, and a manual Chrome check per task.

---

## Task 1: Shared rich-text tag helper

**Files:**
- Create: `components/static/richTags.tsx`

**Interfaces:**
- Produces: `strongTag: Record<'strong', (chunks: ReactNode) => ReactNode>`, `listItemTag: Record<'li', (chunks: ReactNode) => ReactNode>`, `emailTag(address?: string)`, `whatsappTag(href?: string)`, `linkTag(href: string, opts?: { external?: boolean })` — all return objects spreadable into `t.rich('key', { ...tag })`.

- [ ] **Step 1: Write the file**

```tsx
import type { ReactNode } from 'react'

// Shared next-intl `t.rich()` tag renderers for the static/legal pages
// (terms, privacy, rules, safety, escrow, tournament-guide, ...). Message
// strings embed literal tags like `<strong>...</strong>` or
// `<email>...</email>`; spread the matching helper(s) below into the
// `t.rich('key', { ...tag })` call so every page renders them the same way
// instead of redefining renderers per file.
//
// Usage:
//   t.rich('s3P2', emailTag())
//   t.rich('s5List', listItemTag)   // wrap the call site in <ul>/<ol>

export const strongTag = {
  strong: (chunks: ReactNode) => <strong>{chunks}</strong>,
}

export const listItemTag = {
  li: (chunks: ReactNode) => <li>{chunks}</li>,
}

export function emailTag(address = 'sentinelxesports@gmail.com') {
  return {
    email: (chunks: ReactNode) => <a href={`mailto:${address}`}>{chunks}</a>,
  }
}

export function whatsappTag(href = 'https://wa.me/2349032395685') {
  return {
    whatsapp: (chunks: ReactNode) => <a href={href}>{chunks}</a>,
  }
}

export function linkTag(href: string, opts: { external?: boolean } = {}) {
  return {
    link: (chunks: ReactNode) =>
      opts.external ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {chunks}
        </a>
      ) : (
        <a href={href}>{chunks}</a>
      ),
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p .`
Expected: no new errors (file is not imported anywhere yet, so this only checks the file's own syntax/types).

- [ ] **Step 3: Commit**

```bash
git add components/static/richTags.tsx
git commit -m "feat(i18n): add shared rich-text tag helper for static pages"
```

---

## Task 2: Terms of Service (`/terms`)

**Files:**
- Modify: `messages/en.json`, `messages/fr.json`, `messages/pcm.json` (add `terms` namespace)
- Modify: `app/[locale]/(public)/terms/page.tsx`
- Test: `lib/i18n/message-parity.test.ts` (existing, no changes — used as the gate)

**Interfaces:**
- Consumes: `emailTag`, `whatsappTag`, `listItemTag` from `components/static/richTags.tsx` (Task 1)

- [ ] **Step 1: Add the `terms` namespace to `messages/en.json`**

Insert this key after `"footer": { ... }` (before the closing `}` of the root object), adding a trailing comma to the `footer` block's closing `}`:

```json
  "terms": {
    "eyebrow": "Legal",
    "title": "Terms of Service",
    "subtitle": "Last updated: August 2026",
    "metaTitle": "Terms of Service",
    "metaDescription": "The terms that govern using the SentinelX Esports platform.",
    "s1Heading": "1. Who We Are",
    "s1P1": "SentinelX Esports is a mobile esports platform operated by Samuel Chinoyerem Akpoke (“we”, “us”, “our”). We are based in Nigeria and our platform is available at sentinelxesports.com.",
    "s1P2": "By creating an account or using any part of SentinelX, you agree to these Terms of Service. If you do not agree, please do not use the platform.",
    "s2Heading": "2. Eligibility",
    "s2P1": "You must be at least 13 years old to create an account. If you are under 18, you confirm that you have permission from a parent or guardian to use the platform. Players under 18 may not withdraw prize money without verifiable parental or guardian consent.",
    "s2P2": "You may only hold one account. Creating multiple accounts to gain an unfair advantage is prohibited and will result in a permanent ban.",
    "s3Heading": "3. Your Account",
    "s3P1": "You are responsible for keeping your login details secure. Do not share your password with anyone. You are responsible for all activity that takes place under your account.",
    "s3P2": "If you believe your account has been compromised, contact us immediately at <email>sentinelxesports@gmail.com</email>.",
    "s4Heading": "4. Tournaments and Entry Fees",
    "s4P1": "Tournament entry fees are set per event and displayed clearly before registration. The current standard fee is ₦500. By registering and completing payment, you confirm your intent to participate.",
    "s4P2": "Entry fees are processed securely by Paystack. We do not store your card details.",
    "s4P3": "SX Coins may be used to reduce or eliminate entry fees where that option is offered. See the Refund Policy for how cancellations are handled.",
    "s5Heading": "5. Match Rules and Fair Play",
    "s5Intro": "All players must compete honestly. The following are prohibited:",
    "s5List": "<li>Submitting false or manipulated match results</li><li>Using external tools, scripts, or exploits to gain an advantage</li><li>Colluding with an opponent to produce a predetermined result</li><li>Threatening, harassing, or abusing opponents</li>",
    "s5P2": "Match results must be submitted with supporting evidence (screenshot and screen recording). Admin decisions on disputed results are final.",
    "s5P3": "A no-show — failing to appear for your scheduled match without notice — results in a forfeit and a penalty to your SX Score.",
    "s6Heading": "6. Prizes and Withdrawals",
    "s6P1": "Prize money is paid to the bank account you link to your player dashboard via Paystack. You must complete identity verification before your first withdrawal.",
    "s6P2": "We aim to process approved withdrawals within 1–5 business days. We are not responsible for delays caused by your bank.",
    "s7Heading": "7. SX Coins",
    "s7P1": "SX Coins are a virtual in-platform currency. They are earned by competing and spending time on the platform. SX Coins have no monetary value and cannot be exchanged for cash. They may be used within the platform for entry fee discounts, community features, and the in-platform store.",
    "s8Heading": "8. Gaming Exchange",
    "s8P1": "The Gaming Exchange (powered by Zolarux escrow) allows players to buy and sell gaming accounts and in-game items. SentinelX provides the platform and escrow infrastructure. We are not party to the transaction between buyer and seller and are not liable for disputes that arise from transactions conducted outside the platform's escrow system.",
    "s9Heading": "9. Community Standards",
    "s9P1": "You agree to treat all other members of the SentinelX community with respect. Hate speech, discrimination, threats, and harassment are not tolerated and will result in suspension or permanent ban. See our Community Rules for the full standards.",
    "s10Heading": "10. Intellectual Property",
    "s10P1": "All SentinelX branding, design, and original content is owned by SentinelX Esports. You may not reproduce, copy, or distribute our content without written permission. Content you post (match screenshots, community posts) remains yours, but you grant us a licence to display it on the platform.",
    "s11Heading": "11. Limitation of Liability",
    "s11P1": "SentinelX Esports is not liable for indirect, incidental, or consequential losses arising from your use of the platform. Our total liability to you for any claim shall not exceed the total entry fees you have paid to us in the 3 months prior to the claim.",
    "s11P2": "We do not guarantee uninterrupted access to the platform. We will make reasonable efforts to restore service promptly in the event of downtime.",
    "s12Heading": "12. Changes to These Terms",
    "s12P1": "We may update these Terms from time to time. We will notify you via the platform or email when significant changes are made. Continuing to use SentinelX after changes are posted means you accept the updated terms.",
    "s13Heading": "13. Governing Law",
    "s13P1": "These Terms are governed by the laws of the Federal Republic of Nigeria. Any disputes shall be subject to the jurisdiction of Nigerian courts.",
    "s14Heading": "14. Contact",
    "s14P1": "Questions about these Terms? Email us at <email>sentinelxesports@gmail.com</email> or message us on WhatsApp: <whatsapp>+234 903 239 5685</whatsapp>."
  }
```

- [ ] **Step 2: Run the parity test — expect FAIL**

Run: `npx vitest run lib/i18n/message-parity.test.ts`
Expected: FAIL — `fr.json key set must match en.json` and `pcm.json key set must match en.json` (missing all `terms.*` keys).

- [ ] **Step 3: Add the French `terms` namespace to `messages/fr.json`**

```json
  "terms": {
    "eyebrow": "Mentions légales",
    "title": "Conditions d'utilisation",
    "subtitle": "Dernière mise à jour : août 2026",
    "metaTitle": "Conditions d'utilisation",
    "metaDescription": "Les conditions qui régissent l'utilisation de la plateforme SentinelX Esports.",
    "s1Heading": "1. Qui nous sommes",
    "s1P1": "SentinelX Esports est une plateforme d'esport mobile exploitée par Samuel Chinoyerem Akpoke (« nous », « notre »). Nous sommes basés au Nigeria et notre plateforme est disponible sur sentinelxesports.com.",
    "s1P2": "En créant un compte ou en utilisant une partie de SentinelX, vous acceptez les présentes Conditions d'utilisation. Si vous n'êtes pas d'accord, veuillez ne pas utiliser la plateforme.",
    "s2Heading": "2. Admissibilité",
    "s2P1": "Vous devez avoir au moins 13 ans pour créer un compte. Si vous avez moins de 18 ans, vous confirmez avoir l'autorisation d'un parent ou tuteur pour utiliser la plateforme. Les joueurs de moins de 18 ans ne peuvent pas retirer leurs gains sans le consentement vérifiable d'un parent ou tuteur.",
    "s2P2": "Vous ne pouvez détenir qu'un seul compte. La création de plusieurs comptes pour obtenir un avantage déloyal est interdite et entraîne un bannissement permanent.",
    "s3Heading": "3. Votre compte",
    "s3P1": "Vous êtes responsable de la sécurité de vos identifiants de connexion. Ne partagez votre mot de passe avec personne. Vous êtes responsable de toute activité effectuée sous votre compte.",
    "s3P2": "Si vous pensez que votre compte a été compromis, contactez-nous immédiatement à <email>sentinelxesports@gmail.com</email>.",
    "s4Heading": "4. Tournois et frais d'inscription",
    "s4P1": "Les frais d'inscription aux tournois sont fixés par événement et affichés clairement avant l'inscription. Le tarif standard actuel est de ₦500. En vous inscrivant et en effectuant le paiement, vous confirmez votre intention de participer.",
    "s4P2": "Les frais d'inscription sont traités en toute sécurité par Paystack. Nous ne conservons pas les données de votre carte.",
    "s4P3": "Les SX Coins peuvent être utilisés pour réduire ou annuler les frais d'inscription lorsque cette option est proposée. Consultez la Politique de remboursement pour savoir comment les annulations sont traitées.",
    "s5Heading": "5. Règles de jeu et fair-play",
    "s5Intro": "Tous les joueurs doivent jouer honnêtement. Les actions suivantes sont interdites :",
    "s5List": "<li>Soumettre des résultats de match faux ou falsifiés</li><li>Utiliser des outils externes, scripts ou exploits pour obtenir un avantage</li><li>S'entendre avec un adversaire pour produire un résultat prédéterminé</li><li>Menacer, harceler ou insulter ses adversaires</li>",
    "s5P2": "Les résultats de match doivent être soumis avec des preuves à l'appui (capture d'écran et enregistrement d'écran). Les décisions de l'administrateur sur les résultats contestés sont définitives.",
    "s5P3": "Une absence non signalée à votre match programmé entraîne un forfait et une pénalité sur votre SX Score.",
    "s6Heading": "6. Gains et retraits",
    "s6P1": "Les gains sont versés sur le compte bancaire que vous liez à votre tableau de bord joueur via Paystack. Vous devez terminer la vérification d'identité avant votre premier retrait.",
    "s6P2": "Nous visons à traiter les retraits approuvés sous 1 à 5 jours ouvrés. Nous ne sommes pas responsables des retards causés par votre banque.",
    "s7Heading": "7. SX Coins",
    "s7P1": "Les SX Coins sont une monnaie virtuelle interne à la plateforme. Ils sont gagnés en jouant et en passant du temps sur la plateforme. Les SX Coins n'ont aucune valeur monétaire et ne peuvent pas être échangés contre de l'argent. Ils peuvent être utilisés sur la plateforme pour des réductions sur les frais d'inscription, des fonctionnalités communautaires et la boutique interne.",
    "s8Heading": "8. Gaming Exchange",
    "s8P1": "Le Gaming Exchange (propulsé par l'escrow Zolarux) permet aux joueurs d'acheter et de vendre des comptes de jeu et des objets in-game. SentinelX fournit la plateforme et l'infrastructure d'escrow. Nous ne sommes pas partie à la transaction entre l'acheteur et le vendeur et ne sommes pas responsables des litiges découlant de transactions effectuées en dehors du système d'escrow de la plateforme.",
    "s9Heading": "9. Standards communautaires",
    "s9P1": "Vous acceptez de traiter tous les autres membres de la communauté SentinelX avec respect. Les discours de haine, la discrimination, les menaces et le harcèlement ne sont pas tolérés et entraîneront une suspension ou un bannissement permanent. Consultez nos Règles communautaires pour la liste complète des standards.",
    "s10Heading": "10. Propriété intellectuelle",
    "s10P1": "Toute l'image de marque, le design et le contenu original de SentinelX appartiennent à SentinelX Esports. Vous ne pouvez pas reproduire, copier ou distribuer notre contenu sans autorisation écrite. Le contenu que vous publiez (captures d'écran de match, publications communautaires) reste le vôtre, mais vous nous accordez une licence pour l'afficher sur la plateforme.",
    "s11Heading": "11. Limitation de responsabilité",
    "s11P1": "SentinelX Esports n'est pas responsable des pertes indirectes, accessoires ou consécutives résultant de votre utilisation de la plateforme. Notre responsabilité totale envers vous pour toute réclamation ne dépassera pas le total des frais d'inscription que vous nous avez versés au cours des 3 mois précédant la réclamation.",
    "s11P2": "Nous ne garantissons pas un accès ininterrompu à la plateforme. Nous ferons des efforts raisonnables pour rétablir le service rapidement en cas d'interruption.",
    "s12Heading": "12. Modifications des présentes conditions",
    "s12P1": "Nous pouvons mettre à jour ces Conditions de temps à autre. Nous vous informerons via la plateforme ou par e-mail en cas de changements importants. Continuer à utiliser SentinelX après la publication des changements signifie que vous acceptez les conditions mises à jour.",
    "s13Heading": "13. Droit applicable",
    "s13P1": "Les présentes Conditions sont régies par les lois de la République fédérale du Nigeria. Tout litige relève de la compétence des tribunaux nigérians.",
    "s14Heading": "14. Contact",
    "s14P1": "Des questions sur ces Conditions ? Écrivez-nous à <email>sentinelxesports@gmail.com</email> ou contactez-nous sur WhatsApp : <whatsapp>+234 903 239 5685</whatsapp>."
  }
```

- [ ] **Step 4: Add the Pidgin `terms` namespace to `messages/pcm.json`**

```json
  "terms": {
    "eyebrow": "Legal",
    "title": "Terms of Service",
    "subtitle": "Last update: August 2026",
    "metaTitle": "Terms of Service",
    "metaDescription": "The terms wey dey guide how you go use SentinelX Esports platform.",
    "s1Heading": "1. Who We Be",
    "s1P1": "SentinelX Esports na mobile esports platform wey Samuel Chinoyerem Akpoke dey run (“we”, “us”, “our”). We dey based for Nigeria and our platform dey available for sentinelxesports.com.",
    "s1P2": "If you create account or use any part of SentinelX, e mean say you don agree to dis Terms of Service. If you no agree, abeg no use di platform.",
    "s2Heading": "2. Wetin You Need Before You Fit Join",
    "s2P1": "You must don reach 13 years before you fit create account. If you no reach 18, you don confam say your parent or guardian give you permission to use di platform. Players wey no reach 18 no fit withdraw prize money without say their parent or guardian confam am well well.",
    "s2P2": "You fit get one account only. If you create plenty accounts to cheat, dem go permanently ban you.",
    "s3Heading": "3. Your Account",
    "s3P1": "Na your work to keep your login details safe. No share your password with anybody. Anything wey happen for your account, na you dey responsible for am.",
    "s3P2": "If you feel say person don enter your account, contact us sharp sharp for <email>sentinelxesports@gmail.com</email>.",
    "s4Heading": "4. Tournaments and Entry Fee",
    "s4P1": "Every tournament get entry fee wey dem go show you clearly before you register. Right now, standard fee na ₦500. If you register and complete payment, e mean say you don confam say you wan play.",
    "s4P2": "Paystack dey process entry fee safely. We no dey keep your card details.",
    "s4P3": "You fit use SX Coins to reduce or waive entry fee where dem allow am. Check our Refund Policy to see how cancellation dey work.",
    "s5Heading": "5. Match Rules and Fair Play",
    "s5Intro": "Every player must play straight. Dis ones no dey allowed:",
    "s5List": "<li>To submit fake or manipulated match result</li><li>To use outside tools, scripts, or exploit to get advantage</li><li>To gang up with your opponent to fix result</li><li>To threaten, harass, or abuse your opponent</li>",
    "s5P2": "You must submit match result with evidence (screenshot and screen recording). Wetin admin decide for disputed result, na im be final.",
    "s5P3": "No-show — wey mean say you no show up for your match without notice — go make you forfeit and lose SX Score.",
    "s6Heading": "6. Prize Money and Withdrawal",
    "s6P1": "Prize money dey enter di bank account wey you link to your player dashboard through Paystack. You must complete identity verification before your first withdrawal.",
    "s6P2": "We dey try process approved withdrawal within 1–5 business days. If your bank delay am, na dem cause am, no be us.",
    "s7Heading": "7. SX Coins",
    "s7P1": "SX Coins na virtual currency wey dey inside di platform. You go earn am as you dey play and spend time for di platform. SX Coins no get any cash value and you no fit change am to money. You fit use am inside di platform for entry fee discount, community features, and di in-platform store.",
    "s8Heading": "8. Gaming Exchange",
    "s8P1": "Gaming Exchange (wey Zolarux escrow dey power) make players fit buy and sell gaming accounts and in-game items. SentinelX dey provide di platform and escrow infrastructure. We no be part of di transaction between buyer and seller and we no dey responsible for any dispute wey come from transaction wey happen outside di platform escrow system.",
    "s9Heading": "9. Community Standards",
    "s9P1": "You agree to respect every other member of SentinelX community. Hate speech, discrimination, threat, and harassment no get space here — e go cause suspension or permanent ban. Check our Community Rules to see di full standards.",
    "s10Heading": "10. Intellectual Property",
    "s10P1": "All SentinelX branding, design, and original content na SentinelX Esports property. You no fit copy or share our content without written permission. Content wey you post (match screenshots, community posts) still remain yours, but you dey give us licence to show am for di platform.",
    "s11Heading": "11. Limitation of Liability",
    "s11P1": "SentinelX Esports no dey liable for indirect, incidental, or consequential loss wey come from how you dey use di platform. Di total wey we fit owe you for any claim no go pass di total entry fee wey you don pay us for di last 3 months before di claim.",
    "s11P2": "We no dey guarantee say platform go dey up 24/7. We go try our best to restore service quick quick if downtime happen.",
    "s12Heading": "12. Changes to Dis Terms",
    "s12P1": "We fit update dis Terms anytime. We go notify you through di platform or email if any major change happen. If you still dey use SentinelX after we post di changes, e mean say you don accept di new terms.",
    "s13Heading": "13. Governing Law",
    "s13P1": "Dis Terms dey follow di law of Federal Republic of Nigeria. Any dispute go dey under Nigerian court jurisdiction.",
    "s14Heading": "14. Contact",
    "s14P1": "You get question about dis Terms? Email us for <email>sentinelxesports@gmail.com</email> or message us for WhatsApp: <whatsapp>+234 903 239 5685</whatsapp>."
  }
```

- [ ] **Step 5: Run the parity test — expect PASS**

Run: `npx vitest run lib/i18n/message-parity.test.ts`
Expected: PASS

- [ ] **Step 6: Rewrite `app/[locale]/(public)/terms/page.tsx`**

Replace the entire file with:

```tsx
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'
import { emailTag, whatsappTag, listItemTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'terms' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/terms',
    locale,
  })
}

export default async function TermsPage() {
  const t = await getTranslations('terms')
  return (
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')}>
      <div className={proseClassName}>
        <h2>{t('s1Heading')}</h2>
        <p>{t('s1P1')}</p>
        <p>{t('s1P2')}</p>

        <h2>{t('s2Heading')}</h2>
        <p>{t('s2P1')}</p>
        <p>{t('s2P2')}</p>

        <h2>{t('s3Heading')}</h2>
        <p>{t('s3P1')}</p>
        <p>{t.rich('s3P2', emailTag())}</p>

        <h2>{t('s4Heading')}</h2>
        <p>{t('s4P1')}</p>
        <p>{t('s4P2')}</p>
        <p>{t('s4P3')}</p>

        <h2>{t('s5Heading')}</h2>
        <p>{t('s5Intro')}</p>
        <ul>{t.rich('s5List', listItemTag)}</ul>
        <p>{t('s5P2')}</p>
        <p>{t('s5P3')}</p>

        <h2>{t('s6Heading')}</h2>
        <p>{t('s6P1')}</p>
        <p>{t('s6P2')}</p>

        <h2>{t('s7Heading')}</h2>
        <p>{t('s7P1')}</p>

        <h2>{t('s8Heading')}</h2>
        <p>{t('s8P1')}</p>

        <h2>{t('s9Heading')}</h2>
        <p>{t('s9P1')}</p>

        <h2>{t('s10Heading')}</h2>
        <p>{t('s10P1')}</p>

        <h2>{t('s11Heading')}</h2>
        <p>{t('s11P1')}</p>
        <p>{t('s11P2')}</p>

        <h2>{t('s12Heading')}</h2>
        <p>{t('s12P1')}</p>

        <h2>{t('s13Heading')}</h2>
        <p>{t('s13P1')}</p>

        <h2>{t('s14Heading')}</h2>
        <p>{t.rich('s14P1', { ...emailTag(), ...whatsappTag() })}</p>
      </div>
    </StaticPageShell>
  )
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 8: Manual verification**

Run `npm run dev`, visit `/terms`, `/fr/terms`, `/pcm/terms` — confirm all 14 sections render translated, the email/WhatsApp links in section 3 and 14 still work, and the bullet list in section 5 renders as an actual `<ul>` with 4 items.

- [ ] **Step 9: Commit**

```bash
git add messages/en.json messages/fr.json messages/pcm.json "app/[locale]/(public)/terms/page.tsx"
git commit -m "feat(i18n): translate Terms of Service page"
```

---

## Task 3: Privacy Policy (`/privacy`)

**Files:**
- Modify: `messages/en.json`, `messages/fr.json`, `messages/pcm.json` (add `privacy` namespace)
- Modify: `app/[locale]/(public)/privacy/page.tsx`

**Interfaces:**
- Consumes: `emailTag`, `linkTag`, `listItemTag`, `strongTag` from `components/static/richTags.tsx` (Task 1)

- [ ] **Step 1: Add the `privacy` namespace to `messages/en.json`**

```json
  "privacy": {
    "eyebrow": "Legal",
    "title": "Privacy Policy",
    "subtitle": "Last updated: August 2026 · Compliant with the Nigeria Data Protection Act 2023 (NDPA)",
    "metaTitle": "Privacy Policy",
    "metaDescription": "How SentinelX Esports collects, uses, and protects your personal data under Nigeria's Data Protection Act 2023.",
    "s1Heading": "1. Who Controls Your Data",
    "s1P1": "SentinelX Esports, operated by Samuel Chinoyerem Akpoke, is the data controller for personal information collected through this platform. Contact: <email>sentinelxesports@gmail.com</email>.",
    "s2Heading": "2. What Data We Collect",
    "s2Account": "When you create an account:",
    "s2AccountList": "<li>Email address</li><li>Username and display name</li><li>Country</li><li>Password (stored as a secure hash — we never see your plain password)</li>",
    "s2Profile": "When you complete your profile:",
    "s2ProfileList": "<li>WhatsApp phone number (optional — used only for match notifications if you opt in)</li><li>Profile photo</li><li>Bio</li>",
    "s2Tournament": "When you register for a tournament:",
    "s2TournamentList": "<li>Payment information (processed by Paystack — we receive a transaction reference, not your card details)</li><li>Bank account details (collected by Paystack for prize withdrawals — stored by Paystack, not by us)</li>",
    "s2Play": "When you play:",
    "s2PlayList": "<li>Match history, scores, and results</li><li>SX Score and rankings</li><li>Achievements and SX Coins balance</li><li>Match screenshots and recordings you submit for result verification</li>",
    "s2Auto": "Automatically:",
    "s2AutoList": "<li>Log data (IP address, browser type, pages visited) — used for security and to fix bugs</li><li>Session cookies (required for login to work)</li>",
    "s3Heading": "3. Why We Use Your Data",
    "tableHeaderPurpose": "Purpose",
    "tableHeaderBasis": "Legal basis",
    "dataUses": {
      "account": { "purpose": "Running your account and the platform", "basis": "Contract performance" },
      "payment": { "purpose": "Processing tournament entry payments", "basis": "Contract performance" },
      "prizes": { "purpose": "Paying out prizes", "basis": "Contract performance" },
      "whatsapp": { "purpose": "Sending match notifications (WhatsApp)", "basis": "Consent — you opt in by adding your phone number" },
      "improving": { "purpose": "Improving the platform", "basis": "Legitimate interest" },
      "fraud": { "purpose": "Preventing fraud and cheating", "basis": "Legitimate interest" },
      "compliance": { "purpose": "Complying with Nigerian law", "basis": "Legal obligation" }
    },
    "s4Heading": "4. Who We Share Your Data With",
    "s4Intro": "We share data only where necessary:",
    "s4List": "<li><strong>Paystack</strong> — payment processing and bank account verification for prize payouts</li><li><strong>Supabase</strong> — database and authentication infrastructure (servers may be located outside Nigeria; Supabase Inc. operates under appropriate data transfer safeguards)</li><li><strong>Vercel</strong> — web hosting</li><li><strong>Termii</strong> (when active) — WhatsApp notification delivery, only for players who have added a phone number</li><li><strong>Firebase / Google</strong> — push notification delivery (FCM)</li>",
    "s4P2": "We do not sell your personal data. We do not share it with advertisers.",
    "s4P3": "We may disclose data to Nigerian law enforcement or regulatory bodies if legally required to do so.",
    "s5Heading": "5. Your Public Profile",
    "s5P1": "Your username, display name, country, profile photo, SX Score, match history, and achievements are visible to all visitors of the platform. This is necessary for the competitive, community nature of the platform. You can update your display name and photo at any time in Settings.",
    "s6Heading": "6. Your Rights Under the NDPA 2023",
    "s6Intro": "As a data subject, you have the right to:",
    "s6List": "<li><strong>Access</strong> — request a copy of the personal data we hold about you</li><li><strong>Rectification</strong> — ask us to correct inaccurate data</li><li><strong>Erasure</strong> — ask us to delete your account and personal data</li><li><strong>Restriction</strong> — ask us to limit how we process your data</li><li><strong>Portability</strong> — receive your data in a structured, machine-readable format</li><li><strong>Objection</strong> — object to processing based on legitimate interest</li><li><strong>Withdraw consent</strong> — remove your WhatsApp number or turn off notifications at any time in Settings</li>",
    "s6P2": "To exercise any of these rights, email <email>sentinelxesports@gmail.com</email>. We will respond within 30 days.",
    "s6P3": "You also have the right to lodge a complaint with the Nigeria Data Protection Commission (NDPC) at <link>ndpc.gov.ng</link>.",
    "s7Heading": "7. Data Retention",
    "s7P1": "We keep your account data for as long as your account is active. If you delete your account, we will erase your personal data within 30 days, except where we are required by law to retain it (for example, payment records may be retained for up to 7 years for tax and financial compliance).",
    "s7P2": "Match records and results may be retained in anonymised form for platform statistics.",
    "s8Heading": "8. Security",
    "s8P1": "We use industry-standard security measures including encrypted connections (HTTPS), hashed passwords, and role-based access controls. No system is perfectly secure — if you believe your account has been compromised, contact us immediately.",
    "s9Heading": "9. Children",
    "s9P1": "Players under 18 may use the platform with parental consent. We do not knowingly collect data from children under 13. If we become aware that a child under 13 has created an account, we will delete it.",
    "s10Heading": "10. Changes to This Policy",
    "s10P1": "We will notify you via the platform or email if we make significant changes to this policy. The latest version is always available at sentinelxesports.com/privacy."
  }
```

- [ ] **Step 2: Run the parity test — expect FAIL**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect FAIL (missing `privacy.*` in `fr`/`pcm`).

- [ ] **Step 3: Add the French `privacy` namespace to `messages/fr.json`**

```json
  "privacy": {
    "eyebrow": "Mentions légales",
    "title": "Politique de confidentialité",
    "subtitle": "Dernière mise à jour : août 2026 · Conforme à la loi nigériane sur la protection des données de 2023 (NDPA)",
    "metaTitle": "Politique de confidentialité",
    "metaDescription": "Comment SentinelX Esports collecte, utilise et protège vos données personnelles conformément à la loi nigériane sur la protection des données de 2023.",
    "s1Heading": "1. Qui contrôle vos données",
    "s1P1": "SentinelX Esports, exploité par Samuel Chinoyerem Akpoke, est le responsable du traitement des informations personnelles collectées via cette plateforme. Contact : <email>sentinelxesports@gmail.com</email>.",
    "s2Heading": "2. Quelles données nous collectons",
    "s2Account": "Lorsque vous créez un compte :",
    "s2AccountList": "<li>Adresse e-mail</li><li>Nom d'utilisateur et nom d'affichage</li><li>Pays</li><li>Mot de passe (stocké sous forme de hachage sécurisé — nous ne voyons jamais votre mot de passe en clair)</li>",
    "s2Profile": "Lorsque vous complétez votre profil :",
    "s2ProfileList": "<li>Numéro de téléphone WhatsApp (facultatif — utilisé uniquement pour les notifications de match si vous y consentez)</li><li>Photo de profil</li><li>Biographie</li>",
    "s2Tournament": "Lorsque vous vous inscrivez à un tournoi :",
    "s2TournamentList": "<li>Informations de paiement (traitées par Paystack — nous recevons une référence de transaction, pas les détails de votre carte)</li><li>Coordonnées bancaires (collectées par Paystack pour les retraits de gains — stockées par Paystack, pas par nous)</li>",
    "s2Play": "Lorsque vous jouez :",
    "s2PlayList": "<li>Historique des matchs, scores et résultats</li><li>SX Score et classements</li><li>Succès et solde de SX Coins</li><li>Captures d'écran et enregistrements de match que vous soumettez pour la vérification des résultats</li>",
    "s2Auto": "Automatiquement :",
    "s2AutoList": "<li>Données de journal (adresse IP, type de navigateur, pages visitées) — utilisées pour la sécurité et la correction de bugs</li><li>Cookies de session (nécessaires au fonctionnement de la connexion)</li>",
    "s3Heading": "3. Pourquoi nous utilisons vos données",
    "tableHeaderPurpose": "Finalité",
    "tableHeaderBasis": "Base légale",
    "dataUses": {
      "account": { "purpose": "Gestion de votre compte et de la plateforme", "basis": "Exécution du contrat" },
      "payment": { "purpose": "Traitement des paiements d'inscription aux tournois", "basis": "Exécution du contrat" },
      "prizes": { "purpose": "Versement des gains", "basis": "Exécution du contrat" },
      "whatsapp": { "purpose": "Envoi de notifications de match (WhatsApp)", "basis": "Consentement — vous y adhérez en ajoutant votre numéro de téléphone" },
      "improving": { "purpose": "Amélioration de la plateforme", "basis": "Intérêt légitime" },
      "fraud": { "purpose": "Prévention de la fraude et de la triche", "basis": "Intérêt légitime" },
      "compliance": { "purpose": "Conformité avec la loi nigériane", "basis": "Obligation légale" }
    },
    "s4Heading": "4. Avec qui nous partageons vos données",
    "s4Intro": "Nous ne partageons des données que lorsque cela est nécessaire :",
    "s4List": "<li><strong>Paystack</strong> — traitement des paiements et vérification des comptes bancaires pour le versement des gains</li><li><strong>Supabase</strong> — infrastructure de base de données et d'authentification (les serveurs peuvent être situés hors du Nigeria ; Supabase Inc. applique des garanties appropriées pour le transfert de données)</li><li><strong>Vercel</strong> — hébergement web</li><li><strong>Termii</strong> (lorsqu'actif) — envoi des notifications WhatsApp, uniquement pour les joueurs ayant ajouté un numéro de téléphone</li><li><strong>Firebase / Google</strong> — envoi des notifications push (FCM)</li>",
    "s4P2": "Nous ne vendons pas vos données personnelles. Nous ne les partageons pas avec des annonceurs.",
    "s4P3": "Nous pouvons divulguer des données aux forces de l'ordre ou aux organismes de régulation nigérians si la loi l'exige.",
    "s5Heading": "5. Votre profil public",
    "s5P1": "Votre nom d'utilisateur, nom d'affichage, pays, photo de profil, SX Score, historique de match et succès sont visibles par tous les visiteurs de la plateforme. Cela est nécessaire à la nature compétitive et communautaire de la plateforme. Vous pouvez modifier votre nom d'affichage et votre photo à tout moment dans les Paramètres.",
    "s6Heading": "6. Vos droits selon la NDPA 2023",
    "s6Intro": "En tant que personne concernée, vous avez le droit de :",
    "s6List": "<li><strong>Accès</strong> — demander une copie des données personnelles que nous détenons sur vous</li><li><strong>Rectification</strong> — nous demander de corriger des données inexactes</li><li><strong>Effacement</strong> — nous demander de supprimer votre compte et vos données personnelles</li><li><strong>Limitation</strong> — nous demander de limiter le traitement de vos données</li><li><strong>Portabilité</strong> — recevoir vos données dans un format structuré et lisible par machine</li><li><strong>Opposition</strong> — vous opposer à un traitement fondé sur l'intérêt légitime</li><li><strong>Retrait du consentement</strong> — supprimer votre numéro WhatsApp ou désactiver les notifications à tout moment dans les Paramètres</li>",
    "s6P2": "Pour exercer l'un de ces droits, écrivez à <email>sentinelxesports@gmail.com</email>. Nous répondrons sous 30 jours.",
    "s6P3": "Vous avez également le droit de déposer une plainte auprès de la Commission nigériane de protection des données (NDPC) sur <link>ndpc.gov.ng</link>.",
    "s7Heading": "7. Conservation des données",
    "s7P1": "Nous conservons les données de votre compte tant que votre compte est actif. Si vous supprimez votre compte, nous effacerons vos données personnelles sous 30 jours, sauf lorsque la loi nous oblige à les conserver (par exemple, les registres de paiement peuvent être conservés jusqu'à 7 ans pour la conformité fiscale et financière).",
    "s7P2": "Les résultats et historiques de match peuvent être conservés sous forme anonymisée à des fins statistiques.",
    "s8Heading": "8. Sécurité",
    "s8P1": "Nous utilisons des mesures de sécurité conformes aux normes du secteur, notamment des connexions chiffrées (HTTPS), des mots de passe hachés et des contrôles d'accès basés sur les rôles. Aucun système n'est parfaitement sécurisé — si vous pensez que votre compte a été compromis, contactez-nous immédiatement.",
    "s9Heading": "9. Enfants",
    "s9P1": "Les joueurs de moins de 18 ans peuvent utiliser la plateforme avec le consentement parental. Nous ne collectons pas sciemment de données auprès d'enfants de moins de 13 ans. Si nous apprenons qu'un enfant de moins de 13 ans a créé un compte, nous le supprimerons.",
    "s10Heading": "10. Modifications de cette politique",
    "s10P1": "Nous vous informerons via la plateforme ou par e-mail en cas de modification importante de cette politique. La dernière version est toujours disponible sur sentinelxesports.com/privacy."
  }
```

- [ ] **Step 4: Add the Pidgin `privacy` namespace to `messages/pcm.json`**

```json
  "privacy": {
    "eyebrow": "Legal",
    "title": "Privacy Policy",
    "subtitle": "Last update: August 2026 · E dey follow Nigeria Data Protection Act 2023 (NDPA)",
    "metaTitle": "Privacy Policy",
    "metaDescription": "How SentinelX Esports dey collect, use, and protect your personal data under Nigeria Data Protection Act 2023.",
    "s1Heading": "1. Who Dey Control Your Data",
    "s1P1": "SentinelX Esports, wey Samuel Chinoyerem Akpoke dey run, na di data controller for personal information wey dis platform dey collect. Contact: <email>sentinelxesports@gmail.com</email>.",
    "s2Heading": "2. Wetin Data We Dey Collect",
    "s2Account": "Wen you create account:",
    "s2AccountList": "<li>Email address</li><li>Username and display name</li><li>Country</li><li>Password (we dey store am as secure hash — we never see your real password)</li>",
    "s2Profile": "Wen you complete your profile:",
    "s2ProfileList": "<li>WhatsApp phone number (optional — we dey use am only for match notification if you opt in)</li><li>Profile photo</li><li>Bio</li>",
    "s2Tournament": "Wen you register for tournament:",
    "s2TournamentList": "<li>Payment information (Paystack dey process am — we dey receive transaction reference, no be your card details)</li><li>Bank account details (Paystack dey collect am for prize withdrawal — Paystack dey store am, no be us)</li>",
    "s2Play": "Wen you dey play:",
    "s2PlayList": "<li>Match history, score, and result</li><li>SX Score and ranking</li><li>Achievement and SX Coins balance</li><li>Match screenshot and recording wey you submit for result verification</li>",
    "s2Auto": "Automatically:",
    "s2AutoList": "<li>Log data (IP address, browser type, pages wey you visit) — we dey use am for security and to fix bugs</li><li>Session cookies (na im make login work)</li>",
    "s3Heading": "3. Why We Dey Use Your Data",
    "tableHeaderPurpose": "Purpose",
    "tableHeaderBasis": "Legal Basis",
    "dataUses": {
      "account": { "purpose": "To run your account and di platform", "basis": "Contract performance" },
      "payment": { "purpose": "To process tournament entry payment", "basis": "Contract performance" },
      "prizes": { "purpose": "To pay out prize", "basis": "Contract performance" },
      "whatsapp": { "purpose": "To send match notification (WhatsApp)", "basis": "Consent — you opt in wen you add your phone number" },
      "improving": { "purpose": "To improve di platform", "basis": "Legitimate interest" },
      "fraud": { "purpose": "To prevent fraud and cheating", "basis": "Legitimate interest" },
      "compliance": { "purpose": "To comply with Nigerian law", "basis": "Legal obligation" }
    },
    "s4Heading": "4. Who We Dey Share Your Data With",
    "s4Intro": "We only dey share data where e necessary:",
    "s4List": "<li><strong>Paystack</strong> — payment processing and bank account verification for prize payout</li><li><strong>Supabase</strong> — database and authentication infrastructure (servers fit dey outside Nigeria; Supabase Inc. dey follow correct data transfer safeguard)</li><li><strong>Vercel</strong> — web hosting</li><li><strong>Termii</strong> (wen e dey active) — WhatsApp notification delivery, only for players wey add phone number</li><li><strong>Firebase / Google</strong> — push notification delivery (FCM)</li>",
    "s4P2": "We no dey sell your personal data. We no dey share am with advertisers.",
    "s4P3": "We fit disclose data to Nigerian law enforcement or regulatory bodies if law require am.",
    "s5Heading": "5. Your Public Profile",
    "s5P1": "Your username, display name, country, profile photo, SX Score, match history, and achievement dey visible to everybody wey visit di platform. Dis one necessary because of how di platform competitive and community nature be. You fit update your display name and photo anytime for Settings.",
    "s6Heading": "6. Your Rights Under NDPA 2023",
    "s6Intro": "As data subject, you get right to:",
    "s6List": "<li><strong>Access</strong> — ask for copy of di personal data wey we hold about you</li><li><strong>Rectification</strong> — ask us to correct wrong data</li><li><strong>Erasure</strong> — ask us to delete your account and personal data</li><li><strong>Restriction</strong> — ask us to limit how we dey process your data</li><li><strong>Portability</strong> — collect your data for structured, machine-readable format</li><li><strong>Objection</strong> — object to processing wey dey based on legitimate interest</li><li><strong>Withdraw consent</strong> — remove your WhatsApp number or turn off notification anytime for Settings</li>",
    "s6P2": "To use any of dis rights, email <email>sentinelxesports@gmail.com</email>. We go respond within 30 days.",
    "s6P3": "You still get right to file complaint with Nigeria Data Protection Commission (NDPC) for <link>ndpc.gov.ng</link>.",
    "s7Heading": "7. Data Retention",
    "s7P1": "We dey keep your account data as long as your account still active. If you delete your account, we go erase your personal data within 30 days, except law force us to keep am (example, payment records fit stay till 7 years for tax and financial compliance).",
    "s7P2": "Match records and results fit remain for anonymised form for platform statistics.",
    "s8Heading": "8. Security",
    "s8P1": "We dey use industry-standard security measures like encrypted connection (HTTPS), hashed password, and role-based access control. No system dey perfectly secure — if you feel say person don enter your account, contact us sharp sharp.",
    "s9Heading": "9. Children",
    "s9P1": "Players wey no reach 18 fit use di platform if their parent consent. We no dey knowingly collect data from children wey no reach 13. If we notice say child wey no reach 13 create account, we go delete am.",
    "s10Heading": "10. Changes to Dis Policy",
    "s10P1": "We go notify you through di platform or email if we make any major change to dis policy. Di latest version dey always available for sentinelxesports.com/privacy."
  }
```

- [ ] **Step 5: Run the parity test — expect PASS**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect PASS.

- [ ] **Step 6: Rewrite `app/[locale]/(public)/privacy/page.tsx`**

```tsx
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'
import { emailTag, linkTag, listItemTag, strongTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'privacy' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/privacy',
    locale,
  })
}

const DATA_USE_KEYS = ['account', 'payment', 'prizes', 'whatsapp', 'improving', 'fraud', 'compliance'] as const

export default async function PrivacyPage() {
  const t = await getTranslations('privacy')
  const dataUses = DATA_USE_KEYS.map((key) => ({
    purpose: t(`dataUses.${key}.purpose`),
    basis: t(`dataUses.${key}.basis`),
  }))

  return (
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')}>
      <div className={proseClassName}>
        <h2>{t('s1Heading')}</h2>
        <p>{t.rich('s1P1', emailTag())}</p>

        <h2>{t('s2Heading')}</h2>
        <p>
          <strong>{t('s2Account')}</strong>
        </p>
        <ul>{t.rich('s2AccountList', listItemTag)}</ul>
        <p>
          <strong>{t('s2Profile')}</strong>
        </p>
        <ul>{t.rich('s2ProfileList', listItemTag)}</ul>
        <p>
          <strong>{t('s2Tournament')}</strong>
        </p>
        <ul>{t.rich('s2TournamentList', listItemTag)}</ul>
        <p>
          <strong>{t('s2Play')}</strong>
        </p>
        <ul>{t.rich('s2PlayList', listItemTag)}</ul>
        <p>
          <strong>{t('s2Auto')}</strong>
        </p>
        <ul>{t.rich('s2AutoList', listItemTag)}</ul>
      </div>

      <h2 className="mt-10 font-display text-xl font-bold text-white">{t('s3Heading')}</h2>
      <div className="not-prose my-4 overflow-x-auto rounded-lg border border-sx-border">
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

      <div className={proseClassName}>
        <h2>{t('s4Heading')}</h2>
        <p>{t('s4Intro')}</p>
        <ul>{t.rich('s4List', { ...listItemTag, ...strongTag })}</ul>
        <p>{t('s4P2')}</p>
        <p>{t('s4P3')}</p>

        <h2>{t('s5Heading')}</h2>
        <p>{t('s5P1')}</p>

        <h2>{t('s6Heading')}</h2>
        <p>{t('s6Intro')}</p>
        <ul>{t.rich('s6List', { ...listItemTag, ...strongTag })}</ul>
        <p>{t.rich('s6P2', emailTag())}</p>
        <p>{t.rich('s6P3', linkTag('https://ndpc.gov.ng', { external: true }))}</p>

        <h2>{t('s7Heading')}</h2>
        <p>{t('s7P1')}</p>
        <p>{t('s7P2')}</p>

        <h2>{t('s8Heading')}</h2>
        <p>{t('s8P1')}</p>

        <h2>{t('s9Heading')}</h2>
        <p>{t('s9P1')}</p>

        <h2>{t('s10Heading')}</h2>
        <p>{t('s10P1')}</p>
      </div>
    </StaticPageShell>
  )
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p .` — expect no errors.

- [ ] **Step 8: Manual verification**

Run `npm run dev`, visit `/privacy`, `/fr/privacy`, `/pcm/privacy` — confirm all 10 sections and the data-use table render translated, and the NDPC link opens in a new tab.

- [ ] **Step 9: Commit**

```bash
git add messages/en.json messages/fr.json messages/pcm.json "app/[locale]/(public)/privacy/page.tsx"
git commit -m "feat(i18n): translate Privacy Policy page"
```

---

## Task 4: Refund Policy (`/refund-policy`)

**Files:**
- Modify: `messages/en.json`, `messages/fr.json`, `messages/pcm.json` (add `refundPolicy` namespace)
- Modify: `app/[locale]/(public)/refund-policy/page.tsx`

**Interfaces:**
- Consumes: `emailTag`, `listItemTag`, `strongTag` from `components/static/richTags.tsx` (Task 1)

- [ ] **Step 1: Add the `refundPolicy` namespace to `messages/en.json`**

```json
  "refundPolicy": {
    "eyebrow": "Legal",
    "title": "Refund Policy",
    "subtitle": "Last updated: August 2026",
    "metaTitle": "Refund Policy",
    "metaDescription": "When tournament entry fees, coin discounts, and prize money are and are not refundable.",
    "s1Heading": "Tournament Entry Fees (₦500)",
    "s1P1": "Entry fees are generally non-refundable once your registration is confirmed and the tournament has started.",
    "s1RefundIntro": "You are entitled to a full refund if:",
    "s1RefundList": "<li>The tournament is cancelled by SentinelX before it begins</li><li>Your registration is rejected by admin before the bracket is published</li><li>A technical error on our platform prevents you from participating</li>",
    "s1NoRefundIntro": "No refund is issued if:",
    "s1NoRefundList": "<li>You no-show for your scheduled match</li><li>You are disqualified for a rule violation after the tournament begins</li><li>You change your mind after the bracket is published</li>",
    "s1P2": "Refunds are processed via the original payment method and typically take 3–7 business days to appear.",
    "s2Heading": "Entry Fee Discounts Using SX Coins",
    "s2Intro": "If you used SX Coins to reduce or waive your entry fee:",
    "s2List": "<li>The coin portion is refunded as coins (not naira) in the event of a qualifying cancellation</li><li>Coins are credited back to your balance immediately upon refund</li>",
    "s3Heading": "Prize Money",
    "s3P1": "Prize money is credited to your linked bank account after admin approval. Once approved, payouts cannot be reversed. If you believe a prize was incorrectly calculated, contact us within 7 days of the result being confirmed.",
    "s4Heading": "SX Coins",
    "s4P1": "SX Coins are a virtual currency earned through platform activity. They have no cash value and are non-refundable. If your account is closed for a serious rule violation, coins are forfeited.",
    "s5Heading": "How to Request a Refund",
    "s5P1": "Email <email>sentinelxesports@gmail.com</email> with your username, the tournament name, and the reason for your request. We will respond within 3 business days."
  }
```

- [ ] **Step 2: Run the parity test — expect FAIL**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect FAIL.

- [ ] **Step 3: Add the French `refundPolicy` namespace to `messages/fr.json`**

```json
  "refundPolicy": {
    "eyebrow": "Mentions légales",
    "title": "Politique de remboursement",
    "subtitle": "Dernière mise à jour : août 2026",
    "metaTitle": "Politique de remboursement",
    "metaDescription": "Quand les frais d'inscription aux tournois, les réductions en coins et les gains sont ou ne sont pas remboursables.",
    "s1Heading": "Frais d'inscription aux tournois (₦500)",
    "s1P1": "Les frais d'inscription ne sont généralement pas remboursables une fois votre inscription confirmée et le tournoi commencé.",
    "s1RefundIntro": "Vous avez droit à un remboursement intégral si :",
    "s1RefundList": "<li>Le tournoi est annulé par SentinelX avant son début</li><li>Votre inscription est rejetée par l'administrateur avant la publication du tableau</li><li>Une erreur technique sur notre plateforme vous empêche de participer</li>",
    "s1NoRefundIntro": "Aucun remboursement n'est effectué si :",
    "s1NoRefundList": "<li>Vous ne vous présentez pas à votre match programmé</li><li>Vous êtes disqualifié pour infraction au règlement après le début du tournoi</li><li>Vous changez d'avis après la publication du tableau</li>",
    "s1P2": "Les remboursements sont traités via le mode de paiement d'origine et prennent généralement 3 à 7 jours ouvrés pour apparaître.",
    "s2Heading": "Réductions de frais d'inscription avec les SX Coins",
    "s2Intro": "Si vous avez utilisé des SX Coins pour réduire ou annuler vos frais d'inscription :",
    "s2List": "<li>La partie payée en coins est remboursée en coins (pas en naira) en cas d'annulation éligible</li><li>Les coins sont recrédités sur votre solde immédiatement après le remboursement</li>",
    "s3Heading": "Gains",
    "s3P1": "Les gains sont crédités sur votre compte bancaire lié après approbation de l'administrateur. Une fois approuvé, un versement ne peut pas être annulé. Si vous pensez qu'un gain a été mal calculé, contactez-nous dans les 7 jours suivant la confirmation du résultat.",
    "s4Heading": "SX Coins",
    "s4P1": "Les SX Coins sont une monnaie virtuelle gagnée grâce à l'activité sur la plateforme. Ils n'ont aucune valeur monétaire et ne sont pas remboursables. Si votre compte est fermé pour une infraction grave au règlement, les coins sont perdus.",
    "s5Heading": "Comment demander un remboursement",
    "s5P1": "Écrivez à <email>sentinelxesports@gmail.com</email> avec votre nom d'utilisateur, le nom du tournoi et la raison de votre demande. Nous répondrons sous 3 jours ouvrés."
  }
```

- [ ] **Step 4: Add the Pidgin `refundPolicy` namespace to `messages/pcm.json`**

```json
  "refundPolicy": {
    "eyebrow": "Legal",
    "title": "Refund Policy",
    "subtitle": "Last update: August 2026",
    "metaTitle": "Refund Policy",
    "metaDescription": "Wen tournament entry fee, coin discount, and prize money fit refund and wen dem no fit refund.",
    "s1Heading": "Tournament Entry Fee (₦500)",
    "s1P1": "Entry fee no dey refundable once dem confam your registration and tournament don start.",
    "s1RefundIntro": "You go get full refund if:",
    "s1RefundList": "<li>SentinelX cancel di tournament before e start</li><li>Admin reject your registration before dem publish di bracket</li><li>Technical error for our platform stop you from playing</li>",
    "s1NoRefundIntro": "You no go get refund if:",
    "s1NoRefundList": "<li>You no-show for your scheduled match</li><li>Dem disqualify you for rule violation after tournament don start</li><li>You change your mind after dem publish di bracket</li>",
    "s1P2": "Refund dey process through di original payment method and e dey normally take 3–7 business days to show.",
    "s2Heading": "Entry Fee Discount Wey Use SX Coins",
    "s2Intro": "If you use SX Coins to reduce or waive your entry fee:",
    "s2List": "<li>Di coin portion go refund as coins (no be naira) if qualifying cancellation happen</li><li>Coins go enter back your balance immediately after refund</li>",
    "s3Heading": "Prize Money",
    "s3P1": "Prize money dey enter your linked bank account after admin approve am. Once dem approve am, payout no fit reverse. If you feel say dem calculate prize wrong, contact us within 7 days after dem confam di result.",
    "s4Heading": "SX Coins",
    "s4P1": "SX Coins na virtual currency wey you dey earn through platform activity. Dem no get cash value and dem no dey refundable. If dem close your account because of serious rule violation, you go lose your coins.",
    "s5Heading": "How to Request Refund",
    "s5P1": "Email <email>sentinelxesports@gmail.com</email> with your username, tournament name, and di reason for your request. We go respond within 3 business days."
  }
```

- [ ] **Step 5: Run the parity test — expect PASS**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect PASS.

- [ ] **Step 6: Rewrite `app/[locale]/(public)/refund-policy/page.tsx`**

```tsx
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'
import { emailTag, listItemTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'refundPolicy' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/refund-policy',
    locale,
  })
}

export default async function RefundPolicyPage() {
  const t = await getTranslations('refundPolicy')
  return (
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')}>
      <div className={proseClassName}>
        <h2>{t('s1Heading')}</h2>
        <p>{t('s1P1')}</p>
        <p>
          <strong>{t('s1RefundIntro')}</strong>
        </p>
        <ul>{t.rich('s1RefundList', listItemTag)}</ul>
        <p>
          <strong>{t('s1NoRefundIntro')}</strong>
        </p>
        <ul>{t.rich('s1NoRefundList', listItemTag)}</ul>
        <p>{t('s1P2')}</p>

        <h2>{t('s2Heading')}</h2>
        <p>{t('s2Intro')}</p>
        <ul>{t.rich('s2List', listItemTag)}</ul>

        <h2>{t('s3Heading')}</h2>
        <p>{t('s3P1')}</p>

        <h2>{t('s4Heading')}</h2>
        <p>{t('s4P1')}</p>

        <h2>{t('s5Heading')}</h2>
        <p>{t.rich('s5P1', emailTag())}</p>
      </div>
    </StaticPageShell>
  )
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p .` — expect no errors.

- [ ] **Step 8: Manual verification**

Run `npm run dev`, visit `/refund-policy`, `/fr/refund-policy`, `/pcm/refund-policy` — confirm all 5 sections render translated with both nested lists in section 1.

- [ ] **Step 9: Commit**

```bash
git add messages/en.json messages/fr.json messages/pcm.json "app/[locale]/(public)/refund-policy/page.tsx"
git commit -m "feat(i18n): translate Refund Policy page"
```

---

## Task 5: Tournament Rules (`/rules`)

**Files:**
- Modify: `messages/en.json`, `messages/fr.json`, `messages/pcm.json` (add `rules` namespace)
- Modify: `app/[locale]/(public)/rules/page.tsx`

**Interfaces:**
- Consumes: `listItemTag` from `components/static/richTags.tsx` (Task 1)

- [ ] **Step 1: Add the `rules` namespace to `messages/en.json`**

```json
  "rules": {
    "eyebrow": "Support",
    "title": "Tournament Rules",
    "metaTitle": "Tournament Rules",
    "metaDescription": "Eligibility, match, result-submission, dispute, and conduct rules that apply to every SentinelX tournament.",
    "eligibilityHeading": "Eligibility",
    "eligibilityList": "<li>You must have a registered and verified SentinelX account</li><li>You must pay the entry fee (₦500 or reduced with SX Coins) before the registration deadline</li><li>Players serving an active suspension are not eligible to enter</li>",
    "beforeHeading": "Before the Tournament",
    "beforeList": "<li>Registration closes before the bracket is generated — you cannot register after the deadline</li><li>Check your fixture (your scheduled match) on your Player Dashboard after the bracket is published</li><li>Be online and ready 15 minutes before your scheduled match time</li>",
    "playingHeading": "Playing Your Match",
    "playingList": "<li>Matches are played on the agreed game and platform (DLS, EA FC Mobile, eFootball, etc.) as specified in the tournament details</li><li>Both players must join the match lobby at the scheduled time</li><li>If you cannot find your opponent after waiting 10 minutes from the scheduled start time, take a screenshot of the empty lobby and submit it as a no-show report</li>",
    "submittingHeading": "Submitting Results",
    "submittingList": "<li>The winner is responsible for submitting the result</li><li>Submit a screenshot of the final scoreline AND a screen recording of the match</li><li>Results must be submitted within 2 hours of the match ending</li><li>Admin reviews and confirms the result — the bracket updates only after confirmation</li>",
    "noShowHeading": "No-Shows",
    "noShowList": "<li>Failing to appear for your scheduled match is a no-show</li><li>No-show: your opponent advances automatically, and you lose 100 SX Score points</li><li>Repeated no-shows may result in suspension from future tournaments</li>",
    "disputesHeading": "Disputes",
    "disputesList": "<li>If the submitted result is incorrect, the losing player may raise a dispute within 1 hour of submission</li><li>Admin will review both players' screen recordings and make a final decision</li><li>Admin decisions on disputes are final</li><li>Raising a false dispute (deliberately contesting a correct result) results in an SX Score penalty</li>",
    "conductHeading": "Conduct",
    "conductList": "<li>Treat your opponent with respect — harassment, hate speech, or threats will result in immediate disqualification and suspension</li><li>Match fixing or collusion is a permanent ban offence</li><li>Using game exploits or external tools is a permanent ban offence</li>",
    "prizesHeading": "Prizes",
    "prizesList": "<li>Prizes are credited to the winner's wallet after admin confirms the final result</li><li>Players must complete KYC verification before withdrawing prize money</li><li>Withdrawal requests are processed within 1–5 business days</li>"
  }
```

- [ ] **Step 2: Run the parity test — expect FAIL**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect FAIL.

- [ ] **Step 3: Add the French `rules` namespace to `messages/fr.json`**

```json
  "rules": {
    "eyebrow": "Assistance",
    "title": "Règlement des tournois",
    "metaTitle": "Règlement des tournois",
    "metaDescription": "Règles d'admissibilité, de match, de soumission des résultats, de litige et de conduite qui s'appliquent à chaque tournoi SentinelX.",
    "eligibilityHeading": "Admissibilité",
    "eligibilityList": "<li>Vous devez avoir un compte SentinelX enregistré et vérifié</li><li>Vous devez payer les frais d'inscription (₦500 ou réduits avec des SX Coins) avant la date limite d'inscription</li><li>Les joueurs sous suspension active ne sont pas admissibles</li>",
    "beforeHeading": "Avant le tournoi",
    "beforeList": "<li>Les inscriptions se ferment avant la génération du tableau — vous ne pouvez pas vous inscrire après la date limite</li><li>Consultez votre match (votre rencontre programmée) sur votre tableau de bord joueur une fois le tableau publié</li><li>Soyez en ligne et prêt 15 minutes avant l'heure programmée de votre match</li>",
    "playingHeading": "Jouer votre match",
    "playingList": "<li>Les matchs se jouent sur le jeu et la plateforme convenus (DLS, EA FC Mobile, eFootball, etc.) tels que précisés dans les détails du tournoi</li><li>Les deux joueurs doivent rejoindre le lobby du match à l'heure programmée</li><li>Si vous ne trouvez pas votre adversaire après 10 minutes d'attente à partir de l'heure programmée, prenez une capture d'écran du lobby vide et soumettez-la comme signalement d'absence</li>",
    "submittingHeading": "Soumission des résultats",
    "submittingList": "<li>Le gagnant est responsable de la soumission du résultat</li><li>Soumettez une capture d'écran du score final ET un enregistrement d'écran du match</li><li>Les résultats doivent être soumis dans les 2 heures suivant la fin du match</li><li>L'administrateur examine et confirme le résultat — le tableau ne se met à jour qu'après confirmation</li>",
    "noShowHeading": "Absences",
    "noShowList": "<li>Ne pas se présenter à votre match programmé constitue une absence</li><li>Absence : votre adversaire avance automatiquement, et vous perdez 100 points de SX Score</li><li>Des absences répétées peuvent entraîner une suspension des futurs tournois</li>",
    "disputesHeading": "Litiges",
    "disputesList": "<li>Si le résultat soumis est incorrect, le joueur perdant peut soulever un litige dans l'heure suivant la soumission</li><li>L'administrateur examinera les enregistrements d'écran des deux joueurs et prendra une décision finale</li><li>Les décisions de l'administrateur sur les litiges sont définitives</li><li>Soulever un litige infondé (contester délibérément un résultat correct) entraîne une pénalité sur le SX Score</li>",
    "conductHeading": "Conduite",
    "conductList": "<li>Traitez votre adversaire avec respect — le harcèlement, les discours de haine ou les menaces entraîneront une disqualification immédiate et une suspension</li><li>Le trucage de match ou la collusion est une infraction passible d'un bannissement permanent</li><li>L'utilisation d'exploits de jeu ou d'outils externes est une infraction passible d'un bannissement permanent</li>",
    "prizesHeading": "Gains",
    "prizesList": "<li>Les gains sont crédités sur le portefeuille du gagnant après confirmation du résultat final par l'administrateur</li><li>Les joueurs doivent compléter la vérification KYC avant de retirer leurs gains</li><li>Les demandes de retrait sont traitées sous 1 à 5 jours ouvrés</li>"
  }
```

- [ ] **Step 4: Add the Pidgin `rules` namespace to `messages/pcm.json`**

```json
  "rules": {
    "eyebrow": "Support",
    "title": "Tournament Rules",
    "metaTitle": "Tournament Rules",
    "metaDescription": "Eligibility, match, result-submission, dispute, and conduct rules wey apply to every SentinelX tournament.",
    "eligibilityHeading": "Eligibility",
    "eligibilityList": "<li>You must get registered and verified SentinelX account</li><li>You must pay entry fee (₦500 or reduced with SX Coins) before registration deadline</li><li>Players wey dey serve active suspension no fit enter</li>",
    "beforeHeading": "Before Di Tournament",
    "beforeList": "<li>Registration go close before dem generate di bracket — you no fit register after deadline</li><li>Check your fixture (your scheduled match) for your Player Dashboard after dem publish di bracket</li><li>Dey online and ready 15 minutes before your scheduled match time</li>",
    "playingHeading": "How to Play Your Match",
    "playingList": "<li>Matches dey play on di agreed game and platform (DLS, EA FC Mobile, eFootball, etc.) as e dey inside di tournament details</li><li>Both players must enter di match lobby at di scheduled time</li><li>If you no fit find your opponent after you wait 10 minutes from di scheduled start time, screenshot di empty lobby and submit am as no-show report</li>",
    "submittingHeading": "How to Submit Result",
    "submittingList": "<li>Na di winner get responsibility to submit di result</li><li>Submit screenshot of di final scoreline AND screen recording of di match</li><li>You must submit result within 2 hours after di match don end</li><li>Admin go review and confam di result — di bracket go update only after confam</li>",
    "noShowHeading": "No-Shows",
    "noShowList": "<li>If you no show up for your scheduled match, na no-show</li><li>No-show: your opponent go advance automatically, and you go lose 100 SX Score points</li><li>If you keep no-show, dem fit suspend you from future tournaments</li>",
    "disputesHeading": "Disputes",
    "disputesList": "<li>If di submitted result wrong, di player wey lose fit raise dispute within 1 hour after submission</li><li>Admin go review both players' screen recording and take final decision</li><li>Wetin admin decide for dispute, na im be final</li><li>If you raise false dispute (wen you dey deliberately contest correct result), you go get SX Score penalty</li>",
    "conductHeading": "Conduct",
    "conductList": "<li>Respect your opponent — harassment, hate speech, or threat go cause immediate disqualification and suspension</li><li>Match fixing or collusion na permanent ban offence</li><li>To use game exploits or outside tools na permanent ban offence</li>",
    "prizesHeading": "Prizes",
    "prizesList": "<li>Prize dey enter di winner wallet after admin confam di final result</li><li>Players must complete KYC verification before dem withdraw prize money</li><li>Withdrawal request dey process within 1–5 business days</li>"
  }
```

- [ ] **Step 5: Run the parity test — expect PASS**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect PASS.

- [ ] **Step 6: Rewrite `app/[locale]/(public)/rules/page.tsx`**

```tsx
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'
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
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')}>
      <div className={proseClassName}>
        <h2>{t('eligibilityHeading')}</h2>
        <ul>{t.rich('eligibilityList', listItemTag)}</ul>

        <h2>{t('beforeHeading')}</h2>
        <ul>{t.rich('beforeList', listItemTag)}</ul>

        <h2>{t('playingHeading')}</h2>
        <ul>{t.rich('playingList', listItemTag)}</ul>

        <h2>{t('submittingHeading')}</h2>
        <ul>{t.rich('submittingList', listItemTag)}</ul>

        <h2>{t('noShowHeading')}</h2>
        <ul>{t.rich('noShowList', listItemTag)}</ul>

        <h2>{t('disputesHeading')}</h2>
        <ul>{t.rich('disputesList', listItemTag)}</ul>

        <h2>{t('conductHeading')}</h2>
        <ul>{t.rich('conductList', listItemTag)}</ul>

        <h2>{t('prizesHeading')}</h2>
        <ul>{t.rich('prizesList', listItemTag)}</ul>
      </div>
    </StaticPageShell>
  )
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p .` — expect no errors.

- [ ] **Step 8: Manual verification**

Run `npm run dev`, visit `/rules`, `/fr/rules`, `/pcm/rules` — confirm all 8 sections render translated.

- [ ] **Step 9: Commit**

```bash
git add messages/en.json messages/fr.json messages/pcm.json "app/[locale]/(public)/rules/page.tsx"
git commit -m "feat(i18n): translate Tournament Rules page"
```

---

## Task 6: Community Rules (`/community-rules`)

**Files:**
- Modify: `messages/en.json`, `messages/fr.json`, `messages/pcm.json` (add `communityRules` namespace)
- Modify: `app/[locale]/(public)/community-rules/page.tsx`

**Interfaces:**
- Consumes: `emailTag`, `strongTag` from `components/static/richTags.tsx` (Task 1). A local `br: () => <br />` tag is added inline in this page only (the only page using line breaks inside a single message) rather than added to the shared helper.

- [ ] **Step 1: Add the `communityRules` namespace to `messages/en.json`**

```json
  "communityRules": {
    "eyebrow": "Community",
    "title": "Community Rules",
    "metaTitle": "Community Rules",
    "metaDescription": "The standards that keep SentinelX's community positive, competitive, and safe.",
    "intro": "SentinelX is Nigeria's home of mobile esports. The community is for everyone who loves the game — we keep it positive, competitive, and safe.",
    "basicHeading": "The Basic Standard",
    "basicP1": "Treat every member the way you'd want to be treated at a tournament in person. Behind every username is a real person.",
    "notAllowedHeading": "What's Not Allowed",
    "harassmentHeading": "Harassment and hate speech",
    "harassmentP1": "No insults, threats, or discrimination based on tribe, religion, gender, region, or any other personal characteristic. This includes DMs.",
    "spamHeading": "Spam",
    "spamP1": "No repeated posting of the same content, no promotional links without permission, no bot activity.",
    "falseInfoHeading": "False information",
    "falseInfoP1": "Do not post fake match results, fake screenshots, or misleading claims about other players.",
    "privacyHeading": "Privacy violations",
    "privacyP1": "Do not share another player's personal information (phone number, address, real name if they use a username) without their consent.",
    "cheatingHeading": "Cheating promotion",
    "cheatingP1": "Do not share or promote methods for cheating in any game supported on the platform.",
    "nsfwHeading": "NSFW content",
    "nsfwP1": "No explicit, violent, or disturbing content of any kind.",
    "consequencesHeading": "Consequences",
    "consequencesP1": "<strong>First offence:</strong> Warning<br/><strong>Second offence:</strong> Temporary suspension (7–30 days depending on severity)<br/><strong>Serious offences</strong> (hate speech, threats, doxxing, cheating): Immediate suspension or permanent ban, no warning required",
    "reportingHeading": "Reporting",
    "reportingP1": "See something that breaks these rules? Use the report button on any post, or email <email>sentinelxesports@gmail.com</email>. Reports are reviewed by the admin team. We take every report seriously."
  }
```

- [ ] **Step 2: Run the parity test — expect FAIL**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect FAIL.

- [ ] **Step 3: Add the French `communityRules` namespace to `messages/fr.json`**

```json
  "communityRules": {
    "eyebrow": "Communauté",
    "title": "Règles de la communauté",
    "metaTitle": "Règles de la communauté",
    "metaDescription": "Les standards qui gardent la communauté SentinelX positive, compétitive et sûre.",
    "intro": "SentinelX est le foyer de l'esport mobile au Nigeria. La communauté est ouverte à tous ceux qui aiment le jeu — nous la gardons positive, compétitive et sûre.",
    "basicHeading": "Le standard de base",
    "basicP1": "Traitez chaque membre comme vous aimeriez être traité en personne lors d'un tournoi. Derrière chaque nom d'utilisateur se trouve une vraie personne.",
    "notAllowedHeading": "Ce qui n'est pas autorisé",
    "harassmentHeading": "Harcèlement et discours de haine",
    "harassmentP1": "Aucune insulte, menace ou discrimination fondée sur l'ethnie, la religion, le genre, la région ou toute autre caractéristique personnelle. Cela inclut les messages privés.",
    "spamHeading": "Spam",
    "spamP1": "Pas de publication répétée du même contenu, pas de liens promotionnels sans autorisation, pas d'activité de bot.",
    "falseInfoHeading": "Fausses informations",
    "falseInfoP1": "Ne publiez pas de faux résultats de match, de fausses captures d'écran, ou d'affirmations trompeuses sur d'autres joueurs.",
    "privacyHeading": "Atteintes à la vie privée",
    "privacyP1": "Ne partagez pas les informations personnelles d'un autre joueur (numéro de téléphone, adresse, vrai nom s'il utilise un pseudonyme) sans son consentement.",
    "cheatingHeading": "Promotion de la triche",
    "cheatingP1": "Ne partagez ni ne faites la promotion de méthodes de triche pour un jeu pris en charge sur la plateforme.",
    "nsfwHeading": "Contenu NSFW",
    "nsfwP1": "Aucun contenu explicite, violent ou choquant, quel qu'il soit.",
    "consequencesHeading": "Conséquences",
    "consequencesP1": "<strong>Première infraction :</strong> Avertissement<br/><strong>Deuxième infraction :</strong> Suspension temporaire (7 à 30 jours selon la gravité)<br/><strong>Infractions graves</strong> (discours de haine, menaces, doxxing, triche) : Suspension immédiate ou bannissement permanent, sans avertissement préalable",
    "reportingHeading": "Signalement",
    "reportingP1": "Vous voyez quelque chose qui enfreint ces règles ? Utilisez le bouton de signalement sur n'importe quelle publication, ou écrivez à <email>sentinelxesports@gmail.com</email>. Les signalements sont examinés par l'équipe d'administration. Nous prenons chaque signalement au sérieux."
  }
```

- [ ] **Step 4: Add the Pidgin `communityRules` namespace to `messages/pcm.json`**

```json
  "communityRules": {
    "eyebrow": "Community",
    "title": "Community Rules",
    "metaTitle": "Community Rules",
    "metaDescription": "Di standards wey dey keep SentinelX community positive, competitive, and safe.",
    "intro": "SentinelX na Nigeria home of mobile esports. Di community na for everybody wey love di game — we dey keep am positive, competitive, and safe.",
    "basicHeading": "Di Basic Standard",
    "basicP1": "Treat every member di way wey you go want dem treat you for tournament in person. Behind every username, na real person dey.",
    "notAllowedHeading": "Wetin No Dey Allowed",
    "harassmentHeading": "Harassment and Hate Speech",
    "harassmentP1": "No insult, threat, or discrimination based on tribe, religion, gender, region, or any other personal characteristic. Dis one include DMs.",
    "spamHeading": "Spam",
    "spamP1": "No repeated posting of di same content, no promotional links without permission, no bot activity.",
    "falseInfoHeading": "False Information",
    "falseInfoP1": "No post fake match result, fake screenshot, or misleading claim about other players.",
    "privacyHeading": "Privacy Violations",
    "privacyP1": "No share another player personal information (phone number, address, real name if dem dey use username) without dem consent.",
    "cheatingHeading": "Cheating Promotion",
    "cheatingP1": "No share or promote methods for cheating for any game wey di platform support.",
    "nsfwHeading": "NSFW Content",
    "nsfwP1": "No explicit, violent, or disturbing content of any kind.",
    "consequencesHeading": "Consequences",
    "consequencesP1": "<strong>First offence:</strong> Warning<br/><strong>Second offence:</strong> Temporary suspension (7–30 days depending on how bad e be)<br/><strong>Serious offences</strong> (hate speech, threat, doxxing, cheating): Immediate suspension or permanent ban, no warning need",
    "reportingHeading": "Reporting",
    "reportingP1": "You see something wey break dis rules? Use di report button for any post, or email <email>sentinelxesports@gmail.com</email>. Admin team dey review reports. We dey take every report serious."
  }
```

- [ ] **Step 5: Run the parity test — expect PASS**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect PASS.

- [ ] **Step 6: Rewrite `app/[locale]/(public)/community-rules/page.tsx`**

```tsx
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'
import { emailTag, strongTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'communityRules' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/community-rules',
    locale,
  })
}

export default async function CommunityRulesPage() {
  const t = await getTranslations('communityRules')
  return (
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')}>
      <div className={proseClassName}>
        <p>{t('intro')}</p>

        <h2>{t('basicHeading')}</h2>
        <p>{t('basicP1')}</p>

        <h2>{t('notAllowedHeading')}</h2>
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

        <h2>{t('consequencesHeading')}</h2>
        <p>{t.rich('consequencesP1', { ...strongTag, br: () => <br /> })}</p>

        <h2>{t('reportingHeading')}</h2>
        <p>{t.rich('reportingP1', emailTag())}</p>
      </div>
    </StaticPageShell>
  )
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p .` — expect no errors.

- [ ] **Step 8: Manual verification**

Run `npm run dev`, visit `/community-rules`, `/fr/community-rules`, `/pcm/community-rules` — confirm all sections render translated and the consequences paragraph keeps its 3 line breaks.

- [ ] **Step 9: Commit**

```bash
git add messages/en.json messages/fr.json messages/pcm.json "app/[locale]/(public)/community-rules/page.tsx"
git commit -m "feat(i18n): translate Community Rules page"
```

---

## Task 7: Safety (`/safety`)

**Files:**
- Modify: `messages/en.json`, `messages/fr.json`, `messages/pcm.json` (add `safety` namespace)
- Modify: `app/[locale]/(public)/safety/page.tsx`

**Interfaces:**
- Consumes: `emailTag`, `whatsappTag`, `listItemTag` from `components/static/richTags.tsx` (Task 1)

- [ ] **Step 1: Add the `safety` namespace to `messages/en.json`**

```json
  "safety": {
    "eyebrow": "Support",
    "title": "Stay Safe on SentinelX",
    "metaTitle": "Stay Safe on SentinelX",
    "metaDescription": "How to protect your account, your prize money, and yourself while trading or playing on SentinelX.",
    "protectAccountHeading": "Protect Your Account",
    "protectAccountList": "<li>Use a strong, unique password for SentinelX — don't reuse it from another app</li><li>Never share your password with anyone, including people claiming to be SentinelX staff</li><li>Log out of shared devices after playing</li><li>If your email gets a reset request you didn't make, change your password immediately and contact us</li>",
    "neverAskHeading": "We Will Never Ask For This",
    "neverAskIntro": "SentinelX staff will never ask for your:",
    "neverAskList": "<li>Password</li><li>Bank account PIN or BVN</li><li>Paystack OTP codes</li><li>Payment to “unlock” prize money</li>",
    "neverAskP2": "If anyone claiming to be SentinelX asks for any of these, it is a scam. Report it to us immediately.",
    "protectPrizeHeading": "Protect Your Prize Money",
    "protectPrizeList": "<li>Only link your own bank account for withdrawals</li><li>Verify your account before your first withdrawal — this protects you</li><li>Prize withdrawals only go through the platform dashboard. Anyone asking you to send money first to “unlock” winnings is a scammer</li>",
    "safeTradingHeading": "Safe Trading on the Exchange",
    "safeTradingList": "<li>Always use the Zolarux Escrow system for all trades. Funds held in escrow are protected until both parties confirm the transaction</li><li>Never agree to complete a trade outside the platform — if a buyer or seller asks to go outside escrow, refuse and report them</li><li>If a deal looks too good to be true, it probably is</li>",
    "matchSafetyHeading": "Match Safety",
    "matchSafetyList": "<li>Record your screen for every match — this is your protection if a result is disputed</li><li>Save your recordings until after the result is officially confirmed on the platform</li><li>If your opponent is being abusive or threatening, take screenshots and report via the platform or email us</li>",
    "reportHeading": "Report a Problem",
    "reportP1": "Email: <email>sentinelxesports@gmail.com</email><br/>WhatsApp: <whatsapp>+234 903 239 5685</whatsapp>"
  }
```

- [ ] **Step 2: Run the parity test — expect FAIL**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect FAIL.

- [ ] **Step 3: Add the French `safety` namespace to `messages/fr.json`**

```json
  "safety": {
    "eyebrow": "Assistance",
    "title": "Restez en sécurité sur SentinelX",
    "metaTitle": "Restez en sécurité sur SentinelX",
    "metaDescription": "Comment protéger votre compte, vos gains, et vous-même lorsque vous échangez ou jouez sur SentinelX.",
    "protectAccountHeading": "Protégez votre compte",
    "protectAccountList": "<li>Utilisez un mot de passe fort et unique pour SentinelX — ne le réutilisez pas d'une autre application</li><li>Ne partagez jamais votre mot de passe avec qui que ce soit, y compris des personnes se faisant passer pour le personnel de SentinelX</li><li>Déconnectez-vous des appareils partagés après avoir joué</li><li>Si votre e-mail reçoit une demande de réinitialisation que vous n'avez pas faite, changez votre mot de passe immédiatement et contactez-nous</li>",
    "neverAskHeading": "Nous ne vous demanderons jamais ceci",
    "neverAskIntro": "Le personnel de SentinelX ne vous demandera jamais :",
    "neverAskList": "<li>Votre mot de passe</li><li>Le code PIN de votre compte bancaire ou votre BVN</li><li>Vos codes OTP Paystack</li><li>Un paiement pour « débloquer » des gains</li>",
    "neverAskP2": "Si quelqu'un se réclamant de SentinelX vous demande l'un de ces éléments, c'est une arnaque. Signalez-le-nous immédiatement.",
    "protectPrizeHeading": "Protégez vos gains",
    "protectPrizeList": "<li>Liez uniquement votre propre compte bancaire pour les retraits</li><li>Vérifiez votre compte avant votre premier retrait — cela vous protège</li><li>Les retraits de gains passent uniquement par le tableau de bord de la plateforme. Toute personne vous demandant d'envoyer de l'argent d'abord pour « débloquer » des gains est une arnaqueuse</li>",
    "safeTradingHeading": "Échanges sécurisés sur l'Exchange",
    "safeTradingList": "<li>Utilisez toujours le système d'escrow Zolarux pour tous les échanges. Les fonds détenus en escrow sont protégés jusqu'à ce que les deux parties confirment la transaction</li><li>N'acceptez jamais de conclure un échange en dehors de la plateforme — si un acheteur ou un vendeur demande de sortir de l'escrow, refusez et signalez-le</li><li>Si une offre semble trop belle pour être vraie, c'est probablement le cas</li>",
    "matchSafetyHeading": "Sécurité des matchs",
    "matchSafetyList": "<li>Enregistrez votre écran pour chaque match — c'est votre protection en cas de litige sur un résultat</li><li>Conservez vos enregistrements jusqu'à ce que le résultat soit officiellement confirmé sur la plateforme</li><li>Si votre adversaire est abusif ou menaçant, prenez des captures d'écran et signalez-le via la plateforme ou par e-mail</li>",
    "reportHeading": "Signaler un problème",
    "reportP1": "E-mail : <email>sentinelxesports@gmail.com</email><br/>WhatsApp : <whatsapp>+234 903 239 5685</whatsapp>"
  }
```

- [ ] **Step 4: Add the Pidgin `safety` namespace to `messages/pcm.json`**

```json
  "safety": {
    "eyebrow": "Support",
    "title": "Stay Safe for SentinelX",
    "metaTitle": "Stay Safe for SentinelX",
    "metaDescription": "How to protect your account, your prize money, and yourself as you dey trade or play for SentinelX.",
    "protectAccountHeading": "Protect Your Account",
    "protectAccountList": "<li>Use strong, unique password for SentinelX — no reuse am from another app</li><li>No share your password with anybody, even person wey claim say na SentinelX staff</li><li>Log out for shared devices after you finish play</li><li>If your email get reset request wey you no make, change your password sharp sharp and contact us</li>",
    "neverAskHeading": "We No Go Ever Ask You For Dis",
    "neverAskIntro": "SentinelX staff no go ever ask you for your:",
    "neverAskList": "<li>Password</li><li>Bank account PIN or BVN</li><li>Paystack OTP codes</li><li>Payment to “unlock” prize money</li>",
    "neverAskP2": "If anybody wey claim say na SentinelX ask you for any of dis ones, na scam. Report am to us sharp sharp.",
    "protectPrizeHeading": "Protect Your Prize Money",
    "protectPrizeList": "<li>Only link your own bank account for withdrawal</li><li>Verify your account before your first withdrawal — dis one dey protect you</li><li>Prize withdrawal na only through platform dashboard e dey go. Anybody wey ask you to send money first to “unlock” winnings na scammer</li>",
    "safeTradingHeading": "How to Trade Safe for Exchange",
    "safeTradingList": "<li>Always use Zolarux Escrow system for every trade. Money wey dey inside escrow dey protected until both parties confam di transaction</li><li>No ever agree to complete trade outside di platform — if buyer or seller ask you to go outside escrow, refuse am and report am</li><li>If deal too sweet to be true, e probably no be true</li>",
    "matchSafetyHeading": "Match Safety",
    "matchSafetyList": "<li>Record your screen for every match — dis na your protection if dispute happen for result</li><li>Keep your recordings until after dem officially confam di result for di platform</li><li>If your opponent dey abuse you or threaten you, screenshot am and report through di platform or email us</li>",
    "reportHeading": "Report Problem",
    "reportP1": "Email: <email>sentinelxesports@gmail.com</email><br/>WhatsApp: <whatsapp>+234 903 239 5685</whatsapp>"
  }
```

- [ ] **Step 5: Run the parity test — expect PASS**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect PASS.

- [ ] **Step 6: Rewrite `app/[locale]/(public)/safety/page.tsx`**

```tsx
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'
import { emailTag, whatsappTag, listItemTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'safety' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/safety',
    locale,
  })
}

export default async function SafetyPage() {
  const t = await getTranslations('safety')
  return (
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')}>
      <div className={proseClassName}>
        <h2>{t('protectAccountHeading')}</h2>
        <ul>{t.rich('protectAccountList', listItemTag)}</ul>

        <h2>{t('neverAskHeading')}</h2>
        <p>{t('neverAskIntro')}</p>
        <ul>{t.rich('neverAskList', listItemTag)}</ul>
        <p>{t('neverAskP2')}</p>

        <h2>{t('protectPrizeHeading')}</h2>
        <ul>{t.rich('protectPrizeList', listItemTag)}</ul>

        <h2>{t('safeTradingHeading')}</h2>
        <ul>{t.rich('safeTradingList', listItemTag)}</ul>

        <h2>{t('matchSafetyHeading')}</h2>
        <ul>{t.rich('matchSafetyList', listItemTag)}</ul>

        <h2>{t('reportHeading')}</h2>
        <p>{t.rich('reportP1', { ...emailTag(), ...whatsappTag(), br: () => <br /> })}</p>
      </div>
    </StaticPageShell>
  )
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p .` — expect no errors.

- [ ] **Step 8: Manual verification**

Run `npm run dev`, visit `/safety`, `/fr/safety`, `/pcm/safety` — confirm all 6 sections render translated.

- [ ] **Step 9: Commit**

```bash
git add messages/en.json messages/fr.json messages/pcm.json "app/[locale]/(public)/safety/page.tsx"
git commit -m "feat(i18n): translate Safety page"
```

---

## Task 8: Escrow (`/escrow`)

**Files:**
- Modify: `messages/en.json`, `messages/fr.json`, `messages/pcm.json` (add `escrow` namespace)
- Modify: `app/[locale]/(public)/escrow/page.tsx`

**Interfaces:**
- Consumes: `emailTag`, `linkTag`, `listItemTag` from `components/static/richTags.tsx` (Task 1)

- [ ] **Step 1: Add the `escrow` namespace to `messages/en.json`**

```json
  "escrow": {
    "eyebrow": "Gaming Exchange",
    "title": "Safe Trading with Zolarux Escrow",
    "metaTitle": "Safe Trading with Zolarux Escrow",
    "metaDescription": "How Zolarux Escrow protects buyers and sellers on the SentinelX Gaming Exchange.",
    "whatIsExchangeHeading": "What Is the Gaming Exchange?",
    "whatIsExchangeP1": "The Gaming Exchange is SentinelX's marketplace for gaming accounts, in-game items, and digital gaming assets. It's built for Nigerian mobile gamers who want to buy and sell safely — without the risk of being scammed.",
    "whatIsExchangeP2": "Every transaction on the Exchange is protected by Zolarux Escrow. <link>Browse the Exchange →</link>",
    "whatIsEscrowHeading": "What Is Zolarux Escrow?",
    "whatIsEscrowP1": "Zolarux is an independent escrow service. Escrow means a trusted third party holds a payment until both sides of a transaction are satisfied. Neither the buyer's money nor the seller's item is transferred until the deal is confirmed as complete.",
    "whatIsEscrowP2": "This protects both parties.",
    "howItWorksHeading": "How It Works",
    "buyerLabel": "Buyer's perspective:",
    "buyerList": "<li>You find an item you want and agree on a price</li><li>You send payment to Zolarux (not directly to the seller)</li><li>The seller delivers the item or account</li><li>You confirm you've received it and it's as described</li><li>Zolarux releases the payment to the seller</li>",
    "buyerP2": "If the item is not delivered or is misrepresented, you can raise a dispute and your money is returned.",
    "sellerLabel": "Seller's perspective:",
    "sellerList": "<li>You list your item on the Exchange</li><li>A buyer purchases it — their payment goes to Zolarux, not to you yet</li><li>You deliver the item or transfer the account</li><li>The buyer confirms receipt</li><li>Zolarux releases your payment</li>",
    "sellerP2": "You only deliver once the buyer's payment is confirmed as held in escrow.",
    "whyNotDirectHeading": "Why Not Trade Directly?",
    "whyNotDirectP1": "Trading outside of escrow — whether via WhatsApp, direct transfer, or any other method — is not protected. SentinelX cannot help you recover money or items lost in trades that took place outside the platform's escrow system.",
    "whyNotDirectP2": "If a buyer or seller asks you to complete a trade outside the escrow system, decline and report them.",
    "questionsHeading": "Have Questions?",
    "questionsP1": "Contact us at <email>sentinelxesports@gmail.com</email>."
  }
```

- [ ] **Step 2: Run the parity test — expect FAIL**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect FAIL.

- [ ] **Step 3: Add the French `escrow` namespace to `messages/fr.json`**

```json
  "escrow": {
    "eyebrow": "Gaming Exchange",
    "title": "Échanger en toute sécurité avec l'escrow Zolarux",
    "metaTitle": "Échanger en toute sécurité avec l'escrow Zolarux",
    "metaDescription": "Comment l'escrow Zolarux protège acheteurs et vendeurs sur le Gaming Exchange de SentinelX.",
    "whatIsExchangeHeading": "Qu'est-ce que le Gaming Exchange ?",
    "whatIsExchangeP1": "Le Gaming Exchange est la place de marché de SentinelX pour les comptes de jeu, les objets in-game et les biens numériques de jeu. Il est conçu pour les gamers mobiles nigérians qui veulent acheter et vendre en toute sécurité — sans risque de se faire arnaquer.",
    "whatIsExchangeP2": "Chaque transaction sur l'Exchange est protégée par l'escrow Zolarux. <link>Parcourir l'Exchange →</link>",
    "whatIsEscrowHeading": "Qu'est-ce que l'escrow Zolarux ?",
    "whatIsEscrowP1": "Zolarux est un service d'escrow indépendant. L'escrow signifie qu'un tiers de confiance détient un paiement jusqu'à ce que les deux parties d'une transaction soient satisfaites. Ni l'argent de l'acheteur ni l'objet du vendeur ne sont transférés tant que l'accord n'est pas confirmé comme terminé.",
    "whatIsEscrowP2": "Cela protège les deux parties.",
    "howItWorksHeading": "Comment ça marche",
    "buyerLabel": "Du point de vue de l'acheteur :",
    "buyerList": "<li>Vous trouvez un objet que vous voulez et vous vous accordez sur un prix</li><li>Vous envoyez le paiement à Zolarux (pas directement au vendeur)</li><li>Le vendeur livre l'objet ou le compte</li><li>Vous confirmez l'avoir reçu et qu'il est conforme à la description</li><li>Zolarux verse le paiement au vendeur</li>",
    "buyerP2": "Si l'objet n'est pas livré ou est mal décrit, vous pouvez ouvrir un litige et votre argent vous est rendu.",
    "sellerLabel": "Du point de vue du vendeur :",
    "sellerList": "<li>Vous mettez votre objet en vente sur l'Exchange</li><li>Un acheteur l'achète — son paiement va à Zolarux, pas encore à vous</li><li>Vous livrez l'objet ou transférez le compte</li><li>L'acheteur confirme la réception</li><li>Zolarux vous verse le paiement</li>",
    "sellerP2": "Vous ne livrez qu'une fois le paiement de l'acheteur confirmé comme détenu en escrow.",
    "whyNotDirectHeading": "Pourquoi ne pas échanger directement ?",
    "whyNotDirectP1": "Échanger en dehors de l'escrow — que ce soit via WhatsApp, un virement direct, ou toute autre méthode — n'est pas protégé. SentinelX ne peut pas vous aider à récupérer de l'argent ou des objets perdus lors d'échanges effectués en dehors du système d'escrow de la plateforme.",
    "whyNotDirectP2": "Si un acheteur ou un vendeur vous demande de conclure un échange en dehors du système d'escrow, refusez et signalez-le.",
    "questionsHeading": "Des questions ?",
    "questionsP1": "Contactez-nous à <email>sentinelxesports@gmail.com</email>."
  }
```

- [ ] **Step 4: Add the Pidgin `escrow` namespace to `messages/pcm.json`**

```json
  "escrow": {
    "eyebrow": "Gaming Exchange",
    "title": "Trade Safe with Zolarux Escrow",
    "metaTitle": "Trade Safe with Zolarux Escrow",
    "metaDescription": "How Zolarux Escrow dey protect buyers and sellers for SentinelX Gaming Exchange.",
    "whatIsExchangeHeading": "Wetin Be Gaming Exchange?",
    "whatIsExchangeP1": "Gaming Exchange na SentinelX marketplace for gaming accounts, in-game items, and digital gaming assets. Dem build am for Nigerian mobile gamers wey wan buy and sell safe — without any risk of scam.",
    "whatIsExchangeP2": "Every transaction for di Exchange dey protected by Zolarux Escrow. <link>Browse di Exchange →</link>",
    "whatIsEscrowHeading": "Wetin Be Zolarux Escrow?",
    "whatIsEscrowP1": "Zolarux na independent escrow service. Escrow mean say trusted third party go hold payment until both sides of transaction satisfy. Buyer money and seller item no go transfer until dem confam say deal don complete.",
    "whatIsEscrowP2": "Dis one dey protect both parties.",
    "howItWorksHeading": "How E Dey Work",
    "buyerLabel": "From buyer side:",
    "buyerList": "<li>You find item wey you want and you agree price</li><li>You send payment to Zolarux (no be straight to seller)</li><li>Seller deliver di item or account</li><li>You confam say you don receive am and e match di description</li><li>Zolarux release di payment go seller</li>",
    "buyerP2": "If dem no deliver di item or dem misrepresent am, you fit raise dispute and dem go return your money.",
    "sellerLabel": "From seller side:",
    "sellerList": "<li>You list your item for di Exchange</li><li>Buyer buy am — their payment go to Zolarux, e never reach you yet</li><li>You deliver di item or transfer di account</li><li>Buyer confam say dem don receive am</li><li>Zolarux release your payment</li>",
    "sellerP2": "You go only deliver once dem confam say buyer payment don enter escrow.",
    "whyNotDirectHeading": "Why You No Suppose Trade Direct",
    "whyNotDirectP1": "To trade outside escrow — whether through WhatsApp, direct transfer, or any other method — no dey protected. SentinelX no fit help you recover money or items wey you lose for trade wey happen outside di platform escrow system.",
    "whyNotDirectP2": "If buyer or seller ask you to complete trade outside escrow system, refuse am and report am.",
    "questionsHeading": "You Get Question?",
    "questionsP1": "Contact us for <email>sentinelxesports@gmail.com</email>."
  }
```

- [ ] **Step 5: Run the parity test — expect PASS**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect PASS.

- [ ] **Step 6: Rewrite `app/[locale]/(public)/escrow/page.tsx`**

```tsx
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'
import { emailTag, linkTag, listItemTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'escrow' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/escrow',
    locale,
  })
}

export default async function EscrowPage() {
  const t = await getTranslations('escrow')
  return (
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')}>
      <div className={proseClassName}>
        <h2>{t('whatIsExchangeHeading')}</h2>
        <p>{t('whatIsExchangeP1')}</p>
        <p>{t.rich('whatIsExchangeP2', linkTag('/exchange'))}</p>

        <h2>{t('whatIsEscrowHeading')}</h2>
        <p>{t('whatIsEscrowP1')}</p>
        <p>{t('whatIsEscrowP2')}</p>

        <h2>{t('howItWorksHeading')}</h2>
        <p>
          <strong>{t('buyerLabel')}</strong>
        </p>
        <ol>{t.rich('buyerList', listItemTag)}</ol>
        <p>{t('buyerP2')}</p>
        <p>
          <strong>{t('sellerLabel')}</strong>
        </p>
        <ol>{t.rich('sellerList', listItemTag)}</ol>
        <p>{t('sellerP2')}</p>

        <h2>{t('whyNotDirectHeading')}</h2>
        <p>{t('whyNotDirectP1')}</p>
        <p>{t('whyNotDirectP2')}</p>

        <h2>{t('questionsHeading')}</h2>
        <p>{t.rich('questionsP1', emailTag())}</p>
      </div>
    </StaticPageShell>
  )
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p .` — expect no errors.

- [ ] **Step 8: Manual verification**

Run `npm run dev`, visit `/escrow`, `/fr/escrow`, `/pcm/escrow` — confirm both ordered lists render translated and the `/exchange` link works.

- [ ] **Step 9: Commit**

```bash
git add messages/en.json messages/fr.json messages/pcm.json "app/[locale]/(public)/escrow/page.tsx"
git commit -m "feat(i18n): translate Escrow page"
```

---

## Task 9: Tournament Guide (`/tournament-guide`)

**Files:**
- Modify: `messages/en.json`, `messages/fr.json`, `messages/pcm.json` (add `tournamentGuide` namespace)
- Modify: `app/[locale]/(public)/tournament-guide/page.tsx`

**Interfaces:**
- Consumes: `listItemTag` from `components/static/richTags.tsx` (Task 1)

- [ ] **Step 1: Add the `tournamentGuide` namespace to `messages/en.json`**

```json
  "tournamentGuide": {
    "eyebrow": "Support",
    "title": "Tournament Guide",
    "subtitle": "Everything you need to know.",
    "metaTitle": "Tournament Guide",
    "metaDescription": "Everything you need to know before, during, and after a SentinelX tournament match.",
    "beforeRegHeading": "Before You Register",
    "checkGameLabel": "Check the game.",
    "checkGameP": "Each tournament specifies which game is being played. Make sure you have it installed and your in-game account is ready.",
    "checkFormatLabel": "Check the format.",
    "checkFormatP": "Tournaments use group stages (for large fields) followed by single-elimination knockout rounds. The tournament page shows how many groups, how many advance, and the prize structure.",
    "checkScheduleLabel": "Check the schedule.",
    "checkScheduleP": "Tournaments have a registration deadline and a start date. Once registration closes, the bracket is generated and no late entries are accepted.",
    "checkBalanceLabel": "Check your balance.",
    "checkBalanceP": "Entry fee is ₦500. If you don't have enough SX Coins for a discount, make sure your card is ready for the Paystack payment.",
    "registeringHeading": "Registering",
    "registeringList": "<li>Go to Tournaments → find an open tournament → click Register</li><li>Choose your coin discount option (if available)</li><li>Complete payment via Paystack (or confirm free entry if using full coin discount)</li><li>You'll receive a WhatsApp confirmation if you have a number saved in Settings</li>",
    "afterRegHeading": "After Registration",
    "afterRegP1": "Your fixture appears in Dashboard → My Matches once the bracket is published. This shows you who you're playing, what time, and which round.",
    "afterRegP2": "Set a reminder. SentinelX will send a WhatsApp reminder 1 hour before your match if notifications are enabled.",
    "playingHeading": "Playing the Match",
    "prepareLabel": "Prepare your connection.",
    "prepareP": "Unstable internet is your responsibility — connection issues during a match are not grounds for a result reversal.",
    "recordLabel": "Start recording before the match begins.",
    "recordP": "Go to your phone's screen recorder and start it before you enter the game lobby. This recording is your evidence if the result is ever disputed.",
    "joinLabel": "Join at the scheduled time.",
    "joinP": "If you can't find your opponent 10 minutes after the scheduled start, screenshot the empty lobby and report it as a no-show.",
    "playLabel": "Play the game.",
    "playP": "No exploits, no rage quits, no abuse.",
    "submittingHeading": "Submitting the Result",
    "submittingIntro": "The winner submits the result — not the loser.",
    "submittingList": "<li>Go to Dashboard → My Matches → the match → Submit Result</li><li>Upload your screenshot (final scoreline clearly visible)</li><li>Upload your screen recording</li><li>Click Submit</li>",
    "submittingP2": "You have 2 hours from the end of the match to submit. After that, a no-submission may be treated as a no-show.",
    "afterSubmissionHeading": "After Submission",
    "afterSubmissionP1": "Admin reviews your submission. If the result looks clean, it's confirmed within 24 hours and the bracket updates. The loser has 1 hour after submission to raise a dispute if they believe the result is wrong.",
    "afterSubmissionP2": "If you win a prize, it appears in your wallet after the final result is confirmed.",
    "tipsHeading": "Tips from Experience",
    "tipsList": "<li>Save all your recordings until after the official confirmation — you may need them for a dispute</li><li>If you lose, don't quit the app mid-match — abandoning counts against your SX Score</li><li>Good sportsmanship in the community is noticed. Your reputation matters beyond just your score</li>"
  }
```

- [ ] **Step 2: Run the parity test — expect FAIL**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect FAIL.

- [ ] **Step 3: Add the French `tournamentGuide` namespace to `messages/fr.json`**

```json
  "tournamentGuide": {
    "eyebrow": "Assistance",
    "title": "Guide du tournoi",
    "subtitle": "Tout ce que vous devez savoir.",
    "metaTitle": "Guide du tournoi",
    "metaDescription": "Tout ce que vous devez savoir avant, pendant et après un match de tournoi SentinelX.",
    "beforeRegHeading": "Avant de vous inscrire",
    "checkGameLabel": "Vérifiez le jeu.",
    "checkGameP": "Chaque tournoi précise quel jeu est joué. Assurez-vous de l'avoir installé et que votre compte in-game est prêt.",
    "checkFormatLabel": "Vérifiez le format.",
    "checkFormatP": "Les tournois utilisent des phases de groupes (pour les grands effectifs) suivies de tours à élimination directe. La page du tournoi indique le nombre de groupes, le nombre de qualifiés, et la structure des gains.",
    "checkScheduleLabel": "Vérifiez le calendrier.",
    "checkScheduleP": "Les tournois ont une date limite d'inscription et une date de début. Une fois les inscriptions closes, le tableau est généré et aucune inscription tardive n'est acceptée.",
    "checkBalanceLabel": "Vérifiez votre solde.",
    "checkBalanceP": "Les frais d'inscription sont de ₦500. Si vous n'avez pas assez de SX Coins pour une réduction, assurez-vous que votre carte est prête pour le paiement Paystack.",
    "registeringHeading": "S'inscrire",
    "registeringList": "<li>Allez dans Tournois → trouvez un tournoi ouvert → cliquez sur S'inscrire</li><li>Choisissez votre option de réduction en coins (si disponible)</li><li>Effectuez le paiement via Paystack (ou confirmez l'entrée gratuite si vous utilisez la réduction totale en coins)</li><li>Vous recevrez une confirmation WhatsApp si vous avez enregistré un numéro dans les Paramètres</li>",
    "afterRegHeading": "Après l'inscription",
    "afterRegP1": "Votre match apparaît dans Tableau de bord → Mes matchs une fois le tableau publié. Cela vous indique contre qui vous jouez, à quelle heure, et pour quel tour.",
    "afterRegP2": "Définissez un rappel. SentinelX enverra un rappel WhatsApp 1 heure avant votre match si les notifications sont activées.",
    "playingHeading": "Jouer le match",
    "prepareLabel": "Préparez votre connexion.",
    "prepareP": "Une connexion internet instable est de votre responsabilité — les problèmes de connexion pendant un match ne justifient pas l'annulation d'un résultat.",
    "recordLabel": "Commencez à enregistrer avant le début du match.",
    "recordP": "Lancez l'enregistreur d'écran de votre téléphone avant d'entrer dans le lobby du jeu. Cet enregistrement est votre preuve en cas de litige sur le résultat.",
    "joinLabel": "Rejoignez à l'heure programmée.",
    "joinP": "Si vous ne trouvez pas votre adversaire 10 minutes après l'heure de début programmée, prenez une capture d'écran du lobby vide et signalez-le comme une absence.",
    "playLabel": "Jouez le jeu.",
    "playP": "Pas d'exploits, pas d'abandon en cours de match, pas d'abus.",
    "submittingHeading": "Soumettre le résultat",
    "submittingIntro": "C'est le gagnant qui soumet le résultat — pas le perdant.",
    "submittingList": "<li>Allez dans Tableau de bord → Mes matchs → le match → Soumettre le résultat</li><li>Téléchargez votre capture d'écran (score final clairement visible)</li><li>Téléchargez votre enregistrement d'écran</li><li>Cliquez sur Soumettre</li>",
    "submittingP2": "Vous avez 2 heures après la fin du match pour soumettre. Passé ce délai, une absence de soumission peut être traitée comme une absence au match.",
    "afterSubmissionHeading": "Après la soumission",
    "afterSubmissionP1": "L'administrateur examine votre soumission. Si le résultat semble correct, il est confirmé sous 24 heures et le tableau se met à jour. Le perdant dispose d'1 heure après la soumission pour soulever un litige s'il pense que le résultat est erroné.",
    "afterSubmissionP2": "Si vous gagnez un prix, il apparaît dans votre portefeuille après confirmation du résultat final.",
    "tipsHeading": "Conseils d'expérience",
    "tipsList": "<li>Conservez tous vos enregistrements jusqu'après la confirmation officielle — vous pourriez en avoir besoin pour un litige</li><li>Si vous perdez, ne quittez pas l'application en cours de match — un abandon compte négativement pour votre SX Score</li><li>Un bon esprit sportif dans la communauté est remarqué. Votre réputation compte au-delà de votre seul score</li>"
  }
```

- [ ] **Step 4: Add the Pidgin `tournamentGuide` namespace to `messages/pcm.json`**

```json
  "tournamentGuide": {
    "eyebrow": "Support",
    "title": "Tournament Guide",
    "subtitle": "Everything wey you need to know.",
    "metaTitle": "Tournament Guide",
    "metaDescription": "Everything wey you need to know before, during, and after SentinelX tournament match.",
    "beforeRegHeading": "Before You Register",
    "checkGameLabel": "Check di game.",
    "checkGameP": "Every tournament dey specify which game dem dey play. Make sure say you don install am and your in-game account dey ready.",
    "checkFormatLabel": "Check di format.",
    "checkFormatP": "Tournaments dey use group stages (for big number of players) then single-elimination knockout rounds follow. Di tournament page go show how many groups, how many go advance, and di prize structure.",
    "checkScheduleLabel": "Check di schedule.",
    "checkScheduleP": "Tournaments get registration deadline and start date. Once registration close, dem go generate di bracket and no late entry dey accepted.",
    "checkBalanceLabel": "Check your balance.",
    "checkBalanceP": "Entry fee na ₦500. If you no get enough SX Coins for discount, make sure say your card dey ready for Paystack payment.",
    "registeringHeading": "How to Register",
    "registeringList": "<li>Go Tournaments → find open tournament → click Register</li><li>Choose your coin discount option (if e dey available)</li><li>Complete payment through Paystack (or confam free entry if you dey use full coin discount)</li><li>You go receive WhatsApp confirmation if you save number for Settings</li>",
    "afterRegHeading": "After Registration",
    "afterRegP1": "Your fixture go show for Dashboard → My Matches once dem publish di bracket. Dis one go show you who you dey play, wetin time, and wetin round.",
    "afterRegP2": "Set reminder. SentinelX go send WhatsApp reminder 1 hour before your match if notification don enable.",
    "playingHeading": "How to Play Di Match",
    "prepareLabel": "Prepare your connection.",
    "prepareP": "If your internet no steady, na your own wahala — connection issue during match no be ground to reverse result.",
    "recordLabel": "Start recording before match begin.",
    "recordP": "Go your phone screen recorder and start am before you enter di game lobby. Dis recording na your evidence if dispute ever happen for result.",
    "joinLabel": "Join at di scheduled time.",
    "joinP": "If you no fit find your opponent 10 minutes after di scheduled start, screenshot di empty lobby and report am as no-show.",
    "playLabel": "Play di game.",
    "playP": "No exploits, no rage quit, no abuse.",
    "submittingHeading": "How to Submit Di Result",
    "submittingIntro": "Na di winner dey submit di result — no be di loser.",
    "submittingList": "<li>Go Dashboard → My Matches → di match → Submit Result</li><li>Upload your screenshot (final scoreline must dey clearly visible)</li><li>Upload your screen recording</li><li>Click Submit</li>",
    "submittingP2": "You get 2 hours from wen match end to submit. After dat, if you no submit, dem fit treat am as no-show.",
    "afterSubmissionHeading": "After Submission",
    "afterSubmissionP1": "Admin go review your submission. If di result clean, dem go confam am within 24 hours and di bracket go update. Di loser get 1 hour after submission to raise dispute if dem feel say di result wrong.",
    "afterSubmissionP2": "If you win prize, e go show for your wallet after dem confam di final result.",
    "tipsHeading": "Tips Wey Go Help You",
    "tipsList": "<li>Keep all your recordings until after official confirmation — you fit need am for dispute</li><li>If you lose, no quit di app for middle of match — to abandon count against your SX Score</li><li>Good sportsmanship for di community, people go notice am. Your reputation matter pass just your score</li>"
  }
```

- [ ] **Step 5: Run the parity test — expect PASS**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect PASS.

- [ ] **Step 6: Rewrite `app/[locale]/(public)/tournament-guide/page.tsx`**

```tsx
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'
import { listItemTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'tournamentGuide' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/tournament-guide',
    locale,
  })
}

export default async function TournamentGuidePage() {
  const t = await getTranslations('tournamentGuide')
  return (
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')}>
      <div className={proseClassName}>
        <h2>{t('beforeRegHeading')}</h2>
        <p>
          <strong>{t('checkGameLabel')}</strong> {t('checkGameP')}
        </p>
        <p>
          <strong>{t('checkFormatLabel')}</strong> {t('checkFormatP')}
        </p>
        <p>
          <strong>{t('checkScheduleLabel')}</strong> {t('checkScheduleP')}
        </p>
        <p>
          <strong>{t('checkBalanceLabel')}</strong> {t('checkBalanceP')}
        </p>

        <h2>{t('registeringHeading')}</h2>
        <ol>{t.rich('registeringList', listItemTag)}</ol>

        <h2>{t('afterRegHeading')}</h2>
        <p>{t('afterRegP1')}</p>
        <p>{t('afterRegP2')}</p>

        <h2>{t('playingHeading')}</h2>
        <p>
          <strong>{t('prepareLabel')}</strong> {t('prepareP')}
        </p>
        <p>
          <strong>{t('recordLabel')}</strong> {t('recordP')}
        </p>
        <p>
          <strong>{t('joinLabel')}</strong> {t('joinP')}
        </p>
        <p>
          <strong>{t('playLabel')}</strong> {t('playP')}
        </p>

        <h2>{t('submittingHeading')}</h2>
        <p>{t('submittingIntro')}</p>
        <ol>{t.rich('submittingList', listItemTag)}</ol>
        <p>{t('submittingP2')}</p>

        <h2>{t('afterSubmissionHeading')}</h2>
        <p>{t('afterSubmissionP1')}</p>
        <p>{t('afterSubmissionP2')}</p>

        <h2>{t('tipsHeading')}</h2>
        <ul>{t.rich('tipsList', listItemTag)}</ul>
      </div>
    </StaticPageShell>
  )
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p .` — expect no errors.

- [ ] **Step 8: Manual verification**

Run `npm run dev`, visit `/tournament-guide`, `/fr/tournament-guide`, `/pcm/tournament-guide` — confirm all 7 sections render translated, both numbered lists still numbered.

- [ ] **Step 9: Commit**

```bash
git add messages/en.json messages/fr.json messages/pcm.json "app/[locale]/(public)/tournament-guide/page.tsx"
git commit -m "feat(i18n): translate Tournament Guide page"
```

---

## Task 10: Tournament FAQs (`/tournament-faqs`)

**Files:**
- Modify: `messages/en.json`, `messages/fr.json`, `messages/pcm.json` (add `tournamentFaqs` namespace)
- Modify: `app/[locale]/(public)/tournament-faqs/page.tsx`

**Interfaces:**
- Consumes: `FaqAccordion`, `FaqGroup` from `components/static/FaqAccordion.tsx` (unchanged)

- [ ] **Step 1: Add the `tournamentFaqs` namespace to `messages/en.json`**

```json
  "tournamentFaqs": {
    "eyebrow": "Support",
    "title": "Tournament FAQs",
    "metaTitle": "Tournament FAQs",
    "metaDescription": "Answers to the most common questions about entering, playing, and getting paid from SentinelX tournaments.",
    "groupHeading": "Tournament FAQs",
    "q1": "Can I enter more than one tournament at a time?",
    "a1": "Yes. You can be registered in multiple active tournaments simultaneously.",
    "q2": "What games are currently supported?",
    "a2": "DLS (Dream League Soccer) is the current primary game. EA FC Mobile, eFootball, PUBG Mobile, Free Fire, Call of Duty Mobile, and Mortal Kombat are coming in a future update.",
    "q3": "How are groups and brackets decided?",
    "a3": "When registration closes, the system automatically generates groups based on how many players registered. Admin can review and adjust before publishing. The bracket is then single-elimination from the group stage onwards.",
    "q4": "What if I need to withdraw from a tournament after registering?",
    "a4": "Withdrawal after registration closes is not eligible for a refund unless the tournament is cancelled by SentinelX. If you know in advance you can't play, contact us as early as possible.",
    "q5": "Can I play from any device?",
    "a5": "Yes, as long as the required game is installed and you can maintain a stable connection. All supported games are mobile titles — PC or console play is not applicable.",
    "q6": "What counts as a no-show?",
    "a6": "Failing to appear in the game lobby within 10 minutes of the scheduled match start time. If you're running late, message your opponent via the platform immediately.",
    "q7": "Can I play a match early if both players agree?",
    "a7": "No. Matches must be played at the scheduled time to maintain bracket integrity. Contact admin if you both need to reschedule — admin may approve it at their discretion.",
    "q8": "What if I lose internet during a match?",
    "a8": "Connection loss during a match is not grounds for a result reversal or replay. If you disconnect during a match and your opponent can demonstrate completion, the result stands.",
    "q9": "How long are tournament prizes held before expiry?",
    "a9": "Prize money does not expire — it stays in your wallet until you withdraw it. Ensure your bank account is linked and verified to withdraw.",
    "q10": "I won but my result wasn't confirmed — what do I do?",
    "a10": "First, check that you submitted within 2 hours with both a screenshot and a recording. If you did and it's been over 24 hours with no update, contact admin at sentinelxesports@gmail.com."
  }
```

- [ ] **Step 2: Run the parity test — expect FAIL**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect FAIL.

- [ ] **Step 3: Add the French `tournamentFaqs` namespace to `messages/fr.json`**

```json
  "tournamentFaqs": {
    "eyebrow": "Assistance",
    "title": "FAQ Tournois",
    "metaTitle": "FAQ Tournois",
    "metaDescription": "Réponses aux questions les plus fréquentes sur l'inscription, la participation et le paiement des tournois SentinelX.",
    "groupHeading": "FAQ Tournois",
    "q1": "Puis-je participer à plusieurs tournois en même temps ?",
    "a1": "Oui. Vous pouvez être inscrit à plusieurs tournois actifs simultanément.",
    "q2": "Quels jeux sont actuellement pris en charge ?",
    "a2": "DLS (Dream League Soccer) est actuellement le jeu principal. EA FC Mobile, eFootball, PUBG Mobile, Free Fire, Call of Duty Mobile et Mortal Kombat arrivent dans une future mise à jour.",
    "q3": "Comment les groupes et les tableaux sont-ils décidés ?",
    "a3": "Lorsque les inscriptions se ferment, le système génère automatiquement des groupes selon le nombre de joueurs inscrits. L'administrateur peut vérifier et ajuster avant publication. Le tableau devient ensuite à élimination directe à partir de la phase de groupes.",
    "q4": "Que se passe-t-il si je dois me retirer d'un tournoi après inscription ?",
    "a4": "Un retrait après la fermeture des inscriptions n'est pas éligible à un remboursement, sauf si le tournoi est annulé par SentinelX. Si vous savez à l'avance que vous ne pourrez pas jouer, contactez-nous le plus tôt possible.",
    "q5": "Puis-je jouer depuis n'importe quel appareil ?",
    "a5": "Oui, tant que le jeu requis est installé et que vous pouvez maintenir une connexion stable. Tous les jeux pris en charge sont des titres mobiles — jouer sur PC ou console n'est pas applicable.",
    "q6": "Qu'est-ce qui compte comme une absence ?",
    "a6": "Ne pas se présenter dans le lobby du jeu dans les 10 minutes suivant l'heure de début programmée du match. Si vous êtes en retard, contactez immédiatement votre adversaire via la plateforme.",
    "q7": "Puis-je jouer un match plus tôt si les deux joueurs sont d'accord ?",
    "a7": "Non. Les matchs doivent être joués à l'heure programmée pour préserver l'intégrité du tableau. Contactez l'administrateur si vous devez tous les deux reporter — il peut l'approuver à sa discrétion.",
    "q8": "Que se passe-t-il si je perds ma connexion internet pendant un match ?",
    "a8": "Une perte de connexion pendant un match ne justifie ni l'annulation d'un résultat ni un rejeu. Si vous vous déconnectez pendant un match et que votre adversaire peut démontrer que le match s'est terminé, le résultat est maintenu.",
    "q9": "Combien de temps les gains de tournoi sont-ils conservés avant expiration ?",
    "a9": "Les gains n'expirent pas — ils restent dans votre portefeuille jusqu'à ce que vous les retiriez. Assurez-vous que votre compte bancaire est lié et vérifié pour effectuer un retrait.",
    "q10": "J'ai gagné mais mon résultat n'a pas été confirmé — que dois-je faire ?",
    "a10": "Vérifiez d'abord que vous avez soumis dans les 2 heures avec une capture d'écran et un enregistrement. Si c'est le cas et que plus de 24 heures se sont écoulées sans mise à jour, contactez l'administrateur à sentinelxesports@gmail.com."
  }
```

- [ ] **Step 4: Add the Pidgin `tournamentFaqs` namespace to `messages/pcm.json`**

```json
  "tournamentFaqs": {
    "eyebrow": "Support",
    "title": "Tournament FAQs",
    "metaTitle": "Tournament FAQs",
    "metaDescription": "Answers to di most common questions about entering, playing, and getting paid from SentinelX tournaments.",
    "groupHeading": "Tournament FAQs",
    "q1": "I fit enter more than one tournament di same time?",
    "a1": "Yes. You fit register for many active tournaments at di same time.",
    "q2": "Wetin games dem support now?",
    "a2": "DLS (Dream League Soccer) na di current primary game. EA FC Mobile, eFootball, PUBG Mobile, Free Fire, Call of Duty Mobile, and Mortal Kombat dey come for future update.",
    "q3": "How dem dey decide groups and brackets?",
    "a3": "Wen registration close, system go automatically generate groups based on how many players register. Admin fit review and adjust am before dem publish am. Di bracket go then be single-elimination from group stage go forward.",
    "q4": "Wetin if I need to withdraw from tournament after I don register?",
    "a4": "Withdrawal after registration close no dey eligible for refund unless SentinelX cancel di tournament. If you sabi say you no fit play early early, contact us as soon as possible.",
    "q5": "I fit play from any device?",
    "a5": "Yes, as long as di required game don install and you fit maintain steady connection. All di games wey we support na mobile titles — PC or console play no dey applicable.",
    "q6": "Wetin dem dey count as no-show?",
    "a6": "If you no show for di game lobby within 10 minutes after di scheduled match start time. If you dey run late, message your opponent through di platform sharp sharp.",
    "q7": "I fit play match early if both players agree?",
    "a7": "No. Matches must play for di scheduled time to keep bracket integrity. Contact admin if both of una need to reschedule — admin fit approve am if dem want.",
    "q8": "Wetin if I lose internet during match?",
    "a8": "If connection lost during match, e no be ground to reverse result or replay am. If you disconnect during match and your opponent fit prove say match don complete, di result go stand.",
    "q9": "How long tournament prizes dey stay before dem expire?",
    "a9": "Prize money no dey expire — e go stay for your wallet until you withdraw am. Make sure your bank account don link and verify before you withdraw.",
    "q10": "I win but dem never confam my result — wetin I go do?",
    "a10": "First, check say you submit within 2 hours with both screenshot and recording. If you don do am and e don pass 24 hours without update, contact admin for sentinelxesports@gmail.com."
  }
```

- [ ] **Step 5: Run the parity test — expect PASS**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect PASS.

- [ ] **Step 6: Rewrite `app/[locale]/(public)/tournament-faqs/page.tsx`**

```tsx
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell } from '@/components/static/StaticPageShell'
import { FaqAccordion, type FaqGroup } from '@/components/static/FaqAccordion'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'tournamentFaqs' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/tournament-faqs',
    locale,
  })
}

const ITEM_COUNT = 10

export default async function TournamentFaqsPage() {
  const t = await getTranslations('tournamentFaqs')
  const groups: FaqGroup[] = [
    {
      heading: t('groupHeading'),
      items: Array.from({ length: ITEM_COUNT }, (_, i) => ({
        q: t(`q${i + 1}`),
        a: t(`a${i + 1}`),
      })),
    },
  ]

  return (
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')}>
      <FaqAccordion groups={groups} />
    </StaticPageShell>
  )
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p .` — expect no errors.

- [ ] **Step 8: Manual verification**

Run `npm run dev`, visit `/tournament-faqs`, `/fr/tournament-faqs`, `/pcm/tournament-faqs` — confirm all 10 Q&A pairs render translated and the accordion still expands/collapses.

- [ ] **Step 9: Commit**

```bash
git add messages/en.json messages/fr.json messages/pcm.json "app/[locale]/(public)/tournament-faqs/page.tsx"
git commit -m "feat(i18n): translate Tournament FAQs page"
```

---

## Task 11: About (`/about`)

**Files:**
- Modify: `messages/en.json`, `messages/fr.json`, `messages/pcm.json` (add `about` namespace)
- Modify: `app/[locale]/(public)/about/page.tsx`

**Interfaces:**
- Consumes: nothing new — this page does not use `StaticPageShell` or the rich-tags helper (no inline links/bold inside its prose, and it has its own custom hero/CTA layout).
- Numbers ("50K+", "1,200+", "10+", "15+", "∞") and years ("2024", "2025", "2026+") are NOT translated — only their labels/titles/bodies are.

- [ ] **Step 1: Add the `about` namespace to `messages/en.json`**

```json
  "about": {
    "metaTitle": "About Us · SentinelX Esports",
    "metaDescription": "Sentinel X Esports is building Nigeria's home of mobile esports — our mission and story.",
    "heroEyebrow": "About Sentinel X",
    "heroTitleLine1": "More Than Gaming.",
    "heroTitleLine2": "We Build Legends.",
    "heroSubtitle": "Sentinel X Esports is a competitive gaming ecosystem built to empower gamers, create opportunities and shape the future of esports worldwide.",
    "badge1Title": "Built for Gamers",
    "badge1Body": "By gamers, for gamers.",
    "badge2Title": "Global Vision",
    "badge2Body": "Uniting gamers worldwide.",
    "badge3Title": "Endless Growth",
    "badge3Body": "More opportunities, more victories.",
    "promiseLabel": "Our Promise",
    "promiseQuote": "“We provide a fair, safe and competitive environment where every gamer has the chance to play, grow and succeed.”",
    "promiseAttribution": "— Sentinel",
    "missionLabel": "Our Mission",
    "missionBody": "To empower gamers by creating opportunities through tournaments, communities, resources and partnerships that drive the growth of esports.",
    "visionLabel": "Our Vision",
    "visionBody": "To become a global esports leader, inspiring the next generation of champions and making esports a recognized and respected industry worldwide.",
    "valuesLabel": "Our Values",
    "value1Label": "Integrity",
    "value1Body": "We play fair and keep our word.",
    "value2Label": "Passion",
    "value2Body": "We love gaming and it shows in everything we do.",
    "value3Label": "Community",
    "value3Body": "We grow together and support each other.",
    "value4Label": "Excellence",
    "value4Body": "We aim for the best in every match, every day.",
    "stat1Label": "Active Gamers",
    "stat2Label": "Tournaments Hosted",
    "stat3Label": "Games Supported",
    "stat4Label": "Countries Reached",
    "stat5Label": "Opportunities Ahead",
    "storyLabel": "Our Story",
    "storyHeading": "From Passion to Purpose",
    "storyIntro": "Sentinel X was born from a simple belief: gamers deserve more. More opportunities, more platforms, and more respect.",
    "timeline1Title": "The Beginning",
    "timeline1Body": "Sentinel X was founded with a small group of gamers and a big dream to build a better esports community.",
    "timeline2Title": "First Tournaments",
    "timeline2Body": "We hosted our first official tournaments and saw amazing talent from all around.",
    "timeline3Title": "Building the Ecosystem",
    "timeline3Body": "We launched new features, partnered with brands and grew our community across different games.",
    "timeline4Title": "The Future",
    "timeline4Body": "We're just getting started. More games, more opportunities and a global impact.",
    "whySentinelLabel": "Why Sentinel X?",
    "whySentinelHeading": "We Provide More",
    "pillar1Label": "Competitive Tournaments",
    "pillar2Label": "Active Community",
    "pillar3Label": "Safe & Fair Play",
    "pillar4Label": "Rewards & Opportunities",
    "pillar5Label": "Partnerships",
    "pillar6Label": "Resources & Education",
    "ctaHeading": "Be Part of Something Bigger.",
    "ctaSubtitle": "This is more than gaming. This is Sentinel X.",
    "ctaButton": "Join the Community →"
  }
```

- [ ] **Step 2: Run the parity test — expect FAIL**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect FAIL.

- [ ] **Step 3: Add the French `about` namespace to `messages/fr.json`**

```json
  "about": {
    "metaTitle": "À propos · SentinelX Esports",
    "metaDescription": "Sentinel X Esports construit le foyer de l'esport mobile au Nigeria — notre mission et notre histoire.",
    "heroEyebrow": "À propos de Sentinel X",
    "heroTitleLine1": "Plus que du jeu.",
    "heroTitleLine2": "Nous forgeons des légendes.",
    "heroSubtitle": "Sentinel X Esports est un écosystème de jeu compétitif conçu pour donner du pouvoir aux gamers, créer des opportunités et façonner l'avenir de l'esport dans le monde.",
    "badge1Title": "Conçu pour les gamers",
    "badge1Body": "Par des gamers, pour des gamers.",
    "badge2Title": "Vision mondiale",
    "badge2Body": "Unir les gamers du monde entier.",
    "badge3Title": "Croissance sans limite",
    "badge3Body": "Plus d'opportunités, plus de victoires.",
    "promiseLabel": "Notre promesse",
    "promiseQuote": "« Nous offrons un environnement équitable, sûr et compétitif où chaque gamer a la chance de jouer, progresser et réussir. »",
    "promiseAttribution": "— Sentinel",
    "missionLabel": "Notre mission",
    "missionBody": "Donner du pouvoir aux gamers en créant des opportunités à travers des tournois, des communautés, des ressources et des partenariats qui portent la croissance de l'esport.",
    "visionLabel": "Notre vision",
    "visionBody": "Devenir un leader mondial de l'esport, inspirer la prochaine génération de champions et faire de l'esport une industrie reconnue et respectée dans le monde entier.",
    "valuesLabel": "Nos valeurs",
    "value1Label": "Intégrité",
    "value1Body": "Nous jouons franc jeu et tenons parole.",
    "value2Label": "Passion",
    "value2Body": "Nous aimons le jeu et cela se voit dans tout ce que nous faisons.",
    "value3Label": "Communauté",
    "value3Body": "Nous grandissons ensemble et nous nous soutenons mutuellement.",
    "value4Label": "Excellence",
    "value4Body": "Nous visons le meilleur à chaque match, chaque jour.",
    "stat1Label": "Gamers actifs",
    "stat2Label": "Tournois organisés",
    "stat3Label": "Jeux pris en charge",
    "stat4Label": "Pays touchés",
    "stat5Label": "Opportunités à venir",
    "storyLabel": "Notre histoire",
    "storyHeading": "De la passion au but",
    "storyIntro": "Sentinel X est né d'une conviction simple : les gamers méritent mieux. Plus d'opportunités, plus de plateformes, et plus de respect.",
    "timeline1Title": "Les débuts",
    "timeline1Body": "Sentinel X a été fondé par un petit groupe de gamers avec un grand rêve : bâtir une meilleure communauté esport.",
    "timeline2Title": "Premiers tournois",
    "timeline2Body": "Nous avons organisé nos premiers tournois officiels et découvert des talents incroyables venus de partout.",
    "timeline3Title": "Construire l'écosystème",
    "timeline3Body": "Nous avons lancé de nouvelles fonctionnalités, noué des partenariats avec des marques et fait grandir notre communauté sur différents jeux.",
    "timeline4Title": "L'avenir",
    "timeline4Body": "Nous ne faisons que commencer. Plus de jeux, plus d'opportunités et un impact mondial.",
    "whySentinelLabel": "Pourquoi Sentinel X ?",
    "whySentinelHeading": "Nous offrons plus",
    "pillar1Label": "Tournois compétitifs",
    "pillar2Label": "Communauté active",
    "pillar3Label": "Jeu sûr et équitable",
    "pillar4Label": "Récompenses et opportunités",
    "pillar5Label": "Partenariats",
    "pillar6Label": "Ressources et éducation",
    "ctaHeading": "Faites partie de quelque chose de plus grand.",
    "ctaSubtitle": "Ceci est plus que du jeu. Ceci est Sentinel X.",
    "ctaButton": "Rejoindre la communauté →"
  }
```

- [ ] **Step 4: Add the Pidgin `about` namespace to `messages/pcm.json`**

```json
  "about": {
    "metaTitle": "About Us · SentinelX Esports",
    "metaDescription": "Sentinel X Esports dey build Nigeria home of mobile esports — our mission and story.",
    "heroEyebrow": "About Sentinel X",
    "heroTitleLine1": "E Pass Just Gaming.",
    "heroTitleLine2": "We Dey Build Legends.",
    "heroSubtitle": "Sentinel X Esports na competitive gaming ecosystem wey dem build to empower gamers, create opportunities and shape di future of esports worldwide.",
    "badge1Title": "Built for Gamers",
    "badge1Body": "By gamers, for gamers.",
    "badge2Title": "Global Vision",
    "badge2Body": "To unite gamers worldwide.",
    "badge3Title": "Endless Growth",
    "badge3Body": "More opportunities, more victories.",
    "promiseLabel": "Our Promise",
    "promiseQuote": "“We dey provide fair, safe and competitive environment where every gamer get chance to play, grow and succeed.”",
    "promiseAttribution": "— Sentinel",
    "missionLabel": "Our Mission",
    "missionBody": "To empower gamers as we dey create opportunities through tournaments, communities, resources and partnerships wey dey push esports growth.",
    "visionLabel": "Our Vision",
    "visionBody": "To become global esports leader, inspire di next generation of champions and make esports one recognized and respected industry worldwide.",
    "valuesLabel": "Our Values",
    "value1Label": "Integrity",
    "value1Body": "We dey play fair and we dey keep our word.",
    "value2Label": "Passion",
    "value2Body": "We love gaming and e dey show for everything wey we do.",
    "value3Label": "Community",
    "value3Body": "We dey grow together and we dey support each other.",
    "value4Label": "Excellence",
    "value4Body": "We dey aim for di best for every match, every day.",
    "stat1Label": "Active Gamers",
    "stat2Label": "Tournaments Hosted",
    "stat3Label": "Games Supported",
    "stat4Label": "Countries Reached",
    "stat5Label": "Opportunities Ahead",
    "storyLabel": "Our Story",
    "storyHeading": "From Passion to Purpose",
    "storyIntro": "Sentinel X born from one simple belief: gamers deserve more. More opportunities, more platforms, and more respect.",
    "timeline1Title": "Di Beginning",
    "timeline1Body": "Small group of gamers found Sentinel X with big dream to build better esports community.",
    "timeline2Title": "First Tournaments",
    "timeline2Body": "We host our first official tournaments and see amazing talent from everywhere.",
    "timeline3Title": "How We Build Di Ecosystem",
    "timeline3Body": "We launch new features, partner with brands and grow our community across different games.",
    "timeline4Title": "Di Future",
    "timeline4Body": "We just dey start. More games, more opportunities and global impact dey come.",
    "whySentinelLabel": "Why Sentinel X?",
    "whySentinelHeading": "We Dey Provide More",
    "pillar1Label": "Competitive Tournaments",
    "pillar2Label": "Active Community",
    "pillar3Label": "Safe & Fair Play",
    "pillar4Label": "Rewards & Opportunities",
    "pillar5Label": "Partnerships",
    "pillar6Label": "Resources & Education",
    "ctaHeading": "Be Part of Something Bigger.",
    "ctaSubtitle": "Dis one pass just gaming. Dis na Sentinel X.",
    "ctaButton": "Join Di Community →"
  }
```

- [ ] **Step 5: Run the parity test — expect PASS**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect PASS.

- [ ] **Step 6: Rewrite `app/[locale]/(public)/about/page.tsx`**

```tsx
import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { ShieldCheck, Target, Eye, Gem, Flag, Trophy, Users, Rocket, Handshake, BookOpen, Gift } from 'lucide-react'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'
import { findOptionalPublicImage } from '@/lib/media/optional-image'
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'about' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/about',
    image: DEFAULT_OG_IMAGE,
    locale,
  })
}

const WHATSAPP_COMMUNITY = process.env.NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL ?? '#'

export default async function AboutPage() {
  const t = await getTranslations('about')
  const whySentinelImg = findOptionalPublicImage('about', 'why-sentinel-x')
  const missionImg = findOptionalPublicImage('about', 'mission-bg')
  const visionImg = findOptionalPublicImage('about', 'vision-bg')

  const badges = [
    { title: t('badge1Title'), body: t('badge1Body') },
    { title: t('badge2Title'), body: t('badge2Body') },
    { title: t('badge3Title'), body: t('badge3Body') },
  ]

  const values = [
    { label: t('value1Label'), body: t('value1Body') },
    { label: t('value2Label'), body: t('value2Body') },
    { label: t('value3Label'), body: t('value3Body') },
    { label: t('value4Label'), body: t('value4Body') },
  ]

  // Aspirational/vision numbers, not live DB stats — hardcoded per spec §3.6. Not
  // language-dependent, only the label is translated.
  const stats = [
    { value: '50K+', label: t('stat1Label') },
    { value: '1,200+', label: t('stat2Label') },
    { value: '10+', label: t('stat3Label') },
    { value: '15+', label: t('stat4Label') },
    { value: '∞', label: t('stat5Label') },
  ]

  const timeline = [
    { icon: Flag, year: '2024', title: t('timeline1Title'), body: t('timeline1Body') },
    { icon: Trophy, year: '2024', title: t('timeline2Title'), body: t('timeline2Body') },
    { icon: Users, year: '2025', title: t('timeline3Title'), body: t('timeline3Body') },
    { icon: Rocket, year: '2026+', title: t('timeline4Title'), body: t('timeline4Body') },
  ]

  const pillars = [
    { icon: Trophy, label: t('pillar1Label') },
    { icon: Users, label: t('pillar2Label') },
    { icon: ShieldCheck, label: t('pillar3Label') },
    { icon: Gift, label: t('pillar4Label') },
    { icon: Handshake, label: t('pillar5Label') },
    { icon: BookOpen, label: t('pillar6Label') },
  ]

  return (
    <div className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="relative mb-10 overflow-hidden rounded-2xl border border-sx-border bg-sx-surface">
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-sx-purple/25 blur-[100px]"
        />
        <div className="relative px-6 py-10 sm:px-10 sm:py-14 lg:py-16 lg:pr-64 xl:pr-[22rem]">
          <div className="text-center lg:text-left">
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-sx-purple-text">{t('heroEyebrow')}</p>
            <h1 className="font-display text-4xl font-black uppercase leading-[0.95] tracking-tight text-white sm:text-5xl lg:text-6xl">
              {t('heroTitleLine1')}
              <br />
              <span className="text-sx-purple-text">{t('heroTitleLine2')}</span>
            </h1>
            <p className="mx-auto mt-4 max-w-md text-sm text-sx-gray sm:text-base lg:mx-0">{t('heroSubtitle')}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-4 text-left lg:justify-start">
              {badges.map((b) => (
                <div key={b.title}>
                  <p className="text-xs font-bold text-white">{b.title}</p>
                  <p className="text-[11px] text-sx-gray">{b.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* mascot-about.png is the fist-pump pose, not the mockup's open-hand
            reach-toward-viewer render — placeholder until the exact one lands. */}
        <ImagePlaceholder
          className="relative mx-auto -mt-2 h-64 w-52 pb-8 sm:h-80 sm:w-64 lg:absolute lg:inset-y-0 lg:right-56 lg:mx-0 lg:h-auto lg:w-56 lg:pb-0 xl:right-64 xl:w-64"
          label={'Sentinel mascot — open hand reaching toward viewer\n(public/mascot/mascot-about.png)'}
        />

        {/* Our Promise — floats top-right, independent of the mascot's height */}
        <div className="relative mx-auto mt-6 w-full max-w-xs rounded-xl border border-sx-purple/30 bg-sx-surface p-5 lg:absolute lg:right-6 lg:top-8 lg:mx-0 lg:mt-0 lg:w-56 xl:w-64">
          <p className="mb-2 flex items-center gap-2 text-sm font-bold text-white">
            <ShieldCheck className="h-4 w-4 text-sx-purple-text" /> {t('promiseLabel')}
          </p>
          <p className="text-xs italic text-sx-gray">{t('promiseQuote')}</p>
          <p className="mt-3 font-display text-lg italic text-sx-purple-text">{t('promiseAttribution')}</p>
        </div>
      </section>

      {/* ── Mission / Vision / Values ─────────────────────────── */}
      <section className="mb-10 grid gap-4 lg:grid-cols-3">
        <MissionCard icon={Target} label={t('missionLabel')} bgImage={missionImg}>
          {t('missionBody')}
        </MissionCard>
        <MissionCard icon={Eye} label={t('visionLabel')} bgImage={visionImg}>
          {t('visionBody')}
        </MissionCard>
        <div className="rounded-xl border border-sx-border bg-sx-surface p-6">
          <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-sx-purple-text">
            <Gem className="h-4 w-4" /> {t('valuesLabel')}
          </p>
          <div className="space-y-2.5">
            {values.map((v) => (
              <p key={v.label} className="text-sm text-white">
                <span className="font-bold">{v.label}</span> <span className="text-sx-gray">— {v.body}</span>
              </p>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats bar ─────────────────────────────────────────── */}
      <section className="mb-10 grid grid-cols-2 gap-4 rounded-xl border border-sx-border bg-sx-surface p-6 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="text-center">
            <p className="font-display text-2xl font-black text-white">{s.value}</p>
            <p className="mt-0.5 text-[11px] uppercase tracking-wide text-sx-gray">{s.label}</p>
          </div>
        ))}
      </section>

      {/* ── Our Story timeline ────────────────────────────────── */}
      <section className="mb-10 rounded-xl border border-sx-border bg-sx-surface p-6 sm:p-8">
        <p className="mb-1 text-xs font-bold uppercase tracking-widest text-sx-purple-text">{t('storyLabel')}</p>
        <h2 className="mb-3 font-display text-2xl font-black text-white">{t('storyHeading')}</h2>
        <p className="mb-8 max-w-2xl text-sm text-sx-gray">{t('storyIntro')}</p>
        <div className="relative grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div
            aria-hidden
            className="absolute left-5 right-5 top-5 hidden h-px bg-gradient-to-r from-transparent via-sx-purple/40 to-transparent lg:block"
          />
          {timeline.map((t2) => (
            <div key={t2.year + t2.title} className="relative">
              <span className="relative z-10 mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-sx-purple/30 bg-sx-bg text-sx-purple-text">
                <t2.icon className="h-5 w-5" />
              </span>
              <p className="text-xs font-bold text-sx-purple-text">{t2.year}</p>
              <p className="mb-1 font-bold text-white">{t2.title}</p>
              <p className="text-xs text-sx-gray">{t2.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Why Sentinel X ────────────────────────────────────── */}
      <section className="mb-10 grid gap-8 rounded-xl border border-sx-border bg-sx-surface p-6 sm:p-8 lg:grid-cols-2 lg:items-center">
        {whySentinelImg ? (
          <div className="relative mx-auto h-64 w-full max-w-sm overflow-hidden rounded-xl">
            <Image src={whySentinelImg} alt="" fill className="object-cover" />
          </div>
        ) : (
          <ImagePlaceholder
            className="mx-auto h-64 w-full max-w-sm"
            label={'Stadium/arena crowd photo — mascot seen from behind, facing the stage\n(public/about/why-sentinel-x.jpg)'}
          />
        )}
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-widest text-sx-purple-text">{t('whySentinelLabel')}</p>
          <h2 className="mb-5 font-display text-2xl font-black text-white">{t('whySentinelHeading')}</h2>
          <div className="grid grid-cols-2 gap-5">
            {pillars.map((p) => (
              <div key={p.label} className="flex items-center gap-2.5">
                <p.icon className="h-5 w-5 shrink-0 text-sx-purple-text" />
                <p className="text-sm font-semibold text-white">{p.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA banner ────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-xl border border-sx-purple/30 bg-gradient-to-r from-sx-purple/20 to-transparent py-8 pl-24 pr-8 text-center sm:pl-32">
        <div className="pointer-events-none absolute bottom-0 left-2 hidden h-full w-24 sm:block">
          <Image src="/mascot/mascot-about.png" alt="" fill sizes="6rem" className="object-contain object-bottom" />
        </div>
        <p className="font-display text-2xl font-black uppercase text-white sm:text-3xl">{t('ctaHeading')}</p>
        <p className="mt-2 text-sm text-sx-gray">{t('ctaSubtitle')}</p>
        <a
          href={WHATSAPP_COMMUNITY}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-sx-purple px-6 py-3 text-sm font-bold text-white shadow-[0_0_20px_rgba(124,58,237,0.4)] transition-colors hover:bg-sx-purple-light"
        >
          <Users className="h-4 w-4" /> {t('ctaButton')}
        </a>
      </section>
    </div>
  )
}

function MissionCard({
  icon: Icon,
  label,
  bgImage,
  children,
}: {
  icon: typeof Target
  label: string
  bgImage: string | null
  children: React.ReactNode
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-sx-border bg-sx-surface p-6">
      {bgImage && (
        <>
          <Image src={bgImage} alt="" fill className="object-cover opacity-20" />
          <div className="absolute inset-0 bg-gradient-to-t from-sx-surface via-sx-surface/80 to-sx-surface/40" />
        </>
      )}
      <div className="relative">
        <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-sx-purple-text">
          <Icon className="h-4 w-4" /> {label}
        </p>
        <p className="text-sm text-sx-gray">{children}</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p .` — expect no errors. (Note the timeline `.map()` callback uses `t2` instead of `t` to avoid shadowing the outer `t` translation function.)

- [ ] **Step 8: Manual verification**

Run `npm run dev`, visit `/about`, `/fr/about`, `/pcm/about` — confirm hero, badges, mission/vision/values, stats, timeline, "Why Sentinel X" pillars, and the CTA banner all render translated, and the WhatsApp CTA link still works.

- [ ] **Step 9: Commit**

```bash
git add messages/en.json messages/fr.json messages/pcm.json "app/[locale]/(public)/about/page.tsx"
git commit -m "feat(i18n): translate About page"
```

---

## Task 12: Contact (`/contact`)

**Files:**
- Modify: `messages/en.json`, `messages/fr.json`, `messages/pcm.json` (add `contact` namespace)
- Modify: `app/[locale]/(public)/contact/page.tsx`

**Interfaces:**
- Consumes: `emailTag`, `listItemTag` from `components/static/richTags.tsx` (Task 1)

- [ ] **Step 1: Add the `contact` namespace to `messages/en.json`**

```json
  "contact": {
    "eyebrow": "Support",
    "title": "Contact Us",
    "subtitle": "Whether you have a question about a tournament, a problem with your account, or something else — we're reachable and we respond.",
    "metaTitle": "Contact Us",
    "metaDescription": "Reach the SentinelX team by email or WhatsApp — we aim to respond within 24 hours.",
    "emailLabel": "Email",
    "emailResponseNote": "We aim to respond within 24 hours on business days.",
    "whatsappLabel": "WhatsApp",
    "whatsappNote": "Message us directly — fastest for urgent issues like match disputes or account problems.",
    "whatsappCta": "Message us on WhatsApp →",
    "whatToIncludeHeading": "What to Include in Your Message",
    "whatToIncludeIntro": "To help us resolve your issue quickly, include:",
    "whatToIncludeList": "<li>Your SentinelX username</li><li>The tournament name (if relevant)</li><li>A clear description of the problem</li><li>Any screenshots that help explain the issue</li>",
    "commonIssuesHeading": "Common Issues",
    "forgotPasswordLabel": "Forgot your password?",
    "forgotPasswordP": "Use the “Forgot Password” link on the login page — no need to contact us.",
    "paymentIssueLabel": "Payment issue?",
    "paymentIssueP": "Include your Paystack payment reference.",
    "matchDisputeLabel": "Match dispute?",
    "matchDisputeP": "Include the match ID and your screen recording.",
    "withdrawalLabel": "Withdrawal not received?",
    "withdrawalP": "Allow 1–5 business days before contacting us. Include your withdrawal request date and bank name.",
    "reportAbuseHeading": "Report Abuse or Safety Concerns",
    "reportAbuseP1": "If you're experiencing harassment, threats, or have a safety concern, email <email>sentinelxesports@gmail.com</email> with “URGENT” in the subject line. We prioritise these reports."
  }
```

- [ ] **Step 2: Run the parity test — expect FAIL**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect FAIL.

- [ ] **Step 3: Add the French `contact` namespace to `messages/fr.json`**

```json
  "contact": {
    "eyebrow": "Assistance",
    "title": "Nous contacter",
    "subtitle": "Que vous ayez une question sur un tournoi, un problème avec votre compte, ou autre chose — nous sommes joignables et nous répondons.",
    "metaTitle": "Nous contacter",
    "metaDescription": "Contactez l'équipe SentinelX par e-mail ou WhatsApp — nous visons à répondre sous 24 heures.",
    "emailLabel": "E-mail",
    "emailResponseNote": "Nous visons à répondre sous 24 heures les jours ouvrés.",
    "whatsappLabel": "WhatsApp",
    "whatsappNote": "Contactez-nous directement — le plus rapide pour les problèmes urgents comme les litiges de match ou les problèmes de compte.",
    "whatsappCta": "Nous contacter sur WhatsApp →",
    "whatToIncludeHeading": "Que mentionner dans votre message",
    "whatToIncludeIntro": "Pour nous aider à résoudre votre problème rapidement, incluez :",
    "whatToIncludeList": "<li>Votre nom d'utilisateur SentinelX</li><li>Le nom du tournoi (si pertinent)</li><li>Une description claire du problème</li><li>Toute capture d'écran qui aide à expliquer le problème</li>",
    "commonIssuesHeading": "Problèmes courants",
    "forgotPasswordLabel": "Mot de passe oublié ?",
    "forgotPasswordP": "Utilisez le lien « Mot de passe oublié » sur la page de connexion — inutile de nous contacter.",
    "paymentIssueLabel": "Problème de paiement ?",
    "paymentIssueP": "Indiquez votre référence de paiement Paystack.",
    "matchDisputeLabel": "Litige de match ?",
    "matchDisputeP": "Indiquez l'identifiant du match et votre enregistrement d'écran.",
    "withdrawalLabel": "Retrait non reçu ?",
    "withdrawalP": "Patientez 1 à 5 jours ouvrés avant de nous contacter. Indiquez la date de votre demande de retrait et le nom de votre banque.",
    "reportAbuseHeading": "Signaler un abus ou un problème de sécurité",
    "reportAbuseP1": "Si vous subissez du harcèlement, des menaces, ou avez une préoccupation de sécurité, écrivez à <email>sentinelxesports@gmail.com</email> avec « URGENT » dans l'objet. Nous priorisons ces signalements."
  }
```

- [ ] **Step 4: Add the Pidgin `contact` namespace to `messages/pcm.json`**

```json
  "contact": {
    "eyebrow": "Support",
    "title": "Contact Us",
    "subtitle": "Wheda you get question about tournament, problem with your account, or something else — we dey reachable and we dey respond.",
    "metaTitle": "Contact Us",
    "metaDescription": "Reach SentinelX team through email or WhatsApp — we dey aim to respond within 24 hours.",
    "emailLabel": "Email",
    "emailResponseNote": "We dey aim to respond within 24 hours for business days.",
    "whatsappLabel": "WhatsApp",
    "whatsappNote": "Message us direct — dis one dey fastest for urgent issues like match dispute or account problem.",
    "whatsappCta": "Message Us for WhatsApp →",
    "whatToIncludeHeading": "Wetin to Include for Your Message",
    "whatToIncludeIntro": "To help us resolve your issue quick quick, include:",
    "whatToIncludeList": "<li>Your SentinelX username</li><li>Di tournament name (if e relevant)</li><li>Clear description of di problem</li><li>Any screenshot wey go help explain di issue</li>",
    "commonIssuesHeading": "Common Issues",
    "forgotPasswordLabel": "You forget your password?",
    "forgotPasswordP": "Use di \"Forgot Password\" link for login page — no need to contact us.",
    "paymentIssueLabel": "Payment issue?",
    "paymentIssueP": "Include your Paystack payment reference.",
    "matchDisputeLabel": "Match dispute?",
    "matchDisputeP": "Include di match ID and your screen recording.",
    "withdrawalLabel": "Withdrawal wey never enter?",
    "withdrawalP": "Allow 1–5 business days before you contact us. Include your withdrawal request date and bank name.",
    "reportAbuseHeading": "Report Abuse or Safety Concerns",
    "reportAbuseP1": "If you dey experience harassment, threat, or you get safety concern, email <email>sentinelxesports@gmail.com</email> with \"URGENT\" for di subject line. We dey prioritise dis kind reports."
  }
```

- [ ] **Step 5: Run the parity test — expect PASS**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect PASS.

- [ ] **Step 6: Rewrite `app/[locale]/(public)/contact/page.tsx`**

```tsx
import { Mail } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell } from '@/components/static/StaticPageShell'
import { emailTag, listItemTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'contact' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/contact',
    locale,
  })
}

const WHATSAPP_HREF = 'https://wa.me/2349032395685?text=Hi%20SentinelX%2C%20I%20need%20help%20with...'

export default async function ContactPage() {
  const t = await getTranslations('contact')
  return (
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-sx-border bg-sx-surface p-6">
          <p className="mb-2 flex items-center gap-2 text-sm font-bold text-white">
            <Mail className="h-4 w-4 text-sx-purple-text" /> {t('emailLabel')}
          </p>
          <a
            href="mailto:sentinelxesports@gmail.com"
            className="text-sm font-semibold text-sx-purple-text hover:text-white"
          >
            sentinelxesports@gmail.com
          </a>
          <p className="mt-2 text-xs text-sx-gray">{t('emailResponseNote')}</p>
        </div>
        <div className="rounded-xl border border-sx-border bg-sx-surface p-6">
          <p className="mb-2 flex items-center gap-2 text-sm font-bold text-white">
            <WhatsAppIcon className="h-4 w-4 text-[#25D366]" /> {t('whatsappLabel')}
          </p>
          <p className="text-sm font-semibold text-white">+234 903 239 5685</p>
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

        <h2>{t('commonIssuesHeading')}</h2>
        <p>
          <strong>{t('forgotPasswordLabel')}</strong> {t('forgotPasswordP')}
        </p>
        <p>
          <strong>{t('paymentIssueLabel')}</strong> {t('paymentIssueP')}
        </p>
        <p>
          <strong>{t('matchDisputeLabel')}</strong> {t('matchDisputeP')}
        </p>
        <p>
          <strong>{t('withdrawalLabel')}</strong> {t('withdrawalP')}
        </p>

        <h2>{t('reportAbuseHeading')}</h2>
        <p>{t.rich('reportAbuseP1', emailTag())}</p>
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

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p .` — expect no errors.

- [ ] **Step 8: Manual verification**

Run `npm run dev`, visit `/contact`, `/fr/contact`, `/pcm/contact` — confirm both cards and all prose sections render translated, and both the mailto and WhatsApp links still work.

- [ ] **Step 9: Commit**

```bash
git add messages/en.json messages/fr.json messages/pcm.json "app/[locale]/(public)/contact/page.tsx"
git commit -m "feat(i18n): translate Contact page"
```

---

## Task 13: Help Center (`/help`)

**Files:**
- Modify: `messages/en.json`, `messages/fr.json`, `messages/pcm.json` (add `help` namespace)
- Modify: `app/[locale]/(public)/help/page.tsx`

**Interfaces:**
- Consumes: `FaqAccordion`, `FaqGroup` from `components/static/FaqAccordion.tsx` (unchanged)

- [ ] **Step 1: Add the `help` namespace to `messages/en.json`**

```json
  "help": {
    "eyebrow": "Support",
    "title": "Help Center",
    "metaTitle": "Help Center",
    "metaDescription": "Answers to common questions about accounts, tournaments, prizes, SX Score, and SX Coins.",
    "gettingStarted": {
      "heading": "Getting Started",
      "q1": "How do I create an account?",
      "a1": "Click \"Sign Up\" on the homepage. Enter your email address and choose a username. Verify your email using the link we send you, then complete your profile.",
      "q2": "Can I change my username?",
      "a2": "Yes, but only once. Go to Settings to make the change. After that, your username is locked — contact support if you have a serious reason to change it again.",
      "q3": "Is SentinelX free to use?",
      "a3": "Creating an account and browsing the platform is free. Entering tournaments costs ₦500 per tournament, or you can use SX Coins you've earned to reduce or eliminate the fee."
    },
    "tournaments": {
      "heading": "Tournaments",
      "q1": "How do I register for a tournament?",
      "a1": "Go to the Tournaments page, find an open tournament, and click \"Register.\" You'll be taken to the payment screen. Complete your ₦500 payment via Paystack to confirm your spot.",
      "q2": "What happens if I miss my match?",
      "a2": "A no-show means your opponent advances automatically and you lose 100 SX Score points. Always check your fixture on your Player Dashboard and set a reminder.",
      "q3": "How do I submit a match result?",
      "a3": "Go to Dashboard → My Matches → Submit Result. Upload a screenshot of the final scoreline and a screen recording of the match. Both are required.",
      "q4": "What if my opponent submits a wrong result?",
      "a4": "You can dispute the result within 1 hour of submission. Go to the match page and click \"Dispute.\" Admin will review both players' recordings and make a final decision.",
      "q5": "How long does it take for results to be confirmed?",
      "a5": "Admin aims to confirm results within 24 hours of submission. Complex disputes may take longer.",
      "q6": "What if a tournament is cancelled?",
      "a6": "You'll receive a full refund to your original payment method within 3–7 business days."
    },
    "prizes": {
      "heading": "Prizes and Payments",
      "q1": "How do I withdraw my prize money?",
      "a1": "Go to Dashboard → Wallet → Withdraw. Link your Nigerian bank account (first time only), enter the amount, and submit a withdrawal request. We'll process it within 1–5 business days.",
      "q2": "Is there a minimum withdrawal amount?",
      "a2": "Yes — ₦1,000 minimum.",
      "q3": "Why do I need to verify my identity before withdrawing?",
      "a3": "We verify your bank account via Paystack to ensure prize money goes to the right person and to comply with Nigerian financial regulations.",
      "q4": "When will I receive my withdrawal?",
      "a4": "Typically 1–5 business days after your request is approved. Delays can occur due to your bank's processing times, which are outside our control."
    },
    "sxScore": {
      "heading": "SX Score",
      "q1": "What is SX Score?",
      "a1": "SX Score is your reliability and fair-play rating on the platform. Every player starts at 700. It goes up when you win and behave well, and down when you no-show, cheat, or lose disputes.",
      "q2": "What are the SX Score tiers?",
      "a2": "900 and above: Elite (🟢). 750–899: Trusted (🔵). 600–749: Developing (🟡). Below 600: At Risk (🔴).",
      "q3": "Can my SX Score recover?",
      "a3": "Yes. There's no floor cap — you can always earn your way back up by competing fairly."
    },
    "sxCoins": {
      "heading": "SX Coins",
      "q1": "What are SX Coins?",
      "a1": "SX Coins are an in-platform virtual currency. You earn them by competing, completing challenges, and unlocking achievements.",
      "q2": "Can I convert SX Coins to naira?",
      "a2": "No. SX Coins are virtual and cannot be exchanged for cash. They can only be spent within the platform.",
      "q3": "What can I spend SX Coins on?",
      "a3": "Tournament entry fee discounts (500 coins = ₦250 off, 1,000 coins = free entry), post boosts in the community, and items in the in-platform store."
    },
    "accountSafety": {
      "heading": "Account and Safety",
      "q1": "I forgot my password. What do I do?",
      "a1": "Click \"Forgot Password\" on the login page. We'll send a reset link to your registered email address.",
      "q2": "How do I report a player?",
      "a2": "Email sentinelxesports@gmail.com with the player's username and details of the incident. For community posts, use the report button on the post.",
      "q3": "I think my account has been hacked. What do I do?",
      "a3": "Change your password immediately using the \"Forgot Password\" link on the login page, then email us at sentinelxesports@gmail.com. We'll lock the account and help you recover it."
    }
  }
```

- [ ] **Step 2: Run the parity test — expect FAIL**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect FAIL.

- [ ] **Step 3: Add the French `help` namespace to `messages/fr.json`**

```json
  "help": {
    "eyebrow": "Assistance",
    "title": "Centre d'aide",
    "metaTitle": "Centre d'aide",
    "metaDescription": "Réponses aux questions courantes sur les comptes, les tournois, les gains, le SX Score et les SX Coins.",
    "gettingStarted": {
      "heading": "Premiers pas",
      "q1": "Comment créer un compte ?",
      "a1": "Cliquez sur « S'inscrire » sur la page d'accueil. Saisissez votre adresse e-mail et choisissez un nom d'utilisateur. Vérifiez votre e-mail à l'aide du lien que nous vous envoyons, puis complétez votre profil.",
      "q2": "Puis-je changer mon nom d'utilisateur ?",
      "a2": "Oui, mais une seule fois. Allez dans Paramètres pour effectuer le changement. Après cela, votre nom d'utilisateur est verrouillé — contactez le support si vous avez une raison sérieuse de le changer à nouveau.",
      "q3": "L'utilisation de SentinelX est-elle gratuite ?",
      "a3": "Créer un compte et parcourir la plateforme est gratuit. S'inscrire aux tournois coûte ₦500 par tournoi, ou vous pouvez utiliser des SX Coins gagnés pour réduire ou annuler les frais."
    },
    "tournaments": {
      "heading": "Tournois",
      "q1": "Comment m'inscrire à un tournoi ?",
      "a1": "Allez sur la page Tournois, trouvez un tournoi ouvert, et cliquez sur « S'inscrire ». Vous serez dirigé vers l'écran de paiement. Effectuez votre paiement de ₦500 via Paystack pour confirmer votre place.",
      "q2": "Que se passe-t-il si je manque mon match ?",
      "a2": "Une absence signifie que votre adversaire avance automatiquement et que vous perdez 100 points de SX Score. Vérifiez toujours votre match sur votre tableau de bord joueur et définissez un rappel.",
      "q3": "Comment soumettre un résultat de match ?",
      "a3": "Allez dans Tableau de bord → Mes matchs → Soumettre le résultat. Téléchargez une capture d'écran du score final et un enregistrement d'écran du match. Les deux sont requis.",
      "q4": "Que se passe-t-il si mon adversaire soumet un résultat incorrect ?",
      "a4": "Vous pouvez contester le résultat dans l'heure suivant la soumission. Allez sur la page du match et cliquez sur « Contester ». L'administrateur examinera les enregistrements des deux joueurs et prendra une décision finale.",
      "q5": "Combien de temps faut-il pour que les résultats soient confirmés ?",
      "a5": "L'administrateur vise à confirmer les résultats sous 24 heures après soumission. Les litiges complexes peuvent prendre plus de temps.",
      "q6": "Que se passe-t-il si un tournoi est annulé ?",
      "a6": "Vous recevrez un remboursement intégral sur votre mode de paiement d'origine sous 3 à 7 jours ouvrés."
    },
    "prizes": {
      "heading": "Gains et paiements",
      "q1": "Comment retirer mes gains ?",
      "a1": "Allez dans Tableau de bord → Portefeuille → Retirer. Liez votre compte bancaire nigérian (première fois seulement), saisissez le montant, et soumettez une demande de retrait. Nous la traiterons sous 1 à 5 jours ouvrés.",
      "q2": "Y a-t-il un montant minimum de retrait ?",
      "a2": "Oui — minimum ₦1 000.",
      "q3": "Pourquoi dois-je vérifier mon identité avant de retirer ?",
      "a3": "Nous vérifions votre compte bancaire via Paystack pour nous assurer que les gains vont à la bonne personne et pour respecter la réglementation financière nigériane.",
      "q4": "Quand vais-je recevoir mon retrait ?",
      "a4": "Généralement 1 à 5 jours ouvrés après l'approbation de votre demande. Des retards peuvent survenir en raison des délais de traitement de votre banque, indépendants de notre volonté."
    },
    "sxScore": {
      "heading": "SX Score",
      "q1": "Qu'est-ce que le SX Score ?",
      "a1": "Le SX Score est votre note de fiabilité et de fair-play sur la plateforme. Chaque joueur commence à 700. Il augmente quand vous gagnez et vous comportez bien, et diminue en cas d'absence, de triche ou de litige perdu.",
      "q2": "Quels sont les paliers du SX Score ?",
      "a2": "900 et plus : Élite (🟢). 750–899 : Fiable (🔵). 600–749 : En progression (🟡). Moins de 600 : À risque (🔴).",
      "q3": "Mon SX Score peut-il remonter ?",
      "a3": "Oui. Il n'y a pas de plancher — vous pouvez toujours regagner des points en jouant équitablement."
    },
    "sxCoins": {
      "heading": "SX Coins",
      "q1": "Que sont les SX Coins ?",
      "a1": "Les SX Coins sont une monnaie virtuelle interne à la plateforme. Vous les gagnez en jouant, en complétant des défis, et en débloquant des succès.",
      "q2": "Puis-je convertir les SX Coins en naira ?",
      "a2": "Non. Les SX Coins sont virtuels et ne peuvent pas être échangés contre de l'argent. Ils ne peuvent être dépensés que sur la plateforme.",
      "q3": "Sur quoi puis-je dépenser mes SX Coins ?",
      "a3": "Des réductions sur les frais d'inscription aux tournois (500 coins = ₦250 de réduction, 1 000 coins = entrée gratuite), des boosts de publication dans la communauté, et des articles dans la boutique interne."
    },
    "accountSafety": {
      "heading": "Compte et sécurité",
      "q1": "J'ai oublié mon mot de passe. Que faire ?",
      "a1": "Cliquez sur « Mot de passe oublié » sur la page de connexion. Nous enverrons un lien de réinitialisation à votre adresse e-mail enregistrée.",
      "q2": "Comment signaler un joueur ?",
      "a2": "Envoyez un e-mail à sentinelxesports@gmail.com avec le nom d'utilisateur du joueur et les détails de l'incident. Pour les publications communautaires, utilisez le bouton de signalement sur la publication.",
      "q3": "Je pense que mon compte a été piraté. Que faire ?",
      "a3": "Changez immédiatement votre mot de passe à l'aide du lien « Mot de passe oublié » sur la page de connexion, puis écrivez-nous à sentinelxesports@gmail.com. Nous verrouillerons le compte et vous aiderons à le récupérer."
    }
  }
```

- [ ] **Step 4: Add the Pidgin `help` namespace to `messages/pcm.json`**

```json
  "help": {
    "eyebrow": "Support",
    "title": "Help Center",
    "metaTitle": "Help Center",
    "metaDescription": "Answers to common questions about accounts, tournaments, prizes, SX Score, and SX Coins.",
    "gettingStarted": {
      "heading": "How to Start",
      "q1": "How I go create account?",
      "a1": "Click \"Sign Up\" for di homepage. Enter your email address and choose username. Verify your email using di link wey we send you, then complete your profile.",
      "q2": "I fit change my username?",
      "a2": "Yes, but once only. Go Settings to make di change. After dat, your username go lock — contact support if you get serious reason to change am again.",
      "q3": "SentinelX dey free to use?",
      "a3": "To create account and browse di platform, e free. To enter tournament cost ₦500 per tournament, or you fit use SX Coins wey you don earn to reduce or waive di fee."
    },
    "tournaments": {
      "heading": "Tournaments",
      "q1": "How I go register for tournament?",
      "a1": "Go Tournaments page, find open tournament, and click \"Register.\" Dem go take you to payment screen. Complete your ₦500 payment through Paystack to confam your spot.",
      "q2": "Wetin happen if I miss my match?",
      "a2": "No-show mean say your opponent go advance automatically and you go lose 100 SX Score points. Always check your fixture for your Player Dashboard and set reminder.",
      "q3": "How I go submit match result?",
      "a3": "Go Dashboard → My Matches → Submit Result. Upload screenshot of di final scoreline and screen recording of di match. You need both of dem.",
      "q4": "Wetin if my opponent submit wrong result?",
      "a4": "You fit dispute di result within 1 hour after submission. Go di match page and click \"Dispute.\" Admin go review both players recordings and take final decision.",
      "q5": "How long e go take before dem confam result?",
      "a5": "Admin dey aim to confam results within 24 hours after submission. Complex disputes fit take longer.",
      "q6": "Wetin if dem cancel tournament?",
      "a6": "You go receive full refund to your original payment method within 3–7 business days."
    },
    "prizes": {
      "heading": "Prizes and Payments",
      "q1": "How I go withdraw my prize money?",
      "a1": "Go Dashboard → Wallet → Withdraw. Link your Nigerian bank account (first time only), enter di amount, and submit withdrawal request. We go process am within 1–5 business days.",
      "q2": "E get minimum withdrawal amount?",
      "a2": "Yes — ₦1,000 minimum.",
      "q3": "Why I need verify my identity before I withdraw?",
      "a3": "We dey verify your bank account through Paystack make sure say prize money reach di correct person and to comply with Nigerian financial regulations.",
      "q4": "Wen I go receive my withdrawal?",
      "a4": "Normally 1–5 business days after dem approve your request. Delay fit happen because of your bank processing time, wey no dey under our control."
    },
    "sxScore": {
      "heading": "SX Score",
      "q1": "Wetin be SX Score?",
      "a1": "SX Score na your reliability and fair-play rating for di platform. Every player start with 700. E go increase wen you win and behave well, e go reduce wen you no-show, cheat, or lose dispute.",
      "q2": "Wetin be SX Score tiers?",
      "a2": "900 and above: Elite (🟢). 750–899: Trusted (🔵). 600–749: Developing (🟡). Below 600: At Risk (🔴).",
      "q3": "My SX Score fit recover?",
      "a3": "Yes. E no get floor cap — you fit always earn your way back up if you compete fair."
    },
    "sxCoins": {
      "heading": "SX Coins",
      "q1": "Wetin be SX Coins?",
      "a1": "SX Coins na in-platform virtual currency. You go earn am as you compete, complete challenges, and unlock achievements.",
      "q2": "I fit convert SX Coins to naira?",
      "a2": "No. SX Coins na virtual and you no fit exchange am for cash. You fit only spend am inside di platform.",
      "q3": "Wetin I fit spend SX Coins on?",
      "a3": "Tournament entry fee discount (500 coins = ₦250 off, 1,000 coins = free entry), post boosts for di community, and items for di in-platform store."
    },
    "accountSafety": {
      "heading": "Account and Safety",
      "q1": "I forget my password. Wetin I go do?",
      "a1": "Click \"Forgot Password\" for login page. We go send reset link go your registered email address.",
      "q2": "How I go report player?",
      "a2": "Email sentinelxesports@gmail.com with di player username and details of di incident. For community posts, use di report button for di post.",
      "q3": "I feel say dem hack my account. Wetin I go do?",
      "a3": "Change your password sharp sharp using \"Forgot Password\" link for login page, then email us for sentinelxesports@gmail.com. We go lock di account and help you recover am."
    }
  }
```

- [ ] **Step 5: Run the parity test — expect PASS**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect PASS.

- [ ] **Step 6: Rewrite `app/[locale]/(public)/help/page.tsx`**

```tsx
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell } from '@/components/static/StaticPageShell'
import { FaqAccordion, type FaqGroup } from '@/components/static/FaqAccordion'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'help' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/help',
    locale,
  })
}

// Matches the message-catalog group keys and each group's item count.
const GROUP_SPECS = [
  { key: 'gettingStarted', count: 3 },
  { key: 'tournaments', count: 6 },
  { key: 'prizes', count: 4 },
  { key: 'sxScore', count: 3 },
  { key: 'sxCoins', count: 3 },
  { key: 'accountSafety', count: 3 },
] as const

export default async function HelpPage() {
  const t = await getTranslations('help')
  const groups: FaqGroup[] = GROUP_SPECS.map(({ key, count }) => ({
    heading: t(`${key}.heading`),
    items: Array.from({ length: count }, (_, i) => ({
      q: t(`${key}.q${i + 1}`),
      a: t(`${key}.a${i + 1}`),
    })),
  }))

  return (
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')}>
      <FaqAccordion groups={groups} />
    </StaticPageShell>
  )
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p .` — expect no errors.

- [ ] **Step 8: Manual verification**

Run `npm run dev`, visit `/help`, `/fr/help`, `/pcm/help` — confirm all 6 groups and all 22 Q&A pairs render translated.

- [ ] **Step 9: Commit**

```bash
git add messages/en.json messages/fr.json messages/pcm.json "app/[locale]/(public)/help/page.tsx"
git commit -m "feat(i18n): translate Help Center page"
```

---

## Task 14: How It Works (`/how-it-works`)

**Files:**
- Modify: `messages/en.json`, `messages/fr.json`, `messages/pcm.json` (add `howItWorks` namespace)
- Modify: `app/[locale]/(public)/how-it-works/page.tsx`

**Interfaces:**
- Consumes: nothing new — no inline links/bold in this page's prose.

- [ ] **Step 1: Add the `howItWorks` namespace to `messages/en.json`**

```json
  "howItWorks": {
    "eyebrow": "Nigeria's Home of Mobile Esports",
    "title": "How SentinelX Works",
    "subtitle": "SentinelX is where Nigerian mobile gamers compete in organised tournaments, build their reputation, and win real prize money — all from their phone. Here's how to get started.",
    "metaTitle": "How SentinelX Works",
    "metaDescription": "From creating an account to getting paid — how Nigerian mobile gamers compete on SentinelX.",
    "stepLabel": "Step",
    "step1Title": "Create Your Account",
    "step1Body": "Sign up with your email and choose a username. Your username is your esports identity on the platform — pick something you're proud of. Your player profile shows your SX Score, win rate, achievements, and match history. Build it up tournament by tournament.",
    "step2Title": "Enter a Tournament",
    "step2Body": "Browse the Tournaments page to find open registrations. Each tournament shows the game, entry fee, prize pool, format, and registration deadline. Pay the ₦500 entry fee with your card via Paystack. Or use SX Coins you've earned through competing — 1,000 coins get you a free entry.",
    "step3Title": "Check Your Fixture",
    "step3Body": "Once registration closes, admin generates the bracket. You'll see your fixture (who you're playing and when) on your Player Dashboard. You'll also receive a match reminder on WhatsApp if you've added your number in Settings.",
    "step4Title": "Play Your Match",
    "step4Body": "Play the match at the scheduled time. Keep it clean — no exploits, no rage quits. After the match: the winner takes a screenshot of the final score and records the match on their phone. Both are required for result submission.",
    "step5Title": "Submit Your Result",
    "step5Body": "Go to your Player Dashboard → My Matches → Submit Result. Upload your screenshot and screen recording. Admin reviews the submission and confirms the result. The bracket updates only after admin confirms — never before.",
    "step6Title": "Win and Get Paid",
    "step6Body": "Win your bracket and the prize money is credited to your wallet. Link your Nigerian bank account and request a withdrawal — money arrives in 1–5 business days.",
    "sxScoreHeading": "SX Score — Your Reputation",
    "sxScoreBody": "Every player starts with an SX Score of 700. Win matches, show up on time, and behave well — your score goes up. No-shows and disputes bring it down. Your score determines your trust tier on the platform.",
    "sxCoinsHeading": "SX Coins — The In-Platform Currency",
    "sxCoinsBody": "You earn SX Coins by competing, completing weekly challenges, and unlocking achievements. Spend them on entry fee discounts, boosting your community posts, and the in-platform store. Coins are earned — they cannot be bought with cash, and they cannot be converted to naira.",
    "communityHeading": "The Community",
    "communityBody": "Post in the community feed, react to match highlights, and take on weekly challenges. The community is public — anyone can read it, but you need an account to post.",
    "comingSoonLabel": "Coming Soon",
    "teamLeaguesTitle": "Team & School Leagues",
    "teamLeaguesBody": "teams representing a school or state, with team-vs-team standings."
  }
```

- [ ] **Step 2: Run the parity test — expect FAIL**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect FAIL.

- [ ] **Step 3: Add the French `howItWorks` namespace to `messages/fr.json`**

```json
  "howItWorks": {
    "eyebrow": "Le foyer de l'esport mobile au Nigeria",
    "title": "Comment fonctionne SentinelX",
    "subtitle": "SentinelX est l'endroit où les gamers mobiles nigérians s'affrontent dans des tournois organisés, bâtissent leur réputation, et gagnent de vrais gains — tout depuis leur téléphone. Voici comment commencer.",
    "metaTitle": "Comment fonctionne SentinelX",
    "metaDescription": "De la création d'un compte au paiement — comment les gamers mobiles nigérians s'affrontent sur SentinelX.",
    "stepLabel": "Étape",
    "step1Title": "Créez votre compte",
    "step1Body": "Inscrivez-vous avec votre e-mail et choisissez un nom d'utilisateur. Votre nom d'utilisateur est votre identité esport sur la plateforme — choisissez quelque chose dont vous êtes fier. Votre profil joueur affiche votre SX Score, votre taux de victoire, vos succès et votre historique de match. Construisez-le tournoi après tournoi.",
    "step2Title": "Inscrivez-vous à un tournoi",
    "step2Body": "Parcourez la page Tournois pour trouver des inscriptions ouvertes. Chaque tournoi indique le jeu, les frais d'inscription, la cagnotte, le format, et la date limite d'inscription. Payez les frais d'inscription de ₦500 avec votre carte via Paystack. Ou utilisez des SX Coins gagnés en jouant — 1 000 coins vous offrent une entrée gratuite.",
    "step3Title": "Consultez votre match",
    "step3Body": "Une fois les inscriptions closes, l'administrateur génère le tableau. Vous verrez votre match (contre qui vous jouez et quand) sur votre tableau de bord joueur. Vous recevrez aussi un rappel de match sur WhatsApp si vous avez ajouté votre numéro dans les Paramètres.",
    "step4Title": "Jouez votre match",
    "step4Body": "Jouez le match à l'heure programmée. Restez fair-play — pas d'exploits, pas d'abandon en cours de match. Après le match : le gagnant prend une capture d'écran du score final et enregistre le match sur son téléphone. Les deux sont requis pour la soumission du résultat.",
    "step5Title": "Soumettez votre résultat",
    "step5Body": "Allez dans votre tableau de bord joueur → Mes matchs → Soumettre le résultat. Téléchargez votre capture d'écran et votre enregistrement d'écran. L'administrateur examine la soumission et confirme le résultat. Le tableau ne se met à jour qu'après confirmation de l'administrateur — jamais avant.",
    "step6Title": "Gagnez et soyez payé",
    "step6Body": "Remportez votre tableau et les gains sont crédités sur votre portefeuille. Liez votre compte bancaire nigérian et demandez un retrait — l'argent arrive sous 1 à 5 jours ouvrés.",
    "sxScoreHeading": "SX Score — Votre réputation",
    "sxScoreBody": "Chaque joueur commence avec un SX Score de 700. Gagnez des matchs, présentez-vous à l'heure, et comportez-vous bien — votre score augmente. Les absences et les litiges le font baisser. Votre score détermine votre palier de confiance sur la plateforme.",
    "sxCoinsHeading": "SX Coins — La monnaie interne à la plateforme",
    "sxCoinsBody": "Vous gagnez des SX Coins en jouant, en complétant des défis hebdomadaires, et en débloquant des succès. Dépensez-les en réductions sur les frais d'inscription, en boosts de vos publications communautaires, et dans la boutique interne. Les coins se gagnent — ils ne peuvent pas être achetés avec de l'argent, ni convertis en naira.",
    "communityHeading": "La communauté",
    "communityBody": "Publiez dans le fil communautaire, réagissez aux temps forts des matchs, et relevez des défis hebdomadaires. La communauté est publique — tout le monde peut la lire, mais il faut un compte pour publier.",
    "comingSoonLabel": "Bientôt disponible",
    "teamLeaguesTitle": "Ligues d'équipes et scolaires",
    "teamLeaguesBody": "des équipes représentant une école ou un état, avec des classements équipe contre équipe."
  }
```

- [ ] **Step 4: Add the Pidgin `howItWorks` namespace to `messages/pcm.json`**

```json
  "howItWorks": {
    "eyebrow": "Nigeria Home of Mobile Esports",
    "title": "How SentinelX Dey Work",
    "subtitle": "SentinelX na where Nigerian mobile gamers dey compete for organised tournaments, build their reputation, and win real prize money — all from their phone. Na dis one show you how to start.",
    "metaTitle": "How SentinelX Dey Work",
    "metaDescription": "From wen you create account to wen dem pay you — how Nigerian mobile gamers dey compete for SentinelX.",
    "stepLabel": "Step",
    "step1Title": "Create Your Account",
    "step1Body": "Sign up with your email and choose username. Your username na your esports identity for di platform — pick something wey you go proud of. Your player profile go show your SX Score, win rate, achievements, and match history. Build am up tournament by tournament.",
    "step2Title": "Enter Tournament",
    "step2Body": "Browse Tournaments page to find open registrations. Every tournament go show di game, entry fee, prize pool, format, and registration deadline. Pay di ₦500 entry fee with your card through Paystack. Or use SX Coins wey you don earn through competing — 1,000 coins go give you free entry.",
    "step3Title": "Check Your Fixture",
    "step3Body": "Once registration close, admin go generate di bracket. You go see your fixture (who you dey play and wetin time) for your Player Dashboard. You go also receive match reminder for WhatsApp if you don add your number for Settings.",
    "step4Title": "Play Your Match",
    "step4Body": "Play di match for di scheduled time. Keep am clean — no exploits, no rage quit. After di match: di winner take screenshot of di final score and record di match for their phone. You need both of dem for result submission.",
    "step5Title": "Submit Your Result",
    "step5Body": "Go your Player Dashboard → My Matches → Submit Result. Upload your screenshot and screen recording. Admin go review di submission and confam di result. Di bracket go update only after admin confam — never before.",
    "step6Title": "Win and Collect Your Money",
    "step6Body": "Win your bracket and di prize money go enter your wallet. Link your Nigerian bank account and request withdrawal — money go arrive within 1–5 business days.",
    "sxScoreHeading": "SX Score — Your Reputation",
    "sxScoreBody": "Every player start with SX Score of 700. Win matches, show up on time, and behave well — your score go increase. No-shows and disputes go bring am down. Your score dey determine your trust tier for di platform.",
    "sxCoinsHeading": "SX Coins — Di In-Platform Currency",
    "sxCoinsBody": "You go earn SX Coins as you compete, complete weekly challenges, and unlock achievements. Spend am for entry fee discount, to boost your community posts, and for di in-platform store. Coins na wetin you earn — you no fit buy am with cash, and you no fit convert am to naira.",
    "communityHeading": "Di Community",
    "communityBody": "Post for di community feed, react to match highlights, and take on weekly challenges. Di community dey public — anybody fit read am, but you need account before you fit post.",
    "comingSoonLabel": "Coming Soon",
    "teamLeaguesTitle": "Team & School Leagues",
    "teamLeaguesBody": "teams wey dey represent school or state, with team-vs-team standings."
  }
```

- [ ] **Step 5: Run the parity test — expect PASS**

Run: `npx vitest run lib/i18n/message-parity.test.ts` — expect PASS.

- [ ] **Step 6: Rewrite `app/[locale]/(public)/how-it-works/page.tsx`**

```tsx
import { UserPlus, Trophy, CalendarClock, Gamepad2, Upload, Wallet, Star, Coins, Users2, School } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell } from '@/components/static/StaticPageShell'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'howItWorks' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/how-it-works',
    locale,
  })
}

export default async function HowItWorksPage() {
  const t = await getTranslations('howItWorks')

  const steps = [
    { icon: UserPlus, n: 1, title: t('step1Title'), body: t('step1Body') },
    { icon: Trophy, n: 2, title: t('step2Title'), body: t('step2Body') },
    { icon: CalendarClock, n: 3, title: t('step3Title'), body: t('step3Body') },
    { icon: Gamepad2, n: 4, title: t('step4Title'), body: t('step4Body') },
    { icon: Upload, n: 5, title: t('step5Title'), body: t('step5Body') },
    { icon: Wallet, n: 6, title: t('step6Title'), body: t('step6Body') },
  ]

  return (
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')}>
      <div className="space-y-4">
        {steps.map((s) => (
          <div key={s.n} className="flex gap-4 rounded-xl border border-sx-border bg-sx-surface p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sx-purple/15 text-sx-purple-text">
              <s.icon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-sx-purple-text">
                {t('stepLabel')} {s.n}
              </p>
              <p className="mt-0.5 font-bold text-white">{s.title}</p>
              <p className="mt-1 text-sm text-sx-gray">{s.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 space-y-4">
        <InfoSection icon={Star} title={t('sxScoreHeading')}>
          {t('sxScoreBody')}
        </InfoSection>
        <InfoSection icon={Coins} title={t('sxCoinsHeading')}>
          {t('sxCoinsBody')}
        </InfoSection>
        <InfoSection icon={Users2} title={t('communityHeading')}>
          {t('communityBody')}
        </InfoSection>
      </div>

      <div className="mt-10 rounded-xl border border-sx-border/60 bg-sx-surface/40 p-5 opacity-70">
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-sx-gray">{t('comingSoonLabel')}</p>
        <div className="space-y-2 text-sm text-sx-gray">
          <p className="flex items-center gap-2">
            <School className="h-4 w-4 shrink-0" />{' '}
            <span>
              <strong className="text-white">{t('teamLeaguesTitle')}</strong> — {t('teamLeaguesBody')}
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
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p .` — expect no errors.

- [ ] **Step 8: Manual verification**

Run `npm run dev`, visit `/how-it-works`, `/fr/how-it-works`, `/pcm/how-it-works` — confirm all 6 steps, the 3 info sections, and the "Coming Soon" note render translated.

- [ ] **Step 9: Commit**

```bash
git add messages/en.json messages/fr.json messages/pcm.json "app/[locale]/(public)/how-it-works/page.tsx"
git commit -m "feat(i18n): translate How It Works page"
```

---

## Final Verification (after all 14 tasks)

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors across the whole repo.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: all tests pass, including `lib/i18n/message-parity.test.ts`. If run from the main repo root, confirm via `git worktree list` first that no stale linked worktree is still on disk under `.claude/worktrees/` — see the known "Vitest Nested-Worktree Double-Count" gotcha; a plausible total is ~147 files.

- [ ] **Step 3: Full production build**

Run: `npm run build`
Expected: builds cleanly, including static generation for all `/en`, `/fr`, `/pcm` variants of the 13 pages touched by this plan.

- [ ] **Step 4: Manual spot-check in Chrome**

For at least `/terms`, `/about`, and `/help` (one plain-prose page, one component-heavy page, one FAQ-accordion page), visit the `en`, `fr`, and `pcm` variant of each and confirm:
- No leftover English text where a translation exists
- No raw `<strong>`/`<li>`/`<email>` tag syntax leaking into rendered text (a sign a `t.rich()` call is missing its tag map)
- Links (mailto, WhatsApp, internal `/exchange`, external `ndpc.gov.ng`) still work
- The page's `<title>` (browser tab) reflects the translated `metaTitle` per locale — this is the `buildMetadata()` gap this plan closes

- [ ] **Step 5: Update the language switcher regression check**

Since this plan touches every remaining static/legal page, re-verify the `LanguageSwitcher` dropdown (shipped 2026-08-24) still correctly navigates from any of these 13 pages to their `fr`/`pcm` equivalents without a 404 — the `as-needed` locale prefix strategy means `/terms` (en) ↔ `/fr/terms` ↔ `/pcm/terms`.

