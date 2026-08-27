'use client'
import { useState } from 'react'
import { SeasonHero } from './SeasonHero'
import { SeasonSchedule, type ScheduleTournament } from './SeasonSchedule'
import { SeasonLeaderboardTable } from './SeasonLeaderboardTable'
import { ChampionsCupSpotlight } from './ChampionsCupSpotlight'
import type { SeasonLeaderboardRow } from '@/lib/seasons/data'
import type { SeasonTierLabels } from '@/lib/games/season-tier-labels'

export interface SeasonGameSection {
  gameId: string
  gameName: string
  tournaments: ScheduleTournament[]
  leaderboard: SeasonLeaderboardRow[]
  tierLabels: SeasonTierLabels
}

export function SeasonGameTabs({
  sections,
  season,
  currentUserId,
  seasonEndLabel,
}: {
  sections: SeasonGameSection[]
  season: { name: string; start_date: string; end_date: string }
  currentUserId: string | null
  seasonEndLabel: string
}) {
  const [gameId, setGameId] = useState(sections[0]?.gameId ?? '')
  const active = sections.find((s) => s.gameId === gameId) ?? sections[0]
  if (!active) return null

  return (
    <div>
      {sections.length > 1 && (
        <div className="mb-6 flex gap-1 overflow-x-auto scrollbar-hide rounded-xl border border-sx-border bg-sx-surface p-1">
          {sections.map((s) => (
            <button
              key={s.gameId}
              onClick={() => setGameId(s.gameId)}
              className={`shrink-0 flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                active.gameId === s.gameId ? 'bg-sx-purple text-white' : 'text-sx-gray hover:text-white'
              }`}
            >
              {s.gameName}
            </button>
          ))}
        </div>
      )}
      <SeasonHero
        season={season}
        tournaments={active.tournaments}
        playersCompeting={active.leaderboard.length}
        tierLabels={active.tierLabels}
      />
      <SeasonSchedule tournaments={active.tournaments} />
      <SeasonLeaderboardTable
        rows={active.leaderboard}
        currentUserId={currentUserId}
        qualificationNote={active.tierLabels.qualificationNote}
      />
      {active.tierLabels.showChampionsCupSpotlight && <ChampionsCupSpotlight seasonEndLabel={seasonEndLabel} />}
    </div>
  )
}
