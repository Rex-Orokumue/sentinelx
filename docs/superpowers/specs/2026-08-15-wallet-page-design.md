# SentinelX Wallet Page — Design Spec

**Date:** 2026-08-15
**Status:** Approved → ready for implementation
**Route:** `/dashboard/wallet`
**Phase:** 2 (core), Phase 3 (Community Rewards + Referrals), Phase 3+ (Transfer + Deposit)

---

## 1. Vision

The wallet is the player's financial command centre. It should feel **safe, trustworthy, and rewarding** — not like a bank statement. The purple/dark aesthetic carries over from the dashboard. The mascot and Zolarux branding reinforce that their money is protected.

Design reference: the mockup shared by founder (2026-08-15). Build Phase 2 sections fully; reserve Phase 3+ slots with locked/coming-soon treatment rather than omitting them entirely.

---

## 2. Route & Navigation

- Route: `app/(protected)/dashboard/wallet/page.tsx`
- Access: authenticated players only (middleware guards `/dashboard`)
- Left sidebar navigation (persistent across all wallet sub-pages):

| Nav item | Route | Phase |
|----------|-------|-------|
| Overview | `/dashboard/wallet` | 2 — build now |
| Transactions | `/dashboard/wallet/transactions` | 2 — build now |
| Withdraw | `/dashboard/wallet/withdraw` | 2 — build now |
| Deposit | `/dashboard/wallet/deposit` | 3+ — locked |
| Transfer | `/dashboard/wallet/transfer` | 3+ — locked |
| Rewards | `/dashboard/wallet/rewards` | 3 — locked |
| Referrals | `/dashboard/wallet/referrals` | 3 — locked |
| Payment Methods | `/dashboard/wallet/payment-methods` | 2 — build now (view/add bank account) |
| Settings | `/dashboard/wallet/settings` | 2 — link to account settings |

Locked nav items: render the link with a `🔒` icon and `opacity-50 pointer-events-none`. No 404 — just not clickable yet.

On mobile: sidebar collapses to a horizontal scroll tab bar at the top.

---

## 3. Overview Page (`/dashboard/wallet`)

### 3.1 Header

```
Your Wallet Overview
Manage your balance, earnings and transactions.
```

Barlow Condensed 28px for title, Inter 14px slate-400 for subtitle.

### 3.2 Balance Hero Card

Full-width card. Purple gradient background with mascot image positioned right (desktop) / hidden on mobile.

```
┌────────────────────────────────────────────────────────────┐
│  TOTAL BALANCE  👁                      [Mascot — right]   │
│  ₦12,500                [Available Balance]                 │
│  Pending: ₦1,250  ⓘ                                        │
└────────────────────────────────────────────────────────────┘
```

- Background: `bg-gradient-to-r from-sx-purple/30 via-sx-surface to-sx-purple/10 border border-sx-purple/50`
- Balance: Barlow Condensed Black, 48px, white
- "Available Balance" — green pill badge (`bg-green-500/20 text-green-400 border border-green-500/30`)
- Pending amount with ⓘ tooltip: "Pending amounts reflect withdrawals being processed (within 24 hours)."
- 👁 icon toggles balance visibility (hide/show) — this is a `"use client"` toggle, only for this card
- Mascot: `/public/mascot/mascot-home.png` — `absolute right-0 bottom-0 h-40 w-auto` on desktop, hidden on mobile

**Balance source:**
- Total balance = `wallets.balance` (prize winnings)
- Pending = sum of `wallet_transactions WHERE category = 'withdrawal' AND status = 'pending'`
- Available = balance − pending

### 3.3 Quick Action Buttons

4-button row. 2×2 on mobile, 4 columns on desktop.

| Button | Icon | Action | Phase |
|--------|------|--------|-------|
| Deposit | ⬇ purple | Locked — shows "Coming Soon" toast | 3+ |
| Withdraw | ⬆ purple | Links to `/dashboard/wallet/withdraw` | 2 |
| Transfer | ↔ purple | Locked — "Coming Soon" toast | 3+ |
| Rewards | 🎁 purple | Locked — "Coming Soon" toast | 3 |

Locked buttons: same visual style as active, but `opacity-60` and clicking shows a small toast: `"Coming in a future update"`. Do NOT hide them — they add to the feeling that this wallet has depth.

### 3.4 Earnings Overview

```
EARNINGS OVERVIEW                              [View Earnings History →]
────────────────────────────────────────────────────────────────────────
🏆 Tournament Winnings    👥 Referral Rewards    🎁 Community Rewards    💰 Cashback
₦8,750                    ₦0 (locked)             ₦0 (locked)             ₦0 (locked)
Total Earned  +18%        Coming Soon             Coming Soon             Coming Soon
```

- Tournament Winnings: sum of `wallet_transactions WHERE category = 'tournament_prize'` — fully live
- Referral Rewards, Community Rewards, Cashback: show ₦0 with "Coming Soon" label in muted text — same card layout, greyed out
- Percentage change: compare this month vs last month for tournament winnings only
- "View Earnings History →" links to `/dashboard/wallet/transactions`

Card styling per earning type: `bg-sx-surface border border-sx-border rounded-xl p-4`. Active card (Tournament Winnings) gets normal styling; locked cards get `opacity-50`.

### 3.5 Recent Transactions + Withdrawal (2-column on desktop, stacked on mobile)

**Left: Recent Transactions**

```
RECENT TRANSACTIONS                              [View All →]
──────────────────────────────────────────────────────────────
[icon] Tournament Winnings — DLS Champ S2   Jul 20  ✅ +₦5,000
[icon] Withdrawal — To GTBank ****7890      Jul 18  ⏳ -₦3,000
[icon] Tournament Winnings — Community #2   Jul 15  ✅ +₦2,000
```

- Show last 5 transactions
- Icons by category: 🏆 tournament prize, ⬆ withdrawal, ⬇ deposit
- Status: `Completed` = green `✅`, `Pending` = amber `⏳`, `Failed` = red `❌`
- Amount: green for credit, red for debit
- "View All →" links to `/dashboard/wallet/transactions`

**Right: Withdrawal Panel**

```
WITHDRAWAL
──────────────────────────────────────────────────────────────
Linked Account                              ● Verified
🏦 GTBank ****7890
Samuel Akpoke

Available to Withdraw
₦12,500

Minimum withdrawal is ₦1,000

[  Request Withdrawal  ]

🔒 Withdrawals are processed within 24 hours.
```

- If no bank account linked: show "No bank account linked" + "Add Account →" link to `/dashboard/wallet/payment-methods`
- If KYC not verified: show "Verify your account to withdraw" with verification CTA
- If balance < ₦1,000: button disabled with tooltip "Minimum withdrawal is ₦1,000"
- Clicking "Request Withdrawal" opens a bottom sheet / modal (not a new page) to confirm amount + bank account before submitting

### 3.6 Right Panel (desktop only, hidden on mobile)

**"Your winnings are safe here!" promo card**
- Purple border card with mascot
- Copy: "Every transaction is secured with Sentinel X protection and Zolarux Escrow."
- "Learn More →" links to `/about` or `/exchange`

**Referral Earnings** (Phase 3 — show as locked preview)
- Muted card, `opacity-50`
- "Referral Earnings — Coming Soon"
- No fake data

**Rewards Progress**
- Show actual membership tier + XP progress (from `profiles.xp` + `profiles.membership_tier`)
- "Your Level: Guardian" with XP bar — fully live data
- Next reward: if defined in achievements or store — otherwise "Keep playing to unlock rewards"

**Wallet Security**
3 badges:
- 🛡 Wallet Protected — "Zolarux Escrow Active" (always shown, even if exchange isn't live yet — it's aspirational branding)
- ✅ Verified Account — "KYC Verified" if `profiles.kyc_verified = true`, else "Pending Verification"
- 🔒 Escrow Enabled — "All Transactions Safe"

### 3.7 Bottom Banner

Full-width. Purple gradient.

```
Play. Compete. Earn. Withdraw. Repeat.
Sentinel X Wallet is built for gamers. Powered by trust.
```

Mascot image on the right side.

---

## 4. Transactions Page (`/dashboard/wallet/transactions`)

Full transaction history with filters.

```
ALL TRANSACTIONS
──────────────────────────────────────────────────────────────
Filter: [All] [Winnings] [Withdrawals] [Deposits]    [Date range]

[icon] Tournament Winnings — DLS Champ S2   Jul 20, 2026 10:45 PM   ✅ Completed   +₦5,000
[icon] Withdrawal — To GTBank ****7890      Jul 18, 2026 08:15 PM   ⏳ Pending     -₦3,000
...
```

- Filters: All / Winnings / Withdrawals — (Deposits filter shown but no deposit rows yet)
- Pagination: 20 rows per page
- Each row links to a transaction detail (expandable row or bottom sheet, not a new page)

---

## 5. Withdraw Page (`/dashboard/wallet/withdraw`)

Simple focused page — not a modal.

```
REQUEST WITHDRAWAL
──────────────────────────────────────────────────────────────
Linked Bank Account
🏦 GTBank ****7890 — Samuel Akpoke       ✅ Verified
[Change account →]

Amount
[  ₦ ___________  ]
Available: ₦12,500  ·  Min: ₦1,000

[  Withdraw  ]

⚠ Withdrawals are reviewed and processed within 24 hours.
Funds go to your linked GTBank account ending in 7890.
```

- Amount input: number field, validates min ₦1,000 and max available balance
- If no bank linked: redirect to `/dashboard/wallet/payment-methods` first
- On submit: Server Action creates `wallet_transactions` row with `status = 'pending'` and `category = 'withdrawal'`, deducts from `wallets.balance`
- Success: redirect to `/dashboard/wallet` with success toast

---

## 6. Payment Methods Page (`/dashboard/wallet/payment-methods`)

View and manage linked bank accounts.

```
PAYMENT METHODS
──────────────────────────────────────────────────────────────
🏦 GTBank ****7890 — Samuel Akpoke       ✅ Primary  [Remove]

[+ Add Bank Account]
```

- Add account: Paystack account resolution — player enters bank + account number, system resolves name via Paystack API, player confirms
- Only one account at a time in v1 (Phase 2)
- Removing the only account: warn "You won't be able to withdraw without a linked account"

---

## 7. Data Requirements

All fetched server-side in `page.tsx`. Single `Promise.all`:

| Data | Query |
|------|-------|
| Wallet balance | `wallets WHERE player_id = me` |
| Pending withdrawals | `wallet_transactions WHERE player_id = me AND category = 'withdrawal' AND status = 'pending'` — sum |
| Earnings by category | `wallet_transactions WHERE player_id = me AND status = 'completed'` — GROUP BY category |
| Recent transactions (5) | `wallet_transactions WHERE player_id = me ORDER BY created_at DESC LIMIT 5` |
| KYC status | `profiles.kyc_verified` |
| Linked bank account | `player_bank_accounts WHERE player_id = me LIMIT 1` (or equivalent column on profiles) |
| XP + tier | `profiles.xp, profiles.membership_tier` |

---

## 8. Component Structure

```
app/(protected)/dashboard/wallet/
  layout.tsx                    ← sidebar nav + mobile tab bar
  page.tsx                      ← Overview (server component)
  transactions/page.tsx         ← Transaction history
  withdraw/page.tsx             ← Withdrawal form
  payment-methods/page.tsx      ← Bank account management

components/wallet/
  BalanceHeroCard.tsx           ← Balance + mascot (has client toggle for hide/show)
  QuickActions.tsx              ← 4 action buttons
  EarningsOverview.tsx          ← 4 earning type cards
  RecentTransactions.tsx        ← 5-row transaction list
  WithdrawalPanel.tsx           ← Right side of bottom section
  WalletSidebar.tsx             ← Left nav (desktop) / tab bar (mobile)
  WalletSecurityBadges.tsx      ← 3 security status badges
  RewardsProgressWidget.tsx     ← XP/tier progress (reuses membership tier logic)
  TransactionRow.tsx            ← Shared row component
```

Only `BalanceHeroCard.tsx` needs `"use client"` (for the balance hide/show toggle). Everything else is Server Components.

---

## 9. Phase 3+ Placeholder Rules

- Locked nav items: `opacity-50 pointer-events-none` + 🔒 icon
- Locked quick action buttons: same visual, clicking shows `"Coming in a future update"` toast
- Locked earnings cards: `opacity-50`, "Coming Soon" label
- NO fake/placeholder data in locked sections
- Do NOT show ₦0 for locked earning types as if they're real — label them "Coming Soon" so it's clear they're not live

---

## 10. Out of Scope (this spec)

- Deposit via Paystack (Phase 3+) — players fund their account via tournament registration only in Phase 2
- Transfer to another player (Phase 3+ / Exchange)
- Referral system (Phase 3)
- Community Rewards (Phase 3)
- Cashback (Phase 3+)
- Multiple bank accounts (Phase 3)
