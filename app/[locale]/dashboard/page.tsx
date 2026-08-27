import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { bucketFixtures, type DashboardMatchInput } from '@/lib/dashboard/fixtures'
import { recordDailyLogin } from '@/lib/login/actions'
import { getCoinBalance } from '@/lib/coins/service'
import type { RecentAchievement } from '@/components/dashboard/RecentAchievements'
import { HeroIdentityPanel } from '@/components/dashboard/HeroIdentityPanel'
import { NextMatchCard, type NextMatchData } from '@/components/dashboard/NextMatchCard'
import { StatsRow } from '@/components/dashboard/StatsRow'
import { SeasonStandingCard } from '@/components/dashboard/SeasonStandingCard'
import { ProgressCard } from '@/components/dashboard/ProgressCard'
import { MyItemsCard } from '@/components/dashboard/MyItemsCard'
import { RecentMatchesCard } from '@/components/dashboard/RecentMatchesCard'
import { QuickActions } from '@/components/dashboard/QuickActions'
import { DashboardShell } from '@/components/dashboard/DashboardShell'
import { mapRecentMatches } from '@/lib/dashboard/recent-matches'
import { mapOwnedItems } from '@/lib/dashboard/owned-items'
import { getSeasonLeaderboard, getMonthlyLeaderboard } from '@/lib/seasons/data'
import { equippedCosmeticsBySlug, AVATAR_BORDER_CLASSES, PROFILE_THEME_CLASSES, USERNAME_COLOUR_CLASSES } from '@/lib/store/cosmetics'
import type { MembershipTier } from '@/lib/membership/tiers'

export const metadata: Metadata = {
  title: 'Dashboard · SentinelX Esports',
  robots: { index: false, follow: false },
}

export default async function DashboardPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard')

  await recordDailyLogin(createAdminClient(), user.id)

  const [
    profileRes,
    resultsRes,
    walletRes,
    coinBalance,
    achievementsRes,
    nextMatchRes,
    recentMatchesRes,
    achievementSlugsRes,
    activeSeasonRes,
    myOpenMatchesRes,
    ownedItemsRes,
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'username, display_name, avatar_url, wins, goals_scored, xp, membership_tier, login_streak, sx_score, total_matches',
      )
      .eq('id', user.id)
      .maybeSingle(),
    supabase.from('match_results').select('match_id').eq('submitted_by', user.id),
    supabase.from('wallets').select('balance').eq('player_id', user.id).maybeSingle(),
    getCoinBalance(createAdminClient(), user.id),
    supabase
      .from('player_achievements')
      .select('unlocked_at, achievements(name)')
      .eq('player_id', user.id)
      .order('unlocked_at', { ascending: false })
      .limit(3),
    supabase
      .from('matches')
      .select(
        'id, status, round, scheduled_at, is_full_day, ' +
          'tournament:tournaments(title), ' +
          'opponent_a:profiles!matches_player_a_id_fkey(id, display_name, username, avatar_url, membership_tier), ' +
          'opponent_b:profiles!matches_player_b_id_fkey(id, display_name, username, avatar_url, membership_tier)',
      )
      .or(`player_a_id.eq.${user.id},player_b_id.eq.${user.id}`)
      .in('status', ['scheduled', 'live'])
      .order('scheduled_at', { ascending: true })
      .limit(1),
    supabase
      .from('matches')
      .select(
        'id, player_a_id, player_b_id, score_a, score_b, updated_at, ' +
          'tournament:tournaments(title), ' +
          'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
          'player_b:profiles!matches_player_b_id_fkey(username, display_name)',
      )
      .or(`player_a_id.eq.${user.id},player_b_id.eq.${user.id}`)
      .eq('status', 'completed')
      .order('updated_at', { ascending: false })
      .limit(5),
    supabase.from('player_achievements').select('achievements(slug)').eq('player_id', user.id),
    supabase.from('seasons').select('id, name').eq('status', 'active').maybeSingle(),
    // Narrow — see plan Global Constraints on why this isn't the full
    // /dashboard/matches fetch or just the single next-match row.
    supabase
      .from('matches')
      .select('id, status, scheduled_at')
      .or(`player_a_id.eq.${user.id},player_b_id.eq.${user.id}`)
      .in('status', ['scheduled', 'live']),
    supabase
      .from('player_store_items')
      .select('item_id, equipped, store_items(slug, name, category, price_coins, preview_url)')
      .eq('player_id', user.id),
  ])

  const profile = profileRes.data
  type AchievementNameRef = { name: string } | { name: string }[] | null
  const recentAchievements: RecentAchievement[] = ((achievementsRes.data as unknown[] | null) ?? []).map((raw) => {
    const row = raw as { unlocked_at: string; achievements: AchievementNameRef }
    const ref = Array.isArray(row.achievements) ? row.achievements[0] ?? null : row.achievements
    return { name: ref?.name ?? 'Achievement', unlockedAt: row.unlocked_at }
  })

  const submittedMatchIds = new Set((resultsRes.data ?? []).map((r) => r.match_id))

  const openMatches: DashboardMatchInput[] = (myOpenMatchesRes.data ?? []).map((m) => ({
    id: m.id,
    status: m.status,
    scheduledAt: m.scheduled_at,
    isFullDay: false,
    round: '',
    opponentName: '',
    tournamentTitle: '',
    tournamentSlug: '',
  }))
  const openFixtures = bucketFixtures(openMatches, submittedMatchIds, new Date())
  const hasSubmittableMatch = openFixtures.live.length > 0 || openFixtures.upcoming.some((f) => f.awaitingMyResult)

  // ── Store cosmetics ─────────────────────────────────────────────────────
  const ownedItemRows = ownedItemsRes.data ?? []
  const ownedItems = mapOwnedItems(ownedItemRows)
  const cosmetics = equippedCosmeticsBySlug(ownedItemRows)
  const avatarBorderClass = cosmetics.avatarBorder ? AVATAR_BORDER_CLASSES[cosmetics.avatarBorder] : undefined
  const profileThemeClass = cosmetics.profileTheme ? PROFILE_THEME_CLASSES[cosmetics.profileTheme] : undefined
  const usernameColourClass = cosmetics.usernameColour ? USERNAME_COLOUR_CLASSES[cosmetics.usernameColour] : undefined

  const walletBalance = walletRes.data?.balance ?? 0
  const displayName = profile?.display_name ?? profile?.username ?? user.email ?? 'Player'

  const { data: pendingInvitations } = await supabase
    .from('tournament_invitations')
    .select('id, rank_at_invite, expires_at, tournament:tournaments(title, registration_fee)')
    .eq('player_id', user.id)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: true })
    .limit(1)
  const pendingInvitationRow = pendingInvitations?.[0] ?? null
  const pendingInvitationTournament = pendingInvitationRow
    ? Array.isArray(pendingInvitationRow.tournament)
      ? pendingInvitationRow.tournament[0]
      : pendingInvitationRow.tournament
    : null

  // ── Season standing ─────────────────────────────────────────────────────
  const activeSeason = activeSeasonRes.data

  let seasonRank: number | null = null
  let seasonPoints = 0
  let pointsAtRankSixteen = 0
  let monthlyRank: number | null = null
  let monthlyPoints = 0
  if (activeSeason) {
    // DLS-only for now, matching this card's pre-multi-game behavior — see
    // the equivalent note on app/[locale]/seasons/[slug]/page.tsx. Showing a
    // per-game season standing here is a separate follow-up.
    const { data: dlsGame } = await supabase.from('games').select('id').eq('slug', 'dls').maybeSingle()
    const [seasonBoard, monthlyBoard] = await Promise.all([
      getSeasonLeaderboard(createAdminClient(), activeSeason.id, dlsGame?.id ?? ''),
      getMonthlyLeaderboard(createAdminClient(), activeSeason.id, new Date(), dlsGame?.id ?? ''),
    ])
    const seasonIdx = seasonBoard.findIndex((r) => r.playerId === user.id)
    seasonRank = seasonIdx >= 0 ? seasonIdx + 1 : null
    seasonPoints = seasonIdx >= 0 ? seasonBoard[seasonIdx].points : 0
    pointsAtRankSixteen = seasonBoard[15]?.points ?? 0
    const monthlyIdx = monthlyBoard.findIndex((r) => r.playerId === user.id)
    monthlyRank = monthlyIdx >= 0 ? monthlyIdx + 1 : null
    monthlyPoints = monthlyIdx >= 0 ? monthlyBoard[monthlyIdx].points : 0
  }

  // ── Next match ───────────────────────────────────────────────────────────
  type NextMatchOpponentRef = {
    id: string; display_name: string | null; username: string | null; avatar_url: string | null; membership_tier: string | null
  }
  type NextMatchRow = {
    id: string; status: string; round: string; scheduled_at: string | null; is_full_day: boolean
    tournament: { title: string } | { title: string }[] | null
    opponent_a: NextMatchOpponentRef | NextMatchOpponentRef[] | null
    opponent_b: NextMatchOpponentRef | NextMatchOpponentRef[] | null
  }
  const nextMatchRow = (nextMatchRes.data as unknown as NextMatchRow[] | null)?.[0] ?? null
  const nextMatch: NextMatchData | null = nextMatchRow
    ? (() => {
        const a = Array.isArray(nextMatchRow.opponent_a) ? nextMatchRow.opponent_a[0] : nextMatchRow.opponent_a
        const b = Array.isArray(nextMatchRow.opponent_b) ? nextMatchRow.opponent_b[0] : nextMatchRow.opponent_b
        const t = Array.isArray(nextMatchRow.tournament) ? nextMatchRow.tournament[0] : nextMatchRow.tournament
        const opponent = a?.id === user.id ? b : a
        return {
          id: nextMatchRow.id,
          status: nextMatchRow.status,
          round: nextMatchRow.round,
          scheduledAt: nextMatchRow.scheduled_at,
          isFullDay: nextMatchRow.is_full_day,
          tournamentTitle: t?.title ?? 'Tournament',
          myAvatarUrl: profile?.avatar_url ?? null,
          myDisplayName: displayName,
          myTier: (profile?.membership_tier ?? 'recruit') as MembershipTier,
          opponentAvatarUrl: opponent?.avatar_url ?? null,
          opponentDisplayName: opponent?.display_name ?? opponent?.username ?? 'Opponent',
          opponentTier: (opponent?.membership_tier ?? 'recruit') as MembershipTier,
          submitted: submittedMatchIds.has(nextMatchRow.id),
        }
      })()
    : null

  // ── Recent matches ──────────────────────────────────────────────────────
  type RecentRawRef = { username: string | null; display_name: string | null } | { username: string | null; display_name: string | null }[] | null
  type RecentTournamentRef = { title: string } | { title: string }[] | null
  const recentMatchRows = ((recentMatchesRes.data as unknown[] | null) ?? []).map((raw) => {
    const r = raw as {
      id: string; player_a_id: string | null; player_b_id: string | null; score_a: number | null; score_b: number | null
      updated_at: string | null; tournament: RecentTournamentRef; player_a: RecentRawRef; player_b: RecentRawRef
    }
    const isA = r.player_a_id === user.id
    const opp = isA ? r.player_b : r.player_a
    const oppRow = Array.isArray(opp) ? opp[0] ?? null : opp
    const t = Array.isArray(r.tournament) ? r.tournament[0] : r.tournament
    return {
      id: r.id, player_a_id: r.player_a_id, player_b_id: r.player_b_id, score_a: r.score_a, score_b: r.score_b,
      updated_at: r.updated_at,
      opponentName: oppRow?.display_name ?? oppRow?.username ?? 'Opponent',
      opponentUsername: oppRow?.username ?? null,
      tournamentTitle: t?.title ?? 'Tournament',
    }
  })
  const recentMatches = mapRecentMatches(recentMatchRows, user.id)

  const achievementSlugs = ((achievementSlugsRes.data as unknown[] | null) ?? []).flatMap((raw) => {
    const r = raw as { achievements: { slug: string } | { slug: string }[] | null }
    const ref = Array.isArray(r.achievements) ? r.achievements[0] : r.achievements
    return ref?.slug ? [ref.slug] : []
  })

  return (
    <DashboardShell>
      <HeroIdentityPanel
        avatarUrl={profile?.avatar_url ?? null}
        displayName={displayName}
        achievements={achievementSlugs}
        xp={profile?.xp ?? 0}
        sxScore={profile?.sx_score ?? 700}
        seasonRank={seasonRank}
        loginStreak={profile?.login_streak ?? 0}
        avatarBorderClass={avatarBorderClass}
        profileThemeClass={profileThemeClass}
        usernameColourClass={usernameColourClass}
      />
      <NextMatchCard
        match={nextMatch}
        invitation={
          pendingInvitationRow && pendingInvitationTournament
            ? {
                id: pendingInvitationRow.id,
                rank: pendingInvitationRow.rank_at_invite,
                deadline: pendingInvitationRow.expires_at,
                tournamentTitle: pendingInvitationTournament.title,
                fee: pendingInvitationTournament.registration_fee,
              }
            : null
        }
      />
      <StatsRow
        wins={profile?.wins ?? 0}
        totalMatches={profile?.total_matches ?? 0}
        goalsScored={profile?.goals_scored ?? 0}
        coinBalance={coinBalance}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <ProgressCard
          xp={profile?.xp ?? 0}
          coinBalance={coinBalance}
          loginStreak={profile?.login_streak ?? 0}
          recentAchievements={recentAchievements}
        />
        <SeasonStandingCard
          seasonRank={seasonRank}
          seasonPoints={seasonPoints}
          pointsAtRankSixteen={pointsAtRankSixteen}
          monthlyRank={monthlyRank}
          monthlyPoints={monthlyPoints}
        />
      </div>
      <MyItemsCard items={ownedItems} />
      <RecentMatchesCard matches={recentMatches} username={profile?.username ?? null} />
      <QuickActions walletBalance={walletBalance} hasSubmittableMatch={hasSubmittableMatch} />
    </DashboardShell>
  )
}
