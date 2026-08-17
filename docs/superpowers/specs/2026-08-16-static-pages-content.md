# SentinelX Static Pages — Content Spec

**Date:** 2026-08-16
**Status:** Approved → ready for implementation
**Owner:** Samuel Chinoyerem Akpoke · SentinelX Esports
**Contact email:** sentinelxesports@gmail.com
**Contact WhatsApp:** +2349032395685 (public link: https://wa.me/2349032395685)

All pages are static Server Components — no DB queries, no auth required, no `"use client"`. Layout: shared site header + footer. Mobile-first. Prose-heavy pages use `max-w-3xl mx-auto px-4 py-12` container.

---

## Routes to build

| Route | Page | Source section |
|-------|------|---------------|
| `/terms` | Terms of Service | §1 |
| `/privacy` | Privacy Policy | §2 |
| `/refund-policy` | Refund Policy | §3 |
| `/safety` | Safety Tips | §4 |
| `/rules` | Tournament Rules | §5 |
| `/community-rules` | Community Rules | §6 |
| `/how-it-works` | How It Works | §7 |
| `/help` | Help Center | §8 |
| `/tournament-guide` | Tournament Guide | §9 |
| `/tournament-faqs` | Tournament FAQs | §10 |
| `/escrow` | Zolarux Escrow | §11 |
| `/contact` | Contact Us | §12 |

**Update footer links** (SiteFooter.tsx) to point to these real routes instead of `/coming-soon`.
**Update wallet** WalletSidebarInfoCards.tsx: "Learn More" → `/escrow`, "Contact Support" → `/contact`.
**Update community** QuickActionTiles.tsx: "Get Help" → `/contact`. Community Rules link → `/community-rules`.
**Update tournaments** page: Tournament Guide → `/tournament-guide`, Tournament FAQs → `/tournament-faqs`.
**"Create Team"** stays as `/coming-soon?feature=Teams` — do not change.

---

## §1 — Terms of Service (`/terms`)

**Page title:** Terms of Service
**Last updated:** August 2026

---

### 1. Who We Are

SentinelX Esports is a mobile esports platform operated by Samuel Chinoyerem Akpoke ("we", "us", "our"). We are based in Nigeria and our platform is available at sentinelxesports.com.

By creating an account or using any part of SentinelX, you agree to these Terms of Service. If you do not agree, please do not use the platform.

### 2. Eligibility

You must be at least 13 years old to create an account. If you are under 18, you confirm that you have permission from a parent or guardian to use the platform. Players under 18 may not withdraw prize money without verifiable parental or guardian consent.

You may only hold one account. Creating multiple accounts to gain an unfair advantage is prohibited and will result in a permanent ban.

### 3. Your Account

You are responsible for keeping your login details secure. Do not share your password with anyone. You are responsible for all activity that takes place under your account.

If you believe your account has been compromised, contact us immediately at sentinelxesports@gmail.com.

### 4. Tournaments and Entry Fees

Tournament entry fees are set per event and displayed clearly before registration. The current standard fee is ₦500. By registering and completing payment, you confirm your intent to participate.

Entry fees are processed securely by Paystack. We do not store your card details.

SX Coins may be used to reduce or eliminate entry fees where that option is offered. See the Refund Policy for how cancellations are handled.

### 5. Match Rules and Fair Play

All players must compete honestly. The following are prohibited:

- Submitting false or manipulated match results
- Using external tools, scripts, or exploits to gain an advantage
- Colluding with an opponent to produce a predetermined result
- Threatening, harassing, or abusing opponents

Match results must be submitted with supporting evidence (screenshot and screen recording). Admin decisions on disputed results are final.

A no-show — failing to appear for your scheduled match without notice — results in a forfeit and a penalty to your SX Score.

### 6. Prizes and Withdrawals

Prize money is paid to the bank account you link to your player dashboard via Paystack. You must complete identity verification before your first withdrawal.

We aim to process approved withdrawals within 1–5 business days. We are not responsible for delays caused by your bank.

### 7. SX Coins

SX Coins are a virtual in-platform currency. They are earned by competing and spending time on the platform. SX Coins have no monetary value and cannot be exchanged for cash. They may be used within the platform for entry fee discounts, community features, and the in-platform store.

### 8. Gaming Exchange

The Gaming Exchange (powered by Zolarux escrow) allows players to buy and sell gaming accounts and in-game items. SentinelX provides the platform and escrow infrastructure. We are not party to the transaction between buyer and seller and are not liable for disputes that arise from transactions conducted outside the platform's escrow system.

### 9. Community Standards

You agree to treat all other members of the SentinelX community with respect. Hate speech, discrimination, threats, and harassment are not tolerated and will result in suspension or permanent ban. See our Community Rules for the full standards.

### 10. Intellectual Property

All SentinelX branding, design, and original content is owned by SentinelX Esports. You may not reproduce, copy, or distribute our content without written permission. Content you post (match screenshots, community posts) remains yours, but you grant us a licence to display it on the platform.

### 11. Limitation of Liability

SentinelX Esports is not liable for indirect, incidental, or consequential losses arising from your use of the platform. Our total liability to you for any claim shall not exceed the total entry fees you have paid to us in the 3 months prior to the claim.

We do not guarantee uninterrupted access to the platform. We will make reasonable efforts to restore service promptly in the event of downtime.

### 12. Changes to These Terms

We may update these Terms from time to time. We will notify you via the platform or email when significant changes are made. Continuing to use SentinelX after changes are posted means you accept the updated terms.

### 13. Governing Law

These Terms are governed by the laws of the Federal Republic of Nigeria. Any disputes shall be subject to the jurisdiction of Nigerian courts.

### 14. Contact

Questions about these Terms? Email us at sentinelxesports@gmail.com or message us on WhatsApp: +234 903 239 5685.

---

## §2 — Privacy Policy (`/privacy`)

**Page title:** Privacy Policy
**Last updated:** August 2026
**Compliant with:** Nigeria Data Protection Act 2023 (NDPA)

---

### 1. Who Controls Your Data

SentinelX Esports, operated by Samuel Chinoyerem Akpoke, is the data controller for personal information collected through this platform. Contact: sentinelxesports@gmail.com.

### 2. What Data We Collect

**When you create an account:**
- Email address
- Username and display name
- Country
- Password (stored as a secure hash — we never see your plain password)

**When you complete your profile:**
- WhatsApp phone number (optional — used only for match notifications if you opt in)
- Profile photo
- Bio

**When you register for a tournament:**
- Payment information (processed by Paystack — we receive a transaction reference, not your card details)
- Bank account details (collected by Paystack for prize withdrawals — stored by Paystack, not by us)

**When you play:**
- Match history, scores, and results
- SX Score and rankings
- Achievements and SX Coins balance
- Match screenshots and recordings you submit for result verification

**Automatically:**
- Log data (IP address, browser type, pages visited) — used for security and to fix bugs
- Session cookies (required for login to work)

### 3. Why We Use Your Data

| Purpose | Legal basis |
|---------|-------------|
| Running your account and the platform | Contract performance |
| Processing tournament entry payments | Contract performance |
| Paying out prizes | Contract performance |
| Sending match notifications (WhatsApp) | Consent — you opt in by adding your phone number |
| Improving the platform | Legitimate interest |
| Preventing fraud and cheating | Legitimate interest |
| Complying with Nigerian law | Legal obligation |

### 4. Who We Share Your Data With

We share data only where necessary:

- **Paystack** — payment processing and bank account verification for prize payouts
- **Supabase** — database and authentication infrastructure (servers may be located outside Nigeria; Supabase Inc. operates under appropriate data transfer safeguards)
- **Vercel** — web hosting
- **Termii** (when active) — WhatsApp notification delivery, only for players who have added a phone number
- **Firebase / Google** — push notification delivery (FCM)

We do not sell your personal data. We do not share it with advertisers.

We may disclose data to Nigerian law enforcement or regulatory bodies if legally required to do so.

### 5. Your Public Profile

Your username, display name, country, profile photo, SX Score, match history, and achievements are visible to all visitors of the platform. This is necessary for the competitive, community nature of the platform. You can update your display name and photo at any time in Settings.

### 6. Your Rights Under the NDPA 2023

As a data subject, you have the right to:

- **Access** — request a copy of the personal data we hold about you
- **Rectification** — ask us to correct inaccurate data
- **Erasure** — ask us to delete your account and personal data
- **Restriction** — ask us to limit how we process your data
- **Portability** — receive your data in a structured, machine-readable format
- **Objection** — object to processing based on legitimate interest
- **Withdraw consent** — remove your WhatsApp number or turn off notifications at any time in Settings

To exercise any of these rights, email sentinelxesports@gmail.com. We will respond within 30 days.

You also have the right to lodge a complaint with the Nigeria Data Protection Commission (NDPC) at ndpc.gov.ng.

### 7. Data Retention

We keep your account data for as long as your account is active. If you delete your account, we will erase your personal data within 30 days, except where we are required by law to retain it (for example, payment records may be retained for up to 7 years for tax and financial compliance).

Match records and results may be retained in anonymised form for platform statistics.

### 8. Security

We use industry-standard security measures including encrypted connections (HTTPS), hashed passwords, and role-based access controls. No system is perfectly secure — if you believe your account has been compromised, contact us immediately.

### 9. Children

Players under 18 may use the platform with parental consent. We do not knowingly collect data from children under 13. If we become aware that a child under 13 has created an account, we will delete it.

### 10. Changes to This Policy

We will notify you via the platform or email if we make significant changes to this policy. The latest version is always available at sentinelxesports.com/privacy.

---

## §3 — Refund Policy (`/refund-policy`)

**Page title:** Refund Policy
**Last updated:** August 2026

---

### Tournament Entry Fees (₦500)

Entry fees are generally non-refundable once your registration is confirmed and the tournament has started.

**You are entitled to a full refund if:**
- The tournament is cancelled by SentinelX before it begins
- Your registration is rejected by admin before the bracket is published
- A technical error on our platform prevents you from participating

**No refund is issued if:**
- You no-show for your scheduled match
- You are disqualified for a rule violation after the tournament begins
- You change your mind after the bracket is published

Refunds are processed via the original payment method and typically take 3–7 business days to appear.

### Entry Fee Discounts Using SX Coins

If you used SX Coins to reduce or waive your entry fee:
- The coin portion is refunded as coins (not naira) in the event of a qualifying cancellation
- Coins are credited back to your balance immediately upon refund

### Prize Money

Prize money is credited to your linked bank account after admin approval. Once approved, payouts cannot be reversed. If you believe a prize was incorrectly calculated, contact us within 7 days of the result being confirmed.

### SX Coins

SX Coins are a virtual currency earned through platform activity. They have no cash value and are non-refundable. If your account is closed for a serious rule violation, coins are forfeited.

### How to Request a Refund

Email sentinelxesports@gmail.com with your username, the tournament name, and the reason for your request. We will respond within 3 business days.

---

## §4 — Safety Tips (`/safety`)

**Page title:** Stay Safe on SentinelX

---

### Protect Your Account

- Use a strong, unique password for SentinelX — don't reuse it from another app
- Never share your password with anyone, including people claiming to be SentinelX staff
- Log out of shared devices after playing
- If your email gets a reset request you didn't make, change your password immediately and contact us

### We Will Never Ask For This

SentinelX staff will never ask for your:
- Password
- Bank account PIN or BVN
- Paystack OTP codes
- Payment to "unlock" prize money

If anyone claiming to be SentinelX asks for any of these, it is a scam. Report it to us immediately.

### Protect Your Prize Money

- Only link your own bank account for withdrawals
- Verify your account before your first withdrawal — this protects you
- Prize withdrawals only go through the platform dashboard. Anyone asking you to send money first to "unlock" winnings is a scammer

### Safe Trading on the Exchange

- Always use the Zolarux Escrow system for all trades. Funds held in escrow are protected until both parties confirm the transaction
- Never agree to complete a trade outside the platform — if a buyer or seller asks to go outside escrow, refuse and report them
- If a deal looks too good to be true, it probably is

### Match Safety

- Record your screen for every match — this is your protection if a result is disputed
- Save your recordings until after the result is officially confirmed on the platform
- If your opponent is being abusive or threatening, take screenshots and report via the platform or email us

### Report a Problem

Email: sentinelxesports@gmail.com
WhatsApp: +234 903 239 5685

---

## §5 — Tournament Rules (`/rules`)

**Page title:** Tournament Rules

---

### Eligibility

- You must have a registered and verified SentinelX account
- You must pay the entry fee (₦500 or reduced with SX Coins) before the registration deadline
- Players serving an active suspension are not eligible to enter

### Before the Tournament

- Registration closes before the bracket is generated — you cannot register after the deadline
- Check your fixture (your scheduled match) on your Player Dashboard after the bracket is published
- Be online and ready 15 minutes before your scheduled match time

### Playing Your Match

- Matches are played on the agreed game and platform (DLS, EA FC Mobile, eFootball, etc.) as specified in the tournament details
- Both players must join the match lobby at the scheduled time
- If you cannot find your opponent after waiting 10 minutes from the scheduled start time, take a screenshot of the empty lobby and submit it as a no-show report

### Submitting Results

- The winner is responsible for submitting the result
- Submit a screenshot of the final scoreline AND a screen recording of the match
- Results must be submitted within 2 hours of the match ending
- Admin reviews and confirms the result — the bracket updates only after confirmation

### No-Shows

- Failing to appear for your scheduled match is a no-show
- No-show: your opponent advances automatically, and you lose 100 SX Score points
- Repeated no-shows may result in suspension from future tournaments

### Disputes

- If the submitted result is incorrect, the losing player may raise a dispute within 1 hour of submission
- Admin will review both players' screen recordings and make a final decision
- Admin decisions on disputes are final
- Raising a false dispute (deliberately contesting a correct result) results in an SX Score penalty

### Conduct

- Treat your opponent with respect — harassment, hate speech, or threats will result in immediate disqualification and suspension
- Match fixing or collusion is a permanent ban offence
- Using game exploits or external tools is a permanent ban offence

### Prizes

- Prizes are credited to the winner's wallet after admin confirms the final result
- Players must complete KYC verification before withdrawing prize money
- Withdrawal requests are processed within 1–5 business days

---

## §6 — Community Rules (`/community-rules`)

**Page title:** Community Rules

---

SentinelX is Nigeria's home of mobile esports. The community is for everyone who loves the game — we keep it positive, competitive, and safe.

### The Basic Standard

Treat every member the way you'd want to be treated at a tournament in person. Behind every username is a real person.

### What's Not Allowed

**Harassment and hate speech**
No insults, threats, or discrimination based on tribe, religion, gender, region, or any other personal characteristic. This includes DMs.

**Spam**
No repeated posting of the same content, no promotional links without permission, no bot activity.

**False information**
Do not post fake match results, fake screenshots, or misleading claims about other players.

**Privacy violations**
Do not share another player's personal information (phone number, address, real name if they use a username) without their consent.

**Cheating promotion**
Do not share or promote methods for cheating in any game supported on the platform.

**NSFW content**
No explicit, violent, or disturbing content of any kind.

### Consequences

**First offence:** Warning
**Second offence:** Temporary suspension (7–30 days depending on severity)
**Serious offences** (hate speech, threats, doxxing, cheating): Immediate suspension or permanent ban, no warning required

### Reporting

See something that breaks these rules? Use the report button on any post, or email sentinelxesports@gmail.com. Reports are reviewed by the admin team. We take every report seriously.

---

## §7 — How It Works (`/how-it-works`)

**Page title:** How SentinelX Works

---

### Nigeria's Home of Mobile Esports

SentinelX is where Nigerian mobile gamers compete in organised tournaments, build their reputation, and win real prize money — all from their phone.

Here's how to get started.

---

### Step 1: Create Your Account

Sign up with your email and choose a username. Your username is your esports identity on the platform — pick something you're proud of.

Your player profile shows your SX Score, win rate, achievements, and match history. Build it up tournament by tournament.

---

### Step 2: Enter a Tournament

Browse the Tournaments page to find open registrations. Each tournament shows the game, entry fee, prize pool, format, and registration deadline.

Pay the ₦500 entry fee with your card via Paystack. Or use SX Coins you've earned through competing — 1,000 coins get you a free entry.

---

### Step 3: Check Your Fixture

Once registration closes, admin generates the bracket. You'll see your fixture (who you're playing and when) on your Player Dashboard.

You'll also receive a match reminder on WhatsApp if you've added your number in Settings.

---

### Step 4: Play Your Match

Play the match at the scheduled time. Keep it clean — no exploits, no rage quits.

After the match: the winner takes a screenshot of the final score and records the match on their phone. Both are required for result submission.

---

### Step 5: Submit Your Result

Go to your Player Dashboard → My Matches → Submit Result. Upload your screenshot and screen recording. Admin reviews the submission and confirms the result.

The bracket updates only after admin confirms — never before.

---

### Step 6: Win and Get Paid

Win your bracket and the prize money is credited to your wallet. Link your Nigerian bank account and request a withdrawal — money arrives in 1–5 business days.

---

### SX Score — Your Reputation

Every player starts with an SX Score of 700. Win matches, show up on time, and behave well — your score goes up. No-shows and disputes bring it down. Your score determines your trust tier on the platform.

---

### SX Coins — The In-Platform Currency

You earn SX Coins by competing, completing weekly challenges, and unlocking achievements. Spend them on entry fee discounts, boosting your community posts, and the in-platform store.

Coins are earned — they cannot be bought with cash, and they cannot be converted to naira.

---

### The Community

Post in the community feed, react to match highlights, and take on weekly challenges. The community is public — anyone can read it, but you need an account to post.

---

### Coming Soon

**Sentinel X TV** — live streams and match replays.
**Gaming Exchange** — buy and sell gaming accounts safely with Zolarux escrow protection.
**Multi-game support** — EA FC Mobile, eFootball, PUBG Mobile, Free Fire, and more.

---

## §8 — Help Center (`/help`)

**Page title:** Help Center

Render as an accordion (FAQ list). Group questions under headings.

---

**GETTING STARTED**

**How do I create an account?**
Click "Sign Up" on the homepage. Enter your email address and choose a username. Verify your email using the link we send you, then complete your profile.

**Can I change my username?**
Yes, but only once. Go to Settings to make the change. After that, your username is locked — contact support if you have a serious reason to change it again.

**Is SentinelX free to use?**
Creating an account and browsing the platform is free. Entering tournaments costs ₦500 per tournament, or you can use SX Coins you've earned to reduce or eliminate the fee.

---

**TOURNAMENTS**

**How do I register for a tournament?**
Go to the Tournaments page, find an open tournament, and click "Register." You'll be taken to the payment screen. Complete your ₦500 payment via Paystack to confirm your spot.

**What happens if I miss my match?**
A no-show means your opponent advances automatically and you lose 100 SX Score points. Always check your fixture on your Player Dashboard and set a reminder.

**How do I submit a match result?**
Go to Dashboard → My Matches → Submit Result. Upload a screenshot of the final scoreline and a screen recording of the match. Both are required.

**What if my opponent submits a wrong result?**
You can dispute the result within 1 hour of submission. Go to the match page and click "Dispute." Admin will review both players' recordings and make a final decision.

**How long does it take for results to be confirmed?**
Admin aims to confirm results within 24 hours of submission. Complex disputes may take longer.

**What if a tournament is cancelled?**
You'll receive a full refund to your original payment method within 3–7 business days.

---

**PRIZES AND PAYMENTS**

**How do I withdraw my prize money?**
Go to Dashboard → Wallet → Withdraw. Link your Nigerian bank account (first time only), enter the amount, and submit a withdrawal request. We'll process it within 1–5 business days.

**Is there a minimum withdrawal amount?**
Yes — ₦1,000 minimum.

**Why do I need to verify my identity before withdrawing?**
We verify your bank account via Paystack to ensure prize money goes to the right person and to comply with Nigerian financial regulations.

**When will I receive my withdrawal?**
Typically 1–5 business days after your request is approved. Delays can occur due to your bank's processing times, which are outside our control.

---

**SX SCORE**

**What is SX Score?**
SX Score is your reliability and fair-play rating on the platform. Every player starts at 700. It goes up when you win and behave well, and down when you no-show, cheat, or lose disputes.

**What are the SX Score tiers?**
- 900 and above: Elite (🟢)
- 750–899: Trusted (🔵)
- 600–749: Developing (🟡)
- Below 600: At Risk (🔴)

**Can my SX Score recover?**
Yes. There's no floor cap — you can always earn your way back up by competing fairly.

---

**SX COINS**

**What are SX Coins?**
SX Coins are an in-platform virtual currency. You earn them by competing, completing challenges, and unlocking achievements.

**Can I convert SX Coins to naira?**
No. SX Coins are virtual and cannot be exchanged for cash. They can only be spent within the platform.

**What can I spend SX Coins on?**
Tournament entry fee discounts (500 coins = ₦250 off, 1,000 coins = free entry), post boosts in the community, and items in the in-platform store.

---

**ACCOUNT AND SAFETY**

**I forgot my password. What do I do?**
Click "Forgot Password" on the login page. We'll send a reset link to your registered email address.

**How do I report a player?**
Email sentinelxesports@gmail.com with the player's username and details of the incident. For community posts, use the report button on the post.

**I think my account has been hacked. What do I do?**
Change your password immediately using the "Forgot Password" link on the login page, then email us at sentinelxesports@gmail.com. We'll lock the account and help you recover it.

---

## §9 — Tournament Guide (`/tournament-guide`)

**Page title:** Tournament Guide — Everything You Need to Know

---

### Before You Register

**Check the game.** Each tournament specifies which game is being played. Make sure you have it installed and your in-game account is ready.

**Check the format.** Tournaments use group stages (for large fields) followed by single-elimination knockout rounds. The tournament page shows how many groups, how many advance, and the prize structure.

**Check the schedule.** Tournaments have a registration deadline and a start date. Once registration closes, the bracket is generated and no late entries are accepted.

**Check your balance.** Entry fee is ₦500. If you don't have enough SX Coins for a discount, make sure your card is ready for the Paystack payment.

---

### Registering

1. Go to Tournaments → find an open tournament → click Register
2. Choose your coin discount option (if available)
3. Complete payment via Paystack (or confirm free entry if using full coin discount)
4. You'll receive a WhatsApp confirmation if you have a number saved in Settings

---

### After Registration

Your fixture appears in Dashboard → My Matches once the bracket is published. This shows you who you're playing, what time, and which round.

Set a reminder. SentinelX will send a WhatsApp reminder 1 hour before your match if notifications are enabled.

---

### Playing the Match

**Prepare your connection.** Unstable internet is your responsibility — connection issues during a match are not grounds for a result reversal.

**Start recording before the match begins.** Go to your phone's screen recorder and start it before you enter the game lobby. This recording is your evidence if the result is ever disputed.

**Join at the scheduled time.** If you can't find your opponent 10 minutes after the scheduled start, screenshot the empty lobby and report it as a no-show.

**Play the game.** No exploits, no rage quits, no abuse.

---

### Submitting the Result

The winner submits the result — not the loser.

1. Go to Dashboard → My Matches → the match → Submit Result
2. Upload your screenshot (final scoreline clearly visible)
3. Upload your screen recording
4. Click Submit

You have 2 hours from the end of the match to submit. After that, a no-submission may be treated as a no-show.

---

### After Submission

Admin reviews your submission. If the result looks clean, it's confirmed within 24 hours and the bracket updates. The loser has 1 hour after submission to raise a dispute if they believe the result is wrong.

If you win a prize, it appears in your wallet after the final result is confirmed.

---

### Tips from Experience

- Save all your recordings until after the official confirmation — you may need them for a dispute
- If you lose, don't quit the app mid-match — abandoning counts against your SX Score
- Good sportsmanship in the community is noticed. Your reputation matters beyond just your score

---

## §10 — Tournament FAQs (`/tournament-faqs`)

**Page title:** Tournament FAQs

Render as an accordion.

---

**Can I enter more than one tournament at a time?**
Yes. You can be registered in multiple active tournaments simultaneously.

**What games are currently supported?**
DLS (Dream League Soccer) is the current primary game. EA FC Mobile, eFootball, PUBG Mobile, Free Fire, Call of Duty Mobile, and Mortal Kombat are coming in a future update.

**How are groups and brackets decided?**
When registration closes, the system automatically generates groups based on how many players registered. Admin can review and adjust before publishing. The bracket is then single-elimination from the group stage onwards.

**What if I need to withdraw from a tournament after registering?**
Withdrawal after registration closes is not eligible for a refund unless the tournament is cancelled by SentinelX. If you know in advance you can't play, contact us as early as possible.

**Can I play from any device?**
Yes, as long as the required game is installed and you can maintain a stable connection. All supported games are mobile titles — PC or console play is not applicable.

**What counts as a no-show?**
Failing to appear in the game lobby within 10 minutes of the scheduled match start time. If you're running late, message your opponent via the platform immediately.

**Can I play a match early if both players agree?**
No. Matches must be played at the scheduled time to maintain bracket integrity. Contact admin if you both need to reschedule — admin may approve it at their discretion.

**What if I lose internet during a match?**
Connection loss during a match is not grounds for a result reversal or replay. If you disconnect during a match and your opponent can demonstrate completion, the result stands.

**How long are tournament prizes held before expiry?**
Prize money does not expire — it stays in your wallet until you withdraw it. Ensure your bank account is linked and verified to withdraw.

**I won but my result wasn't confirmed — what do I do?**
First, check that you submitted within 2 hours with both a screenshot and a recording. If you did and it's been over 24 hours with no update, contact admin at sentinelxesports@gmail.com.

---

## §11 — Zolarux Escrow Info (`/escrow`)

**Page title:** Safe Trading with Zolarux Escrow

---

### What Is the Gaming Exchange?

The Gaming Exchange is SentinelX's marketplace for gaming accounts, in-game items, and digital gaming assets. It's built for Nigerian mobile gamers who want to buy and sell safely — without the risk of being scammed.

The Exchange is coming soon. When it launches, every transaction will be protected by Zolarux Escrow.

---

### What Is Zolarux Escrow?

Zolarux is an independent escrow service. Escrow means a trusted third party holds a payment until both sides of a transaction are satisfied. Neither the buyer's money nor the seller's item is transferred until the deal is confirmed as complete.

This protects both parties.

---

### How It Works

**Buyer's perspective:**
1. You find an item you want and agree on a price
2. You send payment to Zolarux (not directly to the seller)
3. The seller delivers the item or account
4. You confirm you've received it and it's as described
5. Zolarux releases the payment to the seller

If the item is not delivered or is misrepresented, you can raise a dispute and your money is returned.

**Seller's perspective:**
1. You list your item on the Exchange
2. A buyer purchases it — their payment goes to Zolarux, not to you yet
3. You deliver the item or transfer the account
4. The buyer confirms receipt
5. Zolarux releases your payment

You only deliver once the buyer's payment is confirmed as held in escrow.

---

### Why Not Trade Directly?

Trading outside of escrow — whether via WhatsApp, direct transfer, or any other method — is not protected. SentinelX cannot help you recover money or items lost in trades that took place outside the platform.

If a buyer or seller asks you to complete a trade outside the escrow system, decline and report them.

---

### Current Status

The Gaming Exchange and Zolarux Escrow integration are in development. When the Exchange launches, all trades on SentinelX will automatically go through escrow.

Have questions in the meantime? Contact us at sentinelxesports@gmail.com.

---

## §12 — Contact Us (`/contact`)

**Page title:** Contact Us

---

### We're Here to Help

Whether you have a question about a tournament, a problem with your account, or something else — we're reachable and we respond.

---

**Email**
sentinelxesports@gmail.com
We aim to respond within 24 hours on business days.

**WhatsApp**
+234 903 239 5685
Message us directly — fastest for urgent issues like match disputes or account problems.

[Message us on WhatsApp →] (link: https://wa.me/2349032395685?text=Hi%20SentinelX%2C%20I%20need%20help%20with...)

---

### What to Include in Your Message

To help us resolve your issue quickly, include:
- Your SentinelX username
- The tournament name (if relevant)
- A clear description of the problem
- Any screenshots that help explain the issue

---

### Common Issues

**Forgot your password?** Use the "Forgot Password" link on the login page — no need to contact us.

**Payment issue?** Include your Paystack payment reference.

**Match dispute?** Include the match ID and your screen recording.

**Withdrawal not received?** Allow 1–5 business days before contacting us. Include your withdrawal request date and bank name.

---

### Report Abuse or Safety Concerns

If you're experiencing harassment, threats, or have a safety concern, email sentinelxesports@gmail.com with "URGENT" in the subject line. We prioritise these reports.
