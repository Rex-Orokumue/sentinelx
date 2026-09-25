import { createClient } from '@/lib/supabase/server'
import { frameUrlFor } from '@/lib/store/cosmetics'
import { getHallOfFame } from '@/lib/hall-of-fame/service'
import { SectionHeader } from '@/components/hall-of-fame/SectionHeader'
import { HeroSection } from '@/components/hall-of-fame/HeroSection'
import { AllTimeAwardCard, AllTimeAwardEmptyCard } from '@/components/hall-of-fame/AllTimeAwardCard'
import { CategoryAwardFilter } from '@/components/hall-of-fame/CategoryAwardFilter'
import { ChampionsCupCard, ChampionsCupEmptyCard } from '@/components/hall-of-fame/ChampionsCupCard'
import { TournamentChampionCard } from '@/components/hall-of-fame/TournamentChampionCard'
import { HallOfFameGameFilter } from '@/components/hall-of-fame/HallOfFameGameFilter'
import { MastersChampionCard, MastersChampionEmptyCard } from '@/components/hall-of-fame/MastersChampionCard'
import { CommunityClubCard } from '@/components/hall-of-fame/CommunityClubCard'
import { BronzeCard } from '@/components/hall-of-fame/BronzeCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  return buildMetadata({
    title: 'Hall of Fame — Sentinel X',
    description: "Sentinel X champions, MVP, and Golden Boot — the all-time honors of Nigeria's home of mobile esports.",
    path: '/hall-of-fame',
    locale,
  })
}

export default async function HallOfFamePage({ searchParams }: { searchParams: { game?: string } }) {
  const data = await getHallOfFame(createClient(), { gameSlug: searchParams.game?.trim() || null })
  const {
    activeGameList,
    selectedGame,
    mvp,
    goldenBootOptions,
    categoryAwards,
    championGroups,
    championProfileById,
    cupEntry,
    cupChampionSlugs,
    thirdPlaces,
    hasAwards,
    hasBronze,
  } = data
  const showEmptySections = !selectedGame

  return (
    <>
      <HeroSection />
      <div className="mx-auto max-w-3xl px-4 pb-20">
        <div className="pt-8">
          <HallOfFameGameFilter games={activeGameList} activeSlug={selectedGame?.slug ?? null} />
        </div>
        <section className="border-b border-amber-500/10 py-16">
          <SectionHeader icon="☀️" title="All-Time Awards" subtitle="The greatest individuals in SentinelX history." tone="gold" />
          {hasAwards ? (
            <>
              <div className="flex flex-col gap-4 sm:flex-row">
                {mvp ? (
                  <AllTimeAwardCard
                    label="MVP"
                    icon="⭐"
                    avatarUrl={mvp.avatarUrl}
                    name={mvp.displayName ?? mvp.username ?? 'Anonymous'}
                    membershipTier={mvp.membershipTier}
                    frameUrl={mvp.frameUrl}
                    sentinelTier={mvp.sentinelTier}
                    metricLabel="SX Score"
                    metricValue={mvp.sxScore}
                    awardName="All-Time MVP"
                  />
                ) : (
                  <AllTimeAwardEmptyCard label="MVP" icon="⭐" />
                )}
                <CategoryAwardFilter
                  label="Golden Boot"
                  icon="👟"
                  metricLabel="goals scored"
                  awardName="All-Time Golden Boot"
                  options={goldenBootOptions}
                />
              </div>
              {categoryAwards.length > 0 && (
                <div className="mt-4 flex flex-col gap-4 sm:flex-row">
                  {categoryAwards.map(({ category, meta, options }) => (
                    <CategoryAwardFilter
                      key={category}
                      label={meta.awardName}
                      icon={meta.awardEmoji}
                      metricLabel={meta.statLabel.toLowerCase()}
                      awardName={meta.awardName}
                      options={options}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-4 sm:flex-row">
              <AllTimeAwardEmptyCard label="MVP" icon="⭐" />
              <AllTimeAwardEmptyCard label="Golden Boot" icon="👟" />
            </div>
          )}
        </section>

        {(cupEntry || showEmptySections) && (
        <section
          className="border-y border-sx-purple/30 py-16"
          style={{ background: 'linear-gradient(180deg, rgba(124,58,237,0.08) 0%, transparent 100%)' }}
        >
          <SectionHeader
            icon="🏆"
            title="Champions Cup Legends"
            subtitle="The greatest prize in Nigerian mobile esports. Annual · Invitation Only."
            tone="purple"
          />
          {cupEntry ? (
            <ChampionsCupCard
              avatarUrl={cupEntry.championAvatarUrl}
              name={cupEntry.champion.name}
              achievements={cupChampionSlugs}
              sentinelTier={championProfileById.get(cupEntry.champion.id)?.sentinel_tier ?? null}
              frameUrl={frameUrlFor(championProfileById.get(cupEntry.champion.id)?.equipped_avatar_border)}
              slug={cupEntry.slug}
              date={cupEntry.date}
              prizePool={cupEntry.prizePool ?? 0}
              seasonName={cupEntry.seasonName}
            />
          ) : (
            <ChampionsCupEmptyCard />
          )}
        </section>
        )}

        {(championGroups.masters.length > 0 || showEmptySections) && (
        <section className="border-t border-amber-500/20 py-16">
          <SectionHeader icon="👑" title="Masters Champions" subtitle="Monthly elite champions — the top 16 per month, competing for the prize." tone="gold" />
          {championGroups.masters.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {championGroups.masters.map((r) => (
                <MastersChampionCard
                  key={r.tournamentId}
                  title={r.title}
                  avatarUrl={r.championAvatarUrl}
                  name={r.champion.name}
                  membershipTier={championProfileById.get(r.champion.id)?.membership_tier ?? null}
                  frameUrl={frameUrlFor(championProfileById.get(r.champion.id)?.equipped_avatar_border)}
                  sentinelTier={championProfileById.get(r.champion.id)?.sentinel_tier ?? null}
                  slug={r.slug}
                  prizePool={r.prizePool ?? 0}
                  runnerUpName={r.runnerUp?.name ?? null}
                />
              ))}
            </div>
          ) : (
            <MastersChampionEmptyCard title="August 2026 Masters" />
          )}
        </section>
        )}

        {(championGroups.community_club.length > 0 || showEmptySections) && (
        <section className="py-16">
          <SectionHeader icon="⚡" title="Community Club Champions" subtitle="Weekly community tournaments — where every legend starts." />
          {championGroups.community_club.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {championGroups.community_club.map((r) => (
                <CommunityClubCard
                  key={r.tournamentId}
                  avatarUrl={r.championAvatarUrl}
                  name={r.champion.name}
                  membershipTier={championProfileById.get(r.champion.id)?.membership_tier ?? null}
                  frameUrl={frameUrlFor(championProfileById.get(r.champion.id)?.equipped_avatar_border)}
                  sentinelTier={championProfileById.get(r.champion.id)?.sentinel_tier ?? null}
                  slug={r.slug}
                  title={r.title}
                  date={r.date}
                  runnerUpName={r.runnerUp?.name ?? null}
                />
              ))}
            </div>
          ) : (
            <EmptyState icon="⚡" title="No Community Club champions yet" body="Weekly champions appear here once a tournament finishes." />
          )}
        </section>
        )}

        {championGroups.open.length > 0 && (
          <section className="py-16">
            <SectionHeader icon="🏆" title="Tournament Champions" subtitle="Every other competition across the platform." />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {championGroups.open.map((entry) => (
                <TournamentChampionCard
                  key={entry.tournamentId}
                  entry={entry}
                  membershipTier={championProfileById.get(entry.champion.id)?.membership_tier ?? null}
                  frameUrl={frameUrlFor(championProfileById.get(entry.champion.id)?.equipped_avatar_border)}
                />
              ))}
            </div>
          </section>
        )}

        <section className="py-16">
          <SectionHeader icon="🥉" title="Bronze Finishes" subtitle="Third-place finishers across every tournament." />
          {hasBronze ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {thirdPlaces.map((tp) => (
                <BronzeCard key={tp.tournamentId} playerName={tp.player.name} slug={tp.slug} title={tp.title} gameName={tp.gameName} date={tp.date} />
              ))}
            </div>
          ) : (
            <EmptyState icon="🥉" title="No third place finishes yet" body="3rd place winners appear here once a bronze match is confirmed." />
          )}
        </section>
      </div>
    </>
  )
}
