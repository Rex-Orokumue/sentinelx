import Link from 'next/link'
import { EmptyState } from '@/components/shared/EmptyState'
import { formatMonthYear } from '@/lib/format'
import type { ProfileTitle } from '@/lib/players/profile'

export function ProfileAchievements({ titles }: { titles: ProfileTitle[] }) {
  return (
    <section id="achievements" className="scroll-mt-24">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-white">Achievements</h2>
      </div>
      {titles.length === 0 ? (
        <EmptyState icon="🏆" title="No titles yet" body="Win a tournament to claim your first title." />
      ) : (
        <div className="space-y-2">
          {titles.slice(0, 4).map((t) => {
            const date = formatMonthYear(t.date)
            return (
              <Link
                key={t.tournamentSlug}
                href={`/tournaments/${t.tournamentSlug}`}
                className="flex items-center gap-3 rounded-xl border border-sx-border bg-sx-surface p-4 transition-colors hover:border-sx-purple/40"
              >
                <span className="text-2xl text-sx-purple-text">🏆</span>
                <div className="min-w-0">
                  <p className="truncate font-bold text-white">{t.tournamentTitle}</p>
                  <p className="text-xs text-sx-gray">
                    Champion{t.gameName ? ` · ${t.gameName}` : ''}{date ? ` · ${date}` : ''}
                  </p>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
