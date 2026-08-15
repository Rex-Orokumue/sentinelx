import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { bucketFixtures, isTournamentPublished, type DashboardMatchInput } from '@/lib/dashboard/fixtures'
import { ActiveFixtures, CompletedFixtures } from '@/components/dashboard/FixtureCard'
import { CollapsibleSection } from '@/components/dashboard/CollapsibleSection'
import { MyTournaments, type RegistrationRow } from '@/components/dashboard/MyTournaments'
import { MyListings, type MyListing } from '@/components/dashboard/MyListings'
import { MyBuyRequests, type MyBuyRequest } from '@/components/dashboard/MyBuyRequests'
import { MyOrders } from '@/components/dashboard/MyOrders'
import { latestPerListing, type OrderRow } from '@/lib/exchange/orders'
import { MySales } from '@/components/dashboard/MySales'
import { ProfileEditForm } from '@/components/dashboard/ProfileEditForm'
import { ReferralPanel } from '@/components/dashboard/ReferralPanel'
import { FriendsPanel, type FriendRequestRow, type FriendRow } from '@/components/dashboard/FriendsPanel'
import { FriendliesPanel } from '@/components/dashboard/FriendliesPanel'
import { bucketFriendlies } from '@/lib/friendly-matches/buckets'
import { signOut } from '@/lib/auth/actions'
import { computeDataSupportEligibility } from '@/lib/dashboard/data-support'
import { DataSupportPanel } from '@/components/dashboard/DataSupportPanel'
import {
  computeTournamentStatus,
  type KnockoutMatchInput,
  type TournamentBanner,
} from '@/lib/dashboard/tournament-status'
import type { MembershipInput } from '@/lib/tournaments/standings'
import { TournamentStatusBanners } from '@/components/dashboard/TournamentStatusBanner'
import { recordDailyLogin } from '@/lib/login/actions'
import { getCoinBalance } from '@/lib/coins/service'
import type { RecentAchievement } from '@/components/dashboard/RecentAchievements'
import { HeroIdentityPanel } from '@/components/dashboard/HeroIdentityPanel'
import { NextMatchCard, type NextMatchData } from '@/components/dashboard/NextMatchCard'
import { StatsRow } from '@/components/dashboard/StatsRow'
import { SeasonStandingCard } from '@/components/dashboard/SeasonStandingCard'
import { ProgressCard } from '@/components/dashboard/ProgressCard'
import { RecentMatchesCard } from '@/components/dashboard/RecentMatchesCard'
import { QuickActions } from '@/components/dashboard/QuickActions'
import { mapRecentMatches } from '@/lib/dashboard/recent-matches'
import { getSeasonLeaderboard, getMonthlyLeaderboard } from '@/lib/seasons/data'
import type { MembershipTier } from '@/lib/membership/tiers'

export const metadata: Metadata = {
  title: 'Dashboard · SentinelX Esports',
  robots: { index: false, follow: false },
}

type ProfileRef = {
  id?: string
  username: string | null
  display_name: string | null
  country?: string | null
} | null
type TournamentRef =
  | {
      title: string
      slug: string
      status: string
      data_support_text: string | null
      data_support_whatsapp: string | null
    }
  | {
      title: string
      slug: string
      status: string
      data_support_text: string | null
      data_support_whatsapp: string | null
    }[]
  | null

function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}
function countryOf(p: ProfileRef): string | null {
  return p?.country ?? null
}
function firstTournament(t: TournamentRef): {
  title: string
  slug: string
  status: string
  data_support_text: string | null
  data_support_whatsapp: string | null
} | null {
  if (Array.isArray(t)) return t[0] ?? null
  return t
}

type ReferredRef =
  | { username: string | null; display_name: string | null }
  | { username: string | null; display_name: string | null }[]
  | null
function referredName(r: ReferredRef): string {
  const p = Array.isArray(r) ? r[0] ?? null : r
  return p?.display_name ?? p?.username ?? 'Player'
}

type FriendProfileRef =
  | { username: string | null; display_name: string | null; avatar_url: string | null }
  | { username: string | null; display_name: string | null; avatar_url: string | null }[]
  | null
function friendProfileName(p: FriendProfileRef): { name: string; username: string | null; avatarUrl: string | null } {
  const r = Array.isArray(p) ? p[0] ?? null : p
  return { name: r?.display_name ?? r?.username ?? 'Player', username: r?.username ?? null, avatarUrl: r?.avatar_url ?? null }
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
    matchesRes,
    resultsRes,
    regsRes,
    walletRes,
    listingsRes,
    buyRequestsRes,
    ordersRes,
    salesRes,
    referralsRes,
    friendsRes,
    friendliesRes,
    myGroupMembershipsRes,
    coinBalance,
    achievementsRes,
    nextMatchRes,
    recentMatchesRes,
    achievementSlugsRes,
    activeSeasonRes,
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'username, display_name, avatar_url, whatsapp_number, country, bio, wins, losses, goals_scored, phone_verified_at, xp, membership_tier, login_streak, sx_score, total_matches',
      )
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('matches')
      .select(
        'id, status, scheduled_at, is_full_day, round, tournament_id, player_a_id, player_b_id, score_a, score_b, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name, country), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name, country), ' +
          'tournament:tournaments(title, slug, status, data_support_text, data_support_whatsapp)',
      )
      .or(`player_a_id.eq.${user.id},player_b_id.eq.${user.id}`),
    supabase.from('match_results').select('match_id').eq('submitted_by', user.id),
    supabase
      .from('tournament_registrations')
      .select('id, payment_status, registered_at, tournament:tournaments(title, slug, status)')
      .eq('player_id', user.id)
      .order('registered_at', { ascending: false }),
    supabase.from('wallets').select('balance').eq('player_id', user.id).maybeSingle(),
    supabase
      .from('marketplace_listings')
      .select('id, title, price, status')
      .eq('seller_id', user.id)
      .neq('status', 'removed')
      .order('created_at', { ascending: false }),
    supabase
      .from('buy_requests')
      .select('id, title, budget, status')
      .eq('buyer_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('marketplace_orders')
      .select('id, listing_id, listing_title, amount, status')
      .eq('buyer_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('marketplace_orders')
      .select('id, listing_id, listing_title, amount, status')
      .eq('seller_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('referrals')
      .select('referred:profiles!referrals_referred_id_fkey(username, display_name)')
      .eq('referrer_id', user.id),
    supabase
      .from('friends')
      .select(
        'id, requester_id, recipient_id, status, ' +
          'requester:profiles!friends_requester_id_fkey(username, display_name, avatar_url), ' +
          'recipient:profiles!friends_recipient_id_fkey(username, display_name, avatar_url)',
      )
      .or(`requester_id.eq.${user.id},recipient_id.eq.${user.id}`),
    supabase
      .from('friendly_matches')
      .select('id, status, challenger_id, opponent_id')
      .or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`),
    supabase
      .from('group_memberships')
      .select('group_id, groups(tournament_id)')
      .eq('player_id', user.id),
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
  ])

  const profile = profileRes.data
  type AchievementNameRef = { name: string } | { name: string }[] | null
  const recentAchievements: RecentAchievement[] = ((achievementsRes.data as unknown[] | null) ?? []).map((raw) => {
    const row = raw as { unlocked_at: string; achievements: AchievementNameRef }
    const ref = Array.isArray(row.achievements) ? row.achievements[0] ?? null : row.achievements
    return { name: ref?.name ?? 'Achievement', unlockedAt: row.unlocked_at }
  })
  const myListings: MyListing[] = (listingsRes.data ?? []).map((l) => ({
    id: l.id,
    title: l.title,
    price: l.price,
    status: l.status,
  }))
  const myBuyRequests: MyBuyRequest[] = (buyRequestsRes.data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    budget: r.budget,
    status: r.status as MyBuyRequest['status'],
  }))
  const toOrderRow = (r: {
    id: string
    listing_id: string
    listing_title: string
    amount: number
    status: string
  }): OrderRow => ({
    id: r.id,
    listingId: r.listing_id,
    title: r.listing_title,
    amount: r.amount,
    status: r.status,
  })
  // Both queries are already newest-first — collapse abandoned retries of the
  // same listing down to just the latest attempt.
  const myOrders: OrderRow[] = latestPerListing((ordersRes.data ?? []).map(toOrderRow))
  const mySales: OrderRow[] = latestPerListing((salesRes.data ?? []).map(toOrderRow))

  const submittedMatchIds = new Set((resultsRes.data ?? []).map((r) => r.match_id))

  const rawMatches = ((matchesRes.data as unknown[] | null) ?? []) as {
    id: string
    status: string
    scheduled_at: string | null
    is_full_day: boolean
    round: string
    tournament_id: string
    player_a_id: string
    player_b_id: string
    score_a: number | null
    score_b: number | null
    player_a: ProfileRef
    player_b: ProfileRef
    tournament: TournamentRef
  }[]

  // A bracket generated at registration close (status 'registration_closed') is a
  // staff-only preview until admin publishes it — hide those fixtures from the player
  // dashboard the same way the public bracket page hides them from the public.
  const visibleMatches = rawMatches.filter((mm) => isTournamentPublished(firstTournament(mm.tournament)?.status))

  // Opponent WhatsApp numbers are per-tournament registration data, not
  // profile data. tournament_registrations RLS only lets a player read their
  // OWN row (auth.uid() = player_id) — an opponent's number is invisible to
  // the regular client, so this narrow lookup uses the service-role client,
  // scoped to exactly the opponents in this player's own visible matches
  // (never a blanket read of every registration).
  const matchTournamentIds = Array.from(new Set(visibleMatches.map((mm) => mm.tournament_id)))
  const opponentIds = Array.from(
    new Set(visibleMatches.map((mm) => (mm.player_a_id === user.id ? mm.player_b_id : mm.player_a_id))),
  )
  const { data: regRows } =
    matchTournamentIds.length > 0 && opponentIds.length > 0
      ? await createAdminClient()
          .from('tournament_registrations')
          .select('tournament_id, player_id, reg_whatsapp')
          .in('tournament_id', matchTournamentIds)
          .in('player_id', opponentIds)
      : { data: [] as { tournament_id: string; player_id: string; reg_whatsapp: string | null }[] }
  const whatsappByKey = new Map((regRows ?? []).map((r) => [`${r.tournament_id}:${r.player_id}`, r.reg_whatsapp]))

  const matches: DashboardMatchInput[] = visibleMatches.map((mm) => {
    const opponentId = mm.player_a_id === user.id ? mm.player_b_id : mm.player_a_id
    const opponent = mm.player_a_id === user.id ? mm.player_b : mm.player_a
    const t = firstTournament(mm.tournament)
    return {
      id: mm.id,
      status: mm.status,
      scheduledAt: mm.scheduled_at,
      isFullDay: mm.is_full_day,
      round: mm.round,
      opponentName: nameOf(opponent),
      opponentWhatsapp: whatsappByKey.get(`${mm.tournament_id}:${opponentId}`) ?? null,
      opponentCountry: countryOf(opponent),
      tournamentTitle: t?.title ?? 'Tournament',
      tournamentSlug: t?.slug ?? '',
    }
  })
  const fixtures = bucketFixtures(matches, submittedMatchIds, new Date())
  const hasSubmittableMatch = fixtures.live.length > 0 || fixtures.upcoming.some((f) => f.awaitingMyResult)

  type GroupTournamentRef = { tournament_id: string } | { tournament_id: string }[] | null
  function firstGroupTournamentId(g: GroupTournamentRef): string | null {
    const row = Array.isArray(g) ? g[0] ?? null : g
    return row?.tournament_id ?? null
  }

  const myGroupRows = ((myGroupMembershipsRes.data as unknown[] | null) ?? []) as {
    group_id: string
    groups: GroupTournamentRef
  }[]
  const groupIdByTournamentId = new Map<string, string>()
  for (const r of myGroupRows) {
    const tId = firstGroupTournamentId(r.groups)
    if (tId) groupIdByTournamentId.set(tId, r.group_id)
  }
  const myGroupIds = Array.from(new Set(myGroupRows.map((r) => r.group_id)))

  const [groupStandingsRes, groupMatchesRes] =
    myGroupIds.length > 0
      ? await Promise.all([
          supabase
            .from('group_memberships')
            .select('group_id, player_id, wins, draws, losses, goals_for, goals_against, points')
            .in('group_id', myGroupIds),
          supabase.from('matches').select('group_id, status').in('group_id', myGroupIds).eq('round', 'group'),
        ])
      : [
          {
            data: [] as {
              group_id: string
              player_id: string
              wins: number
              draws: number
              losses: number
              goals_for: number
              goals_against: number
              points: number
            }[],
          },
          { data: [] as { group_id: string; status: string }[] },
        ]

  const groupCompleteById = new Map<string, boolean>()
  const groupStandingsById = new Map<string, MembershipInput[]>()
  for (const groupId of myGroupIds) {
    const matchRows = (groupMatchesRes.data ?? []).filter((m) => m.group_id === groupId)
    groupCompleteById.set(groupId, matchRows.length > 0 && matchRows.every((m) => m.status === 'completed'))
    groupStandingsById.set(
      groupId,
      (groupStandingsRes.data ?? [])
        .filter((r) => r.group_id === groupId)
        .map((r) => ({
          playerId: r.player_id,
          name: '',
          wins: r.wins,
          draws: r.draws,
          losses: r.losses,
          goalsFor: r.goals_for,
          goalsAgainst: r.goals_against,
          points: r.points,
        })),
    )
  }

  const knockoutMatchesByTournament = new Map<string, KnockoutMatchInput[]>()
  for (const mm of visibleMatches) {
    if (mm.round === 'group') continue
    const list = knockoutMatchesByTournament.get(mm.tournament_id) ?? []
    list.push({
      round: mm.round,
      status: mm.status,
      score_a: mm.score_a,
      score_b: mm.score_b,
      player_a_id: mm.player_a_id,
      player_b_id: mm.player_b_id,
    })
    knockoutMatchesByTournament.set(mm.tournament_id, list)
  }

  // Built from rawMatches (not visibleMatches) so an unpublished tournament's
  // title/status is still resolvable here — but such a tournament is then
  // deliberately skipped below via isTournamentPublished, same privacy rule
  // the rest of this page already applies to fixtures.
  const tournamentRefById = new Map<string, { title: string; slug: string; status: string }>()
  for (const mm of rawMatches) {
    const t = firstTournament(mm.tournament)
    if (t) tournamentRefById.set(mm.tournament_id, { title: t.title, slug: t.slug, status: t.status })
  }

  const tournamentIdsToEvaluate = Array.from(
    new Set<string>([...Array.from(knockoutMatchesByTournament.keys()), ...Array.from(groupIdByTournamentId.keys())]),
  )

  const tournamentBanners: NonNullable<TournamentBanner>[] = []
  for (const tournamentId of tournamentIdsToEvaluate) {
    const ref = tournamentRefById.get(tournamentId)
    if (!ref || !isTournamentPublished(ref.status)) continue
    const groupId = groupIdByTournamentId.get(tournamentId) ?? null
    const banner = computeTournamentStatus(user.id, {
      tournamentId,
      tournamentTitle: ref.title,
      tournamentSlug: ref.slug,
      tournamentStatus: ref.status,
      groupId,
      groupComplete: groupId ? groupCompleteById.get(groupId) ?? false : false,
      groupStandings: groupId ? groupStandingsById.get(groupId) ?? [] : [],
      knockoutMatches: knockoutMatchesByTournament.get(tournamentId) ?? [],
    })
    if (banner) tournamentBanners.push(banner)
  }

  const dataSupportEligibility = computeDataSupportEligibility(
    visibleMatches.map((mm) => {
      const t = firstTournament(mm.tournament)
      return {
        round: mm.round,
        tournamentId: mm.tournament_id,
        tournamentTitle: t?.title ?? 'Tournament',
        dataSupportText: t?.data_support_text ?? null,
        dataSupportWhatsapp: t?.data_support_whatsapp ?? null,
      }
    }),
  )

  const registrations: RegistrationRow[] = ((regsRes.data as unknown[] | null) ?? []).map((raw) => {
    const r = raw as { id: string; payment_status: string; tournament: TournamentRef }
    const t = firstTournament(r.tournament)
    return {
      id: r.id,
      paymentStatus: r.payment_status,
      tournamentTitle: t?.title ?? 'Tournament',
      tournamentSlug: t?.slug ?? '',
    }
  })

  const walletBalance = walletRes.data?.balance ?? 0

  const displayName = profile?.display_name ?? profile?.username ?? user.email ?? 'Player'

  const referredPlayers = ((referralsRes.data as unknown[] | null) ?? []).map((raw) =>
    referredName((raw as { referred: ReferredRef }).referred),
  )

  const rawFriends = ((friendsRes.data as unknown[] | null) ?? []) as {
    id: string
    requester_id: string
    recipient_id: string
    status: string
    requester: FriendProfileRef
    recipient: FriendProfileRef
  }[]
  const incomingRequests: FriendRequestRow[] = rawFriends
    .filter((f) => f.status === 'pending' && f.recipient_id === user.id)
    .map((f) => {
      const p = friendProfileName(f.requester)
      return { id: f.id, requesterName: p.name, requesterUsername: p.username, requesterAvatarUrl: p.avatarUrl }
    })
  const friendsList: FriendRow[] = rawFriends
    .filter((f) => f.status === 'accepted')
    .map((f) => {
      const otherIsRequester = f.recipient_id === user.id
      const p = friendProfileName(otherIsRequester ? f.requester : f.recipient)
      return { id: f.id, friendName: p.name, friendUsername: p.username, friendAvatarUrl: p.avatarUrl }
    })

  const rawFriendlies = ((friendliesRes.data as unknown[] | null) ?? []).map((r) => {
    const row = r as { id: string; status: string; challenger_id: string; opponent_id: string }
    return { id: row.id, status: row.status, challengerId: row.challenger_id, opponentId: row.opponent_id }
  })
  const friendlyBuckets = bucketFriendlies(rawFriendlies, user.id)

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

  // ── Season standing (Section 4) ─────────────────────────────────────────
  const activeSeason = activeSeasonRes.data

  let seasonRank: number | null = null
  let seasonPoints = 0
  let pointsAtRankSixteen = 0
  let monthlyRank: number | null = null
  let monthlyPoints = 0
  if (activeSeason) {
    const [seasonBoard, monthlyBoard] = await Promise.all([
      getSeasonLeaderboard(createAdminClient(), activeSeason.id),
      getMonthlyLeaderboard(createAdminClient(), activeSeason.id, new Date()),
    ])
    const seasonIdx = seasonBoard.findIndex((r) => r.playerId === user.id)
    seasonRank = seasonIdx >= 0 ? seasonIdx + 1 : null
    seasonPoints = seasonIdx >= 0 ? seasonBoard[seasonIdx].points : 0
    pointsAtRankSixteen = seasonBoard[15]?.points ?? 0
    const monthlyIdx = monthlyBoard.findIndex((r) => r.playerId === user.id)
    monthlyRank = monthlyIdx >= 0 ? monthlyIdx + 1 : null
    monthlyPoints = monthlyIdx >= 0 ? monthlyBoard[monthlyIdx].points : 0
  }

  // ── Next match (Section 2) ──────────────────────────────────────────────
  type NextMatchOpponentRef = {
    id: string
    display_name: string | null
    username: string | null
    avatar_url: string | null
    membership_tier: string | null
  }
  type NextMatchRow = {
    id: string
    status: string
    round: string
    scheduled_at: string | null
    is_full_day: boolean
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

  // ── Recent matches (Section 6) ──────────────────────────────────────────
  type RecentRawRef = { username: string | null; display_name: string | null } | { username: string | null; display_name: string | null }[] | null
  type RecentTournamentRef = { title: string } | { title: string }[] | null
  const recentMatchRows = ((recentMatchesRes.data as unknown[] | null) ?? []).map((raw) => {
    const r = raw as {
      id: string
      player_a_id: string | null
      player_b_id: string | null
      score_a: number | null
      score_b: number | null
      updated_at: string | null
      tournament: RecentTournamentRef
      player_a: RecentRawRef
      player_b: RecentRawRef
    }
    const isA = r.player_a_id === user.id
    const opp = isA ? r.player_b : r.player_a
    const oppRow = Array.isArray(opp) ? opp[0] ?? null : opp
    const t = Array.isArray(r.tournament) ? r.tournament[0] : r.tournament
    return {
      id: r.id,
      player_a_id: r.player_a_id,
      player_b_id: r.player_b_id,
      score_a: r.score_a,
      score_b: r.score_b,
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
    <div className="mx-auto max-w-4xl px-4 pb-20">
      <div className="space-y-4 py-4">
        <HeroIdentityPanel
          avatarUrl={profile?.avatar_url ?? null}
          displayName={displayName}
          achievements={achievementSlugs}
          xp={profile?.xp ?? 0}
          sxScore={profile?.sx_score ?? 700}
          seasonRank={seasonRank}
          loginStreak={profile?.login_streak ?? 0}
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
        <RecentMatchesCard matches={recentMatches} username={profile?.username ?? null} />
        <QuickActions walletBalance={walletBalance} hasSubmittableMatch={hasSubmittableMatch} />
      </div>

      <form action={signOut} className="mb-4">
        <button
          type="submit"
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
        >
          Sign out
        </button>
      </form>
      <ProfileEditForm
        profile={{
          displayName: profile?.display_name ?? null,
          username: profile?.username ?? null,
          avatarUrl: profile?.avatar_url ?? null,
          whatsapp: profile?.whatsapp_number ?? null,
          country: profile?.country ?? null,
          bio: profile?.bio ?? null,
          phoneVerifiedAt: profile?.phone_verified_at ?? null,
        }}
      />
      <CollapsibleSection
        id="referrals"
        title="Referrals"
        defaultOpen={false}
        summary={`${referredPlayers.length} referral${referredPlayers.length === 1 ? '' : 's'}`}
      >
        <ReferralPanel username={profile?.username ?? ''} referredPlayers={referredPlayers} />
      </CollapsibleSection>

      {dataSupportEligibility.length > 0 && (
        <CollapsibleSection title="Data support" defaultOpen={false}>
          <DataSupportPanel username={profile?.username ?? ''} eligibility={dataSupportEligibility} />
        </CollapsibleSection>
      )}

      <CollapsibleSection id="friends" title="Friends" defaultOpen={incomingRequests.length > 0}>
        <FriendsPanel incoming={incomingRequests} friends={friendsList} />
      </CollapsibleSection>

      <CollapsibleSection
        id="friendlies"
        title="Friendlies"
        defaultOpen={friendlyBuckets.pending.length > 0 || friendlyBuckets.active.length > 0}
        summary={`${friendlyBuckets.completed.length} completed`}
      >
        <FriendliesPanel
          pendingCount={friendlyBuckets.pending.length}
          activeCount={friendlyBuckets.active.length}
          completedCount={friendlyBuckets.completed.length}
        />
      </CollapsibleSection>

      <CollapsibleSection id="matches" title="Active matches" defaultOpen>
        <TournamentStatusBanners banners={tournamentBanners} />
        <ActiveFixtures fixtures={{ live: fixtures.live, upcoming: fixtures.upcoming }} />
      </CollapsibleSection>
      <CollapsibleSection
        title="Completed matches"
        defaultOpen={false}
        summary={`${fixtures.completed.length} completed`}
      >
        <CompletedFixtures fixtures={fixtures.completed} />
      </CollapsibleSection>

      <MyTournaments registrations={registrations} />
      <MyListings listings={myListings} />
      <MyBuyRequests requests={myBuyRequests} />
      <MyOrders orders={myOrders} />
      <MySales sales={mySales} />
    </div>
  )
}
