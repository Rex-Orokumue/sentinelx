# SentinelX Player Profile & Settings — Design Spec

**Date:** 2026-08-16
**Status:** Approved → ready for implementation
**Routes:** `/players/[username]` (public profile), `/dashboard/settings` (own settings)
**Phase:** 3

---

## 1. Vision

The player profile is your esports identity card — the one page that tells the world who you are on SentinelX. It should feel like a trophy room: your tier, your score, your achievements, your match history, all in one place. It must be stunning for veterans and aspirational for newcomers.

The settings page is the control panel behind that identity — clean, functional, no visual noise.

---

## 2. Public Profile (`/players/[username]`)

### 2.1 Hero Section

Full-width. No sidebar. Background: same radial purple gradient as dashboard hero.

```
┌──────────────────────────────────────────────────────────────┐
│  [Purple radial gradient background]                         │
│                                                              │
│  [HexAvatar xl — 112px, tier frame + achievement badges]     │
│                                                              │
│  METHIO                              🟢 Elite (SX Score)     │
│  @methio · 🇳🇬 Nigeria               👑 Guardian (Level)     │
│                                                              │
│  SX Score: 1,240    Season Rank: #12    Titles: 3           │
│                                                              │
│  [Edit Profile] (shown only to profile owner)               │
└──────────────────────────────────────────────────────────────┘
```

- `HexAvatar xl` (112px) with full tier frame, achievement decorations at vertices
- Display name: Barlow Condensed Black, 36px, uppercase
- Username: `@username`, slate-400, 14px
- Country flag emoji + country name
- Two tier badges side by side:
  - SX Score tier (`sentinel_tier`): 🟢 Elite / 🔵 Trusted / 🟡 Developing / 🔴 At Risk
  - Membership level (`membership_tier`): Recruit / Guardian / Elite / Sentinel / Legend
  - Tooltips distinguish them: "SX Score Reliability" vs "Membership Level"
- Three stat pills: SX Score, Season Rank, Total Titles
- "Edit Profile" button — only visible to the authenticated profile owner, links to `/dashboard/settings`

### 2.2 Stats Grid

4-stat row below the hero. 2×2 on mobile, 4-column on desktop.

| Stat | Source |
|------|--------|
| Win Rate | `wins / total_matches * 100` |
| Total Wins | `profiles.wins` |
| Goals Scored | `profiles.goals_scored` |
| Total Matches | `profiles.total_matches` |

Card: `bg-sx-surface border border-sx-border rounded-xl p-4`. Large number in Barlow Condensed 28px.

### 2.3 XP & Membership Progress

Compact bar — same as dashboard progression card but read-only for visitor, full version for owner.

```
┌────────────────────────────────────────────────────────────┐
│  👑 Guardian                                               │
│  ████████░░░░  3,240 / 5,000 XP to Elite                  │
│  🪙 1,450 SX Coins                                        │
└────────────────────────────────────────────────────────────┘
```

Coin balance: shown only on own profile (owner view). Hidden for visitors — it's personal financial info.

### 2.4 Achievement Showcase

```
ACHIEVEMENTS (12 unlocked)                      [View All →]
────────────────────────────────────────────────────────────
[🏆 Tournament Champion]  [👟 Golden Boot]  [🔥 Win Streak 5]
   "First win"               "Top scorer"      "5 in a row"
```

- Show top 3 featured achievements — sorted by rarity (rarest first), then by most recent unlock
- Each badge: 48×48px icon, achievement name, short description
- "View All →" expands to a grid of all unlocked achievements (and locked ones dimmed/greyed)
- Locked achievements shown as `bg-sx-surface opacity-40` with a 🔒 — no name or description revealed (mystery = motivation)
- Achievement opt-in sharing (§4.3) controls whether auto-posts appear in feed — does NOT affect visibility of achievements on this profile page. All unlocked achievements are always visible on the public profile.

### 2.5 Recent Matches

Last 5 matches. Same component as dashboard `RecentMatchesCard` but read-only, no "View All" to own dashboard — instead links to a full match history section below.

```
RECENT MATCHES
────────────────────────────────────────────────────────────
WIN   vs Arole    3–1   Community Club #3 · Aug 16
LOSS  vs methio   0–2   Community Club #3 · Aug 14
WIN   vs Drizzy   2–1   Community Club #2 · Aug 10
```

### 2.6 Community Posts (Phase 3)

Posts this player has made in the community feed, most recent first. Limit 5. "View all on Community →" links to `/community` filtered by author.

If no posts: `"No community posts yet."` — small, no drama.

### 2.7 Season Standing (own profile only)

Shown to profile owner only — not public. Same `SeasonStandingCard` from dashboard.

---

## 3. Own Profile — Data Requirements

Server Component. Single `Promise.all`:

| Data | Query |
|------|-------|
| Profile | `profiles WHERE username = [param]` — full fields |
| Achievements | `player_achievements JOIN achievements WHERE player_id = profile.id ORDER BY unlocked_at DESC` |
| Recent matches (5) | `matches WHERE player_a_id OR player_b_id = profile.id AND status = 'completed' ORDER BY updated_at DESC LIMIT 5` |
| Opponent names | join from each match |
| Season rank | `getSeasonLeaderboard()` — find player's position |
| Recent feed posts (5) | `community_posts WHERE author_id = profile.id AND is_deleted = false ORDER BY created_at DESC LIMIT 5` |
| Coin balance | `sx_coins WHERE player_id = profile.id` — only fetched if viewer is the owner (server-side check: `session.user.id === profile.id`) |

---

## 4. Settings Page (`/dashboard/settings`)

Clean two-section layout. Server Component shell, client form components.

### 4.1 Profile Settings

```
┌────────────────────────────────────────────────────────────┐
│  PROFILE                                                   │
│  ─────────────────────────────────────────────────────     │
│  Avatar                                                    │
│  [HexAvatar lg — current]  [Upload new photo]              │
│  Supported: JPG, PNG · Max 2MB                             │
│                                                            │
│  Display Name    [methio                    ]              │
│  Username        [@methio                   ] (locked*)    │
│  Bio             [Love the game...          ]              │
│  Country         [Nigeria ▾                 ]              │
│  WhatsApp        [+234 800 000 0000         ]              │
│                                                            │
│  [Save Changes]                                            │
└────────────────────────────────────────────────────────────┘
```

*Username: editable once (first change is free), locked after. Show "Username can only be changed once" warning before the first change. After first change, field is read-only with a lock icon and small text "Contact support to change username."

Avatar upload: same Supabase Storage pattern as community post images. Compress to 400×400px square, WebP, before upload.

### 4.2 Notification Preferences

```
┌────────────────────────────────────────────────────────────┐
│  NOTIFICATIONS                                             │
│  Sent to your WhatsApp number: +234 800 000 0000          │
│  (Update in Profile settings above)                        │
│  ─────────────────────────────────────────────────────     │
│  Match reminders (1h before kickoff)          [ON  ●]     │
│  Result confirmed                             [ON  ●]     │
│  Prize credited to wallet                     [ON  ●]     │
│  Weekly challenge completed                   [OFF ○]     │
│  Achievement unlocked                         [OFF ○]     │
│  Registration confirmed                       [ON  ●]     │
│                                                            │
│  If no WhatsApp number is set, notifications are paused.  │
└────────────────────────────────────────────────────────────┘
```

Defaults: match reminders, results, prizes, and registration ON. Challenges and achievements OFF by default (less critical, more noise).

### 4.3 Achievement Sharing

```
┌────────────────────────────────────────────────────────────┐
│  ACHIEVEMENT SHARING                                       │
│  When you unlock an achievement, auto-post it to the       │
│  community feed for others to celebrate.                   │
│  ─────────────────────────────────────────────────────     │
│  Tournament wins                              [ON  ●]     │
│  Milestone achievements (100 matches, etc.)   [ON  ●]     │
│  Streak achievements                          [ON  ●]     │
│  Social achievements (reactions, posts)       [OFF ○]     │
│  All other achievements                       [OFF ○]     │
└────────────────────────────────────────────────────────────┘
```

This controls `achievements.share_to_feed` per category — not per individual achievement (too granular). Categories map to `achievements.category` column.

When toggled ON for a category: all achievements in that category with `share_to_feed = true` at the achievement level will auto-post. When toggled OFF: even if the achievement has `share_to_feed = true`, the player's preference suppresses the post.

DB: add `notification_prefs jsonb` column to `profiles`:
```json
{
  "whatsapp": {
    "match_reminder": true,
    "result_confirmed": true,
    "prize_credited": true,
    "challenge_completed": false,
    "achievement_unlocked": false,
    "registration_confirmed": true
  },
  "achievement_sharing": {
    "tournament": true,
    "milestone": true,
    "streak": true,
    "social": false,
    "other": false
  }
}
```

Default value set in migration. JSONB merge-patch on save (don't overwrite entire object — preserve unknown keys for future additions).

### 4.4 Account & Security

```
┌────────────────────────────────────────────────────────────┐
│  ACCOUNT                                                   │
│  ─────────────────────────────────────────────────────     │
│  Email          gorokumue@gmail.com           (via Supabase Auth)
│  Password       [Change Password →]           (triggers password reset email)
│                                                            │
│  KYC STATUS                                               │
│  ✅ Account Verified — withdrawal enabled                  │
│  OR                                                        │
│  ⚠ Not yet verified — verify to unlock withdrawals        │
│  [Verify Now →]                                           │
│                                                            │
│  DANGER ZONE                                              │
│  [Delete Account]  (requires confirmation modal)          │
└────────────────────────────────────────────────────────────┘
```

Password change: Server Action that calls `supabase.auth.resetPasswordForEmail()` — sends reset email, shows "Check your email" toast. Same flow as existing forgot password.

---

## 5. Component Structure

```
app/(public)/players/[username]/
  page.tsx                        ← Server Component, all data fetched here
  loading.tsx                     ← Skeleton loader

components/profile/
  ProfileHero.tsx                 ← Hero section (HexAvatar xl, name, tier, stats)
  ProfileStatsGrid.tsx            ← 4-stat row
  ProfileXpBar.tsx                ← XP + membership progress
  AchievementShowcase.tsx         ← Top 3 + View All expandable grid
  AchievementGrid.tsx             ← Full grid (unlocked + locked dimmed)
  ProfileRecentMatches.tsx        ← Last 5 matches read-only
  ProfileCommunityPosts.tsx       ← Last 5 feed posts

app/(protected)/dashboard/settings/
  page.tsx                        ← Server Component shell
  
components/settings/
  ProfileForm.tsx                 ← "use client" — avatar upload + text fields
  NotificationPrefsForm.tsx       ← "use client" — toggle switches
  AchievementSharingForm.tsx      ← "use client" — category toggles
  AccountSection.tsx              ← Password reset + KYC status + delete account
```

---

## 6. Username One-Change Rule

DB enforcement:
```sql
ALTER TABLE profiles ADD COLUMN username_changed_at timestamptz;
```

Server Action check before username update: if `username_changed_at IS NOT NULL`, reject with "Username has already been changed once." message. On first change: update username + set `username_changed_at = now()`.

---

## 7. Out of Scope

- Profile visibility controls (public vs private) — Phase 4
- Blocking players — Phase 4
- Following/followers — Phase 4
- Verified checkmark (content creator / admin badge) — Phase 4
- Profile themes from the store — Phase 2 store feature, already specced separately
